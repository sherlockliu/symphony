import test from "node:test";
import assert from "node:assert/strict";
import { DashboardStatusStore } from "../src/dashboard/statusStore.js";
import { startDashboardServer } from "../src/dashboard/server.js";
import type { Issue, IssueRunSummary, WorkflowConfig } from "../src/types.js";

test("DashboardStatusStore serializes run status without unsafe workspace paths", () => {
  const store = new DashboardStatusStore(config(), "daemon", fixedClock());
  store.recordDaemonEvent({
    status: "poll_started",
    cycle: 1
  });
  store.recordIssueStarted(issue);
  store.recordIssueCompleted(summary("completed", "/tmp/workspaces/ABC-1", "https://github.com/acme/repo/pull/1"));
  store.recordDaemonEvent({
    status: "poll_completed",
    cycle: 1,
    totalIssues: 2,
    activeIssues: 2,
    eligibleIssues: 2,
    processedIssues: 1
  });

  const status = store.status();
  const runs = store.runsView();

  assert.equal(status.currentMode, "daemon");
  assert.equal(status.pollingIntervalSeconds, 30);
  assert.equal(status.queuedRuns, 1);
  assert.equal(status.succeededRuns, 1);
  assert.equal(runs.succeeded[0]!.issueIdentifier, "ABC-1");
  assert.equal(runs.succeeded[0]!.workspacePath, "/tmp/workspaces/ABC-1");

  store.recordIssueCompleted(summary("completed", "/tmp/outside/ABC-2", null));
  assert.equal(store.runByIssueIdentifier("ABC-1")?.workspacePath, null);
});

test("DashboardStatusStore config summary omits tracker and provider secrets", () => {
  const store = new DashboardStatusStore(config({
    tracker: {
      kind: "jira",
      baseUrl: "https://example.atlassian.net",
      emailEnv: "JIRA_EMAIL",
      apiTokenEnv: "JIRA_API_TOKEN",
      jql: "project = ENG",
      readyStates: ["Ready for AI"],
      maxResults: 50,
      reviewState: "Human Review"
    },
    agent: {
      kind: "codex",
      command: "codex",
      args: ["exec", "-"],
      timeoutSeconds: 300,
      logDir: "/tmp/logs"
    }
  }));

  const serialized = JSON.stringify(store.configSummary());

  assert.equal(serialized.includes("jira-secret-token"), false);
  assert.equal(serialized.includes("bot@example.com"), false);
  assert.equal(serialized.includes("project = ENG"), false);
  assert.equal(serialized.includes("codex"), true);
  assert.equal(serialized.includes("exec"), false);
});

test("dashboard API endpoints return status, runs, health, and config summary", async (context) => {
  const store = new DashboardStatusStore(config(), "daemon", fixedClock());
  store.recordIssueStarted(issue);
  store.recordIssueCompleted(summary("completed", "/tmp/workspaces/ABC-1", null));
  let server;
  try {
    server = await startDashboardServer(store, { host: "127.0.0.1", port: 0 });
  } catch (error) {
    if (isListenBlocked(error)) {
      context.skip("localhost listen is blocked in this sandbox");
      return;
    }
    throw error;
  }

  try {
    const health = await getJson(`${server.url}/health`);
    const status = await getJson(`${server.url}/api/status`);
    const runs = await getJson(`${server.url}/api/runs`);
    const run = await getJson(`${server.url}/api/runs/ABC-1`);
    const summaryResponse = await getJson(`${server.url}/api/config-summary`);
    const html = await fetch(server.url).then((response) => response.text());

    assert.equal(health.status, "ok");
    assert.equal(status.succeededRuns, 1);
    assert.equal(runs.succeeded[0].issueIdentifier, "ABC-1");
    assert.equal(run.issueIdentifier, "ABC-1");
    assert.equal(summaryResponse.trackerKind, "mock");
    assert.match(html, /Owned Symphony Dashboard/);
  } finally {
    await server.close();
  }
});

const issue: Issue = {
  id: "issue-1",
  identifier: "ABC-1",
  title: "Build dashboard",
  description: "private details that should not be serialized",
  priority: 1,
  state: "Ready",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

function summary(
  status: "completed" | "failed",
  workspace: string,
  prUrl: string | null
): IssueRunSummary {
  return {
    status,
    issueId: "issue-1",
    issue: "ABC-1",
    workspace,
    repo: `${workspace}/repo`,
    branch: "symphony/abc-1",
    runner: "dry-run",
    exitCode: status === "completed" ? 0 : 1,
    timedOut: false,
    logPath: "/tmp/logs/ABC-1-dry-run.log",
    pullRequest: {
      created: prUrl !== null,
      url: prUrl,
      skippedReason: prUrl === null ? "no_changes" : null,
      changed: prUrl !== null,
      logPaths: []
    },
    tracker: {
      commented: prUrl !== null,
      transitioned: prUrl !== null,
      skippedReason: prUrl === null ? "no_pr_created" : undefined
    },
    next: "Symphony never merges PRs"
  };
}

function config(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  const base: WorkflowConfig = {
    version: 1,
    workflowPath: "/tmp/WORKFLOW.md",
    tracker: { kind: "mock", issueFile: "/tmp/issues.json" },
    state: { kind: "memory" },
    workspace: { root: "/tmp/workspaces" },
    repository: {
      url: "https://github.com/acme/repo.git",
      baseBranch: "main",
      cloneDir: "repo"
    },
    branch: { prefix: "symphony" },
    github: { kind: "gh", remote: "origin", draft: true, logDir: "/tmp/logs" },
    agent: { kind: "dry-run", timeoutSeconds: 300, logDir: "/tmp/logs" },
    states: { active: ["Ready"], terminal: ["Done"] },
    limits: { maxConcurrency: 1 },
    retry: {
      maxAttempts: 2,
      failureCooldownSeconds: 300,
      retryableErrors: ["agent_timeout", "network_error", "transient_tracker_error"],
      retryWithExistingPullRequest: false,
      rerunSucceeded: false
    },
    daemon: { pollIntervalSeconds: 30 },
    dashboard: { enabled: true, host: "127.0.0.1", port: 4000 }
  };
  return {
    ...base,
    ...overrides,
    workflowPath: overrides.workflowPath ?? base.workflowPath
  };
}

function fixedClock(): () => Date {
  return () => new Date("2026-05-07T12:00:00.000Z");
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return await response.json();
}

function isListenBlocked(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EPERM";
}
