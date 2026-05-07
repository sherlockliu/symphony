import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { registerTracker, registeredTrackerKinds, type CustomTrackerConfig } from "../src/trackers/registry.js";
import type { TrackerAdapter } from "../src/trackers/tracker.js";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { validateWorkflow } from "../src/workflow/schema.js";
import { InMemoryRunStateStore } from "../src/state/runStateStore.js";
import type { AgentRunRequest, AgentRunResult, Issue } from "../src/types.js";

const customKind = "example-test-tracker";

interface ExampleTrackerConfig extends CustomTrackerConfig {
  kind: typeof customKind;
  queueName: string;
  apiToken: string;
}

test("a custom tracker can be registered and used without changing orchestrator core", async () => {
  const issue: Issue = {
    id: "external-1",
    identifier: "EXT-1",
    title: "Run through registered tracker",
    description: "This came from a custom tracker registration.",
    priority: null,
    state: "Ready",
    branchName: null,
    url: "https://tracker.example/issues/EXT-1",
    labels: ["custom"],
    blockedBy: [],
    createdAt: null,
    updatedAt: null
  };
  let listCalls = 0;

  registerTracker<ExampleTrackerConfig>({
    kind: customKind,
    capabilities: {
      canComment: false,
      canTransition: false,
      canFetchByQuery: true,
      canFetchByLabel: false
    },
    validateConfig(raw, context) {
      const queueName = requiredString(raw.queueName, "tracker.queue_name", context.issues);
      const apiToken = requiredString(raw.apiToken, "tracker.api_token", context.issues);
      if (queueName === undefined || apiToken === undefined) {
        return undefined;
      }
      return {
        kind: customKind,
        queueName,
        apiToken
      };
    },
    create() {
      const adapter: TrackerAdapter = {
        async listIssues() {
          listCalls += 1;
          return [issue];
        }
      };
      return adapter;
    }
  }, { replace: true });

  const definition = parseWorkflow(workflowWithTracker([
    `kind: ${customKind}`,
    "  queue_name: ready-for-agent",
    "  api_token: secret-value"
  ]));
  const config = validateWorkflow(definition, "/repo/examples/WORKFLOW.md");

  assert.equal(config.tracker.kind, customKind);
  assert.ok(registeredTrackerKinds().includes(customKind));

  const orchestrator = new Orchestrator(definition, config, {
    stateStore: new InMemoryRunStateStore(),
    workspaceManager: {
      async createIssueWorkspace() {
        return {
          issueKey: issue.identifier,
          path: "/tmp/workspaces/EXT-1",
          repoPath: "/tmp/workspaces/EXT-1/repo",
          createdNow: true
        };
      }
    },
    git: {
      async prepareRepository() {
        return {
          branchName: "symphony/ext-1",
          commands: []
        };
      }
    },
    runner: runnerWithSuccess(),
    pullRequests: {
      async createDraftPullRequest() {
        return {
          created: false,
          url: null,
          skippedReason: "no_changes",
          changed: false,
          logPaths: []
        };
      }
    }
  });

  const result = await orchestrator.runOnce();

  assert.equal(listCalls, 1);
  assert.equal(result.processedIssues, 1);
  assert.equal(result.results[0]?.issue, "EXT-1");
});

test("unknown tracker kind produces a clear validation error", () => {
  const definition = parseWorkflow(workflowWithTracker([
    "kind: does-not-exist",
    "  api_token: secret-value"
  ]));

  assert.throws(
    () => validateWorkflow(definition, "/repo/examples/WORKFLOW.md"),
    /tracker.kind must be one of:/
  );
});

test("tracker capability requirements fail clearly when unsupported", () => {
  const definition = parseWorkflow(workflowWithTracker([
    "kind: mock",
    "  issue_file: ./mock-issues.json",
    "  require_comment: true"
  ]));
  const config = validateWorkflow(definition, "/repo/examples/WORKFLOW.md");

  assert.throws(
    () => new Orchestrator(definition, config, { tracker: { async listIssues() { return []; } } }),
    /requires unsupported tracker capability: comment/
  );
});

test("orchestrator core does not import concrete tracker adapters", async () => {
  const source = await readFile("src/orchestrator/orchestrator.ts", "utf8");

  assert.equal(source.includes("mockTracker"), false);
  assert.equal(source.includes("jiraTracker"), false);
  assert.equal(source.includes("planeTracker"), false);
  assert.equal(source.includes("githubIssuesTracker"), false);
});

function requiredString(value: unknown, display: string, issues: string[]): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function runnerWithSuccess(): {
  kind: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
} {
  return {
    kind: "test",
    async run() {
      return {
        success: true,
        runner: "test",
        exitCode: 0,
        timedOut: false,
        logPath: "/tmp/logs/EXT-1.log",
        stdout: "",
        stderr: ""
      };
    }
  };
}

function workflowWithTracker(trackerLines: string[]): string {
  return `---
version: 1
tracker:
  ${trackerLines.join("\n")}
workspace:
  root: ./tmp/workspaces
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
  active: ["Ready"]
  terminal: ["Done"]
limits:
  max_concurrency: 1
---
# Prompt
Do {{issue.identifier}}.
`;
}
