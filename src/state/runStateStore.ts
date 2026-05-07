import { randomUUID } from "node:crypto";
import type { Issue, WorkflowConfig } from "../types.js";

export type IssueRunLifecycleState =
  | "discovered"
  | "queued"
  | "preparing_workspace"
  | "running_agent"
  | "creating_pr"
  | "commenting_tracker"
  | "transitioning_tracker"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "needs_human_attention"
  | "cancelled";

export interface IssueRunState {
  id: string;
  trackerKind: string;
  trackerIssueId: string;
  issueIdentifier: string;
  issueUrl: string | null;
  issueTitle: string;
  state: IssueRunLifecycleState;
  attemptCount: number;
  maxAttempts: number;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
  workspacePath: string | null;
  branchName: string | null;
  pullRequestUrl: string | null;
  logsPath: string | null;
  trackerStateAtStart: string | null;
  trackerStateLatest: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
  lockOwner: string | null;
  lockExpiresAt: string | null;
  metadata: Record<string, unknown>;
}

export interface RunStateStore {
  getByIssueId(issueId: string): Promise<IssueRunState | undefined>;
  getByIssueIdentifier(identifier: string): Promise<IssueRunState | undefined>;
  upsert(state: IssueRunState): Promise<void>;
  listActive(): Promise<IssueRunState[]>;
  listUnfinished(): Promise<IssueRunState[]>;
  listRetryable(now: Date): Promise<IssueRunState[]>;
  listRecent(limit: number): Promise<IssueRunState[]>;
  markStaleRuns(now: Date): Promise<void>;
  acquireLock?(state: IssueRunState, owner: string, expiresAt: Date): Promise<boolean>;
  releaseLock?(state: IssueRunState, owner: string): Promise<void>;
}

export const ACTIVE_RUN_STATES = new Set<IssueRunLifecycleState>([
  "queued",
  "preparing_workspace",
  "running_agent",
  "creating_pr",
  "commenting_tracker",
  "transitioning_tracker"
]);

export const UNFINISHED_RUN_STATES = new Set<IssueRunLifecycleState>([
  "discovered",
  ...ACTIVE_RUN_STATES,
  "failed_retryable"
]);

export const TERMINAL_RUN_STATES = new Set<IssueRunLifecycleState>([
  "succeeded",
  "failed_terminal",
  "needs_human_attention",
  "cancelled"
]);

export class InMemoryRunStateStore implements RunStateStore {
  private readonly statesByKey = new Map<string, IssueRunState>();
  private readonly keysById = new Map<string, string>();
  private readonly keysByIdentifier = new Map<string, string>();

  async getByIssueId(issueId: string): Promise<IssueRunState | undefined> {
    const key = this.keysById.get(issueId);
    if (key === undefined) {
      return undefined;
    }
    return cloneState(this.statesByKey.get(key));
  }

  async getByIssueIdentifier(identifier: string): Promise<IssueRunState | undefined> {
    const key = this.keysByIdentifier.get(identifier);
    if (key === undefined) {
      return undefined;
    }
    return cloneState(this.statesByKey.get(key));
  }

  async upsert(state: IssueRunState): Promise<void> {
    const key = stateKey(state.trackerKind, state.trackerIssueId);
    const next = cloneState(state)!;
    this.statesByKey.set(key, next);
    this.keysById.set(state.trackerIssueId, key);
    this.keysByIdentifier.set(state.issueIdentifier, key);
  }

  async listActive(): Promise<IssueRunState[]> {
    return this.listWhere((state) => isActiveRunState(state.state));
  }

  async listUnfinished(): Promise<IssueRunState[]> {
    return this.listWhere((state) => isUnfinishedRunState(state.state));
  }

  async listRetryable(now: Date): Promise<IssueRunState[]> {
    return this.listWhere((state) => isRetryableRunState(state, now));
  }

