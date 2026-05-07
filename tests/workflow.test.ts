import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { loadWorkflow } from "../src/workflow/load.js";
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
    assert.deepEqual(config.state, { kind: "memory" });
    assert.equal(config.workflowPath, "/repo/examples/WORKFLOW.md");
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
    assert.equal(config.daemon?.pollIntervalSeconds, 60);
    assert.deepEqual(config.retry, {
      maxAttempts: 2,
      failureCooldownSeconds: 300,
      retryableErrors: ["agent_timeout", "network_error", "transient_tracker_error"],
      retryWithExistingPullRequest: false,
      rerunSucceeded: false
    });
    assert.deepEqual(config.dashboard, { enabled: false, host: "127.0.0.1", port: 4000 });
  } finally {
    if (previous === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previous;
    }
  }
});

test("validateWorkflow accepts Postgres state configuration", () => {
  const workflow = validWorkflow
    .replace(
      "workspace:\n  root: ${WORKSPACE_ROOT}",
      [
        "state:",
        "  kind: postgres",
        "  connection_string: ${DATABASE_URL}",
        "  lock_ttl_seconds: 600",
        "workspace:",
        "  root: ${WORKSPACE_ROOT}"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://orchestrator:secret@localhost:5432/orchestrator";
  try {
    const parsed = parseWorkflow(workflow);
    const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

    assert.deepEqual(config.state, {
      kind: "postgres",
      connectionString: "postgres://orchestrator:secret@localhost:5432/orchestrator",
      lockTtlSeconds: 600
    });
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  }
});

test("validateWorkflow rejects invalid Postgres state configuration", () => {
  const workflow = validWorkflow
    .replace(
      "workspace:\n  root: ${WORKSPACE_ROOT}",
      [
        "state:",
        "  kind: postgres",
        "workspace:",
        "  root: ${WORKSPACE_ROOT}"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /state.connection_string must be provided/
  );
});

test("validateWorkflow rejects unsupported state stores with an actionable message", () => {
  const workflow = validWorkflow
    .replace(
      "workspace:\n  root: ${WORKSPACE_ROOT}",
      [
        "state:",
        "  kind: sqlite",
        "  path: ./state.db",
        "workspace:",
        "  root: ${WORKSPACE_ROOT}"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /SQLite is not implemented/
  );
});

test("validateWorkflow rejects unsupported parallel orchestration with an actionable message", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace("max_concurrency: 1", "max_concurrency: 2");
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /parallel orchestration is implemented/
  );
});

test("validateWorkflow accepts daemon poll interval configuration", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      "limits:\n  max_concurrency: 1\ndaemon:\n  poll_interval_seconds: 15"
    );
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.equal(config.daemon?.pollIntervalSeconds, 15);
});

test("validateWorkflow rejects invalid daemon poll intervals", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      "limits:\n  max_concurrency: 1\ndaemon:\n  poll_interval_seconds: 0"
    );
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /daemon.poll_interval_seconds must be greater than or equal to 1/
  );
});

test("validateWorkflow accepts dashboard configuration", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      [
        "limits:",
        "  max_concurrency: 1",
        "dashboard:",
        "  enabled: true",
        "  host: localhost",
        "  port: 4100"
      ].join("\n")
    );
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.deepEqual(config.dashboard, { enabled: true, host: "localhost", port: 4100 });
});

test("validateWorkflow rejects invalid dashboard ports", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      "limits:\n  max_concurrency: 1\ndashboard:\n  port: 70000"
    );
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /dashboard.port must be an integer between 1 and 65535/
  );
});

test("validateWorkflow accepts retry configuration", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      [
        "limits:",
        "  max_concurrency: 1",
        "retry:",
        "  max_attempts: 3",
        "  failure_cooldown_seconds: 10",
        "  retryable_errors: [\"agent_timeout\", \"network_error\"]",
        "  retry_with_existing_pull_request: true",
        "  rerun_succeeded: true"
      ].join("\n")
    );
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.deepEqual(config.retry, {
    maxAttempts: 3,
    failureCooldownSeconds: 10,
    retryableErrors: ["agent_timeout", "network_error"],
    retryWithExistingPullRequest: true,
    rerunSucceeded: true
  });
});

test("validateWorkflow rejects invalid retry configuration", () => {
  const workflow = validWorkflow
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
    .replace(
      "limits:\n  max_concurrency: 1",
      "limits:\n  max_concurrency: 1\nretry:\n  max_attempts: 0"
    );
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /retry.max_attempts must be an integer greater than or equal to 1/
  );
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

test("loadWorkflow reports missing workflow paths with an actionable message", async () => {
  await assert.rejects(
    () => loadWorkflow("/tmp/does-not-exist/WORKFLOW.md"),
    /Workflow file not found: .*examples\/WORKFLOW\.quickstart\.mock\.md/
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
    /tracker.kind must be one of:/
  );
});

test("validateWorkflow rejects unsupported agent runner kinds", () => {
  const parsed = parseWorkflow(
    validWorkflow
      .replace("kind: dry-run", "kind: claude-code")
      .replace("${WORKSPACE_ROOT}", "./tmp/workspaces")
  );

  assert.throws(
    () => validateWorkflow(parsed, "/repo/WORKFLOW.md"),
    /agent.kind must be one of:/
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

test("validateWorkflow accepts shell runner configuration", () => {
  const workflow = validWorkflow
    .replace(
      "kind: dry-run\n  timeout_seconds: 300",
      [
        "kind: shell",
        "  command: my-agent --non-interactive",
        "  timeout_minutes: 2",
        "  prompt_mode: file",
        "  env:",
        "    AGENT_MODE: coding"
      ].join("\n")
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);
  const config = validateWorkflow(parsed, "/repo/examples/WORKFLOW.md");

  assert.equal(config.agent.kind, "shell");
  if (config.agent.kind === "shell") {
    assert.equal(config.agent.command, "my-agent --non-interactive");
    assert.equal(config.agent.timeoutSeconds, 120);
    assert.equal(config.agent.promptMode, "file");
    assert.deepEqual(config.agent.env, { AGENT_MODE: "coding" });
  }
});

test("validateWorkflow rejects invalid shell prompt mode", () => {
  const workflow = validWorkflow
    .replace(
      "kind: dry-run\n  timeout_seconds: 300",
      "kind: shell\n  command: my-agent\n  prompt_mode: socket"
    )
    .replace("${WORKSPACE_ROOT}", "./tmp/workspaces");
  const parsed = parseWorkflow(workflow);

  assert.throws(
    () => validateWorkflow(parsed, "/repo/examples/WORKFLOW.md"),
    /agent.prompt_mode must be stdin or file/
  );
});
