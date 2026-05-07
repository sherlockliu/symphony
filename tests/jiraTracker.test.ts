import test from "node:test";
import assert from "node:assert/strict";
import { JiraTracker, type HttpRequest, type HttpResponse } from "../src/trackers/jiraTracker.js";

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
  email: "bot@example.com",
  apiToken: "token-secret",
  jql: 'project = ENG AND status = "Ready for Agent"',
  maxResults: 50,
  reviewTransition: "Human Review"
};

test("JiraTracker fetches issues by JQL and normalizes fields", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new JiraTracker(config, async (request) => {
    calls.push(request);
    return response(200, {
      issues: [
        {
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
        }
      ]
    });
  });

  const issues = await tracker.listIssues();

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
      priority: 2,
      state: "Ready for Agent",
      branchName: null,
      url: "https://example.atlassian.net/browse/ENG-12",
      labels: ["backend", "jira"],
      blockedBy: [{ id: "10000", identifier: "ENG-11", state: "In Progress" }],
      createdAt: "2026-05-01T10:00:00.000+0000",
      updatedAt: "2026-05-02T10:00:00.000+0000"
    }
  ]);
});

test("JiraTracker comments with a PR URL and transitions to Human Review", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new JiraTracker(config, async (request) => {
    calls.push(request);
    if (request.method === "GET") {
      return response(200, {
        transitions: [
          { id: "31", name: "Human Review", to: { name: "Human Review" } }
        ]
      });
    }
    return response(204, "");
  });
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
  const tracker = new JiraTracker(config, async () => response(200, { transitions: [] }));
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
