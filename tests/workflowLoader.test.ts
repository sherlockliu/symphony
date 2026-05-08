import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkflowFromString } from "../src/workflow/workflowLoader.js";

const validWorkflow = `---
tracker:
  kind: mock

repository:
  url: "git@github.com:example/app.git"
  defaultBranch: "main"
  branchNamePattern: "ai/{{ issue.identifier }}"

workspace:
  root: "./workspaces"

agent:
  kind: dry-run
  command: "echo"
  maxConcurrentAgents: 2
  maxTurns: 20
  timeoutSeconds: 1800

states:
  ready:
    - "Ready for AI"
  review: "Human Review"
  done:
    - "Done"
    - "Closed"

safety:
  allowAutoMerge: false
  allowTicketTransitions: true
  allowPrCreation: true
---

You are working on {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}
`;

test("loadWorkflowFromString parses a valid workflow", () => {
  const loaded = loadWorkflowFromString(validWorkflow);

  assert.equal(loaded.config.tracker.kind, "mock");
  assert.equal(loaded.config.repository.url, "git@github.com:example/app.git");
  assert.equal(loaded.config.agent.kind, "dry-run");
  assert.deepEqual(loaded.config.states.eligible, ["Ready for AI"]);
  assert.equal(loaded.config.states.humanReview, "Human Review");
  assert.deepEqual(loaded.config.states.terminal, ["Done", "Closed"]);
  assert.match(loaded.configHash, /^[a-f0-9]{64}$/);
});

test("loadWorkflowFromString accepts GitHub repository output configuration", () => {
  const workflow = validWorkflow.replace(
    'repository:\n  url: "git@github.com:example/app.git"\n  defaultBranch: "main"\n  branchNamePattern: "ai/{{ issue.identifier }}"',
    [
      "repository:",
      "  provider: github",
      '  url: "git@github.com:example/app.git"',
      '  defaultBranch: "main"',
      '  branchNamePattern: "ai/{{ issue.identifier }}"',
      "  github:",
      '    owner: "example"',
      '    repo: "app"',
      '    tokenEnv: "GITHUB_TOKEN"'
    ].join("\n")
  );

  const loaded = loadWorkflowFromString(workflow);

  assert.equal(loaded.config.repository.provider, "github");
  assert.equal(loaded.config.repository.github?.owner, "example");
  assert.equal(loaded.config.repository.github?.repo, "app");
  assert.equal(loaded.config.repository.github?.tokenEnv, "GITHUB_TOKEN");
});

test("loadWorkflowFromString reports missing required fields", () => {
  const workflow = validWorkflow.replace(
    /repository:\n  url: "git@github\.com:example\/app\.git"\n  defaultBranch: "main"\n  branchNamePattern: "ai\/\{\{ issue\.identifier \}\}"\n\n/,
    ""
  );

  assert.throws(
    () => loadWorkflowFromString(workflow),
    /repository/
  );
});

test("loadWorkflowFromString rejects invalid tracker kinds", () => {
  const workflow = validWorkflow.replace("kind: mock", "kind: linear");

  assert.throws(
    () => loadWorkflowFromString(workflow),
    /tracker\.kind|Invalid input/
  );
});

test("loadWorkflowFromString applies default values", () => {
  const workflow = validWorkflow
    .replace("  maxConcurrentAgents: 2\n", "")
    .replace("  timeoutSeconds: 1800\n", "")
    .replace(/\nsafety:\n  allowAutoMerge: false\n  allowTicketTransitions: true\n  allowPrCreation: true\n/, "");

  const loaded = loadWorkflowFromString(workflow);

  assert.equal(loaded.config.agent.maxConcurrentAgents, 1);
  assert.equal(loaded.config.agent.timeoutSeconds, 1800);
  assert.equal(loaded.config.polling.intervalSeconds, 60);
  assert.equal(loaded.config.safety.allowAutoMerge, false);
  assert.equal(loaded.config.safety.allowTicketTransitions, true);
  assert.equal(loaded.config.workspace.cleanupPolicy, "never");
});

test("loadWorkflowFromString extracts the Markdown prompt body", () => {
  const loaded = loadWorkflowFromString(validWorkflow);

  assert.equal(
    loaded.promptTemplate,
    [
      "You are working on {{ issue.identifier }}.",
      "",
      "Title:",
      "{{ issue.title }}",
      "",
      "Description:",
      "{{ issue.description }}"
    ].join("\n")
  );
});

test("loadWorkflowFromString changes config hash when config changes", () => {
  const first = loadWorkflowFromString(validWorkflow);
  const second = loadWorkflowFromString(validWorkflow.replace('defaultBranch: "main"', 'defaultBranch: "trunk"'));

  assert.notEqual(first.configHash, second.configHash);
});
