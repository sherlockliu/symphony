import test from "node:test";
import assert from "node:assert/strict";
import { JiraTrackerAdapter, type HttpRequest, type HttpResponse } from "../src/trackers/jiraTracker.js";

function response(status: number, body: unknown): HttpResponse {
  return {
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

const config = {
  kind: "jira" as const,
  baseUrl: "https://example.atlassian.net",
  emailEnv: "JIRA_EMAIL",
  apiTokenEnv: "JIRA_API_TOKEN",
  jql: 'project = ENG AND status = "Ready for Agent"',
  readyStates: ["Ready for Agent"],
  maxResults: 50,
  reviewState: "Human Review"
};

const env = {
  JIRA_EMAIL: "bot@example.com",
  JIRA_API_TOKEN: "token-secret"
};

test("JiraTracker fetches issues by JQL and normalizes fields", async () => {
  const calls: HttpRequest[] = [];
  const jiraPayload = {
    id: "10001",
    key: "ENG-12",
    fields: {
      summary: "Ship Jira adapter",
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Normalize this issue." }]
          }
        ]
      },
      priority: { id: "2", name: "High" },
      status: { name: "Ready for Agent" },
      labels: ["Backend", "Jira"],
      created: "2026-05-01T10:00:00.000+0000",
      updated: "2026-05-02T10:00:00.000+0000",
      issuelinks: [
        {
          type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
          inwardIssue: {
            id: "10000",
            key: "ENG-11",
            fields: { status: { name: "In Progress" } }
          }
        }
      ]
    }
  };
  const tracker = new JiraTrackerAdapter(config, async (request) => {
    calls.push(request);
    return response(200, {
      issues: [jiraPayload]
    });
  }, env);

  const issues = await tracker.fetchCandidateIssues();

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://example.atlassian.net/rest/api/3/search/jql");
  assert.match(calls[0]!.headers.Authorization, /^Basic /);
  assert.deepEqual(JSON.parse(calls[0]!.body!), {
    jql: 'project = ENG AND status = "Ready for Agent"',
    maxResults: 50,
    fields: ["summary", "description", "priority", "status", "labels", "created", "updated", "issuelinks"]
  });
  assert.deepEqual(issues, [
    {
      id: "10001",
      identifier: "ENG-12",
      title: "Ship Jira adapter",
      description: "Normalize this issue.",
      priority: "High",
      state: "Ready for Agent",
      branchName: null,
      url: "https://example.atlassian.net/browse/ENG-12",
      labels: ["Backend", "Jira"],
      blockedBy: [{ id: "10000", identifier: "ENG-11", state: "In Progress" }],
      createdAt: "2026-05-01T10:00:00.000+0000",
      updatedAt: "2026-05-02T10:00:00.000+0000",
      raw: jiraPayload
    }
  ]);
});

test("JiraTracker comments with a PR URL and transitions to Human Review", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new JiraTrackerAdapter(config, async (request) => {
    calls.push(request);
    if (request.method === "GET") {
      return response(200, {
        transitions: [
          { id: "31", name: "Human Review", to: { name: "Human Review" } }
        ]
      });
    }
    return response(204, "");
  }, env);
  const issue = {
    id: "10001",
    identifier: "ENG-12",
    title: "Ship Jira adapter",
    description: null,
    priority: null,
    state: "Ready for Agent",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null
  };

  await tracker.addPullRequestComment(issue, "https://github.com/example/repo/pull/1");
  await tracker.transitionToHumanReview(issue);

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://example.atlassian.net/rest/api/3/issue/ENG-12/comment");
  assert.match(calls[0]!.body!, /Draft PR created by Symphony/);
  assert.equal(calls[1]!.method, "GET");
  assert.equal(calls[1]!.url, "https://example.atlassian.net/rest/api/3/issue/ENG-12/transitions");
  assert.equal(calls[2]!.method, "POST");
  assert.deepEqual(JSON.parse(calls[2]!.body!), { transition: { id: "31" } });
});

test("JiraTracker fails safely when Human Review transition is unavailable", async () => {
  const tracker = new JiraTrackerAdapter(config, async () => response(200, { transitions: [] }), env);
  const issue = {
    id: "10001",
    identifier: "ENG-12",
    title: "Ship Jira adapter",
    description: null,
    priority: null,
    state: "Ready for Agent",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null
  };

  await assert.rejects(() => tracker.transitionToHumanReview(issue), /Human Review is not available/);
});

test("JiraTracker fails clearly when multiple transitions match", async () => {
  const tracker = new JiraTrackerAdapter(config, async () => response(200, {
    transitions: [
      { id: "31", name: "Human Review", to: { name: "Human Review" } },
      { id: "32", name: "Human Review", to: { name: "Human Review" } }
    ]
  }), env);

  await assert.rejects(
    () => tracker.transitionIssue("ENG-12", "Human Review"),
    /ambiguous.*31.*32/
  );
});

test("JiraTracker reads credentials from configured environment variables", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new JiraTrackerAdapter(config, async (request) => {
    calls.push(request);
    return response(200, { issues: [] });
  }, env);

  await tracker.listIssues();

  const expected = Buffer.from("bot@example.com:token-secret").toString("base64");
  assert.equal(calls[0]!.headers.Authorization, `Basic ${expected}`);
});

test("JiraTracker reports missing environment variables clearly", () => {
  assert.throws(
    () => new JiraTrackerAdapter(config, async () => response(200, { issues: [] }), {}),
    /Jira email environment variable JIRA_EMAIL is not set/
  );
});

test("JiraTracker redacts secrets from API errors", async () => {
  const tracker = new JiraTrackerAdapter(config, async () => response(401, {
    error: "bad token",
    apiToken: "token-secret",
    authorization: "Basic token-secret"
  }), env);

  await assert.rejects(
    () => tracker.listIssues(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /token-secret/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("JiraTracker reports transport errors without leaking secrets", async () => {
  const tracker = new JiraTrackerAdapter(config, async () => {
    throw new Error("network failed with apiToken=token-secret");
  }, env);

  await assert.rejects(
    () => tracker.listIssues(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /token-secret/);
      assert.match(error.message, /apiToken=\[REDACTED\]/);
      return true;
    }
  );
});
