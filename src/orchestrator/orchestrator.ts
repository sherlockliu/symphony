import { createAgentRunner } from "../agents/createAgentRunner.js";
import { GitService } from "../git/gitService.js";
import { GitHubPullRequestService, type PullRequestService } from "../github/pullRequestService.js";
import { renderPrompt } from "../templates/promptRenderer.js";
import { filterActiveIssues } from "../trackers/mockTracker.js";
import { createTracker } from "../trackers/createTracker.js";
import type { TrackerAdapter } from "../trackers/tracker.js";
import type { AgentRunner } from "../agents/agentRunner.js";
import {
  InMemoryRunStateStore,
  isActiveRunState,
  type IssueRunState,
  type RunStateStore
} from "../state/runStateStore.js";
import type {
  Issue,
  IssueRunSummary,
  OrchestratorCycleResult,
  OrchestratorRunOptions,
  PullRequestResult,
  TrackerUpdateResult,
  WorkflowConfig,
  WorkflowDefinition
} from "../types.js";
import { WorkspaceManager } from "../workspaces/workspaceManager.js";

interface WorkspacePlanner {
  createIssueWorkspace(issue: Issue): Promise<{ issueKey: string; path: string; repoPath: string; createdNow: boolean }>;
}

interface RepositoryPreparer {
  prepareRepository(
    issue: Issue,
    workspace: { issueKey: string; path: string; repoPath: string; createdNow: boolean }
  ): Promise<{ branchName: string; commands: string[] }>;
}

export interface OrchestratorDependencies {
  tracker?: TrackerAdapter;
  workspaceManager?: WorkspacePlanner;
  git?: RepositoryPreparer;
  runner?: AgentRunner;
  pullRequests?: PullRequestService;
  stateStore?: RunStateStore;
  now?: () => Date;
}

export class Orchestrator {
  private readonly tracker: TrackerAdapter;
  private readonly workspaceManager: WorkspacePlanner;
  private readonly git: RepositoryPreparer;
  private readonly runner: AgentRunner;
  private readonly pullRequests: PullRequestService;
  private readonly stateStore: RunStateStore;
  private readonly now: () => Date;

  constructor(
    private readonly definition: WorkflowDefinition,
    private readonly config: WorkflowConfig,
    dependencies: OrchestratorDependencies = {}
  ) {
    this.tracker = dependencies.tracker ?? createTracker(config);
    this.workspaceManager = dependencies.workspaceManager ?? new WorkspaceManager(config);
    this.git = dependencies.git ?? new GitService(config);
    this.runner = dependencies.runner ?? createAgentRunner(config);
    this.pullRequests = dependencies.pullRequests ?? new GitHubPullRequestService(config);
    this.stateStore = dependencies.stateStore ?? new InMemoryRunStateStore();
    this.now = dependencies.now ?? (() => new Date());
  }

  async runOnce(options: OrchestratorRunOptions = {}): Promise<OrchestratorCycleResult> {
    const issues = await this.tracker.listIssues();
    await this.reconcileTrackerState(issues, options);
    const activeIssues = filterActiveIssues(issues, this.config.states.active);
    const eligibleIssues: Issue[] = [];
    for (const issue of activeIssues) {
      if (options.excludeIssueIds?.has(issue.id)) {
        continue;
      }
      if (await this.isEligibleForRun(issue, options)) {
        eligibleIssues.push(issue);
      }
    }
    const selectedIssues = eligibleIssues.slice(0, this.config.limits.maxConcurrency);
    const results: IssueRunSummary[] = [];

    for (const issue of selectedIssues) {
      options.onIssueStarted?.(issue);
      try {
        const summary = await this.runIssue(issue, options);
        results.push(summary);
        options.onIssueCompleted?.(summary);
      } catch (error) {
        options.onIssueFailed?.(issue, error);
        throw error;
      }
    }

    return {
      totalIssues: issues.length,
      activeIssues: activeIssues.length,
      eligibleIssues: eligibleIssues.length,
      processedIssues: selectedIssues.length,
      results
    };
  }

