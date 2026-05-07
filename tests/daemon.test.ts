import test from "node:test";
import assert from "node:assert/strict";
import { PollingDaemon, type DaemonLogEvent } from "../src/daemon/pollingDaemon.js";
import type { IssueRunSummary, OrchestratorCycleResult, OrchestratorRunOptions } from "../src/types.js";

test("PollingDaemon polls repeatedly and delegates retry state to orchestrator", async () => {
  const excludeSnapshots: string[][] = [];
  const events: DaemonLogEvent[] = [];
  let sleeps = 0;

  const daemon = new PollingDaemon({
    async runOnce(options?: OrchestratorRunOptions): Promise<OrchestratorCycleResult> {
      excludeSnapshots.push([...(options?.excludeIssueIds ?? [])]);
      const issueAlreadyCompleted = options?.excludeIssueIds?.has("issue-1") ?? false;
      return {
        totalIssues: 1,
        activeIssues: 1,
        eligibleIssues: issueAlreadyCompleted ? 0 : 1,
        processedIssues: issueAlreadyCompleted ? 0 : 1,
        results: issueAlreadyCompleted ? [] : [summary("completed")]
      };
    }
  }, {
    pollIntervalMs: 1000,
    maxCycles: 2,
    sleep: async () => {
      sleeps += 1;
    },
    logger: (event) => {
      events.push(event);
    }
  });

  await daemon.start();

  assert.deepEqual(excludeSnapshots, [[], []]);
  assert.equal(sleeps, 1);
  assert.equal(events.at(0)?.status, "daemon_started");
  assert.equal(events.at(-1)?.status, "daemon_stopped");
  assert.equal(events.some((event) => event.status === "poll_failed"), false);
});

test("PollingDaemon retries failed issues on the next poll", async () => {
  const excludeSnapshots: string[][] = [];

  const daemon = new PollingDaemon({
    async runOnce(options?: OrchestratorRunOptions): Promise<OrchestratorCycleResult> {
      excludeSnapshots.push([...(options?.excludeIssueIds ?? [])]);
      return {
        totalIssues: 1,
        activeIssues: 1,
        eligibleIssues: 1,
        processedIssues: 1,
        results: [summary("failed")]
      };
    }
  }, {
    pollIntervalMs: 1000,
    maxCycles: 2,
    sleep: async () => undefined
  });

  await daemon.start();

  assert.deepEqual(excludeSnapshots, [[], []]);
});

function summary(status: "completed" | "failed"): IssueRunSummary {
  return {
    status,
    issueId: "issue-1",
    issue: "ABC-1",
    workspace: "/tmp/workspaces/ABC-1",
    repo: "/tmp/workspaces/ABC-1/repo",
    branch: "symphony/abc-1",
    runner: "dry-run",
    exitCode: status === "completed" ? 0 : 1,
    timedOut: false,
    logPath: "/tmp/logs/ABC-1-dry-run.log",
    pullRequest: {
      created: false,
      url: null,
      skippedReason: status === "completed" ? "no_changes" : "agent_failed",
      changed: false,
      logPaths: []
    },
    tracker: {
      commented: false,
      transitioned: false,
      skippedReason: "no_pr_created"
    },
    next: "Symphony never merges PRs"
  };
}
