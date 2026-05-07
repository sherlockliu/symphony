import path from "node:path";
import { redactSecrets } from "../logging/redact.js";
import { assertInsideRoot } from "../workspaces/pathSafety.js";
import type { DaemonLogEvent } from "../daemon/pollingDaemon.js";
import type { Issue, IssueRunSummary, WorkflowConfig } from "../types.js";
import { isActiveRunState, type IssueRunLifecycleState, type IssueRunState } from "../state/runStateStore.js";

export type DashboardMode = "daemon";
export type DashboardRunState = IssueRunLifecycleState | "active";

export interface DashboardRunView {
  issueIdentifier: string;
  issueId: string | null;
  status: DashboardRunState;
  trackerKind: WorkflowConfig["tracker"]["kind"];
  agentKind: WorkflowConfig["agent"]["kind"];
  workspacePath: string | null;
  prUrl: string | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DashboardStatusView {
  currentMode: DashboardMode;
  uptimeSeconds: number;
  pollingIntervalSeconds: number;
  activeRuns: number;
  queuedRuns: number;
  succeededRuns: number;
  failedRuns: number;
  lastPollTime: string | null;
  trackerKind: WorkflowConfig["tracker"]["kind"];
  agentKind: WorkflowConfig["agent"]["kind"];
  lastError: string | null;
}

export interface DashboardRunsView {
  active: DashboardRunView[];
  succeeded: DashboardRunView[];
  failed: DashboardRunView[];
}

export interface DashboardConfigSummary {
  version: number;
  trackerKind: WorkflowConfig["tracker"]["kind"];
  agentKind: WorkflowConfig["agent"]["kind"];
  repository: {
    baseBranch: string;
    cloneDir: string;
  };
  workspaceRoot: string;
  branchPrefix: string;
  github: {
    kind: "gh";
    remote: string;
    draft: true;
  };
  daemon: {
    pollIntervalSeconds: number;
  };
  retry: {
    maxAttempts: number;
    failureCooldownSeconds: number;
    retryableErrors: string[];
    retryWithExistingPullRequest: boolean;
    rerunSucceeded: boolean;
  };
  dashboard: {
    enabled: boolean;
    host: string;
    port: number;
  };
}

export class DashboardStatusStore {
  private readonly startedAtMs: number;
  private readonly runs = new Map<string, DashboardRunView>();
  private queuedRuns = 0;
  private lastPollTime: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: WorkflowConfig,
    private readonly mode: DashboardMode = "daemon",
    now: () => Date = () => new Date()
  ) {
    this.now = now;
    this.startedAtMs = now().getTime();
  }

  private readonly now: () => Date;

  recordDaemonEvent(event: DaemonLogEvent): void {
    if (event.status === "poll_started") {
      this.lastPollTime = this.nowIso();
      this.lastError = null;
      return;
    }
    if (event.status === "poll_completed") {
      this.lastPollTime = this.nowIso();
      this.queuedRuns = Math.max(event.eligibleIssues - event.processedIssues, 0);
      return;
    }
    if (event.status === "poll_failed") {
      this.lastPollTime = this.nowIso();
      this.lastError = redactSecrets(event.error);
    }
  }

  recordRunState(state: IssueRunState): void {
    const now = this.nowIso();
    this.runs.set(state.issueIdentifier, {
      issueIdentifier: state.issueIdentifier,
      issueId: state.issueId,
      status: state.state,
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      workspacePath: state.workspacePath === null ? null : safeWorkspacePath(this.config.workspace.root, state.workspacePath),
      prUrl: state.pullRequestUrl,
      lastError: state.lastError,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      updatedAt: state.updatedAt || now
    });
  }

  recordIssueStarted(issue: Issue): void {
    const now = this.nowIso();
    this.runs.set(issue.identifier, {
      issueIdentifier: issue.identifier,
      issueId: issue.id,
      status: "active",
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      workspacePath: null,
      prUrl: null,
      lastError: null,
      startedAt: now,
      completedAt: null,
      updatedAt: now
    });
  }

