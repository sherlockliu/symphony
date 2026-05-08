export type TrackerKind = "mock" | "jira" | "plane";
export type CleanupPolicy = "never" | "on_success" | "always";
export type ISODateTime = string;

export interface TrackedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  trackerKind: TrackerKind;
  state: string;
  priority: string | number | null;
  labels: string[];
  assignee: string | null;
  raw: unknown;
}

export interface MockTrackerConfig {
  kind: "mock";
  issueFile?: string;
  issuesFile?: string;
  eventsFile?: string;
  options?: Record<string, unknown>;
}

export interface JiraTrackerConfig {
  kind: "jira";
  baseUrl: string;
  emailEnv: string;
  apiTokenEnv: string;
  jql: string;
  readyStates: string[];
  reviewState: string;
  maxResults?: number;
}

export interface PlaneTrackerConfig {
  kind: "plane";
  baseUrl: string;
  apiTokenEnv: string;
  workspaceSlug: string;
  projectId: string;
  readyStates: string[];
  reviewState: string;
  maxResults?: number;
}

export type TrackerConfig = MockTrackerConfig | JiraTrackerConfig | PlaneTrackerConfig;

export interface RepositoryConfig {
  provider?: "github";
  url: string;
  defaultBranch: string;
  branchNamePattern: string;
  github?: {
    owner: string;
    repo: string;
    tokenEnv: string;
  };
}

export interface WorkspaceConfig {
  root: string;
  cleanupPolicy: CleanupPolicy;
}

export interface AgentConfig {
  kind: string;
  command: string;
  maxConcurrentAgents: number;
  maxTurns: number;
  timeoutSeconds: number;
}

export interface PollingConfig {
  enabled: boolean;
  intervalSeconds: number;
}

export interface WorkflowStatesConfig {
  eligible: string[];
  terminal: string[];
  humanReview: string;
}

export interface SafetyConfig {
  requireHumanReview: boolean;
  allowAutoMerge: boolean;
  allowTicketTransitions: boolean;
  allowPrCreation: boolean;
  redactSecrets: boolean;
  maxConcurrentRuns: number;
  allowedCommands?: string[];
  blockedCommands?: string[];
}

export interface WorkflowConfig {
  tracker: TrackerConfig;
  repository: RepositoryConfig;
  workspace: WorkspaceConfig;
  agent: AgentConfig;
  polling: PollingConfig;
  states: WorkflowStatesConfig;
  safety: SafetyConfig;
}

export enum RunStatus {
  DISCOVERED = "DISCOVERED",
  ELIGIBLE = "ELIGIBLE",
  QUEUED = "QUEUED",
  PREPARING_WORKSPACE = "PREPARING_WORKSPACE",
  RUNNING_AGENT = "RUNNING_AGENT",
  AGENT_COMPLETED = "AGENT_COMPLETED",
  PR_CREATED = "PR_CREATED",
  NEEDS_HUMAN_REVIEW = "NEEDS_HUMAN_REVIEW",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  IGNORED = "IGNORED"
}

export interface AgentRun {
  id: string;
  issueId: string;
  issueIdentifier: string;
  status: RunStatus;
  workspacePath: string | null;
  branchName: string | null;
  agentKind: string;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  retryCount: number;
  prUrl: string | null;
  errorMessage: string | null;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  timestamp: ISODateTime;
  metadata: Record<string, unknown>;
}

export interface AgentRunInput {
  issue: TrackedIssue;
  workflow: WorkflowConfig;
  workspacePath: string;
  prompt: string;
}

export interface AgentRunResult {
  status: "success" | "failed";
  summary: string;
  changedFiles: string[];
  prUrl: string | null;
  errorMessage?: string;
}

export interface TrackerAdapter {
  readonly kind: TrackerKind;
  fetchCandidateIssues(config: TrackerConfig): Promise<TrackedIssue[]>;
  fetchIssue(id: string, config: TrackerConfig): Promise<TrackedIssue>;
  commentOnIssue?(issueId: string, body: string, config: TrackerConfig): Promise<void>;
  transitionIssue?(issueId: string, targetState: string, config: TrackerConfig): Promise<void>;
}

export interface AgentRunner {
  readonly kind: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface WorkspacePlan {
  issueIdentifier: string;
  workspacePath: string;
  repositoryPath: string;
  branchName: string;
}

export interface WorkspaceManager {
  planWorkspace(issue: TrackedIssue, config: WorkflowConfig): WorkspacePlan;
  prepareWorkspace(issue: TrackedIssue, config: WorkflowConfig): Promise<WorkspacePlan>;
}

export function createTrackedIssue(input: TrackedIssue): TrackedIssue {
  assertNonEmpty(input.id, "TrackedIssue.id");
  assertNonEmpty(input.identifier, "TrackedIssue.identifier");
  assertNonEmpty(input.title, "TrackedIssue.title");
  assertNonEmpty(input.trackerKind, "TrackedIssue.trackerKind");
  assertNonEmpty(input.state, "TrackedIssue.state");
  if (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string")) {
    throw new Error("TrackedIssue.labels must be a string array.");
  }
  return {
    ...input,
    labels: [...input.labels]
  };
}

export function createAgentRun(input: AgentRun): AgentRun {
  assertNonEmpty(input.id, "AgentRun.id");
  assertNonEmpty(input.issueId, "AgentRun.issueId");
  assertNonEmpty(input.issueIdentifier, "AgentRun.issueIdentifier");
  assertNonEmpty(input.agentKind, "AgentRun.agentKind");
  if (!Object.values(RunStatus).includes(input.status)) {
    throw new Error(`AgentRun.status must be a valid RunStatus value.`);
  }
  if (!Number.isInteger(input.retryCount) || input.retryCount < 0) {
    throw new Error("AgentRun.retryCount must be a non-negative integer.");
  }
  return { ...input };
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}
