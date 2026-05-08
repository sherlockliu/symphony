import test from "node:test";
import assert from "node:assert/strict";
import { renderPrompt } from "../src/templates/promptRenderer.js";
import { RunStatus, type AgentRun, type TrackedIssue, type WorkflowConfig as DomainWorkflowConfig } from "../src/core/domain.js";
import type { Issue, WorkflowConfig } from "../src/types.js";

const issue: Issue = {
  id: "1",
  identifier: "ABC-1",
  title: "Render prompts",
  description: null,
  priority: 1,
  state: "Ready",
  branchName: null,
  url: null,
  labels: ["cli", "prompt"],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

const config: WorkflowConfig = {
  version: 1,
  workflowPath: "/tmp/WORKFLOW.md",
  tracker: { kind: "mock", issueFile: "/tmp/issues.json" },
  state: { kind: "memory" },
  workspace: { root: "/tmp/workspaces" },
  repository: { url: "https://github.com/example/project.git", baseBranch: "main", cloneDir: "repo" },
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
  dashboard: { enabled: false, host: "127.0.0.1", port: 4000 }
};

test("renderPrompt replaces issue and config placeholders", () => {
  const rendered = renderPrompt(
    "{{issue.identifier}} {{issue.title}} {{issue.labels}} {{config.workspace.root}} {{issue.description}}",
    { issue, config }
  );

  assert.equal(rendered, "ABC-1 Render prompts cli, prompt /tmp/workspaces ");
});

test("renderPrompt replaces domain issue, run, and workflow placeholders", () => {
  const trackedIssue: TrackedIssue = {
    id: "issue-123",
    identifier: "APP-123",
    title: "Fix checkout failure",
    description: "The checkout page fails when a coupon is applied.",
    url: "https://tracker.example/APP-123",
    trackerKind: "mock",
    state: "Ready for AI",
    priority: "High",
    labels: ["checkout", "bug"],
    assignee: "engineer@example.com",
    raw: null
  };
  const workflowConfig: DomainWorkflowConfig = {
    tracker: { kind: "mock" },
    repository: {
      url: "git@github.com:example/app.git",
      defaultBranch: "main",
      branchNamePattern: "ai/{{ issue.identifier }}"
    },
    workspace: {
      root: "./workspaces",
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
  const run: AgentRun = {
    id: "run-123",
    issueId: "issue-123",
    issueIdentifier: "APP-123",
    status: RunStatus.RUNNING_AGENT,
    workspacePath: "/tmp/workspaces/APP-123",
    branchName: "ai/APP-123",
    agentKind: "dry-run",
    startedAt: "2026-05-07T20:00:00.000Z",
    finishedAt: null,
    retryCount: 0,
    prUrl: null,
    errorMessage: null
  };

  const rendered = renderPrompt(
    [
      "{{ issue.id }}",
      "{{ issue.identifier }}",
      "{{ issue.title }}",
      "{{ issue.description }}",
      "{{ issue.url }}",
      "{{ issue.state }}",
      "{{ issue.priority }}",
      "{{ run.id }}",
      "{{ run.workspacePath }}",
      "{{ config.repository.url }}",
      "{{ config.repository.defaultBranch }}"
    ].join("\n"),
    { issue: trackedIssue, config: workflowConfig, run }
  );

  assert.equal(
    rendered,
    [
      "issue-123",
      "APP-123",
      "Fix checkout failure",
      "The checkout page fails when a coupon is applied.",
      "https://tracker.example/APP-123",
      "Ready for AI",
      "High",
      "run-123",
      "/tmp/workspaces/APP-123",
      "git@github.com:example/app.git",
      "main"
    ].join("\n")
  );
});

test("renderPrompt renders missing variables as empty strings", () => {
  const rendered = renderPrompt("before {{ issue.missing }} after {{ run.id }}", { issue, config });

  assert.equal(rendered, "before  after ");
});

test("renderPrompt includes issue title and description in rendered coding prompts", () => {
  const rendered = renderPrompt("Title: {{ issue.title }}\n\nDescription:\n{{ issue.description }}", {
    issue: {
      ...issue,
      title: "Add retry state",
      description: "Persist failed runs so daemon restarts are safe."
    },
    config
  });

  assert.match(rendered, /Title: Add retry state/);
  assert.match(rendered, /Persist failed runs so daemon restarts are safe\./);
});

test("renderPrompt exposes config.repository.defaultBranch for runtime configs via baseBranch compatibility", () => {
  const rendered = renderPrompt("{{ config.repository.defaultBranch }}", { issue, config });

  assert.equal(rendered, "main");
});