  recordIssueCompleted(summary: IssueRunSummary): void {
    const previous = this.runs.get(summary.issue);
    const now = this.nowIso();
    this.runs.set(summary.issue, {
      issueIdentifier: summary.issue,
      issueId: summary.issueId,
      status: summary.status === "completed" ? "succeeded" : "failed",
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      workspacePath: safeWorkspacePath(this.config.workspace.root, summary.workspace),
      prUrl: summary.pullRequest.url,
      lastError: summary.status === "failed" ? failureReason(summary) : null,
      startedAt: previous?.startedAt ?? null,
      completedAt: now,
      updatedAt: now
    });
  }

  recordIssueFailed(issue: Issue, error: unknown): void {
    const previous = this.runs.get(issue.identifier);
    const now = this.nowIso();
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    this.runs.set(issue.identifier, {
      issueIdentifier: issue.identifier,
      issueId: issue.id,
      status: "failed",
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      workspacePath: previous?.workspacePath ?? null,
      prUrl: previous?.prUrl ?? null,
      lastError: message,
      startedAt: previous?.startedAt ?? now,
      completedAt: now,
      updatedAt: now
    });
    this.lastError = message;
  }

  status(): DashboardStatusView {
    const runs = this.runsView();
    return {
      currentMode: this.mode,
      uptimeSeconds: Math.max(Math.floor((this.now().getTime() - this.startedAtMs) / 1000), 0),
      pollingIntervalSeconds: this.config.daemon?.pollIntervalSeconds ?? 60,
      activeRuns: runs.active.length,
      queuedRuns: this.queuedRuns,
      succeededRuns: runs.succeeded.length,
      failedRuns: runs.failed.length,
      lastPollTime: this.lastPollTime,
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      lastError: this.lastError
    };
  }

  runsView(): DashboardRunsView {
    const runs = [...this.runs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      active: runs.filter((run) => run.status === "active" || isActiveRunState(run.status as IssueRunLifecycleState)),
      succeeded: runs.filter((run) => run.status === "succeeded"),
      failed: runs.filter((run) => run.status === "failed" || run.status === "needs_human_attention")
    };
  }

  runByIssueIdentifier(issueIdentifier: string): DashboardRunView | null {
    return this.runs.get(issueIdentifier) ?? null;
  }

  configSummary(): DashboardConfigSummary {
    return {
      version: this.config.version,
      trackerKind: this.config.tracker.kind,
      agentKind: this.config.agent.kind,
      repository: {
        baseBranch: this.config.repository.baseBranch,
        cloneDir: this.config.repository.cloneDir
      },
      workspaceRoot: path.resolve(this.config.workspace.root),
      branchPrefix: this.config.branch.prefix,
      github: {
        kind: this.config.github.kind,
        remote: this.config.github.remote,
        draft: this.config.github.draft
      },
      daemon: {
        pollIntervalSeconds: this.config.daemon?.pollIntervalSeconds ?? 60
      },
      retry: {
        maxAttempts: this.config.retry.maxAttempts,
        failureCooldownSeconds: this.config.retry.failureCooldownSeconds,
        retryableErrors: this.config.retry.retryableErrors,
        retryWithExistingPullRequest: this.config.retry.retryWithExistingPullRequest,
        rerunSucceeded: this.config.retry.rerunSucceeded
      },
      dashboard: {
        enabled: this.config.dashboard.enabled,
        host: this.config.dashboard.host,
        port: this.config.dashboard.port
      }
    };
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export function isDashboardLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

function safeWorkspacePath(root: string, workspacePath: string): string | null {
  try {
    return assertInsideRoot(root, workspacePath);
  } catch {
    return null;
  }
}

function failureReason(summary: IssueRunSummary): string {
  if (summary.timedOut) {
    return "agent_timed_out";
  }
  return summary.pullRequest.skippedReason ?? "agent_failed";
}
