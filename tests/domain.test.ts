import test from "node:test";
import assert from "node:assert/strict";
import {
  RunStatus,
  createAgentRun,
  createTrackedIssue,
  type AgentRunner,
  type TrackerAdapter,
  type WorkspaceManager,
  type WorkflowConfig
} from "../src/core/domain.js";

const workflow: WorkflowConfig = {
  tracker: {
    kind: "mock",
    issueFile: "./issues.json"
  },
  repository: {
    url: "git@example.com:acme/repo.git",
    defaultBranch: "main",
    branchNamePattern: "agent/{{issue.identifier}}"
  },
  workspace: {
    root: ".workspaces",
    cleanupPolicy: "never"
  },
  agent: {
    kind: "dry-run",
    command: "echo",
    maxConcurrentAgents: 1,
    maxTurns: 1,
    timeoutSeconds: 300
  },
  polling: {
    enabled: false,
    intervalSeconds: 60
  },
  states: {
    eligible: ["Ready"],
    terminal: ["Done", "Cancelled"],
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

test("RunStatus exposes the expected domain values", () => {
  assert.deepEqual(Object.values(RunStatus), [
    "DISCOVERED",
    "ELIGIBLE",
    "QUEUED",
    "PREPARING_WORKSPACE",
    "RUNNING_AGENT",
    "AGENT_COMPLETED",
    "PR_CREATED",
    "NEEDS_HUMAN_REVIEW",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "IGNORED"
  ]);
});

test("createTrackedIssue preserves required tracked issue fields", () => {
  const issue = createTrackedIssue({
    id: "issue-1",
    identifier: "ENG-1",
    title: "Add orchestration domain model",
    description: "Create pure domain types.",
    url: "https://tracker.example/ENG-1",
    trackerKind: "mock",
    state: "Ready",
    priority: "High",
    labels: ["orchestrator", "domain"],
    assignee: "agent@example.com",
    raw: { source: "test" }
  });

  assert.equal(issue.id, "issue-1");
  assert.equal(issue.identifier, "ENG-1");
  assert.equal(issue.title, "Add orchestration domain model");
  assert.equal(issue.description, "Create pure domain types.");
  assert.equal(issue.url, "https://tracker.example/ENG-1");
  assert.equal(issue.trackerKind, "mock");
  assert.equal(issue.state, "Ready");
  assert.equal(issue.priority, "High");
  assert.deepEqual(issue.labels, ["orchestrator", "domain"]);
  assert.equal(issue.assignee, "agent@example.com");
  assert.deepEqual(issue.raw, { source: "test" });
});

test("createTrackedIssue rejects missing required fields", () => {
  assert.throws(
    () => createTrackedIssue({
      id: "",
      identifier: "ENG-1",
      title: "Bad issue",
      description: null,
      url: null,
      trackerKind: "mock",
      state: "Ready",
      priority: null,
      labels: [],
      assignee: null,
      raw: null
    }),
    /TrackedIssue.id must be a non-empty string/
  );
});

test("createAgentRun validates status and retry count", () => {
  const run = createAgentRun({
    id: "run-1",
    issueId: "issue-1",
    issueIdentifier: "ENG-1",
    status: RunStatus.QUEUED,
    workspacePath: "/tmp/workspaces/ENG-1",
    branchName: "agent/ENG-1",
    agentKind: "dry-run",
    startedAt: "2026-05-07T00:00:00.000Z",
    finishedAt: null,
    retryCount: 0,
    prUrl: null,
    errorMessage: null
  });

  assert.equal(run.status, RunStatus.QUEUED);
  assert.equal(run.retryCount, 0);
});

test("domain interfaces support mock tracker, agent, and workspace implementations", async () => {
  const issue = createTrackedIssue({
    id: "issue-1",
    identifier: "ENG-1",
    title: "Run mocked domain flow",
    description: null,
    url: null,
    trackerKind: "mock",
    state: "Ready",
    priority: null,
    labels: [],
    assignee: null,
    raw: null
  });
  const tracker: TrackerAdapter = {
    kind: "mock",
    async fetchCandidateIssues() {
      return [issue];
    },
    async fetchIssue() {
      return issue;
    }
  };
  const workspaceManager: WorkspaceManager = {
    planWorkspace(candidate) {
      return {
        issueIdentifier: candidate.identifier,
        workspacePath: `/tmp/${candidate.identifier}`,
        repositoryPath: `/tmp/${candidate.identifier}/repo`,
        branchName: `agent/${candidate.identifier}`
      };
    },
    async prepareWorkspace(candidate, config) {
      return this.planWorkspace(candidate, config);
    }
  };
  const agent: AgentRunner = {
    kind: "dry-run",
    async run(input) {
      return {
        status: input.issue.identifier === "ENG-1" ? "success" : "failed",
        summary: input.prompt,
        changedFiles: [],
        prUrl: null
      };
    }
  };

  const [candidate] = await tracker.fetchCandidateIssues(workflow.tracker);
  const workspacePlan = await workspaceManager.prepareWorkspace(candidate!, workflow);
  const result = await agent.run({
    issue: candidate!,
    workflow,
    workspacePath: workspacePlan.workspacePath,
    prompt: "Do the work"
  });

  assert.equal(workspacePlan.branchName, "agent/ENG-1");
  assert.equal(result.status, "success");
  assert.equal(result.summary, "Do the work");
});
