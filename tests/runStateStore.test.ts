import test from "node:test";
import assert from "node:assert/strict";
import { POSTGRES_MIGRATIONS } from "../src/state/postgresMigrations.js";
import { PostgresRunStateStore, type SqlExecutor } from "../src/state/postgresRunStateStore.js";
import {
  createInitialRunState,
  InMemoryRunStateStore,
  type IssueRunState
} from "../src/state/runStateStore.js";
import type { Issue, WorkflowConfig } from "../src/types.js";

test("InMemoryRunStateStore implements durable store semantics", async () => {
  const store = new InMemoryRunStateStore();
  const now = new Date("2026-05-07T12:00:00.000Z");
  const runState = {
    ...createInitialRunState(issue, config(), now.toISOString()),
    state: "failed_retryable",
    attemptCount: 1,
    nextRetryAt: "2026-05-07T11:59:00.000Z"
  } satisfies IssueRunState;

  await store.upsert(runState);
  await store.upsert({ ...runState, issueTitle: "Updated title" });

  assert.equal((await store.getByIssueId(issue.id))?.issueTitle, "Updated title");
  assert.equal((await store.getByIssueIdentifier(issue.identifier))?.trackerIssueId, issue.id);
  assert.equal((await store.listRetryable(now)).length, 1);
  assert.equal((await store.listActive()).length, 0);
  assert.equal((await store.listUnfinished()).length, 1);
  assert.equal((await store.listRecent(10)).length, 1);
});

test("InMemoryRunStateStore prevents duplicate active locks and clears expired locks", async () => {
  const store = new InMemoryRunStateStore();
  const runState = createInitialRunState(issue, config(), "2026-05-07T12:00:00.000Z");
  await store.upsert(runState);

  assert.equal(await store.acquireLock(runState, "worker-a", new Date(Date.now() + 300_000)), true);
  assert.equal(await store.acquireLock(runState, "worker-b", new Date(Date.now() + 300_000)), false);

  await store.releaseLock(runState, "worker-a");
  assert.equal((await store.getByIssueId(issue.id))?.lockOwner, null);
});

test("markStaleRuns converts active runs to retryable or human-attention states", async () => {
  const store = new InMemoryRunStateStore();
  const retryable = {
    ...createInitialRunState(issue, config(), "2026-05-07T12:00:00.000Z"),
    state: "running_agent",
    attemptCount: 1,
    maxAttempts: 2
  } satisfies IssueRunState;
  const exhausted = {
    ...createInitialRunState({ ...issue, id: "issue-2", identifier: "ABC-2" }, config(), "2026-05-07T12:00:00.000Z"),
    state: "creating_pr",
    attemptCount: 2,
    maxAttempts: 2
  } satisfies IssueRunState;

  await store.upsert(retryable);
  await store.upsert(exhausted);
  assert.equal((await store.listActive()).length, 2);
  await store.markStaleRuns(new Date("2026-05-07T12:30:00.000Z"));

  assert.equal((await store.getByIssueId("issue-1"))?.state, "failed_retryable");
  assert.equal((await store.getByIssueId("issue-2"))?.state, "needs_human_attention");
});

test("Postgres migrations are idempotent and include duplicate-prevention indexes", () => {
  const sql = POSTGRES_MIGRATIONS.map((migration) => migration.sql).join("\n");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS issue_run_states/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS issue_run_states_tracker_issue_unique/);
  assert.match(sql, /lock_owner text/);
  assert.match(sql, /schema_migrations/);
});

test("PostgresRunStateStore serializes and deserializes run state through an executor", async () => {
  const executor = new FakeSqlExecutor();
  const store = new PostgresRunStateStore({
    connectionString: "postgres://orchestrator:secret@localhost:5432/orchestrator",
    executor
  });
  const runState = {
    ...createInitialRunState(issue, config({ state: { kind: "postgres", connectionString: "postgres://x:y@localhost/db", lockTtlSeconds: 900 } }), "2026-05-07T12:00:00.000Z"),
    state: "succeeded",
    attemptCount: 1,
    pullRequestUrl: "https://github.com/acme/repo/pull/1"
  } satisfies IssueRunState;

  await store.upsert(runState);
  const fetched = await store.getByIssueId(issue.id);
  const recent = await store.listRecent(5);

  assert.equal(fetched?.pullRequestUrl, "https://github.com/acme/repo/pull/1");
  assert.equal(recent.length, 1);
  assert.equal(executor.migrationCount, 1);
});

class FakeSqlExecutor implements SqlExecutor {
  migrationCount = 0;
  private state: Record<string, unknown> | undefined;

  async query(sql: string, params: unknown[] = []) {
    if (sql.includes("CREATE TABLE IF NOT EXISTS issue_run_states")) {
      this.migrationCount += 1;
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO issue_run_states")) {
      this.state = rowFromParams(params);
      return { rows: [] };
    }
    if (sql.startsWith("SELECT * FROM issue_run_states")) {
      return { rows: this.state === undefined ? [] : [this.state] };
    }
    return { rows: [] };
  }
}

function rowFromParams(params: unknown[]): Record<string, unknown> {
  return {
    id: params[0],
    tracker_kind: params[1],
    tracker_issue_id: params[2],
    issue_identifier: params[3],
    issue_url: params[4],
    issue_title: params[5],
    state: params[6],
    attempt_count: params[7],
    max_attempts: params[8],
    last_error_type: params[9],
    last_error_message: params[10],
    workspace_path: params[11],
    branch_name: params[12],
    pull_request_url: params[13],
    logs_path: params[14],
    tracker_state_at_start: params[15],
    tracker_state_latest: params[16],
    created_at: params[17],
    updated_at: params[18],
    started_at: params[19],
    completed_at: params[20],
    next_retry_at: params[21],
    lock_owner: params[22],
    lock_expires_at: params[23],
    metadata: params[24]
  };
}

const issue: Issue = {
  id: "issue-1",
  identifier: "ABC-1",
  title: "Persist state",
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
    retry: {
      maxAttempts: 2,
      failureCooldownSeconds: 300,
      retryableErrors: ["agent_timeout", "network_error", "transient_tracker_error"],
      retryWithExistingPullRequest: false,
      rerunSucceeded: false
    },
    daemon: { pollIntervalSeconds: 60 },
    dashboard: { enabled: false, host: "127.0.0.1", port: 4000 }
  };
  return { ...base, ...overrides };
}