  private async runIssue(issue: Issue, options: OrchestratorRunOptions): Promise<IssueRunSummary> {
    let state = await this.beginAttempt(issue, options);
    try {
      const workspace = await this.workspaceManager.createIssueWorkspace(issue);
      state = await this.updateState(state, {
        state: "preparing_workspace",
        workspacePath: workspace.path
      }, options);
      const gitPlan = await this.git.prepareRepository(issue, workspace);
      state = await this.updateState(state, {
        branchName: gitPlan.branchName
      }, options);
      const prompt = renderPrompt(this.definition.promptTemplate, { issue, config: this.config });
      state = await this.updateState(state, { state: "running_agent" }, options);
      const agentResult = await this.runner.run({
        issue,
        workspace,
        prompt,
        workflowPath: this.config.workflowPath,
        timeoutSeconds: this.config.agent.timeoutSeconds,
        logDir: this.config.agent.logDir
      });
      state = await this.updateState(state, { logsPath: agentResult.logPath }, options);
      const pullRequestResult = agentResult.success
        ? await this.createPullRequestWithState(issue, workspace, gitPlan.branchName, state, options)
        : skippedPullRequest("agent_failed");
      state = (await this.stateStore.get(issue.id)) ?? state;
      const trackerResult = await this.updateTrackerAfterPullRequestWithState(issue, pullRequestResult.url, state, options);

      const summary: IssueRunSummary = {
        status: agentResult.success ? "completed" : "failed",
        issueId: issue.id,
        issue: issue.identifier,
        workspace: workspace.path,
        repo: workspace.repoPath,
        branch: gitPlan.branchName,
        runner: agentResult.runner,
        exitCode: agentResult.exitCode,
        timedOut: agentResult.timedOut,
        logPath: agentResult.logPath,
        pullRequest: pullRequestResult,
        tracker: trackerResult,
        next: "Symphony never merges PRs"
      };

      if (summary.status === "completed") {
        await this.updateState(state, {
          state: "succeeded",
          completedAt: this.nowIso(),
          pullRequestUrl: pullRequestResult.url,
          logsPath: agentResult.logPath,
          lastError: null
        }, options);
        return summary;
      }

      await this.recordFailure(state, issue, agentResult.timedOut ? "agent_timeout" : "agent_failed", options);
      return summary;
    } catch (error) {
      const latest = (await this.stateStore.get(issue.id)) ?? state;
      await this.recordFailure(latest, issue, classifyError(error), options);
      throw error;
    }
  }

  private async reconcileTrackerState(issues: Issue[], options: OrchestratorRunOptions): Promise<void> {
    for (const issue of issues) {
      let existing = await this.stateStore.get(issue.id);
      if (existing === undefined) {
        continue;
      }
      if (existing.trackerStateLatest !== issue.state) {
        existing = await this.updateState(existing, { trackerStateLatest: issue.state }, options);
      }
      if (this.isCandidate(issue)) {
        continue;
      }
      if (isActiveRunState(existing.state)) {
        options.onWarning?.(
          `${issue.identifier} is ${existing.state} internally but tracker moved to ${issue.state}.`
        );
        continue;
      }
      if (existing.state !== "succeeded" && existing.state !== "needs_human_attention") {
        await this.updateState(existing, {
          state: this.isCancelledTrackerState(issue.state) ? "cancelled" : "skipped",
          completedAt: existing.completedAt ?? this.nowIso()
        }, options);
      }
    }
  }

  private async isEligibleForRun(issue: Issue, options: OrchestratorRunOptions): Promise<boolean> {
    const existing = await this.stateStore.get(issue.id);
    if (existing === undefined) {
      await this.saveState(initialState(issue, this.nowIso()), options);
      return true;
    }
    if (isActiveRunState(existing.state)) {
      return false;
    }
    if (existing.state === "succeeded" && !this.config.retry.rerunSucceeded) {
      return false;
    }
    if (existing.state === "needs_human_attention" || existing.state === "cancelled") {
      return false;
    }
    if (existing.pullRequestUrl !== null && !this.config.retry.retryWithExistingPullRequest) {
      return false;
    }
    if (existing.state === "failed") {
      if (!this.isRetryableError(existing.lastError)) {
        await this.markNeedsHumanAttention(issue, existing, options);
        return false;
      }
      if (existing.attemptNumber >= this.config.retry.maxAttempts) {
        await this.markNeedsHumanAttention(issue, existing, options);
        return false;
      }
      if (!this.cooldownElapsed(existing)) {
        return false;
      }
    }
    return true;
  }

