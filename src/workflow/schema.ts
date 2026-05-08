import path from "node:path";
import type { JsonValue, WorkflowConfig, WorkflowDefinition } from "../types.js";
import { validateAgentConfig } from "../agents/registry.js";
import { interpolateEnv } from "../config/env.js";
import { validateTrackerConfig } from "../trackers/registry.js";

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid WORKFLOW.md:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "WorkflowValidationError";
  }
}

export function validateWorkflow(definition: WorkflowDefinition, workflowPath: string): WorkflowConfig {
  const interpolated = interpolateEnv(definition.config);
  const issues: string[] = [];
  const config = interpolated as Record<string, JsonValue>;
  const baseDir = path.dirname(path.resolve(workflowPath));

  const tracker = objectAt(config, "tracker", issues);
  const state = objectAt(config, "state", issues, "state", false);
  const workspace = objectAt(config, "workspace", issues);
  const repository = objectAt(config, "repository", issues);
  const branch = objectAt(config, "branch", issues, "branch", false);
  const github = objectAt(config, "github", issues);
  const agent = objectAt(config, "agent", issues);
  const states = objectAt(config, "states", issues);
  const limits = objectAt(config, "limits", issues);
  const daemon = objectAt(config, "daemon", issues, "daemon", false);
  const dashboard = objectAt(config, "dashboard", issues, "dashboard", false);
  const retry = objectAt(config, "retry", issues, "retry", false);
  const safety = objectAt(config, "safety", issues, "safety", false);

  const version = numberAt(config, "version", issues);
  const trackerConfig = validateTrackerConfig(tracker, { baseDir, issues });
  const stateKind = optionalStringAt(state, "kind", issues, "state.kind") ?? "memory";
  const stateFilePath = optionalStringAt(state, "filePath", issues, "state.file_path");
  const postgresConnectionString = optionalStringAt(state, "connectionString", issues, "state.connection_string");
  const postgresLockTtlSeconds = optionalNumberAt(state, "lockTtlSeconds", issues, "state.lock_ttl_seconds") ?? 900;
  const agentConfig = validateAgentConfig(agent, { baseDir, issues });
  const workspaceRoot = stringAt(workspace, "root", issues, "workspace.root");
  const repositoryUrl = stringAt(repository, "url", issues, "repository.url");
  const baseBranch = stringAt(repository, "baseBranch", issues, "repository.base_branch");
  const cloneDir = optionalStringAt(repository, "cloneDir", issues, "repository.clone_dir") ?? "repo";
  const branchPrefix = optionalStringAt(branch, "prefix", issues, "branch.prefix") ?? "symphony";
  const githubKind = stringAt(github, "kind", issues, "github.kind");
  const githubRemote = optionalStringAt(github, "remote", issues, "github.remote") ?? "origin";
  const githubDraft = optionalBooleanAt(github, "draft", issues, "github.draft") ?? true;
  const githubLogDir = optionalStringAt(github, "logDir", issues, "github.log_dir") ?? "logs";
  const activeStates = stringArrayAt(states, "active", issues, "states.active");
  const terminalStates = stringArrayAt(states, "terminal", issues, "states.terminal");
  const maxConcurrency = numberAt(limits, "maxConcurrency", issues, "limits.max_concurrency");
  const pollIntervalSeconds =
    optionalNumberAt(daemon, "pollIntervalSeconds", issues, "daemon.poll_interval_seconds") ?? 60;
  const dashboardEnabled = optionalBooleanAt(dashboard, "enabled", issues, "dashboard.enabled") ?? false;
  const dashboardHost = optionalStringAt(dashboard, "host", issues, "dashboard.host") ?? "127.0.0.1";
  const dashboardPort = optionalNumberAt(dashboard, "port", issues, "dashboard.port") ?? 4000;
  const retryMaxAttempts = optionalNumberAt(retry, "maxAttempts", issues, "retry.max_attempts") ?? 2;
  const retryFailureCooldownSeconds =
    optionalNumberAt(retry, "failureCooldownSeconds", issues, "retry.failure_cooldown_seconds") ?? 300;
  const retryableErrors =
    optionalStringArrayAt(retry, "retryableErrors", issues, "retry.retryable_errors") ?? [
      "agent_timeout",
      "network_error",
      "transient_tracker_error"
    ];
  const retryWithExistingPullRequest =
    optionalBooleanAt(retry, "retryWithExistingPullRequest", issues, "retry.retry_with_existing_pull_request") ?? false;
  const rerunSucceeded = optionalBooleanAt(retry, "rerunSucceeded", issues, "retry.rerun_succeeded") ?? false;
  const allowAutoMerge = optionalBooleanAt(safety, "allowAutoMerge", issues, "safety.allow_auto_merge") ?? false;
  const allowedCommands = optionalStringArrayAt(safety, "allowedCommands", issues, "safety.allowed_commands") ?? [];
  const blockedCommands = optionalStringArrayAt(safety, "blockedCommands", issues, "safety.blocked_commands") ?? [];

  if (version !== undefined && version !== 1) {
    issues.push("version must be 1.");
  }
  if (githubKind !== undefined && githubKind !== "gh") {
    issues.push("github.kind must be gh.");
  }
  if (githubDraft !== undefined && githubDraft !== true) {
    issues.push("github.draft must be true; Symphony never creates ready-for-review PRs automatically.");
  }
  if (stateKind !== "memory" && stateKind !== "json" && stateKind !== "postgres") {
    issues.push("state.kind must be memory, json, or postgres when provided. SQLite is not implemented in this repository.");
  }
  if (stateKind === "json") {
    if (stateFilePath === undefined) {
      issues.push("state.file_path must be provided when state.kind is json.");
    } else if (stateFilePath.includes("\0")) {
      issues.push("state.file_path contains an invalid null byte.");
    }
  }
  if (stateKind === "postgres") {
    if (postgresConnectionString === undefined) {
      issues.push("state.connection_string must be provided when state.kind is postgres.");
    } else if (!/^postgres(?:ql)?:\/\//.test(postgresConnectionString)) {
      issues.push("state.connection_string must use postgres:// or postgresql://.");
    }
    if (!Number.isFinite(postgresLockTtlSeconds) || postgresLockTtlSeconds < 1) {
      issues.push("state.lock_ttl_seconds must be greater than or equal to 1 when provided.");
    }
  }
  if (cloneDir.includes("/") || cloneDir.includes("\\") || cloneDir === "." || cloneDir === "..") {
    issues.push("repository.clone_dir must be a single directory name.");
  }
  if (branchPrefix.includes("..") || branchPrefix.includes("@{")) {
    issues.push("branch.prefix contains invalid git ref syntax.");
  }
  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)) {
    issues.push("limits.max_concurrency must be an integer greater than or equal to 1.");
  }
  if (maxConcurrency !== undefined && maxConcurrency !== 1) {
    issues.push("limits.max_concurrency must remain 1 until parallel orchestration is implemented.");
  }
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 1) {
    issues.push("daemon.poll_interval_seconds must be greater than or equal to 1 when provided.");
  }
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) {
    issues.push("dashboard.port must be an integer between 1 and 65535 when provided.");
  }
  if (!Number.isInteger(retryMaxAttempts) || retryMaxAttempts < 1) {
    issues.push("retry.max_attempts must be an integer greater than or equal to 1 when provided.");
  }
  if (!Number.isFinite(retryFailureCooldownSeconds) || retryFailureCooldownSeconds < 0) {
    issues.push("retry.failure_cooldown_seconds must be greater than or equal to 0 when provided.");
  }
  if (retryableErrors.length === 0 || retryableErrors.some((value) => value.trim().length === 0)) {
    issues.push("retry.retryable_errors must contain at least one non-empty string.");
  }

  if (issues.length > 0) {
    throw new WorkflowValidationError(issues);
  }

  return {
    version: 1,
    workflowPath: path.resolve(workflowPath),
    tracker: trackerConfig!,
    state: stateConfigFor(stateKind, baseDir, stateFilePath, postgresConnectionString, postgresLockTtlSeconds),
    workspace: {
      root: path.resolve(baseDir, workspaceRoot!)
    },
    repository: {
      url: resolveRepositoryUrl(baseDir, repositoryUrl!),
      baseBranch: baseBranch!,
      cloneDir
    },
    branch: {
      prefix: branchPrefix
    },
    github: {
      kind: "gh",
      remote: githubRemote,
      draft: true,
      logDir: path.resolve(baseDir, githubLogDir)
    },
    agent: agentConfig!,
    states: {
      active: activeStates!,
      terminal: terminalStates!
    },
    limits: {
      maxConcurrency: maxConcurrency!
    },
    retry: {
      maxAttempts: retryMaxAttempts,
      failureCooldownSeconds: retryFailureCooldownSeconds,
      retryableErrors,
      retryWithExistingPullRequest,
      rerunSucceeded
    },
    daemon: {
      pollIntervalSeconds
    },
    dashboard: {
      enabled: dashboardEnabled,
      host: dashboardHost,
      port: dashboardPort
    },
    safety: {
      allowAutoMerge,
      allowedCommands,
      blockedCommands
    }
  };
}

function stateConfigFor(
  kind: string,
  baseDir: string,
  stateFilePath: string | undefined,
  postgresConnectionString: string | undefined,
  postgresLockTtlSeconds: number
): WorkflowConfig["state"] {
  if (kind === "postgres") {
    return {
      kind: "postgres",
      connectionString: postgresConnectionString!,
      lockTtlSeconds: postgresLockTtlSeconds
    };
  }
  if (kind === "json") {
    return {
      kind: "json",
      filePath: path.resolve(baseDir, stateFilePath!)
    };
  }
  return {
    kind: "memory"
  };
}

function objectAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key,
  required = true
): Record<string, JsonValue> {
  const value = parent[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (required || value !== undefined) {
      issues.push(`${display} must be an object.`);
    }
    return {};
  }
  return value;
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

function numberAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): number | undefined {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${display} must be a number.`);
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

function stringArrayAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string[] | undefined {
  const value = parent[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push(`${display} must be a non-empty string array.`);
    return undefined;
  }
  return value as string[];
}

function resolveRepositoryUrl(baseDir: string, repositoryUrl: string): string {
  if (/^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/.test(repositoryUrl)) {
    return repositoryUrl;
  }
  return path.resolve(baseDir, repositoryUrl);
}
