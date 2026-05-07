export type IssueRunLifecycleState =
  | "discovered"
  | "queued"
  | "preparing_workspace"
  | "running_agent"
  | "creating_pr"
  | "commenting_tracker"
  | "transitioning_tracker"
  | "succeeded"
  | "failed"
  | "skipped"
  | "needs_human_attention"
  | "cancelled";

export interface IssueRunState {
  issueId: string;
  issueIdentifier: string;
  attemptNumber: number;
  state: IssueRunLifecycleState;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  workspacePath: string | null;
  branchName: string | null;
  pullRequestUrl: string | null;
  trackerStateAtStart: string | null;
  trackerStateLatest: string | null;
  logsPath: string | null;
}

export interface RunStateStore {
  get(issueId: string): Promise<IssueRunState | undefined>;
  upsert(state: IssueRunState): Promise<void>;
  listActive(): Promise<IssueRunState[]>;
  listRecent(limit: number): Promise<IssueRunState[]>;
}

const ACTIVE_STATES = new Set<IssueRunLifecycleState>([
  "discovered",
  "queued",
  "preparing_workspace",
  "running_agent",
  "creating_pr",
  "commenting_tracker",
  "transitioning_tracker"
]);

export class InMemoryRunStateStore implements RunStateStore {
  private readonly states = new Map<string, IssueRunState>();

  async get(issueId: string): Promise<IssueRunState | undefined> {
    const state = this.states.get(issueId);
    return state === undefined ? undefined : cloneState(state);
  }

  async upsert(state: IssueRunState): Promise<void> {
    this.states.set(state.issueId, cloneState(state));
  }

  async listActive(): Promise<IssueRunState[]> {
    return [...this.states.values()]
      .filter((state) => isActiveRunState(state.state))
      .map(cloneState);
  }

  async listRecent(limit: number): Promise<IssueRunState[]> {
    return [...this.states.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(cloneState);
  }
}

export function isActiveRunState(state: IssueRunLifecycleState): boolean {
  return ACTIVE_STATES.has(state);
}

function cloneState(state: IssueRunState): IssueRunState {
  return { ...state };
}
