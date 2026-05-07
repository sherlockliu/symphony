import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { InMemoryRunStateStore, type IssueRunState } from "../src/state/runStateStore.js";
import type { AgentRunRequest, AgentRunResult, Issue, WorkflowConfig } from "../src/types.js";
import type { TrackerAdapter } from "../src/trackers/tracker.js";

test("retry cooldown prevents immediate retry of retryable failures", async () => {
  const store = new InMemoryRunStateStore();
  const runner = runnerWith([
    { success: false, timedOut: true },
    { success: true }
  ]);
  const subject = makeOrchestrator({ store, runner, now: clock("2026-05-07T12:00:00.000Z") });

  const first = await subject.runOnce();
  const second = await subject.runOnce();

  assert.equal(first.processedIssues, 1);
  assert.equal(second.processedIssues, 0);
  assert.equal(runner.calls, 1);
  assert.equal((await store.getByIssueId(issue.id))?.state, "failed_retryable");
  assert.equal((await store.getByIssueId(issue.id))?.lastErrorType, "agent_timeout");
});

test("retryable failures run again after cooldown", async () => {
  const store = new InMemoryRunStateStore();
  const runner = runnerWith([
    { success: false, timedOut: true },
    { success: true }
  ]);
  let now = new Date("2026-05-07T12:00:00.000Z");
  const subject = makeOrchestrator({ store, runner, now: () => now });

  await subject.runOnce();
  now = new Date("2026-05-07T12:06:00.000Z");
  const second = await subject.runOnce();

  assert.equal(second.processedIssues, 1);
  assert.equal(runner.calls, 2);
  const state = await store.getByIssueId(issue.id);
  assert.equal(state?.attemptCount, 2);
  assert.equal(state?.state, "succeeded");
});

test("max attempts marks issue as needs_human_attention", async () => {
  const store = new InMemoryRunStateStore();
  const comments: IssueRunState[] = [];
  const tracker = trackerWith([issue], comments);
  const runner = runnerWith([{ success: false, timedOut: true }]);
  const subject = makeOrchestrator({
    store,
    tracker,
    runner,
    config: config({ retry: { ...defaultRetry(), maxAttempts: 1 } })
  });

  await subject.runOnce();

  const state = await store.getByIssueId(issue.id);
  assert.equal(state?.state, "needs_human_attention");
  assert.equal(state?.attemptCount, 1);
  assert.equal(comments.length, 1);
});

test("non-retryable errors are not retried", async () => {
  const store = new InMemoryRunStateStore();
  const runner = runnerWith([{ success: false, timedOut: false }]);
  const subject = makeOrchestrator({ store, runner });

  await subject.runOnce();
  const second = await subject.runOnce();

  const state = await store.getByIssueId(issue.id);
  assert.equal(state?.state, "failed_terminal");
  assert.equal(state?.lastErrorType, "agent_failed");
  assert.equal(second.processedIssues, 0);
  assert.equal(runner.calls, 1);
});

test("issue moved out of candidate state is skipped when not running", async () => {
  const store = new InMemoryRunStateStore();
  await store.upsert(state({ state: "failed_retryable", lastErrorType: "agent_timeout" }));
  const tracker = trackerWith([{ ...issue, state: "Done" }]);
  const runner = runnerWith([{ success: true }]);
  const subject = makeOrchestrator({ store, tracker, runner });

  const result = await subject.runOnce();

  assert.equal(result.processedIssues, 0);
  assert.equal(runner.calls, 0);
  assert.equal((await store.getByIssueId(issue.id))?.state, "cancelled");
  assert.equal((await store.getByIssueId(issue.id))?.trackerStateLatest, "Done");
});

test("existing pull request URL prevents retry by default", async () => {
  const store = new InMemoryRunStateStore();
  await store.upsert(state({
    state: "failed_retryable",
    lastErrorType: "agent_timeout",
    pullRequestUrl: "https://github.com/acme/repo/pull/3",
    completedAt: "2026-05-07T11:00:00.000Z"
  }));
  const runner = runnerWith([{ success: true }]);
  const subject = makeOrchestrator({ store, runner, now: clock("2026-05-07T12:00:00.000Z") });

  const result = await subject.runOnce();

  assert.equal(result.processedIssues, 0);
  assert.equal(runner.calls, 0);
});

test("succeeded issues are not rerun by default", async () => {
  const store = new InMemoryRunStateStore();
  await store.upsert(state({
    state: "succeeded",
    attemptCount: 1,
    completedAt: "2026-05-07T11:00:00.000Z"
  }));
  const runner = runnerWith([{ success: true }]);
  const subject = makeOrchestrator({ store, runner });

  const result = await subject.runOnce();

  assert.equal(result.processedIssues, 0);
  assert.equal(runner.calls, 0);
});

test("duplicate active run is not started", async () => {
  const store = new InMemoryRunStateStore();
  await store.upsert(state({ state: "running_agent", startedAt: "2026-05-07T11:59:00.000Z", completedAt: null }));
  const runner = runnerWith([{ success: true }]);
  const subject = makeOrchestrator({ store, runner });

  const result = await subject.runOnce();

  assert.equal(result.processedIssues, 0);
  assert.equal(runner.calls, 0);
  assert.equal((await store.getByIssueId(issue.id))?.state, "running_agent");
});

