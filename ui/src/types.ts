export type RunStatus =
  | "DISCOVERED"
  | "ELIGIBLE"
  | "QUEUED"
  | "PREPARING_WORKSPACE"
  | "RUNNING_AGENT"
  | "AGENT_COMPLETED"
  | "PR_CREATED"
  | "NEEDS_HUMAN_REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "IGNORED";

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: string | number | null;
  state: string;
  url: string | null;
  labels: string[];
}

export interface AgentRun {
  id: string;
  issueId: string;
  issueIdentifier: string;
  status: RunStatus;
  workspacePath: string | null;
  branchName: string | null;
  agentKind: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  prUrl: string | null;
  errorMessage: string | null;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface RunRecord {
  run: AgentRun;
  events: RunEvent[];
  result?: {
    status: string;
    summary: string;
    changedFiles: string[];
    prUrl: string | null;
  };
}

export interface RunDetail {
  record: RunRecord;
  prompt: string | null;
  output: unknown;
  config: WorkflowSummary;
}

export interface WorkflowSummary {
  workflowPath: string | null;
  configHash: string;
  trackerKind: string;
  agentKind: string;
  repositoryUrl: string;
  defaultBranch: string;
  workspaceRoot: string;
  maxConcurrentAgents?: number;
  safety?: {
    allowAutoMerge: boolean;
  };
}

export interface BoardColumn {
  name: "Fetched" | "Queued" | "Running" | "Needs Review" | "Done" | "Failed";
  items: Array<Issue | RunRecord>;
}

export interface BoardResponse {
  columns: BoardColumn[];
}
