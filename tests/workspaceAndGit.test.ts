import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { branchNameForIssue } from "../src/git/branch.js";
import { GitService } from "../src/git/gitService.js";
import type { Issue, WorkflowConfig } from "../src/types.js";
import { assertInsideRoot, sanitizePathSegment } from "../src/workspaces/pathSafety.js";
import { WorkspaceManager } from "../src/workspaces/workspaceManager.js";

const issue: Issue = {
  id: "1",
  identifier: "ABC-123",
  title: "Prepare Worktree Safely",
  description: null,
  priority: 1,
  state: "Ready",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

function config(root: string): WorkflowConfig {
  return {
    version: 1,
    workflowPath: path.join(root, "WORKFLOW.md"),
    tracker: { kind: "mock", issueFile: "/tmp/issues.json" },
    workspace: { root },
    repository: {
      url: "https://github.com/example/project.git",
      baseBranch: "main",
      cloneDir: "repo"
    },
    branch: { prefix: "symphony" },
    github: { kind: "gh", remote: "origin", draft: true, logDir: path.join(root, "logs") },
    agent: { kind: "dry-run", timeoutSeconds: 300, logDir: path.join(root, "logs") },
    states: { active: ["Ready"], terminal: ["Done"] },
    limits: { maxConcurrency: 1 },
    retry: {
      maxAttempts: 2,
      failureCooldownSeconds: 300,
      retryableErrors: ["agent_timeout", "network_error", "transient_tracker_error"],
      retryWithExistingPullRequest: false,
      rerunSucceeded: false
    },
    dashboard: { enabled: false, host: "127.0.0.1", port: 4000 }
  };
}

test("path safety rejects paths outside the workspace root", () => {
  assert.equal(assertInsideRoot("/tmp/root", "/tmp/root/ABC-123"), "/tmp/root/ABC-123");
  assert.throws(() => assertInsideRoot("/tmp/root", "/tmp/root-other/ABC-123"), /outside workspace root/);
  assert.equal(sanitizePathSegment(" ABC/123 "), "ABC-123");
});

test("WorkspaceManager creates issue workspace inside root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-workspaces-"));
  try {
    const manager = new WorkspaceManager(config(root));
    const workspace = await manager.createIssueWorkspace(issue);

    assert.equal(workspace.issueKey, "ABC-123");
    assert.equal(workspace.path, path.join(root, "ABC-123"));
    assert.equal(workspace.repoPath, path.join(root, "ABC-123", "repo"));
    assert.equal(workspace.createdNow, true);
    await stat(workspace.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("branchNameForIssue derives a safe prefixed branch name", () => {
  assert.equal(branchNameForIssue(issue, "symphony"), "symphony/abc-123-prepare-worktree-safely");
  assert.equal(
    branchNameForIssue({ ...issue, branchName: "Feature/ABC-123 Unsafe Name" }, "owned"),
    "owned/feature/abc-123-unsafe-name"
  );
});

test("GitService plans clone and checkout commands for dry-run output", () => {
  const workflowConfig = config("/tmp/workspaces");
  const workspace = new WorkspaceManager(workflowConfig).planIssueWorkspace(issue);
  const plan = new GitService(workflowConfig).planPreparation(issue, workspace);

  assert.equal(plan.branchName, "symphony/abc-123-prepare-worktree-safely");
  assert.deepEqual(plan.commands, [
    "git clone --branch main https://github.com/example/project.git /tmp/workspaces/ABC-123/repo",
    "git -C /tmp/workspaces/ABC-123/repo checkout -B symphony/abc-123-prepare-worktree-safely"
  ]);
});

test("GitService prepares a real local clone and issue branch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-git-"));
  const sourceRepo = path.join(root, "source");
  const workspaceRoot = path.join(root, "workspaces");

  try {
    await run("git", ["init", sourceRepo]);
    await writeFile(path.join(sourceRepo, "README.md"), "hello\n");
    await run("git", ["-C", sourceRepo, "add", "README.md"]);
    await run("git", [
      "-C",
      sourceRepo,
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test User",
      "commit",
      "-m",
      "initial"
    ]);
    await run("git", ["-C", sourceRepo, "branch", "-M", "main"]);

    const workflowConfig = {
      ...config(workspaceRoot),
      repository: {
        ...config(workspaceRoot).repository,
        url: sourceRepo
      }
    };
    const manager = new WorkspaceManager(workflowConfig);
    const workspace = await manager.createIssueWorkspace(issue);
    const plan = await new GitService(workflowConfig).prepareRepository(issue, workspace);
    const branch = await capture("git", ["-C", workspace.repoPath, "branch", "--show-current"]);

    assert.equal(plan.branchName, "symphony/abc-123-prepare-worktree-safely");
    assert.equal(branch.trim(), plan.branchName);
    await stat(path.join(workspace.repoPath, ".git"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
    });
  });
}

async function capture(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}: ${stderr}`));
    });
  });
}
