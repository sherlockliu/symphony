import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MockTracker, MockTrackerAdapter } from "../src/trackers/mockTracker.js";
import { filterActiveIssues } from "../src/trackers/tracker.js";
import { parseWorkflow } from "../src/workflow/frontMatter.js";
import { validateWorkflow } from "../src/workflow/schema.js";

test("MockTracker normalizes issue fields and filters active issues", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issueFile = path.join(dir, "issues.json");
  await writeFile(issueFile, JSON.stringify([
    {
      id: "1",
      identifier: "ABC-1",
      title: "Ready task",
      state: "Ready",
      labels: ["Feature"]
    },
    {
      id: "2",
      identifier: "ABC-2",
      title: "Completed task",
      state: "Done",
      labels: ["Docs"]
    }
  ]));

  try {
    const tracker = new MockTracker(issueFile);
    const issues = await tracker.listIssues();

    assert.equal(issues.length, 2);
    assert.deepEqual(issues[0]!.labels, ["feature"]);
    assert.equal(issues[0]!.description, null);
    assert.deepEqual(filterActiveIssues(issues, ["Ready"]).map((issue) => issue.identifier), ["ABC-1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MockTrackerAdapter loads mock issues", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issuesFile = path.join(dir, "mock-issues.json");
  await writeIssues(issuesFile);

  try {
    const tracker = new MockTrackerAdapter({ issuesFile });
    const issues = await tracker.listIssues();

    assert.equal(issues.length, 2);
    assert.equal(issues[0]!.identifier, "MUL-1");
    assert.equal(issues[0]!.priority, "High");
    assert.equal(issues[0]!.url, "https://example.local/MUL-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MockTrackerAdapter filters candidate issues by configured ready states", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issuesFile = path.join(dir, "mock-issues.json");
  await writeIssues(issuesFile);

  try {
    const tracker = new MockTrackerAdapter({
      issuesFile,
      readyStates: ["Ready for AI"]
    });
    const candidates = await tracker.fetchCandidateIssues();

    assert.deepEqual(candidates.map((issue) => issue.identifier), ["MUL-1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MockTrackerAdapter records comments to the events file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issuesFile = path.join(dir, "mock-issues.json");
  const eventsFile = path.join(dir, ".mock-tracker-events.json");
  await writeIssues(issuesFile);

  try {
    const tracker = new MockTrackerAdapter({ issuesFile, eventsFile });
    await tracker.commentOnIssue("1", "Ready for human review.");

    const events = JSON.parse(await readFile(eventsFile, "utf8")) as Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: "comment",
      issueId: "1",
      body: "Ready for human review.",
      timestamp: events[0]!.timestamp
    });
    assert.equal(typeof events[0]!.timestamp, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MockTrackerAdapter records transitions to the events file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issuesFile = path.join(dir, "mock-issues.json");
  const eventsFile = path.join(dir, ".mock-tracker-events.json");
  await writeIssues(issuesFile);

  try {
    const tracker = new MockTrackerAdapter({ issuesFile, eventsFile });
    await tracker.transitionIssue("1", "Human Review");

    const events = JSON.parse(await readFile(eventsFile, "utf8")) as Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: "transition",
      issueId: "1",
      state: "Human Review",
      timestamp: events[0]!.timestamp
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MockTrackerAdapter reports invalid issue files clearly", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-mock-"));
  const issuesFile = path.join(dir, "mock-issues.json");
  await writeFile(issuesFile, "{not-json");

  try {
    const tracker = new MockTrackerAdapter({ issuesFile });

    await assert.rejects(
      () => tracker.listIssues(),
      /Mock issues file must contain valid JSON/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateWorkflow accepts mock issues_file and events_file config", () => {
  const definition = parseWorkflow(`---
version: 1
tracker:
  kind: mock
  issues_file: ./mock-issues.json
  events_file: ./.mock-tracker-events.json
workspace:
  root: ./workspaces
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
  active: ["Ready for AI"]
  terminal: ["Done"]
limits:
  max_concurrency: 1
---
Prompt for {{issue.identifier}}.
`);

  const config = validateWorkflow(definition, "/repo/examples/WORKFLOW.md");

  assert.equal(config.tracker.kind, "mock");
  assert.equal(config.tracker.issueFile, "/repo/examples/mock-issues.json");
  assert.equal(config.tracker.eventsFile, "/repo/examples/.mock-tracker-events.json");
});

async function writeIssues(issuesFile: string): Promise<void> {
  await writeFile(issuesFile, JSON.stringify([
    {
      id: "1",
      identifier: "MUL-1",
      title: "Set up CI/CD pipeline with GitHub Actions",
      description: "Configure automated build, test, and lint checks.",
      state: "Ready for AI",
      priority: "High",
      labels: ["devops"],
      url: "https://example.local/MUL-1"
    },
    {
      id: "2",
      identifier: "MUL-2",
      title: "Document release process",
      description: "Write the deployment notes.",
      state: "Done",
      priority: "Low",
      labels: ["docs"],
      url: "https://example.local/MUL-2"
    }
  ]));
}
