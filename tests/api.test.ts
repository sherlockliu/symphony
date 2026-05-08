import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildApiServer } from "../src/server/api.js";
import { RunStatus, type WorkflowConfig } from "../src/core/domain.js";
import type { MvpWorkflow, PersistedRunRecord } from "../src/core/orchestrator.js";

test("HTTP API health returns ok", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "GET", url: "/api/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API board returns expected columns", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "GET", url: "/api/board" });
    const body = response.json() as { columns: Array<{ name: string; items: unknown[] }> };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(body.columns.map((column) => column.name), [
      "Fetched",
      "Queued",
      "Running",
      "Needs Review",
      "Done",
      "Failed"
    ]);
    assert.equal(body.columns.find((column) => column.name === "Fetched")!.items.length, 1);
    assert.equal(body.columns.find((column) => column.name === "Needs Review")!.items.length, 1);
    assert.equal(body.columns.find((column) => column.name === "Failed")!.items.length, 1);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API runs endpoint returns run records", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "GET", url: "/api/runs" });
    const body = response.json() as { runs: PersistedRunRecord[] };

    assert.equal(response.statusCode, 200);
    assert.equal(body.runs.length, 2);
    assert.equal(body.runs[0]!.run.id, "run-1");
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API events endpoint returns events", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "GET", url: "/api/runs/run-1/events" });
    const body = response.json() as { events: Array<{ type: string }> };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(body.events.map((event) => event.type), ["issue_fetched", "agent_completed"]);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API retry action creates a new queued run and records an event", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "POST", url: "/api/runs/run-2/retry" });
    const body = response.json() as { record: PersistedRunRecord };
    const runsResponse = await server.inject({ method: "GET", url: "/api/runs" });
    const runsBody = runsResponse.json() as { runs: PersistedRunRecord[] };

    assert.equal(response.statusCode, 200);
    assert.equal(body.record.run.issueId, "issue-3");
    assert.equal(body.record.run.status, RunStatus.QUEUED);
    assert.equal(body.record.run.retryCount, 1);
    assert.equal(body.record.run.agentKind, "dry-run");
    assert.equal(body.record.events[0]!.type, "retry_requested");
    assert.equal(runsBody.runs.length, 3);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API cancel action rejects non-running runs clearly", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "POST", url: "/api/runs/run-1/cancel" });
    const body = response.json() as { error: string; message: string };

    assert.equal(response.statusCode, 409);
    assert.equal(body.error, "invalid_run_state");
    assert.match(body.message, /RUNNING_AGENT/);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API cancel action marks running runs cancelled and invokes controller", async () => {
  const fixture = await createFixture();
  await writeFile(fixture.apiOptions.runsFilePath!, JSON.stringify([...runRecords(), runningRunRecord()], null, 2), "utf8");
  const cancelled: string[] = [];
  const server = buildApiServer({
    ...fixture.apiOptions,
    activeRunController: {
      async cancel(runId) {
        cancelled.push(runId);
        return true;
      }
    }
  });
  try {
    const response = await server.inject({ method: "POST", url: "/api/runs/run-running/cancel" });
    const body = response.json() as { record: PersistedRunRecord };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(cancelled, ["run-running"]);
    assert.equal(body.record.run.status, RunStatus.CANCELLED);
    assert.equal(body.record.events.at(-1)?.type, "cancel_requested");
    assert.equal(body.record.events.at(-1)?.metadata.childProcessStopped, true);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API ignore action marks a run ignored and records an event", async () => {
  const fixture = await createFixture();
  const server = buildApiServer(fixture.apiOptions);
  try {
    const response = await server.inject({ method: "POST", url: "/api/runs/run-2/ignore" });
    const body = response.json() as { record: PersistedRunRecord };
    const eventsResponse = await server.inject({ method: "GET", url: "/api/runs/run-2/events" });
    const eventsBody = eventsResponse.json() as { events: Array<{ type: string }> };

    assert.equal(response.statusCode, 200);
    assert.equal(body.record.run.status, RunStatus.IGNORED);
    assert.equal(eventsBody.events.at(-1)?.type, "ignored_by_operator");
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API serves built static UI when configured", async () => {
  const fixture = await createFixture();
  const staticUiDir = path.join(fixture.root, "dist-ui");
  await mkdir(path.join(staticUiDir, "assets"), { recursive: true });
  await writeFile(path.join(staticUiDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  await writeFile(path.join(staticUiDir, "assets", "app.css"), "body { color: #111; }", "utf8");
  const server = buildApiServer({ ...fixture.apiOptions, staticUiDir });
  try {
    const html = await server.inject({ method: "GET", url: "/" });
    const css = await server.inject({ method: "GET", url: "/assets/app.css" });

    assert.equal(html.statusCode, 200);
    assert.match(html.body, /<div id="root"><\/div>/);
    assert.equal(css.statusCode, 200);
    assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

test("HTTP API does not serve traversed static assets", async () => {
  const fixture = await createFixture();
  const staticUiDir = path.join(fixture.root, "dist-ui");
  await mkdir(path.join(staticUiDir, "assets"), { recursive: true });
  await writeFile(path.join(staticUiDir, "index.html"), "<!doctype html>", "utf8");
  const server = buildApiServer({ ...fixture.apiOptions, staticUiDir });
  try {
    const response = await server.inject({ method: "GET", url: "/assets/%2e%2e/index.html" });

    assert.notEqual(response.statusCode, 200);
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});

async function createFixture(): Promise<{
  apiOptions: Parameters<typeof buildApiServer>[0];
  root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-api-"));
  const issuesFilePath = path.join(root, "mock-issues.json");
  const runsFilePath = path.join(root, ".orchestrator", "runs.json");
  await mkdir(path.dirname(runsFilePath), { recursive: true });
  await writeFile(issuesFilePath, JSON.stringify([
    {
      id: "issue-1",
      identifier: "MUL-1",
      title: "Ready issue",
      description: "Ready for agent.",
      state: "Ready for AI",
      priority: "High",
      labels: ["devops"],
      url: "https://example.local/MUL-1"
    },
    {
      id: "issue-2",
      identifier: "MUL-2",
      title: "Unprocessed issue",
      description: "Fetched but not run.",
      state: "Ready for AI",
      priority: "Low",
      labels: [],
      url: "https://example.local/MUL-2"
    }
  ]), "utf8");
  await writeFile(runsFilePath, JSON.stringify(runRecords(), null, 2), "utf8");

  const config = workflowConfig(root, issuesFilePath);
  const workflow: MvpWorkflow = {
    config,
    promptTemplate: "Prompt",
    configHash: "hash-1"
  };

  return {
    root,
    apiOptions: {
      workflow,
      baseDir: root,
      issuesFilePath,
      runsFilePath
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function workflowConfig(root: string, issuesFilePath: string): WorkflowConfig {
  return {
    tracker: { kind: "mock", issuesFile: issuesFilePath },
    repository: {
      url: "git@github.com:example/app.git",
      defaultBranch: "main",
      branchNamePattern: "ai/{{ issue.identifier }}"
    },
    workspace: {
      root: path.join(root, "workspaces"),
      cleanupPolicy: "never"
    },
    agent: {
      kind: "dry-run",
      command: "echo",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      timeoutSeconds: 1800
    },
    polling: {
      enabled: false,
      intervalSeconds: 60
    },
    states: {
      eligible: ["Ready for AI"],
      terminal: ["Done"],
      humanReview: "Human Review"
    },
    safety: {
      requireHumanReview: true,
      allowAutoMerge: false,
      allowTicketTransitions: true,
      allowPrCreation: true,
      redactSecrets: true,
      maxConcurrentRuns: 1
    }
  };
}

function runRecords(): PersistedRunRecord[] {
  return [
    {
      run: {
        id: "run-1",
        issueId: "issue-1",
        issueIdentifier: "MUL-1",
        status: RunStatus.NEEDS_HUMAN_REVIEW,
        workspacePath: "/tmp/workspaces/MUL-1",
        branchName: "ai/MUL-1",
        agentKind: "dry-run",
        startedAt: "2026-05-07T22:00:00.000Z",
        finishedAt: "2026-05-07T22:00:01.000Z",
        retryCount: 0,
        prUrl: null,
        errorMessage: null
      },
      events: [
        {
          id: "event-1",
          runId: "run-1",
          type: "issue_fetched",
          message: "Fetched MUL-1.",
          timestamp: "2026-05-07T22:00:00.000Z",
          metadata: {}
        },
        {
          id: "event-2",
          runId: "run-1",
          type: "agent_completed",
          message: "Dry run completed",
          timestamp: "2026-05-07T22:00:01.000Z",
          metadata: {}
        }
      ],
      result: {
        status: "success",
        summary: "Dry run completed",
        changedFiles: [],
        prUrl: null
      }
    },
    {
      run: {
        id: "run-2",
        issueId: "issue-3",
        issueIdentifier: "MUL-3",
        status: RunStatus.FAILED,
        workspacePath: "/tmp/workspaces/MUL-3",
        branchName: "ai/MUL-3",
        agentKind: "dry-run",
        startedAt: "2026-05-07T22:00:00.000Z",
        finishedAt: "2026-05-07T22:00:01.000Z",
        retryCount: 0,
        prUrl: null,
        errorMessage: "agent failed"
      },
      events: [
        {
          id: "event-3",
          runId: "run-2",
          type: "run_failed",
          message: "agent failed",
          timestamp: "2026-05-07T22:00:01.000Z",
          metadata: {}
        }
      ]
    }
  ];
}

function runningRunRecord(): PersistedRunRecord {
  return {
    run: {
      id: "run-running",
      issueId: "issue-4",
      issueIdentifier: "MUL-4",
      status: RunStatus.RUNNING_AGENT,
      workspacePath: "/tmp/workspaces/MUL-4",
      branchName: "ai/MUL-4",
      agentKind: "dry-run",
      startedAt: "2026-05-07T22:00:00.000Z",
      finishedAt: null,
      retryCount: 0,
      prUrl: null,
      errorMessage: null
    },
    events: [
      {
        id: "event-running",
        runId: "run-running",
        type: "agent_started",
        message: "Agent started",
        timestamp: "2026-05-07T22:00:00.000Z",
        metadata: {}
      }
    ]
  };
}
