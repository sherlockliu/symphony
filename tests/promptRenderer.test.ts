import test from "node:test";
import assert from "node:assert/strict";
import { renderPrompt } from "../src/templates/promptRenderer.js";
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