const issue: Issue = {
  id: "issue-1",
  identifier: "ABC-1",
  title: "Retry safely",
  description: null,
  priority: 1,
  state: "Ready",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

function makeOrchestrator(input: {
  store: InMemoryRunStateStore;
  runner?: ReturnType<typeof runnerWith>;
  tracker?: TrackerAdapter;
  config?: WorkflowConfig;
  now?: () => Date;
}): Orchestrator {
  return new Orchestrator(
    { config: {}, promptTemplate: "Do {{issue.identifier}}" },
    input.config ?? config(),
    {
      stateStore: input.store,
      tracker: input.tracker ?? trackerWith([issue]),
      workspaceManager: {
        async createIssueWorkspace() {
          return {
            issueKey: issue.identifier,
            path: `/tmp/workspaces/${issue.identifier}`,
            repoPath: `/tmp/workspaces/${issue.identifier}/repo`,
            createdNow: true
          };
        }
      },
      git: {
        async prepareRepository() {
          return {
            branchName: "symphony/abc-1",
            commands: []
          };
        }
      },
      runner: input.runner ?? runnerWith([{ success: true }]),
      pullRequests: {
        async createDraftPullRequest() {
          return {
            created: false,
            url: null,
            skippedReason: "no_changes",
            changed: false,
            logPaths: []
          };
        }
      },
      now: input.now
    }
  );
}

function trackerWith(issues: Issue[], comments: IssueRunState[] = []): TrackerAdapter {
  return {
    async listIssues() {
      return issues;
    },
    async addNeedsHumanAttentionComment(_issue, runState) {
      comments.push(runState);
    }
  };
}

function runnerWith(results: Array<Partial<AgentRunResult>>): {
  calls: number;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  kind: string;
} {
  return {
    calls: 0,
    kind: "test",
    async run() {
      this.calls += 1;
      const result = results.shift() ?? { success: true };
      return {
        success: result.success ?? true,
        runner: "test",
        exitCode: result.exitCode ?? (result.success === false ? 1 : 0),
        timedOut: result.timedOut ?? false,
        logPath: "/tmp/logs/ABC-1.log",
        stdout: "",
        stderr: ""
      };
    }
  };
}

function config(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  const base: WorkflowConfig = {
    version: 1,
    workflowPath: "/tmp/WORKFLOW.md",
    tracker: { kind: "mock", issueFile: "/tmp/issues.json" },
    state: { kind: "memory" },
    workspace: { root: "/tmp/workspaces" },
    repository: { url: "https://github.com/acme/repo.git", baseBranch: "main", cloneDir: "repo" },
    branch: { prefix: "symphony" },
    github: { kind: "gh", remote: "origin", draft: true, logDir: "/tmp/logs" },
    agent: { kind: "dry-run", timeoutSeconds: 300, logDir: "/tmp/logs" },
    states: { active: ["Ready"], terminal: ["Done", "Canceled"] },
    limits: { maxConcurrency: 1 },
    retry: defaultRetry(),
    daemon: { pollIntervalSeconds: 60 },
    dashboard: { enabled: false, host: "127.0.0.1", port: 4000 }
  };
  return {
    ...base,
    ...overrides,
    workflowPath: overrides.workflowPath ?? base.workflowPath
  };
}

function defaultRetry(): WorkflowConfig["retry"] {
  return {
    maxAttempts: 2,
    failureCooldownSeconds: 300,
    retryableErrors: ["agent_timeout", "network_error", "transient_tracker_error"],
    retryWithExistingPullRequest: false,
    rerunSucceeded: false
  };
}

function state(overrides: Partial<IssueRunState> = {}): IssueRunState {
  return {
    id: "run-1",
    trackerKind: "mock",
    trackerIssueId: issue.id,
    issueIdentifier: issue.identifier,
    issueUrl: issue.url,
    issueTitle: issue.title,
    attemptCount: 1,
    maxAttempts: 2,
    state: "failed_retryable",
    createdAt: "2026-05-07T11:55:00.000Z",
    startedAt: "2026-05-07T11:55:00.000Z",
    updatedAt: "2026-05-07T11:55:00.000Z",
    completedAt: "2026-05-07T11:55:00.000Z",
    lastErrorType: "agent_timeout",
    lastErrorMessage: "Agent runner timed out.",
    workspacePath: `/tmp/workspaces/${issue.identifier}`,
    branchName: "symphony/abc-1",
    pullRequestUrl: null,
    trackerStateAtStart: "Ready",
    trackerStateLatest: "Ready",
    logsPath: "/tmp/logs/ABC-1.log",
    nextRetryAt: null,
    lockOwner: null,
    lockExpiresAt: null,
    metadata: {},
    ...overrides
  };
}

function clock(iso: string): () => Date {
  return () => new Date(iso);
}
