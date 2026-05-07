import path from "node:path";
import type { JsonValue } from "../types.js";
import type { AgentCapabilities, AgentRunner } from "./agentRunner.js";
import { CodexRunner } from "./codexRunner.js";
import { DryRunRunner } from "./dryRunRunner.js";
import type { ProcessExecutor } from "./processExecutor.js";
import { ShellRunner } from "./shellRunner.js";

export interface DryRunAgentConfig {
  kind: "dry-run";
  timeoutSeconds: number;
  logDir: string;
  savePrompt?: boolean;
}

export interface CodexAgentConfig {
  kind: "codex";
  command: string;
  args: string[];
  timeoutSeconds: number;
  logDir: string;
  savePrompt?: boolean;
}

export interface ShellAgentConfig {
  kind: "shell";
  command: string;
  timeoutSeconds: number;
  logDir: string;
  promptMode: "stdin" | "file";
  env: Record<string, string>;
  savePrompt: boolean;
}

export interface CustomAgentConfig {
  kind: string;
  timeoutSeconds: number;
  logDir: string;
  savePrompt?: boolean;
  [key: string]: unknown;
}

export type BuiltInAgentConfig = DryRunAgentConfig | CodexAgentConfig | ShellAgentConfig;
export type AgentConfig = BuiltInAgentConfig | CustomAgentConfig;

export interface AgentValidationContext {
  baseDir: string;
  issues: string[];
}

export interface AgentRunnerDependencies {
  executor?: ProcessExecutor;
}

export interface AgentRunnerFactory<TConfig extends AgentConfig = AgentConfig> {
  kind: string;
  capabilities: AgentCapabilities;
  validateConfig(raw: Record<string, JsonValue>, context: AgentValidationContext): TConfig | undefined;
  create(config: TConfig, dependencies?: AgentRunnerDependencies): AgentRunner;
}

export type AgentRunnerRegistration<TConfig extends AgentConfig = AgentConfig> = AgentRunnerFactory<TConfig>;

export class AgentRunnerRegistry {
  private readonly factories = new Map<string, AgentRunnerFactory>();

  register<TConfig extends AgentConfig>(
    factory: AgentRunnerFactory<TConfig>,
    options: { replace?: boolean } = {}
  ): void {
    if (this.factories.has(factory.kind) && options.replace !== true) {
      throw new Error(`Agent runner kind ${factory.kind} is already registered.`);
    }
    this.factories.set(factory.kind, factory as AgentRunnerFactory);
  }

  create(config: AgentConfig, dependencies: AgentRunnerDependencies = {}): AgentRunner {
    const factory = this.factories.get(config.kind);
    if (factory === undefined) {
      throw new Error(`Agent runner kind ${config.kind} is not registered.`);
    }
    return factory.create(config, dependencies);
  }

  validateConfig(raw: Record<string, JsonValue>, context: AgentValidationContext): AgentConfig | undefined {
    const kind = stringAt(raw, "kind", context.issues, "agent.kind");
    if (kind === undefined) {
      return undefined;
    }
    const factory = this.factories.get(kind);
    if (factory === undefined) {
      context.issues.push(`agent.kind must be one of: ${this.listKinds().join(", ")}.`);
      return undefined;
    }
    return factory.validateConfig(raw, context);
  }

  listKinds(): string[] {
    return [...this.factories.keys()].sort();
  }
}

export const defaultAgentRunnerRegistry = new AgentRunnerRegistry();

export function registerAgentRunner<TConfig extends AgentConfig>(
  registration: AgentRunnerRegistration<TConfig>,
  options: { replace?: boolean } = {}
): void {
  defaultAgentRunnerRegistry.register(registration, options);
}

export function createAgentRunnerFromRegistry(
  config: AgentConfig,
  dependencies: AgentRunnerDependencies = {}
): AgentRunner {
  return defaultAgentRunnerRegistry.create(config, dependencies);
}

export function validateAgentConfig(
  raw: Record<string, JsonValue>,
  context: AgentValidationContext
): AgentConfig | undefined {
  return defaultAgentRunnerRegistry.validateConfig(raw, context);
}

