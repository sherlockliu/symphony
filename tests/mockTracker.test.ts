import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MockTracker } from "../src/trackers/mockTracker.js";
import { filterActiveIssues } from "../src/trackers/tracker.js";

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
