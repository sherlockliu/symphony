import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import {
  registerAgentRunner,
  registeredAgentRunnerKinds,
  type CustomAgentConfig
} from "../src/agents/registry.js";
import type { AgentRunner } from "../src/agents/agentRunner.js";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { validateWorkflow } from "../src/workflow/schema.js";
import { InMemoryRunStateStore } from "../src/state/runStateStore.js";
import type { AgentRunRequest, Issue } from "../src/types.js";
import type { TrackerAdapter } from "../src/trackers/tracker.js";

const customKind = "example-test-runner";

interface ExampleAgentConfig extends CustomAgentConfig {
  kind: typeof customKind;
  executable: string;
}

test("a custom agent runner can be registered and used without changing orchestrator core", async () => {
  const issue: Issue = {
    id: "issue-1",
    identifier: "AGENT-1",
    title: "Run custom agent",
    description: null,
    priority: null,
    state: "Ready",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null
  };
  const requests: AgentRunRequest[] = [];

  registerAgentRunner<ExampleAgentConfig>({
    kind: customKind,
    validate(raw, context) {
      const timeoutSeconds = requiredNumber(raw.timeoutSeconds, "agent.timeout_seconds", context.issues);
      const logDir = requiredString(raw.logDir, "agent.log_dir", context.issues);
      const executable = requiredString(raw.executable, "agent.executable", context.issues);
      if (timeoutSeconds === undefined || logDir === undefined || executable === undefined) {
        return undefined;
      }
      return {
        kind: customKind,
        timeoutSeconds,
        logDir: path.resolve(context.baseDir, logDir),
        executable
      };
    },
    create(config) {
      const runner: AgentRunner = {
        kind: config.kind,
        async run(request) {
          requests.push(request);
          return {
            success: true,
            runner: config.kind,
            exitCode: 0,
            timedOut: false,
            logPath: path.join(request.logDir, `${request.issue.identifier}-example.log`),
            stdout: "ok",
            stderr: ""
          };
        }
      };
      return runner;
    }
  }, { replace: true });

  const definition = parseWorkflow(workflowWithAgent([
    `kind: ${customKind}`,
    "  executable: example-agent",
    "  timeout_seconds: 45",
    "  log_dir: ./logs"
  ]));
  const config = validateWorkflow(definition, "/repo/examples/WORKFLOW.md");

  assert.equal(config.agent.kind, customKind);
  assert.ok(registeredAgentRunnerKinds().includes(customKind));

  const orchestrator = new Orchestrator(definition, config, {
    stateStore: new InMemoryRunStateStore(),
    tracker: trackerWith([issue]),
    workspaceManager: {
      async createIssueWorkspace() {
        return {
          issueKey: issue.identifier,
          path: "/tmp/workspaces/AGENT-1",
          repoPath: "/tmp/workspaces/AGENT-1/repo",
          createdNow: true
        };
      }
    },
    git: {
      async prepareRepository() {
        return {
          branchName: "symphony/agent-1",
          commands: []
        };
      }
    },
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

  assert.equal(result.processedIssues, 1);
  assert.equal(result.results[0]?.runner, customKind);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.workflowPath, "/repo/examples/WORKFLOW.md");
  assert.equal(requests[0]!.timeoutSeconds, 45);
  assert.equal(requests[0]!.logDir, "/repo/examples/logs");
  assert.match(requests[0]!.prompt, /Run AGENT-1/);
});

function trackerWith(issues: Issue[]): TrackerAdapter {
  return {
    async listIssues() {
      return issues;
    }
  };
}

function requiredString(value: unknown, display: string, issues: string[]): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function requiredNumber(value: unknown, display: string, issues: string[]): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issues.push(`${display} must be a positive number.`);
    return undefined;
  }
  return value;
}

function workflowWithAgent(agentLines: string[]): string {
  return `---
version: 1
tracker:
  kind: mock
  issue_file: ./mock-issues.json
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
  ${agentLines.join("\n")}
states:
  active: ["Ready"]
  terminal: ["Done"]
limits:
  max_concurrency: 1
---
# Prompt
Run {{issue.identifier}}.
`;
}
