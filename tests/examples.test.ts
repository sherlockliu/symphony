import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkflow } from "../src/workflow/load.js";

test("all example WORKFLOW files validate with example credentials", async () => {
  const previous = {
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    PLANE_API_KEY: process.env.PLANE_API_KEY
  };
  process.env.JIRA_EMAIL = "bot@example.com";
  process.env.JIRA_API_TOKEN = "jira-example-token";
  process.env.PLANE_API_KEY = "plane-example-token";

  try {
    const examplesDir = path.resolve("examples");
    const files = (await readdir(examplesDir))
      .filter((file) => /^WORKFLOW\..*\.md$/.test(file))
      .sort();

    assert.ok(files.includes("WORKFLOW.quickstart.mock.md"));
    assert.ok(files.includes("WORKFLOW.jira.example.md"));
    assert.ok(files.includes("WORKFLOW.plane.example.md"));
    assert.ok(files.includes("WORKFLOW.docker.mock.example.md"));

    for (const file of files) {
      const { config } = await loadWorkflow(path.join(examplesDir, file));
      assert.equal(config.version, 1, file);
      assert.equal(config.github.draft, true, file);
      assert.equal(config.limits.maxConcurrency, 1, file);
      assert.ok(config.agent.timeoutSeconds > 0, file);
    }
  } finally {
    restoreEnv("JIRA_EMAIL", previous.JIRA_EMAIL);
    restoreEnv("JIRA_API_TOKEN", previous.JIRA_API_TOKEN);
    restoreEnv("PLANE_API_KEY", previous.PLANE_API_KEY);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
