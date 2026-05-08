import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { NodeProcessExecutor } from "../src/agents/processExecutor.js";
import { SafeLogger } from "../src/logging/safeLogger.js";
import { assertSafeCommandExecution, CommandSafetyError } from "../src/security/commandGuard.js";
import { collectConfigWarnings } from "../src/security/configWarnings.js";
import { assertSafeWorkspaceRoot, PathSafetyError } from "../src/workspaces/pathSafety.js";

test("SafeLogger redacts messages and structured params", () => {
  const messages: unknown[][] = [];
  const logger = new SafeLogger({
    log: (...args: unknown[]) => messages.push(args),
    warn: (...args: unknown[]) => messages.push(args),
    error: (...args: unknown[]) => messages.push(args)
  });

  logger.info("OPENAI_API_KEY=sk-testsecretvalue", { nested: { GITHUB_TOKEN: "ghp_123456789012345678901234" } });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], [
    "OPENAI_API_KEY=[REDACTED]",
    '{\n  "nested": {\n    "GITHUB_TOKEN": "[REDACTED]"\n  }\n}'
  ]);
});

test("command guard allows execution inside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-guard-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);

  assert.doesNotThrow(() => {
    assertSafeCommandExecution({
      command: "node",
      cwd: repo,
      workspaceRoot: root,
      allowedCommands: ["node"]
    });
  });
});

test("command guard rejects cwd outside the workspace root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-guard-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "symphony-outside-"));

  assert.throws(() => {
    assertSafeCommandExecution({
      command: "node",
      cwd: outside,
      workspaceRoot: root
    });
  }, /outside workspace root/);
});

test("command guard enforces blocked and allowed command lists", () => {
  assert.throws(() => {
    assertSafeCommandExecution({
      command: "rm",
      cwd: "/tmp/workspace",
      workspaceRoot: "/tmp/workspace",
      blockedCommands: ["rm"]
    });
  }, CommandSafetyError);

  assert.throws(() => {
    assertSafeCommandExecution({
      command: "python",
      cwd: "/tmp/workspace",
      workspaceRoot: "/tmp/workspace",
      allowedCommands: ["node"]
    });
  }, /not allowed/);
});

test("NodeProcessExecutor applies command safety before spawning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-executor-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "symphony-executor-outside-"));
  const executor = new NodeProcessExecutor();

  await assert.rejects(
    () => executor.execute({
      command: process.execPath,
      args: ["-e", "console.log('should not run')"],
      cwd: outside,
      input: "",
      timeoutMs: 1000,
      logPath: path.join(root, "agent.log"),
      workspaceRoot: root
    }),
    /outside workspace root/
  );
});

test("workspace root validation rejects filesystem root and null bytes", () => {
  assert.throws(() => assertSafeWorkspaceRoot(path.parse(process.cwd()).root), PathSafetyError);
  assert.throws(() => assertSafeWorkspaceRoot("workspace\0bad"), /null byte/);
});

test("collectConfigWarnings reports risky configuration", () => {
  const warnings = collectConfigWarnings({
    safety: { allowAutoMerge: true },
    agent: { maxConcurrentAgents: 8 },
    workspace: { root: "/" },
    dashboard: { host: "0.0.0.0" }
  });

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "allow_auto_merge_enabled",
    "high_agent_concurrency",
    "workspace_root_is_filesystem_root",
    "dashboard_public_without_auth"
  ]);
});

test("collectConfigWarnings accepts dashboard public host when auth is configured", () => {
  const warnings = collectConfigWarnings({
    dashboard: { host: "0.0.0.0", authRequired: true }
  });

  assert.equal(warnings.some((warning) => warning.code === "dashboard_public_without_auth"), false);
});
