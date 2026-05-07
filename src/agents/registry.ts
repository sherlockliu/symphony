import path from "node:path";
import type { JsonValue } from "../types.js";
import type { AgentRunner } from "./agentRunner.js";
import { CodexRunner } from "./codexRunner.js";
import { DryRunRunner } from "./dryRunRunner.js";
import type { ProcessExecutor } from "./processExecutor.js";

export interface DryRunAgentConfig {
  kind: "dry-run";
  timeoutSeconds: number;
  logDir: string;
}

export interface CodexAgentConfig {
  kind: "codex";
  command: string;
  args: string[];
  timeoutSeconds: number;
  logDir: string;
}

export interface CustomAgentConfig {
  kind: string;
  timeoutSeconds: number;
  logDir: string;
  [key: string]: unknown;
}

export type BuiltInAgentConfig = DryRunAgentConfig | CodexAgentConfig;
export type AgentConfig = BuiltInAgentConfig | CustomAgentConfig;

export interface AgentValidationContext {
  baseDir: string;
  issues: string[];
}

export interface AgentRunnerDependencies {
  executor?: ProcessExecutor;
}

export interface AgentRunnerRegistration<TConfig extends AgentConfig = AgentConfig> {
  kind: string;
  validate(raw: Record<string, JsonValue>, context: AgentValidationContext): TConfig | undefined;
  create(config: TConfig, dependencies?: AgentRunnerDependencies): AgentRunner;
}

const registry = new Map<string, AgentRunnerRegistration>();

export function registerAgentRunner<TConfig extends AgentConfig>(
  registration: AgentRunnerRegistration<TConfig>,
  options: { replace?: boolean } = {}
): void {
  if (registry.has(registration.kind) && options.replace !== true) {
    throw new Error(`Agent runner kind ${registration.kind} is already registered.`);
  }
  registry.set(registration.kind, registration as AgentRunnerRegistration);
}

export function createAgentRunnerFromRegistry(
  config: AgentConfig,
  dependencies: AgentRunnerDependencies = {}
): AgentRunner {
  const registration = registry.get(config.kind);
  if (registration === undefined) {
    throw new Error(`Agent runner kind ${config.kind} is not registered.`);
  }
  return registration.create(config, dependencies);
}

export function validateAgentConfig(
  raw: Record<string, JsonValue>,
  context: AgentValidationContext
): AgentConfig | undefined {
  const kind = stringAt(raw, "kind", context.issues, "agent.kind");
  if (kind === undefined) {
    return undefined;
  }
  const registration = registry.get(kind);
  if (registration === undefined) {
    context.issues.push(`agent.kind must be one of: ${registeredAgentRunnerKinds().join(", ")}.`);
    return undefined;
  }
  return registration.validate(raw, context);
}

export function registeredAgentRunnerKinds(): string[] {
  return [...registry.keys()].sort();
}

registerAgentRunner<DryRunAgentConfig>({
  kind: "dry-run",
  validate(raw, context) {
    const timeoutSeconds = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds") ?? 900;
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";
    validateCommonAgentFields(timeoutSeconds, context.issues);
    return {
      kind: "dry-run",
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir)
    };
  },
  create(config) {
    return new DryRunRunner(config);
  }
});

registerAgentRunner<CodexAgentConfig>({
  kind: "codex",
  validate(raw, context) {
    const timeoutSeconds = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds") ?? 900;
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";
    const command = optionalStringAt(raw, "command", context.issues, "agent.command") ?? "codex";
    const args = optionalStringArrayAt(raw, "args", context.issues, "agent.args") ?? ["exec", "-"];
    validateCommonAgentFields(timeoutSeconds, context.issues);
    return {
      kind: "codex",
      command,
      args,
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir)
    };
  },
  create(config, dependencies) {
    return new CodexRunner(config, dependencies?.executor);
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
