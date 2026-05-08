import test from "node:test";
import assert from "node:assert/strict";
import { PlaneTrackerAdapter } from "../src/trackers/planeTracker.js";
import type { HttpRequest, HttpResponse } from "../src/trackers/jiraTracker.js";

function response(status: number, body: unknown): HttpResponse {
  return {
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

const config = {
  kind: "plane" as const,
  baseUrl: "https://api.plane.so",
  apiTokenEnv: "PLANE_API_TOKEN",
  workspaceSlug: "acme",
  projectId: "project-1",
  readyStates: ["Ready for AI"],
  maxResults: 50,
  reviewState: "Human Review"
};

const env = {
  PLANE_API_TOKEN: "plane-secret"
};

test("PlaneTracker fetches work items and normalizes fields", async () => {
  const calls: HttpRequest[] = [];
  const payload = {
    id: "work-item-1",
    code: "ENG-42",
    name: "Ship Plane adapter",
    description_stripped: "Normalize Plane work items.",
    priority: "high",
    state: { id: "state-ready", name: "Ready for AI" },
    labels: [{ name: "Backend" }, { name: "Plane" }],
    sequence_id: 42,
    url: "https://plane.example/acme/ENG-42",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-05-02T10:00:00Z",
    project: { id: "project-1", identifier: "ENG", name: "Engineering" }
  };
  const tracker = new PlaneTrackerAdapter(config, async (request) => {
    calls.push(request);
    return response(200, [
      payload,
      { id: "work-item-2", name: "Ignore", state: { id: "state-todo", name: "Todo" } }
    ]);
  }, env);

  const issues = await tracker.fetchCandidateIssues();

  assert.equal(calls[0]!.method, "GET");
  assert.equal(
    calls[0]!.url,
    "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/?limit=50&offset=0&expand=state%2Clabels%2Cproject"
  );
  assert.equal(calls[0]!.headers["x-api-key"], "plane-secret");
  assert.deepEqual(issues, [
    {
      id: "work-item-1",
      identifier: "ENG-42",
      title: "Ship Plane adapter",
      description: "Normalize Plane work items.",
      priority: "high",
      state: "Ready for AI",
      branchName: null,
      url: "https://plane.example/acme/ENG-42",
      labels: ["Backend", "Plane"],
      blockedBy: [],
      createdAt: "2026-05-01T10:00:00Z",
      updatedAt: "2026-05-02T10:00:00Z",
      raw: payload
    }
  ]);
});

test("PlaneTracker normalizes fallback sequence, title, html description, and generated URL", async () => {
  const tracker = new PlaneTrackerAdapter({ ...config, readyStates: [] }, async () => response(200, [
    {
      id: "work-item-2",
      title: "Fallback title",
      description_html: "<p>HTML description</p>",
      priority: "medium",
      state: "Ready for AI",
      labels: ["UI"],
      sequence_id: 7,
      project: { id: "project-1", identifier: "ENG" }
    }
  ]), env);

  const issues = await tracker.listIssues();

  assert.equal(issues[0]!.identifier, "ENG-7");
  assert.equal(issues[0]!.title, "Fallback title");
  assert.equal(issues[0]!.description, "HTML description");
  assert.equal(issues[0]!.priority, "medium");
  assert.deepEqual(issues[0]!.labels, ["UI"]);
  assert.equal(issues[0]!.url, "https://api.plane.so/acme/projects/project-1/issues/ENG-7");
});

test("PlaneTracker comments with a PR URL and transitions to Human Review", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new PlaneTrackerAdapter(config, async (request) => {
    calls.push(request);
    if (request.method === "GET") {
      return response(200, [
        { id: "state-review", name: "Human Review" }
      ]);
    }
    return response(200, {});
  }, env);
  const issue = {
    id: "work-item-1",
    identifier: "ENG-42",
    title: "Ship Plane adapter",
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

  await tracker.addPullRequestComment(issue, "https://github.com/example/repo/pull/2");
  await tracker.commentOnIssue(issue.id, "A manual comment");
  await tracker.transitionToHumanReview(issue);

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/work-item-1/comments/");
  assert.match(calls[0]!.body!, /Draft PR created by Symphony/);
  assert.equal(calls[1]!.method, "POST");
  assert.match(calls[1]!.body!, /A manual comment/);
  assert.equal(calls[2]!.method, "GET");
  assert.equal(calls[2]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/states/");
  assert.equal(calls[3]!.method, "PATCH");
  assert.equal(calls[3]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/work-item-1/");
  assert.deepEqual(JSON.parse(calls[3]!.body!), { state: "state-review" });
});

test("PlaneTracker fails safely when Human Review state is unavailable", async () => {
  const tracker = new PlaneTrackerAdapter(config, async () => response(200, []), env);
  const issue = {
    id: "work-item-1",
    identifier: "ENG-42",
    title: "Ship Plane adapter",
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

test("PlaneTracker reports missing environment variables clearly", () => {
  assert.throws(
    () => new PlaneTrackerAdapter(config, async () => response(200, []), {}),
    /Plane API token environment variable PLANE_API_TOKEN is not set/
  );
});

test("PlaneTracker redacts secrets from API errors", async () => {
  const tracker = new PlaneTrackerAdapter(config, async () => response(401, {
    error: "bad token",
    apiToken: "plane-secret",
    token: "plane-secret"
  }), env);

  await assert.rejects(
    () => tracker.listIssues(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /plane-secret/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("PlaneTracker reports transport errors without leaking secrets", async () => {
  const tracker = new PlaneTrackerAdapter(config, async () => {
    throw new Error("network failed with apiToken=plane-secret");
  }, env);

  await assert.rejects(
    () => tracker.listIssues(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /plane-secret/);
      assert.match(error.message, /apiToken=\[REDACTED\]/);
      return true;
    }
  );
});
