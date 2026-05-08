import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { AgentRunnerFactory } from "../src/agents/agentRunnerFactory.js";
import { DryRunAgentRunner } from "../src/agents/dryRunAgentRunner.js";
import type { AgentRunInput, TrackedIssue, WorkflowConfig } from "../src/core/domain.js";

const issue: TrackedIssue = {
  id: "issue-1",
  identifier: "MUL-1",
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

function workflowConfig(root: string, agentKind = "dry-run"): WorkflowConfig {
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
      kind: agentKind,
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

function input(workspacePath: string): AgentRunInput {
  return {
    issue,
    workspacePath,
    workflow: workflowConfig(path.dirname(workspacePath)),
    prompt: "Implement MUL-1 safely."
  };
}

test("DryRunAgentRunner writes the rendered prompt file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-dry-run-agent-"));
  try {
    const workspacePath = path.join(root, "MUL-1");
    await new DryRunAgentRunner().run(input(workspacePath));

    const prompt = await readFile(path.join(workspacePath, ".orchestrator", "prompt.md"), "utf8");
    assert.equal(prompt, "Implement MUL-1 safely.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DryRunAgentRunner writes a fake result file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-dry-run-agent-"));
  try {
    const workspacePath = path.join(root, "MUL-1");
    await new DryRunAgentRunner().run(input(workspacePath));

    const result = JSON.parse(await readFile(path.join(workspacePath, ".orchestrator", "result.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(result, {
      status: "success",
      summary: "Dry run completed",
      changedFiles: [],
      prUrl: null
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DryRunAgentRunner returns a dry-run result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-dry-run-agent-"));
  try {
    const workspacePath = path.join(root, "MUL-1");
    const result = await new DryRunAgentRunner().run(input(workspacePath));

    assert.deepEqual(result, {
      status: "success",
      summary: "Dry run completed",
      changedFiles: [],
      prUrl: null
    });
    await stat(path.join(workspacePath, ".orchestrator"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AgentRunnerFactory selects the dry-run runner", () => {
  const runner = new AgentRunnerFactory().create(workflowConfig("/tmp/workspaces"));

  assert.ok(runner instanceof DryRunAgentRunner);
  assert.equal(runner.kind, "dry-run");
});

test("AgentRunnerFactory rejects unknown runner kinds clearly", () => {
  assert.throws(
    () => new AgentRunnerFactory().create(workflowConfig("/tmp/workspaces", "codex")),
    /Unknown agent runner kind: codex/
  );
});
