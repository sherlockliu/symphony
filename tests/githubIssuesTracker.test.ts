import test from "node:test";
import assert from "node:assert/strict";
import { GitHubIssuesTracker } from "../src/trackers/githubIssuesTracker.js";
import type { HttpRequest, HttpResponse } from "../src/trackers/jiraTracker.js";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { validateWorkflow } from "../src/workflow/schema.js";

function response(status: number, body: unknown): HttpResponse {
  return {
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

const config = {
  kind: "github-issues" as const,
  owner: "acme",
  repo: "repo",
  token: "github-secret",
  labels: ["ready-for-ai"],
  humanReviewLabel: "human-review",
  closedStates: ["closed"],
  removeCandidateLabelsOnReview: true,
  maxResults: 50
};

test("GitHubIssuesTracker fetches candidate issues by label and normalizes fields", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new GitHubIssuesTracker(config, async (request) => {
    calls.push(request);
    return response(200, [
      {
        id: 1001,
        number: 42,
        title: "Ship GitHub issues adapter",
        body: "Normalize this issue.",
        html_url: "https://github.com/acme/repo/issues/42",
        state: "open",
        labels: [{ name: "Ready-For-AI" }, { name: "Backend" }],
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-02T10:00:00Z"
      },
      {
        id: 1002,
        number: 43,
        title: "Closed issue",
        html_url: "https://github.com/acme/repo/issues/43",
        state: "closed",
        labels: []
      },
      {
        id: 1003,
        number: 44,
        title: "Pull request should be ignored",
        html_url: "https://github.com/acme/repo/pull/44",
        state: "open",
        labels: [],
        pull_request: {}
      }
    ]);
  });

  const issues = await tracker.listIssues();

  assert.equal(calls[0]!.method, "GET");
  assert.equal(
    calls[0]!.url,
    "https://api.github.com/repos/acme/repo/issues?state=all&labels=ready-for-ai&per_page=50&page=1"
  );
  assert.equal(calls[0]!.headers.Authorization, "Bearer github-secret");
  assert.deepEqual(issues, [
    {
      id: "acme/repo#42",
      identifier: "repo#42",
      title: "Ship GitHub issues adapter",
      description: "Normalize this issue.",
      priority: null,
      state: "open",
      branchName: null,
      url: "https://github.com/acme/repo/issues/42",
      labels: ["ready-for-ai", "backend"],
      blockedBy: [],
      createdAt: "2026-05-01T10:00:00Z",
      updatedAt: "2026-05-02T10:00:00Z"
    }
  ]);
});

test("GitHubIssuesTracker comments on issues with a mocked API", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new GitHubIssuesTracker(config, async (request) => {
    calls.push(request);
    return response(201, { id: 1 });
  });

  await tracker.commentOnIssue("acme/repo#42", "Draft PR created.");

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.github.com/repos/acme/repo/issues/42/comments");
  assert.deepEqual(JSON.parse(calls[0]!.body!), { body: "Draft PR created." });
});

test("GitHubIssuesTracker transition adds human-review label and optionally removes candidate labels", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new GitHubIssuesTracker(config, async (request) => {
    calls.push(request);
    return response(request.method === "DELETE" ? 204 : 200, request.method === "DELETE" ? "" : {});
  });

  await tracker.transitionIssue("acme/repo#42", "human-review");

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.github.com/repos/acme/repo/issues/42/labels");
  assert.deepEqual(JSON.parse(calls[0]!.body!), { labels: ["human-review"] });
  assert.equal(calls[1]!.method, "DELETE");
  assert.equal(calls[1]!.url, "https://api.github.com/repos/acme/repo/issues/42/labels/ready-for-ai");
});

test("validateWorkflow accepts GitHub Issues tracker configuration", () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "github-secret";
  try {
    const config = validateWorkflow(parseWorkflow(`---
version: 1
tracker:
  kind: github-issues
  owner: acme
  repo: repo
  token: \${GITHUB_TOKEN}
  labels:
    - ready-for-ai
  human_review_label: human-review
  closed_states: ["closed"]
  remove_candidate_labels_on_review: true
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
  active: ["open"]
  terminal: ["closed"]
limits:
  max_concurrency: 1
---
# Prompt
Do {{issue.identifier}}.
`), "/repo/examples/WORKFLOW.md");

    assert.equal(config.tracker.kind, "github-issues");
    if (config.tracker.kind === "github-issues") {
      assert.equal(config.tracker.owner, "acme");
      assert.equal(config.tracker.repo, "repo");
      assert.equal(config.tracker.token, "github-secret");
      assert.deepEqual(config.tracker.labels, ["ready-for-ai"]);
      assert.equal(config.tracker.removeCandidateLabelsOnReview, true);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previous;
    }
  }
});
