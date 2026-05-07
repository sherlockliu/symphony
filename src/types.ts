import type { AgentConfig } from "./agents/registry.js";
import type { TrackerConfig } from "./trackers/registry.js";

export type Scalar = string | number | boolean | null;
export type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue };

export interface WorkflowDefinition {
  config: Record<string, JsonValue>;
  promptTemplate: string;
}

export interface WorkflowConfig {
  version: 1;
  workflowPath: string;
  tracker: TrackerConfig;
  state: StateConfig;
  workspace: {
    root: string;
  };
  repository: {
    url: string;
    baseBranch: string;
    cloneDir: string;
  };
  branch: {
    prefix: string;
  };
  github: {
    kind: "gh";
    remote: string;
    draft: true;
    logDir: string;
  };
  agent: AgentConfig;
  states: {
    active: string[];
    terminal: string[];
  };
  limits: {
    maxConcurrency: number;
  };
  retry: {
    maxAttempts: number;
    failureCooldownSeconds: number;
    retryableErrors: string[];
    retryWithExistingPullRequest: boolean;
    rerunSucceeded: boolean;
  };
  daemon?: {
    pollIntervalSeconds: number;
  };
  dashboard: {
    enabled: boolean;
    host: string;
    port: number;
  };
}

export type StateConfig =
  | {
      kind: "memory";
    }
  | {
      kind: "postgres";
      connectionString: string;
      lockTtlSeconds: number;
    };

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: Array<{
    id: string | null;
    identifier: string | null;
    state: string | null;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IssueWorkspace {
  issueKey: string;
  path: string;
  repoPath: string;
  createdNow: boolean;
}

export interface AgentRunRequest {
  issue: Issue;
  workspace: IssueWorkspace;
  prompt: string;
  workflowPath: string;
  timeoutSeconds: number;
  logDir: string;
}

export interface AgentRunResult {
  success: boolean;
  runner: string;
  summary?: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
  logsPath?: string;
  stdout: string;
  stderr: string;
  branchName?: string;
  pullRequestUrl?: string;
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}

export interface PullRequestRequest {
  issue: Issue;
  workspace: IssueWorkspace;
  branchName: string;
  baseBranch: string;
}

export interface PullRequestResult {
  created: boolean;
  url: string | null;
  skippedReason: string | null;
  changed: boolean;
  logPaths: string[];
}

export interface TrackerUpdateResult {
  commented: boolean;
  transitioned: boolean;
  skippedReason?: string;
}

export interface IssueRunSummary {
  status: "completed" | "failed";
  issueId: string;
  issue: string;
  workspace: string;
  repo: string;
  branch: string;
  runner: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
  pullRequest: PullRequestResult;
  tracker: TrackerUpdateResult;
  next: string;
}

export interface OrchestratorRunOptions {
  excludeIssueIds?: ReadonlySet<string>;
  onIssueStarted?: (issue: Issue) => void;
  onIssueCompleted?: (summary: IssueRunSummary) => void;
  onIssueFailed?: (issue: Issue, error: unknown) => void;
  onRunStateUpdated?: (state: import("./state/runStateStore.js").IssueRunState) => void;
  onWarning?: (message: string) => void;
}

export interface OrchestratorCycleResult {
  totalIssues: number;
  activeIssues: number;
  eligibleIssues: number;
  processedIssues: number;
  results: IssueRunSummary[];
}
