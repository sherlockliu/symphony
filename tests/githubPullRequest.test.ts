import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubPullRequestService } from "../src/github/pullRequestService.js";
import type { ProcessExecutor, ProcessRequest, ProcessResult } from "../src/agents/processExecutor.js";
import type { Issue, IssueWorkspace, WorkflowConfig } from "../src/types.js";

const issue: Issue = {
  id: "1",
  identifier: "ABC-9",
  title: "Create a draft PR",
  description: null,
  priority: 1,
  state: "Ready",
  branchName: null,
  url: "https://tracker.example/ABC-9",
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

const workspace: IssueWorkspace = {
  issueKey: "ABC-9",
  path: "/tmp/workspaces/ABC-9",
  repoPath: "/tmp/workspaces/ABC-9/repo",
  createdNow: false
};

function config(): WorkflowConfig {
  return {
    version: 1,
    workflowPath: "/tmp/WORKFLOW.md",
    tracker: { kind: "mock", issueFile: "/tmp/issues.json" },
    workspace: { root: "/tmp/workspaces" },
    repository: {
      url: "https://github.com/example/project.git",
      baseBranch: "main",
      cloneDir: "repo"
    },
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
}

test("GitHubPullRequestService skips commit, push, and PR when no changes are detected", async () => {
  const calls: ProcessRequest[] = [];
  const service = new GitHubPullRequestService(config(), executor(calls, [{ stdout: "", exitCode: 0 }]));

  const result = await service.createDraftPullRequest({
    issue,
    workspace,
    branchName: "symphony/abc-9-create-a-draft-pr",
    baseBranch: "main"
  });

  assert.equal(result.created, false);
  assert.equal(result.skippedReason, "no_changes");
  assert.equal(result.url, null);
  assert.deepEqual(calls.map((call) => [call.command, ...call.args]), [["git", "status", "--porcelain"]]);
});

test("GitHubPullRequestService commits, pushes, and creates a draft PR for changed repos", async () => {
  const calls: ProcessRequest[] = [];
  const service = new GitHubPullRequestService(config(), executor(calls, [
    { stdout: " M src/index.ts\n", exitCode: 0 },
    { stdout: "", exitCode: 0 },
    { stdout: "[branch abc] commit\n", exitCode: 0 },
    { stdout: "pushed\n", exitCode: 0 },
    { stdout: "https://github.com/example/project/pull/12\n", exitCode: 0 }
  ]));

  const result = await service.createDraftPullRequest({
    issue,
    workspace,
    branchName: "symphony/abc-9-create-a-draft-pr",
    baseBranch: "main"
  });

  assert.equal(result.created, true);
  assert.equal(result.url, "https://github.com/example/project/pull/12");
  assert.equal(result.changed, true);
  assert.deepEqual(calls.map((call) => [call.command, ...call.args]), [
    ["git", "status", "--porcelain"],
    ["git", "add", "-A"],
    ["git", "commit", "-m", "ABC-9: Create a draft PR"],
    ["git", "push", "-u", "origin", "symphony/abc-9-create-a-draft-pr"],
    [
      "gh",
      "pr",
      "create",
      "--draft",
      "--base",
      "main",
      "--head",
      "symphony/abc-9-create-a-draft-pr",
      "--title",
      "ABC-9: Create a draft PR",
      "--body",
      [
        "Implements ABC-9.",
        "",
        "Issue: https://tracker.example/ABC-9",
        "",
        "Created by Symphony. This PR is intentionally draft-only and will never be merged automatically."
      ].join("\n")
    ]
  ]);
  assert.equal(calls.some((call) => call.command === "gh" && call.args.includes("merge")), false);
  assert.equal(calls.at(-1)!.logPath, path.join("/tmp/logs", "ABC-9-gh-pr-create.log"));
});

test("GitHubPullRequestService plan output never contains merge commands", () => {
  const commands = new GitHubPullRequestService(config()).planCommands(issue, "symphony/abc-9-create-a-draft-pr");

  assert.equal(commands.some((command) => /^gh pr merge\b|^git merge\b/.test(command)), false);
  assert.equal(commands.some((command) => command.includes("gh pr create --draft")), true);
});

function executor(
  calls: ProcessRequest[],
  results: Array<Partial<ProcessResult>>
): ProcessExecutor {
  return {
    async execute(request: ProcessRequest): Promise<ProcessResult> {
      calls.push(request);
      const result = results.shift();
      if (result === undefined) {
        throw new Error("Unexpected process execution.");
      }
      return {
        exitCode: result.exitCode ?? 0,
        timedOut: result.timedOut ?? false,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
      };
    }
  };
}
