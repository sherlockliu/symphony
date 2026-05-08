import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkflow } from "../src/workflow/load.js";

test("all example WORKFLOW files validate with example credentials", async () => {
  const previous = {
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    PLANE_API_TOKEN: process.env.PLANE_API_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL
  };
  process.env.JIRA_EMAIL = "bot@example.com";
  process.env.JIRA_API_TOKEN = "jira-example-token";
  process.env.PLANE_API_TOKEN = "plane-example-token";
  process.env.GITHUB_TOKEN = "github-example-token";
  process.env.ANTHROPIC_API_KEY = "anthropic-example-token";
  process.env.DATABASE_URL = "postgres://orchestrator:orchestrator@localhost:5432/orchestrator";

  try {
    const examplesDir = path.resolve("examples");
    const files = (await readdir(examplesDir))
      .filter((file) => /^WORKFLOW\..*\.md$/.test(file))
      .sort();

    assert.ok(files.includes("WORKFLOW.quickstart.mock.md"));
    assert.ok(files.includes("WORKFLOW.jira.example.md"));
    assert.ok(files.includes("WORKFLOW.plane.example.md"));
    assert.ok(files.includes("WORKFLOW.docker.mock.example.md"));
    assert.ok(files.includes("WORKFLOW.claude-code.example.md"));
    assert.ok(files.includes("WORKFLOW.github-issues.example.md"));
    assert.ok(files.includes("WORKFLOW.postgres.mock.example.md"));
    assert.ok(files.includes("WORKFLOW.shell-agent.example.md"));
    assert.equal(files.includes("WORKFLOW.sqlite.example.md"), false);

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
    restoreEnv("PLANE_API_TOKEN", previous.PLANE_API_TOKEN);
    restoreEnv("GITHUB_TOKEN", previous.GITHUB_TOKEN);
    restoreEnv("ANTHROPIC_API_KEY", previous.ANTHROPIC_API_KEY);
    restoreEnv("DATABASE_URL", previous.DATABASE_URL);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
