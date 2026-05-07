import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { validateWorkflow } from "../src/workflow/schema.js";
import { interpolateEnv } from "../src/config/env.js";

const validWorkflow = `---
version: 1
tracker:
  kind: mock
  issue_file: ./mock-issues.json
workspace:
  root: \${WORKSPACE_ROOT}
repository:
  url: ..
  base_branch: main
  clone_dir: repo
branch:
  prefix: symphony
github:
  kind: gh
  remote: origin
  draft: true
  log_dir: ./logs
agent:
  kind: dry-run
  timeout_seconds: 300
  log_dir: ./logs
states:
  active: ["Ready", "In Progress"]
  terminal: ["Done"]
limits:
  max_concurrency: 1
---
# Prompt
Do {{issue.identifier}}.
`;

test("parseWorkflow reads YAML front matter and Markdown body", () => {
  const parsed = parseWorkflow(validWorkflow);

  assert.equal(parsed.config.version, 1);
  assert.deepEqual(parsed.config.tracker, {
    kind: "mock",
    issueFile: "./mock-issues.json"
  });
  assert.match(parsed.promptTemplate, /Do \{\{issue.identifier\}\}\./);
});

test("parseWorkflow supports block-style string arrays", () => {
  const parsed = parseWorkflow(validWorkflow.replace('active: ["Ready", "In Progress"]', "active:\n    - Ready\n    - In Progress"));

  assert.deepEqual((parsed.config.states as Record<string, unknown>).active, ["Ready", "In Progress"]);
});

test("validateWorkflow resolves env values and normalizes paths", () => {
  const previous = process.env.WORKSPACE_ROOT;
  process.env.WORKSPACE_ROOT = "./tmp/workspaces";
  try {
    const parsed = parseWorkflow(validWorkflow);
    const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

    assert.equal(config.tracker.kind, "mock");
    assert.equal(config.agent.kind, "dry-run");
    assert.equal(config.limits.maxConcurrency, 1);
    assert.equal(config.workspace.root, "/repo/examples/tmp/workspaces");
    assert.equal(config.tracker.issueFile, "/repo/examples/mock-issues.json");
    assert.equal(config.repository.url, "/repo");
    assert.equal(config.repository.baseBranch, "main");
    assert.equal(config.repository.cloneDir, "repo");
    assert.equal(config.branch.prefix, "symphony");
    assert.equal(config.github.kind, "gh");
    assert.equal(config.github.remote, "origin");
    assert.equal(config.github.draft, true);
    assert.equal(config.github.logDir, "/repo/examples/logs");
    assert.equal(config.agent.timeoutSeconds, 300);
    assert.equal(config.agent.logDir, "/repo/examples/logs");
  } finally {
    if (previous === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previous;
    }
  }
});

test("validateWorkflow rejects non-draft GitHub PR configuration", () => {
  const workflow = validWorkflow
    .replace("draft: true", "draft: false")
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /github.draft must be true/
  );
});

test("interpolateEnv rejects missing variables", () => {
  assert.throws(
    () => interpolateEnv({ token: "${MISSING_TEST_TOKEN}" }, {}),
    /Missing environment variable MISSING_TEST_TOKEN/
  );
});

test("validateWorkflow rejects unsupported tracker kinds", () => {
  const parsed = parseWorkflow(
    validWorkflow
      .replace("kind: mock", "kind: linear")
      .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
  );

  assert.throws(
    () => validateWorkflow(parsed, "/repo/WORKFLOW.md"),
    /tracker.kind must be mock, jira, or plane/
  );
});

test("validateWorkflow accepts Jira tracker configuration", () => {
  const workflow = validWorkflow
    .replace(
      "kind: mock\n  issue_file: ./mock-issues.json",
      [
        "kind: jira",
        "  base_url: https://example.atlassian.net",
        "  email: bot@example.com",
        "  api_token: token-secret",
        "  jql: 'project = ENG AND status = \"Ready for Agent\"'",
        "  max_results: 25",
        "  review_transition: Human Review"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.equal(config.tracker.kind, "jira");
  if (config.tracker.kind === "jira") {
    assert.equal(config.tracker.baseUrl, "https://example.atlassian.net");
    assert.equal(config.tracker.email, "bot@example.com");
    assert.equal(config.tracker.apiToken, "token-secret");
    assert.equal(config.tracker.jql, 'project = ENG AND status = "Ready for Agent"');
    assert.equal(config.tracker.maxResults, 25);
    assert.equal(config.tracker.reviewTransition, "Human Review");
  }
});

test("validateWorkflow accepts Plane tracker configuration", () => {
  const workflow = validWorkflow
    .replace(
      "kind: mock\n  issue_file: ./mock-issues.json",
      [
        "kind: plane",
        "  base_url: https://api.plane.so",
        "  api_key: plane-secret",
        "  workspace_slug: acme",
        "  project_id: project-1",
        "  max_results: 25",
        "  review_state: Human Review"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.equal(config.tracker.kind, "plane");
  if (config.tracker.kind === "plane") {
    assert.equal(config.tracker.baseUrl, "https://api.plane.so");
    assert.equal(config.tracker.apiKey, "plane-secret");
    assert.equal(config.tracker.workspaceSlug, "acme");
    assert.equal(config.tracker.projectId, "project-1");
    assert.equal(config.tracker.maxResults, 25);
    assert.equal(config.tracker.reviewState, "Human Review");
  }
});

test("validateWorkflow accepts codex runner configuration", () => {
  const workflow = validWorkflow
    .replace("kind: dry-run", "kind: codex\n  command: codex\n  args: [\"exec\", \"-\", \"--json\"]")
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.equal(config.agent.kind, "codex");
  if (config.agent.kind === "codex") {
    assert.equal(config.agent.command, "codex");
    assert.deepEqual(config.agent.args, ["exec", "-", "--json"]);
    assert.equal(config.agent.timeoutSeconds, 300);
    assert.equal(config.agent.logDir, "/repo/examples/logs");
  }
});