  private async beginAttempt(issue: Issue, options: OrchestratorRunOptions): Promise<IssueRunState> {
    const existing = await this.stateStore.get(issue.id);
    const now = this.nowIso();
    const attemptNumber = existing === undefined ? 1 : existing.attemptNumber + 1;
    const state: IssueRunState = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      attemptNumber,
      state: "queued",
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
      workspacePath: existing?.workspacePath ?? null,
      branchName: existing?.branchName ?? issue.branchName,
      pullRequestUrl: existing?.pullRequestUrl ?? null,
      trackerStateAtStart: issue.state,
      trackerStateLatest: issue.state,
      logsPath: existing?.logsPath ?? null
    };
    await this.saveState(state, options);
    return state;
  }

  private async createPullRequestWithState(
    issue: Issue,
    workspace: { issueKey: string; path: string; repoPath: string; createdNow: boolean },
    branchName: string,
    state: IssueRunState,
    options: OrchestratorRunOptions
  ): Promise<PullRequestResult> {
    await this.updateState(state, { state: "creating_pr" }, options);
    const result = await this.pullRequests.createDraftPullRequest({
      issue,
      workspace,
      branchName,
      baseBranch: this.config.repository.baseBranch
    });
    await this.updateState(state, { pullRequestUrl: result.url }, options);
    return result;
  }

  private async updateTrackerAfterPullRequestWithState(
    issue: Issue,
    prUrl: string | null,
    state: IssueRunState,
    options: OrchestratorRunOptions
  ): Promise<TrackerUpdateResult> {
    if (prUrl === null) {
      return {
        commented: false,
        transitioned: false,
        skippedReason: "no_pr_created"
      };
    }
    if (this.tracker.addPullRequestComment === undefined || this.tracker.transitionToHumanReview === undefined) {
      return {
        commented: false,
        transitioned: false,
        skippedReason: "tracker_writeback_not_supported"
      };
    }

    await this.updateState(state, { state: "commenting_tracker" }, options);
    await this.tracker.addPullRequestComment(issue, prUrl);
    await this.updateState(state, { state: "transitioning_tracker" }, options);
    await this.tracker.transitionToHumanReview(issue);
    return {
      commented: true,
      transitioned: true
    };
  }

  private async recordFailure(
    state: IssueRunState,
    issue: Issue,
    errorCode: string,
    options: OrchestratorRunOptions
  ): Promise<void> {
    const failed = await this.updateState(state, {
      state: "failed",
      completedAt: this.nowIso(),
      lastError: errorCode
    }, options);
    if (!this.isRetryableError(errorCode) || failed.attemptNumber >= this.config.retry.maxAttempts) {
      await this.markNeedsHumanAttention(issue, failed, options);
    }
  }

  private async markNeedsHumanAttention(
    issue: Issue,
    state: IssueRunState,
    options: OrchestratorRunOptions
  ): Promise<void> {
    if (state.state !== "needs_human_attention") {
      const next = await this.updateState(state, {
        state: "needs_human_attention",
        completedAt: state.completedAt ?? this.nowIso()
      }, options);
      if (this.tracker.addNeedsHumanAttentionComment !== undefined) {
        await this.tracker.addNeedsHumanAttentionComment(issue, next);
      }
    }
  }

  private async updateState(
    state: IssueRunState,
    patch: Partial<Omit<IssueRunState, "issueId" | "issueIdentifier" | "attemptNumber">>,
    options: OrchestratorRunOptions
  ): Promise<IssueRunState> {
    const next: IssueRunState = {
      ...state,
      ...patch,
      updatedAt: this.nowIso()
    };
    await this.saveState(next, options);
    return next;
  }

  private async saveState(state: IssueRunState, options: OrchestratorRunOptions): Promise<void> {
    await this.stateStore.upsert(state);
    options.onRunStateUpdated?.(state);
  }

  private isCandidate(issue: Issue): boolean {
    return this.config.states.active.includes(issue.state);
  }

  private cooldownElapsed(state: IssueRunState): boolean {
    const reference = state.completedAt ?? state.updatedAt;
    const elapsedMs = this.now().getTime() - Date.parse(reference);
    return elapsedMs >= this.config.retry.failureCooldownSeconds * 1000;
  }

  private isRetryableError(errorCode: string | null): boolean {
    return errorCode !== null && this.config.retry.retryableErrors.includes(errorCode);
  }

  private isCancelledTrackerState(trackerState: string): boolean {
    return /cancel(?:led|ed)?/i.test(trackerState);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export async function updateTrackerAfterPullRequest(
  tracker: TrackerAdapter,
  issue: Issue,
  prUrl: string | null
): Promise<TrackerUpdateResult> {
  if (prUrl === null) {
    return {
      commented: false,
      transitioned: false,
      skippedReason: "no_pr_created"
    };
  }
  if (tracker.addPullRequestComment === undefined || tracker.transitionToHumanReview === undefined) {
    return {
      commented: false,
      transitioned: false,
      skippedReason: "tracker_writeback_not_supported"
    };
  }

  await tracker.addPullRequestComment(issue, prUrl);
  await tracker.transitionToHumanReview(issue);
  return {
    commented: true,
    transitioned: true
  };
}

function skippedPullRequest(skippedReason: string): PullRequestResult {
  return {
    created: false,
    url: null,
    skippedReason,
    changed: false,
    logPaths: []
  };
}

function initialState(issue: Issue, now: string): IssueRunState {
  return {
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    attemptNumber: 0,
    state: "discovered",
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    lastError: null,
    workspacePath: null,
    branchName: issue.branchName,
    pullRequestUrl: null,
    trackerStateAtStart: null,
    trackerStateLatest: issue.state,
    logsPath: null
  };
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout|SIGTERM/i.test(message)) {
    return "agent_timeout";
  }
  if (/\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network)\b/i.test(message)) {
    return "network_error";
  }
  if (/\bHTTP 5\d\d\b|transient|rate limit/i.test(message)) {
    return "transient_tracker_error";
  }
  return "unknown_error";
}