export function registeredAgentRunnerKinds(): string[] {
  return defaultAgentRunnerRegistry.listKinds();
}

registerAgentRunner<DryRunAgentConfig>({
  kind: "dry-run",
  capabilities: {
    canEditFiles: false,
    canRunCommands: false,
    canCreateCommits: false,
    canOpenPullRequests: false
  },
  validateConfig(raw, context) {
    const timeoutSeconds = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds") ?? 900;
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";
    const savePrompt = optionalBooleanAt(raw, "savePrompt", context.issues, "agent.save_prompt") ?? true;
    validateCommonAgentFields(timeoutSeconds, context.issues);
    return {
      kind: "dry-run",
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir),
      savePrompt
    };
  },
  create(config) {
    return new DryRunRunner(config);
  }
});

registerAgentRunner<CodexAgentConfig>({
  kind: "codex",
  capabilities: {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  },
  validateConfig(raw, context) {
    const timeoutSeconds = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds") ?? 900;
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";
    const command = optionalStringAt(raw, "command", context.issues, "agent.command") ?? "codex";
    const args = optionalStringArrayAt(raw, "args", context.issues, "agent.args") ?? ["exec", "-"];
    const savePrompt = optionalBooleanAt(raw, "savePrompt", context.issues, "agent.save_prompt") ?? false;
    validateCommonAgentFields(timeoutSeconds, context.issues);
    return {
      kind: "codex",
      command,
      args,
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir),
      savePrompt
    };
  },
  create(config, dependencies) {
    return new CodexRunner(config, dependencies?.executor);
  }
});

registerAgentRunner<ShellAgentConfig>({
  kind: "shell",
  capabilities: {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  },
  validateConfig(raw, context) {
    const timeoutSecondsValue = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds");
    const timeoutMinutesValue = optionalNumberAt(raw, "timeoutMinutes", context.issues, "agent.timeout_minutes");
    const timeoutSeconds = timeoutSecondsValue ?? (timeoutMinutesValue === undefined ? 900 : timeoutMinutesValue * 60);
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";
    const command = stringAt(raw, "command", context.issues, "agent.command");
    const promptMode = optionalStringAt(raw, "promptMode", context.issues, "agent.prompt_mode") ?? "stdin";
    const env = optionalStringRecordAt(raw, "env", context.issues, "agent.env") ?? {};
    const savePrompt = optionalBooleanAt(raw, "savePrompt", context.issues, "agent.save_prompt") ?? false;

    validateCommonAgentFields(timeoutSeconds, context.issues);
    if (promptMode !== "stdin" && promptMode !== "file") {
      context.issues.push("agent.prompt_mode must be stdin or file.");
    }
    if (command === undefined) {
      return undefined;
    }
    return {
      kind: "shell",
      command,
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir),
      promptMode: promptMode === "file" ? "file" : "stdin",
      env,
      savePrompt
    };
  },
  create(config, dependencies) {
    return new ShellRunner(config, dependencies?.executor);
  }
});

function validateCommonAgentFields(timeoutSeconds: number, issues: string[]): void {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    issues.push("agent.timeout_seconds must be greater than 0.");
  }
}

function stringAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string | undefined {
  const value = parent[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function optionalStringAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string when provided.`);
    return undefined;
  }
  return value;
}

function optionalNumberAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): number | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${display} must be a number when provided.`);
    return undefined;
  }
  return value;
}

function optionalStringArrayAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push(`${display} must be a string array when provided.`);
    return undefined;
  }
  return value as string[];
}

function optionalBooleanAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): boolean | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push(`${display} must be a boolean when provided.`);
    return undefined;
  }
  return value;
}

function optionalStringRecordAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): Record<string, string> | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${display} must be an object when provided.`);
    return undefined;
  }
  const record = value as Record<string, JsonValue>;
  const output: Record<string, string> = {};
  for (const [envKey, envValue] of Object.entries(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
      issues.push(`${display}.${envKey} must be a valid environment variable name.`);
      continue;
    }
    if (typeof envValue !== "string") {
      issues.push(`${display}.${envKey} must be a string.`);
      continue;
    }
    output[envKey] = envValue;
  }
  return output;
}
