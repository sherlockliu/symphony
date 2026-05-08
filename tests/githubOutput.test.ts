import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DefaultGitHubOutputService,
  type GitHubApiRequest,
  type GitHubApiResponse
} from "../src/core/githubOutput.js";
import { RunStatus, type AgentRun, type AgentRunResult, type TrackedIssue, type WorkflowConfig, type WorkspacePlan } from "../src/core/domain.js";
import type { ProcessExecutor, ProcessRequest, ProcessResult } from "../src/agents/processExecutor.js";

test("GitHub output finds an existing PR for the current branch", async () => {
  process.env.GITHUB_TOKEN = "github-secret";
  const gitCalls: ProcessRequest[] = [];
  const apiCalls: GitHubApiRequest[] = [];
  const service = new DefaultGitHubOutputService(
    executor(gitCalls, [
      { stdout: "true\n" },
      { stdout: "ai/MUL-1\n" },
      { stdout: "2\n" }
    ]),
    api(apiCalls, [
      { status: 200, body: [{ html_url: "https://github.com/acme/app/pull/7" }] }
    ])
  );

  const result = await service.attachPullRequest(request());

  assert.equal(result.prUrl, "https://github.com/acme/app/pull/7");
  assert.equal(result.branchName, "ai/MUL-1");
  assert.equal(result.commitCount, 2);
  assert.equal(result.foundExisting, true);
  assert.deepEqual(gitCalls.map((call) => [call.command, ...call.args]), [
    ["git", "rev-parse", "--is-inside-work-tree"],
    ["git", "branch", "--show-current"],
    ["git", "rev-list", "--count", "main..HEAD"]
  ]);
  assert.equal(apiCalls[0]!.path, "/repos/acme/app/pulls?head=acme%3Aai%2FMUL-1&state=open");
  assert.equal(apiCalls[0]!.token, "github-secret");
});

test("GitHub output creates a draft PR when no existing PR is found", async () => {
  process.env.GITHUB_TOKEN = "github-secret";
  const apiCalls: GitHubApiRequest[] = [];
  const service = new DefaultGitHubOutputService(
    executor([], [
      { stdout: "true\n" },
      { stdout: "ai/MUL-1\n" },
      { stdout: "1\n" }
    ]),
    api(apiCalls, [
      { status: 200, body: [] },
      { status: 201, body: { html_url: "https://github.com/acme/app/pull/8" } }
    ])
  );

  const result = await service.attachPullRequest(request());
  const create = apiCalls[1]!;
  const body = create.body as Record<string, unknown>;

  assert.equal(result.prUrl, "https://github.com/acme/app/pull/8");
  assert.equal(result.created, true);
  assert.equal(create.method, "POST");
  assert.equal(create.path, "/repos/acme/app/pulls");
  assert.equal(body.title, "MUL-1: Add GitHub output");
  assert.equal(body.head, "ai/MUL-1");
  assert.equal(body.base, "main");
  assert.equal(body.draft, true);
  assert.match(String(body.body), /Tracker issue: https:\/\/tracker\.example\/MUL-1/);
  assert.match(String(body.body), /Agent summary:\nImplemented output support\./);
  assert.match(String(body.body), /requires human review/);
  assert.equal(apiCalls.some((call) => call.path.includes("merge") || JSON.stringify(call.body ?? {}).includes("auto_merge")), false);
});

test("GitHub output refuses to create PRs from the default branch", async () => {
  process.env.GITHUB_TOKEN = "github-secret";
  const service = new DefaultGitHubOutputService(
    executor([], [
      { stdout: "true\n" },
      { stdout: "main\n" }
    ]),
    api([], [])
  );

  await assert.rejects(
    () => service.attachPullRequest(request()),
    /default branch/
  );
});

function request(): Parameters<DefaultGitHubOutputService["attachPullRequest"]>[0] {
  return {
    issue,
    run,
    agentResult,
    workflow: config(),
    workspace
  };
}

const issue: TrackedIssue = {
  id: "1",
  identifier: "MUL-1",
  title: "Add GitHub output",
  description: "Attach PR URL to run.",
  url: "https://tracker.example/MUL-1",
  trackerKind: "mock",
  state: "Ready for AI",
  priority: "High",
  labels: [],
  assignee: null,
  raw: {}
};

const run: AgentRun = {
  id: "run-1",
  issueId: "1",
  issueIdentifier: "MUL-1",
  status: RunStatus.AGENT_COMPLETED,
  workspacePath: "/tmp/workspaces/MUL-1",
  branchName: "ai/MUL-1",
  agentKind: "dry-run",
  startedAt: "2026-05-08T12:00:00.000Z",
  finishedAt: null,
  retryCount: 0,
  prUrl: null,
  errorMessage: null
};

const agentResult: AgentRunResult = {
  status: "success",
  summary: "Implemented output support.",
  changedFiles: ["src/index.ts"],
  prUrl: null
};

const workspace: WorkspacePlan = {
  issueIdentifier: "MUL-1",
  workspacePath: "/tmp/workspaces/MUL-1",
  repositoryPath: "/tmp/workspaces/MUL-1/repo",
  branchName: "ai/MUL-1"
};

function config(): WorkflowConfig {
  return {
    tracker: { kind: "mock", issuesFile: "/tmp/issues.json" },
    repository: {
      provider: "github",
      url: "git@github.com:acme/app.git",
      defaultBranch: "main",
      branchNamePattern: "ai/{{ issue.identifier }}",
      github: {
        owner: "acme",
        repo: "app",
        tokenEnv: "GITHUB_TOKEN"
      }
    },
    workspace: { root: path.join("/tmp", "workspaces"), cleanupPolicy: "never" },
    agent: { kind: "dry-run", command: "echo", maxConcurrentAgents: 1, maxTurns: 20, timeoutSeconds: 1800 },
    polling: { enabled: false, intervalSeconds: 60 },
    states: { eligible: ["Ready for AI"], terminal: ["Done"], humanReview: "Human Review" },
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

function api(
  calls: GitHubApiRequest[],
  responses: GitHubApiResponse[]
) {
  return async (request: GitHubApiRequest): Promise<GitHubApiResponse> => {
    calls.push(request);
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected GitHub API request.");
    }
    return response;
  };
}
