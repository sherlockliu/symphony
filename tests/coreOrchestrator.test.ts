import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator, type PersistedRunRecord } from "../src/core/orchestrator.js";
import { RunStatus, type AgentRunner, type WorkflowConfig } from "../src/core/domain.js";
import type { GitHubOutputService } from "../src/core/githubOutput.js";
import { createConfigHash } from "../src/workflow/workflowLoader.js";

function workflowConfig(root: string, issuesFile: string, eventsFile: string): WorkflowConfig {
  return {
    tracker: {
      kind: "mock",
      issuesFile,
      eventsFile
    },
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

const promptTemplate = [
  "Work on {{ issue.identifier }}.",
  "",
  "Title: {{ issue.title }}",
  "",
  "Description:",
  "{{ issue.description }}",
  "",
  "Workspace: {{ run.workspacePath }}"
].join("\n");

test("core Orchestrator runOnce processes a mock issue through local dry-run lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-core-orchestrator-"));
  const issuesFile = path.join(root, "mock-issues.json");
  const eventsFile = path.join(root, ".orchestrator", "mock-tracker-events.json");
  const runsFilePath = path.join(root, ".orchestrator", "runs.json");
  await writeIssues(issuesFile);

  try {
    const config = workflowConfig(root, issuesFile, eventsFile);
    const result = await new Orchestrator({
      config,
      promptTemplate,
      configHash: createConfigHash(config)
    }, {
      baseDir: root,
      runsFilePath,
      now: () => new Date("2026-05-07T22:00:00.000Z")
    }).runOnce();

    assert.equal(result.fetchedIssues, 2);
    assert.equal(result.eligibleIssues, 1);
    assert.equal(result.processedRuns.length, 1);
    assert.equal(result.processedRuns[0]!.issueIdentifier, "MUL-1");
    assert.equal(result.processedRuns[0]!.status, RunStatus.NEEDS_HUMAN_REVIEW);

    const workspacePath = path.join(root, "workspaces", "MUL-1");
    await stat(workspacePath);
    const prompt = await readFile(path.join(workspacePath, ".orchestrator", "prompt.md"), "utf8");
    assert.match(prompt, /Title: Set up CI\/CD pipeline with GitHub Actions/);
    assert.match(prompt, /Configure automated build, test, and lint checks\./);

    const trackerEvents = JSON.parse(await readFile(eventsFile, "utf8")) as Array<Record<string, unknown>>;
    assert.deepEqual(trackerEvents.map((event) => event.type), ["comment", "transition"]);
    assert.equal(trackerEvents[0]!.issueId, "1");
    assert.equal(trackerEvents[1]!.state, "Human Review");

    const runRecords = JSON.parse(await readFile(runsFilePath, "utf8")) as PersistedRunRecord[];
    assert.equal(runRecords.length, 1);
    assert.equal(runRecords[0]!.run.status, RunStatus.NEEDS_HUMAN_REVIEW);
    assert.deepEqual(runRecords[0]!.events.map((event) => event.type), [
      "issue_fetched",
      "issue_eligible",
      "workspace_created",
      "prompt_rendered",
      "agent_started",
      "agent_completed",
      "tracker_commented",
      "tracker_transitioned"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core Orchestrator attaches GitHub PR URL to run and tracker comment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-core-orchestrator-"));
  const issuesFile = path.join(root, "mock-issues.json");
  const eventsFile = path.join(root, ".orchestrator", "mock-tracker-events.json");
  const runsFilePath = path.join(root, ".orchestrator", "runs.json");
  await writeIssues(issuesFile);
  const githubOutput: GitHubOutputService = {
    async attachPullRequest(request) {
      return {
        prUrl: "https://github.com/example/app/pull/42",
        branchName: request.workspace.branchName,
        commitCount: 1,
        created: true,
        foundExisting: false,
        skippedReason: null
      };
    }
  };

  try {
    const config = workflowConfig(root, issuesFile, eventsFile);
    const result = await new Orchestrator({
      config,
      promptTemplate,
      configHash: createConfigHash(config)
    }, {
      baseDir: root,
      runsFilePath,
      githubOutput
    }).runOnce();

    assert.equal(result.processedRuns[0]!.branchName, "ai/MUL-1");
    assert.equal(result.processedRuns[0]!.prUrl, "https://github.com/example/app/pull/42");

    const trackerEvents = JSON.parse(await readFile(eventsFile, "utf8")) as Array<Record<string, unknown>>;
    assert.match(String(trackerEvents[0]!.body), /https:\/\/github\.com\/example\/app\/pull\/42/);

    const runRecords = JSON.parse(await readFile(runsFilePath, "utf8")) as PersistedRunRecord[];
    assert.equal(runRecords[0]!.run.prUrl, "https://github.com/example/app/pull/42");
    assert.equal(runRecords[0]!.result?.prUrl, "https://github.com/example/app/pull/42");
    assert.ok(runRecords[0]!.events.some((event) => event.type === "pr_created"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core Orchestrator records failed runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-core-orchestrator-"));
  const issuesFile = path.join(root, "mock-issues.json");
  const eventsFile = path.join(root, ".orchestrator", "mock-tracker-events.json");
  const runsFilePath = path.join(root, ".orchestrator", "runs.json");
  await writeIssues(issuesFile);
  const failingRunner: AgentRunner = {
    kind: "dry-run",
    async run() {
      throw new Error("agent failed");
    }
  };

  try {
    const config = workflowConfig(root, issuesFile, eventsFile);
    const result = await new Orchestrator({
      config,
      promptTemplate,
      configHash: createConfigHash(config)
    }, {
      baseDir: root,
      runsFilePath,
      agentRunner: failingRunner
    }).runOnce();

    assert.equal(result.processedRuns.length, 1);
    assert.equal(result.processedRuns[0]!.status, RunStatus.FAILED);
    assert.equal(result.processedRuns[0]!.errorMessage, "agent failed");

    const runRecords = JSON.parse(await readFile(runsFilePath, "utf8")) as PersistedRunRecord[];
    assert.equal(runRecords[0]!.run.status, RunStatus.FAILED);
    assert.equal(runRecords[0]!.events.at(-1)?.type, "run_failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeIssues(issuesFile: string): Promise<void> {
  await writeFile(issuesFile, JSON.stringify([
    {
      id: "1",
      identifier: "MUL-1",
      title: "Set up CI/CD pipeline with GitHub Actions",
      description: "Configure automated build, test, and lint checks.",
      state: "Ready for AI",
      priority: "High",
      labels: ["devops"],
      url: "https://example.local/MUL-1"
    },
    {
      id: "2",
      identifier: "MUL-2",
      title: "Completed task",
      description: "Already done.",
      state: "Done",
      priority: "Low",
      labels: [],
      url: "https://example.local/MUL-2"
    }
  ]), "utf8");
}
