import test from "node:test";
import assert from "node:assert/strict";
import { PlaneTracker } from "../src/trackers/planeTracker.js";
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
  apiKey: "plane-secret",
  workspaceSlug: "acme",
  projectId: "project-1",
  maxResults: 50,
  reviewState: "Human Review"
};

test("PlaneTracker fetches work items and normalizes fields", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new PlaneTracker(config, async (request) => {
    calls.push(request);
    return response(200, [
      {
        id: "work-item-1",
        name: "Ship Plane adapter",
        description_stripped: "Normalize Plane work items.",
        priority: "high",
        state: { id: "state-ready", name: "Ready for Agent" },
        labels: [{ name: "Backend" }, { name: "Plane" }],
        sequence_id: 42,
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-02T10:00:00Z",
        project: { id: "project-1", identifier: "ENG", name: "Engineering" }
      }
    ]);
  });

  const issues = await tracker.listIssues();

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
      priority: 2,
      state: "Ready for Agent",
      branchName: null,
      url: "https://api.plane.so/acme/projects/project-1/issues/ENG-42",
      labels: ["backend", "plane"],
      blockedBy: [],
      createdAt: "2026-05-01T10:00:00Z",
      updatedAt: "2026-05-02T10:00:00Z"
    }
  ]);
});

test("PlaneTracker comments with a PR URL and transitions to Human Review", async () => {
  const calls: HttpRequest[] = [];
  const tracker = new PlaneTracker(config, async (request) => {
    calls.push(request);
    if (request.method === "GET") {
      return response(200, [
        { id: "state-review", name: "Human Review" }
      ]);
    }
    return response(200, {});
  });
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
  await tracker.transitionToHumanReview(issue);

  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/work-item-1/comments/");
  assert.match(calls[0]!.body!, /Draft PR created by Symphony/);
  assert.equal(calls[1]!.method, "GET");
  assert.equal(calls[1]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/states/");
  assert.equal(calls[2]!.method, "PATCH");
  assert.equal(calls[2]!.url, "https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/work-item-1/");
  assert.deepEqual(JSON.parse(calls[2]!.body!), { state: "state-review" });
});

test("PlaneTracker fails safely when Human Review state is unavailable", async () => {
  const tracker = new PlaneTracker(config, async () => response(200, []));
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
