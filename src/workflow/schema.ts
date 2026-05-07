import path from "node:path";
import type { JsonValue, WorkflowConfig, WorkflowDefinition } from "../types.js";
import { interpolateEnv } from "../config/env.js";

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

  const tracker = objectAt(config, "tracker", issues);
  const workspace = objectAt(config, "workspace", issues);
  const repository = objectAt(config, "repository", issues);
  const branch = objectAt(config, "branch", issues, "branch", false);
  const github = objectAt(config, "github", issues);
  const agent = objectAt(config, "agent", issues);
  const states = objectAt(config, "states", issues);
  const limits = objectAt(config, "limits", issues);

  const version = numberAt(config, "version", issues);
  const trackerKind = stringAt(tracker, "kind", issues, "tracker.kind");
  const issueFile = optionalStringAt(tracker, "issueFile", issues, "tracker.issue_file");
  const jiraBaseUrl = optionalStringAt(tracker, "baseUrl", issues, "tracker.base_url");
  const jiraEmail = optionalStringAt(tracker, "email", issues, "tracker.email");
  const jiraApiToken = optionalStringAt(tracker, "apiToken", issues, "tracker.api_token");
  const jiraJql = optionalStringAt(tracker, "jql", issues, "tracker.jql");
  const jiraMaxResults = optionalNumberAt(tracker, "maxResults", issues, "tracker.max_results") ?? 50;
  const jiraReviewTransition =
    optionalStringAt(tracker, "reviewTransition", issues, "tracker.review_transition") ?? "Human Review";
  const planeBaseUrl = optionalStringAt(tracker, "baseUrl", issues, "tracker.base_url");
  const planeApiKey = optionalStringAt(tracker, "apiKey", issues, "tracker.api_key");
  const planeWorkspaceSlug = optionalStringAt(tracker, "workspaceSlug", issues, "tracker.workspace_slug");
  const planeProjectId = optionalStringAt(tracker, "projectId", issues, "tracker.project_id");
  const planeMaxResults = optionalNumberAt(tracker, "maxResults", issues, "tracker.max_results") ?? 50;
  const planeReviewState = optionalStringAt(tracker, "reviewState", issues, "tracker.review_state") ?? "Human Review";
  const workspaceRoot = stringAt(workspace, "root", issues, "workspace.root");
  const repositoryUrl = stringAt(repository, "url", issues, "repository.url");
  const baseBranch = stringAt(repository, "baseBranch", issues, "repository.base_branch");
  const cloneDir = optionalStringAt(repository, "cloneDir", issues, "repository.clone_dir") ?? "repo";
  const branchPrefix = optionalStringAt(branch, "prefix", issues, "branch.prefix") ?? "symphony";
  const githubKind = stringAt(github, "kind", issues, "github.kind");
  const githubRemote = optionalStringAt(github, "remote", issues, "github.remote") ?? "origin";
  const githubDraft = optionalBooleanAt(github, "draft", issues, "github.draft") ?? true;
  const githubLogDir = optionalStringAt(github, "logDir", issues, "github.log_dir") ?? "logs";
  const agentKind = stringAt(agent, "kind", issues, "agent.kind");
  const agentTimeoutSeconds = optionalNumberAt(agent, "timeoutSeconds", issues, "agent.timeout_seconds") ?? 900;
  const agentLogDir = optionalStringAt(agent, "logDir", issues, "agent.log_dir") ?? "logs";
  const codexCommand = optionalStringAt(agent, "command", issues, "agent.command") ?? "codex";
  const codexArgs = optionalStringArrayAt(agent, "args", issues, "agent.args") ?? ["exec", "-"];
  const activeStates = stringArrayAt(states, "active", issues, "states.active");
  const terminalStates = stringArrayAt(states, "terminal", issues, "states.terminal");
  const maxConcurrency = numberAt(limits, "maxConcurrency", issues, "limits.max_concurrency");

  if (version !== undefined && version !== 1) {
    issues.push("version must be 1.");
  }
  if (trackerKind !== undefined && trackerKind !== "mock" && trackerKind !== "jira" && trackerKind !== "plane") {
    issues.push("tracker.kind must be mock, jira, or plane.");
  }
  if (trackerKind === "mock" && issueFile === undefined) {
    issues.push("tracker.issue_file is required when tracker.kind is mock.");
  }
  if (trackerKind === "jira") {
    if (jiraBaseUrl === undefined) {
      issues.push("tracker.base_url is required when tracker.kind is jira.");
    }
    if (jiraEmail === undefined) {
      issues.push("tracker.email is required when tracker.kind is jira.");
    }
    if (jiraApiToken === undefined) {
      issues.push("tracker.api_token is required when tracker.kind is jira.");
    }
    if (jiraJql === undefined) {
      issues.push("tracker.jql is required when tracker.kind is jira.");
    }
    if (!Number.isInteger(jiraMaxResults) || jiraMaxResults < 1 || jiraMaxResults > 100) {
      issues.push("tracker.max_results must be an integer between 1 and 100.");
    }
  }
  if (trackerKind === "plane") {
    if (planeBaseUrl === undefined) {
      issues.push("tracker.base_url is required when tracker.kind is plane.");
    }
    if (planeApiKey === undefined) {
      issues.push("tracker.api_key is required when tracker.kind is plane.");
    }
    if (planeWorkspaceSlug === undefined) {
      issues.push("tracker.workspace_slug is required when tracker.kind is plane.");
    }
    if (planeProjectId === undefined) {
      issues.push("tracker.project_id is required when tracker.kind is plane.");
    }
    if (!Number.isInteger(planeMaxResults) || planeMaxResults < 1 || planeMaxResults > 100) {
      issues.push("tracker.max_results must be an integer between 1 and 100.");
    }
  }
  if (agentKind !== undefined && agentKind !== "dry-run" && agentKind !== "codex") {
    issues.push("agent.kind must be dry-run or codex.");
  }
  if (githubKind !== undefined && githubKind !== "gh") {
    issues.push("github.kind must be gh.");
  }
  if (githubDraft !== undefined && githubDraft !== true) {
    issues.push("github.draft must be true; Symphony never creates ready-for-review PRs automatically.");
  }
  if (agentTimeoutSeconds !== undefined && (!Number.isFinite(agentTimeoutSeconds) || agentTimeoutSeconds <= 0)) {
    issues.push("agent.timeout_seconds must be greater than 0.");
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
    issues.push("limits.max_concurrency must remain 1 until real runners are implemented.");
  }

  if (issues.length > 0) {
    throw new WorkflowValidationError(issues);
  }

  const baseDir = path.dirname(path.resolve(workflowPath));
  return {
    version: 1,
    tracker: buildTrackerConfig(baseDir, {
      kind: trackerKind!,
      issueFile,
      jiraBaseUrl,
      jiraEmail,
      jiraApiToken,
      jiraJql,
      jiraMaxResults,
      jiraReviewTransition,
      planeBaseUrl,
      planeApiKey,
      planeWorkspaceSlug,
      planeProjectId,
      planeMaxResults,
      planeReviewState
    }),
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
    agent: buildAgentConfig(baseDir, agentKind!, agentTimeoutSeconds, agentLogDir, codexCommand, codexArgs),
    states: {
      active: activeStates!,
      terminal: terminalStates!
    },
    limits: {
      maxConcurrency: maxConcurrency!
    }
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

function buildAgentConfig(
  baseDir: string,
  kind: string,
  timeoutSeconds: number,
  logDir: string,
  command: string,
  args: string[]
): WorkflowConfig["agent"] {
  const resolvedLogDir = path.resolve(baseDir, logDir);
  if (kind === "codex") {
    return {
      kind: "codex",
      command,
      args,
      timeoutSeconds,
      logDir: resolvedLogDir
    };
  }

  return {
    kind: "dry-run",
    timeoutSeconds,
    logDir: resolvedLogDir
  };
}

function buildTrackerConfig(
  baseDir: string,
  input: {
    kind: string;
    issueFile?: string;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
    jiraJql?: string;
    jiraMaxResults: number;
    jiraReviewTransition: string;
    planeBaseUrl?: string;
    planeApiKey?: string;
    planeWorkspaceSlug?: string;
    planeProjectId?: string;
    planeMaxResults: number;
    planeReviewState: string;
  }
): WorkflowConfig["tracker"] {
  if (input.kind === "jira") {
    return {
      kind: "jira",
      baseUrl: input.jiraBaseUrl!,
      email: input.jiraEmail!,
      apiToken: input.jiraApiToken!,
      jql: input.jiraJql!,
      maxResults: input.jiraMaxResults,
      reviewTransition: input.jiraReviewTransition
    };
  }
  if (input.kind === "plane") {
    return {
      kind: "plane",
      baseUrl: input.planeBaseUrl!,
      apiKey: input.planeApiKey!,
      workspaceSlug: input.planeWorkspaceSlug!,
      projectId: input.planeProjectId!,
      maxResults: input.planeMaxResults,
      reviewState: input.planeReviewState
    };
  }

  return {
    kind: "mock",
    issueFile: path.resolve(baseDir, input.issueFile!)
  };
}