  async listRecent(limit: number): Promise<IssueRunState[]> {
    return [...this.statesByKey.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((state) => cloneState(state)!);
  }

  async markStaleRuns(now: Date): Promise<void> {
    const nowIso = now.toISOString();
    for (const state of this.statesByKey.values()) {
      if (!isStaleRecoverableState(state.state)) {
        continue;
      }
      const next: IssueRunState = {
        ...state,
        state: state.attemptCount >= state.maxAttempts ? "needs_human_attention" : "failed_retryable",
        updatedAt: nowIso,
        completedAt: nowIso,
        lastErrorType: state.lastErrorType ?? "stale_run_recovered",
        lastErrorMessage: state.lastErrorMessage ?? "Run was unfinished during daemon startup recovery.",
        nextRetryAt: state.attemptCount >= state.maxAttempts ? null : state.nextRetryAt,
        lockOwner: null,
        lockExpiresAt: null
      };
      await this.upsert(next);
    }
  }

  async acquireLock(state: IssueRunState, owner: string, expiresAt: Date): Promise<boolean> {
    const existing = await this.getByIssueId(state.trackerIssueId);
    if (existing === undefined) {
      return false;
    }
    const now = new Date();
    if (existing.lockOwner !== null && existing.lockExpiresAt !== null && Date.parse(existing.lockExpiresAt) > now.getTime()) {
      return false;
    }
    await this.upsert({
      ...existing,
      lockOwner: owner,
      lockExpiresAt: expiresAt.toISOString(),
      updatedAt: now.toISOString()
    });
    return true;
  }

  async releaseLock(state: IssueRunState, owner: string): Promise<void> {
    const existing = await this.getByIssueId(state.trackerIssueId);
    if (existing === undefined || existing.lockOwner !== owner) {
      return;
    }
    await this.upsert({
      ...existing,
      lockOwner: null,
      lockExpiresAt: null,
      updatedAt: new Date().toISOString()
    });
  }

  private listWhere(predicate: (state: IssueRunState) => boolean): IssueRunState[] {
    return [...this.statesByKey.values()]
      .filter(predicate)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((state) => cloneState(state)!);
  }
}

export function createInitialRunState(
  issue: Issue,
  config: WorkflowConfig,
  now: string
): IssueRunState {
  return {
    id: randomUUID(),
    trackerKind: config.tracker.kind,
    trackerIssueId: issue.id,
    issueIdentifier: issue.identifier,
    issueUrl: issue.url,
    issueTitle: issue.title,
    state: "discovered",
    attemptCount: 0,
    maxAttempts: config.retry.maxAttempts,
    lastErrorType: null,
    lastErrorMessage: null,
    workspacePath: null,
    branchName: issue.branchName,
    pullRequestUrl: null,
    logsPath: null,
    trackerStateAtStart: null,
    trackerStateLatest: issue.state,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    nextRetryAt: null,
    lockOwner: null,
    lockExpiresAt: null,
    metadata: {}
  };
}

export function isActiveRunState(state: IssueRunLifecycleState): boolean {
  return ACTIVE_RUN_STATES.has(state);
}

export function isUnfinishedRunState(state: IssueRunLifecycleState): boolean {
  return UNFINISHED_RUN_STATES.has(state);
}

export function isTerminalRunState(state: IssueRunLifecycleState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

export function isRetryableRunState(state: IssueRunState, now: Date): boolean {
  if (state.state !== "failed_retryable") {
    return false;
  }
  if (state.attemptCount >= state.maxAttempts) {
    return false;
  }
  if (state.nextRetryAt === null) {
    return true;
  }
  return Date.parse(state.nextRetryAt) <= now.getTime();
}

export function isStaleRecoverableState(state: IssueRunLifecycleState): boolean {
  return state === "preparing_workspace"
    || state === "running_agent"
    || state === "creating_pr"
    || state === "commenting_tracker"
    || state === "transitioning_tracker";
}

function stateKey(trackerKind: string, trackerIssueId: string): string {
  return `${trackerKind}\0${trackerIssueId}`;
}

function cloneState(state: IssueRunState | undefined): IssueRunState | undefined {
  return state === undefined
    ? undefined
    : {
        ...state,
        metadata: { ...state.metadata }
      };
}
