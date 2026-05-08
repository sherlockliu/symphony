import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { RunStatus, type AgentRun, type TrackedIssue, type WorkflowConfig } from "../src/core/domain.js";
import { sanitizeIssueIdentifier } from "../src/workspaces/pathSafety.js";
import { LocalWorkspaceManager, type LocalWorkspaceMetadata } from "../src/workspaces/localWorkspaceManager.js";

const issue: TrackedIssue = {
  id: "issue-1",
  identifier: "MUL/../1 fix CI",
  title: "Set up CI/CD pipeline",
  description: "Configure automated build, test, and lint checks.",
  url: "https://example.local/MUL-1",
  trackerKind: "mock",
  state: "Ready for AI",
  priority: "High",
  labels: ["devops"],
  assignee: null,
  raw: null
};

const run: AgentRun = {
  id: "run-1",
  issueId: "issue-1",
  issueIdentifier: issue.identifier,
  status: RunStatus.PREPARING_WORKSPACE,
  workspacePath: null,
  branchName: null,
  agentKind: "dry-run",
  startedAt: "2026-05-07T20:00:00.000Z",
  finishedAt: null,
  retryCount: 0,
  prUrl: null,
  errorMessage: null
};

function workflowConfig(root: string): WorkflowConfig {
  return {
    tracker: { kind: "mock", issuesFile: "./mock-issues.json" },
    repository: {
      url: "git@github.com:example/app.git",
      defaultBranch: "main",
      branchNamePattern: "ai/{{ issue.identifier }}"
    },
    workspace: {
      root,
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

test("sanitizeIssueIdentifier allows letters numbers dash and underscore", () => {
  assert.equal(sanitizeIssueIdentifier("ABC_123-def"), "ABC_123-def");
  assert.equal(sanitizeIssueIdentifier("ABC/123: fix CI"), "ABC-123-fix-CI");
});

test("LocalWorkspaceManager prevents path traversal through issue identifiers", () => {
  const config = workflowConfig("/tmp/workspaces");
  const plan = new LocalWorkspaceManager().planWorkspace(
    { ...issue, identifier: "../../secret" },
    config
  );

  assert.equal(plan.workspacePath, path.join("/tmp/workspaces", "secret"));
  assert.equal(path.relative(config.workspace.root, plan.workspacePath).startsWith(".."), false);
});

test("LocalWorkspaceManager creates metadata file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-local-workspace-"));
  try {
    const manager = new LocalWorkspaceManager({
      now: () => new Date("2026-05-07T21:00:00.000Z")
    });
    const plan = await manager.prepareWorkspace(issue, workflowConfig(root), run, "hash-123");

    await stat(plan.workspacePath);
    await stat(path.join(plan.workspacePath, ".orchestrator"));
    const metadata = JSON.parse(await readFile(plan.metadataPath, "utf8")) as LocalWorkspaceMetadata;

    assert.deepEqual(metadata, {
      runId: "run-1",
      issueIdentifier: "MUL/../1 fix CI",
      createdAt: "2026-05-07T21:00:00.000Z",
      workflowConfigHash: "hash-123",
      repositoryUrl: "git@github.com:example/app.git",
      branchName: "ai/MUL/../1 fix CI"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LocalWorkspaceManager renders branch names from repository pattern", () => {
  const config = workflowConfig("/tmp/workspaces");
  const plan = new LocalWorkspaceManager().planWorkspace(issue, config);

  assert.equal(plan.branchName, "ai/MUL/../1 fix CI");
});

test("LocalWorkspaceManager creates workspaces idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-local-workspace-"));
  try {
    const manager = new LocalWorkspaceManager();
    const config = workflowConfig(root);
    const first = await manager.prepareWorkspace(issue, config, run, "hash-123");
    const second = await manager.prepareWorkspace(issue, config, run, "hash-123");

    assert.equal(first.workspacePath, second.workspacePath);
    assert.equal(first.createdNow, true);
    assert.equal(second.createdNow, false);
    await stat(second.metadataPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
