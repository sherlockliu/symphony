export type Scalar = string | number | boolean | null;
export type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue };

export interface WorkflowDefinition {
  config: Record<string, JsonValue>;
  promptTemplate: string;
}

export interface WorkflowConfig {
  version: 1;
  tracker:
    | {
        kind: "mock";
        issueFile: string;
      }
    | {
        kind: "jira";
        baseUrl: string;
        email: string;
        apiToken: string;
        jql: string;
        maxResults: number;
        reviewTransition: string;
      }
    | {
        kind: "plane";
        baseUrl: string;
        apiKey: string;
        workspaceSlug: string;
        projectId: string;
        maxResults: number;
        reviewState: string;
      };
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
  agent:
    | {
        kind: "dry-run";
        timeoutSeconds: number;
        logDir: string;
      }
    | {
        kind: "codex";
        command: string;
        args: string[];
        timeoutSeconds: number;
        logDir: string;
      };
  states: {
    active: string[];
    terminal: string[];
  };
  limits: {
    maxConcurrency: number;
  };
}

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
}

export interface AgentRunResult {
  success: boolean;
  runner: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
  stdout: string;
  stderr: string;
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
