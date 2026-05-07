import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CodexRunner } from "../src/agents/codexRunner.js";
import { createAgentRunner } from "../src/agents/createAgentRunner.js";
import { DryRunRunner } from "../src/agents/dryRunRunner.js";
import type { ProcessExecutor, ProcessRequest, ProcessResult } from "../src/agents/processExecutor.js";
import type { CodexAgentConfig, DryRunAgentConfig } from "../src/agents/registry.js";
import { ShellRunner } from "../src/agents/shellRunner.js";
import type { AgentRunRequest, Issue, IssueWorkspace, WorkflowConfig } from "../src/types.js";

const issue: Issue = {
  id: "1",
  identifier: "ABC-7",
  title: "Run agent",
  description: "Exercise process runner.",
  priority: 1,
  state: "Ready",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null
};

function workflowConfig(root: string): WorkflowConfig {
  return {
    version: 1,
    workflowPath: path.join(root, "WORKFLOW.md"),
    tracker: { kind: "mock", issueFile: path.join(root, "issues.json") },
    state: { kind: "memory" },
    workspace: { root: path.join(root, "workspaces") },
    repository: {
      url: root,
      baseBranch: "main",
      cloneDir: "repo"
    },
    branch: { prefix: "symphony" },
    github: { kind: "gh", remote: "origin", draft: true, logDir: path.join(root, "logs") },
    agent: {
      kind: "dry-run",
      timeoutSeconds: 300,
      logDir: path.join(root, "logs")
    },
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

function request(root: string): AgentRunRequest {
  const workspace: IssueWorkspace = {
    issueKey: "ABC-7",
    path: path.join(root, "workspaces", "ABC-7"),
    repoPath: path.join(root, "workspaces", "ABC-7", "repo"),
    createdNow: true
  };

  return {
    issue,
    workspace,
    prompt: "Implement ABC-7 with OPENAI_API_KEY=sk-testsecretvalue",
    workflowPath: path.join(root, "WORKFLOW.md"),
    timeoutSeconds: 300,
    logDir: path.join(root, "logs")
  };
}

test("DryRunRunner captures a redacted prompt log without executing a process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-"));
  try {
    const runner = new DryRunRunner(workflowConfig(root).agent as DryRunAgentConfig);
    const result = await runner.run(request(root));
    const log = await readFile(result.logPath, "utf8");

    assert.equal(result.success, true);
    assert.equal(result.runner, "dry-run");
    assert.match(log, /runner: dry-run/);
    assert.match(log, /OPENAI_API_KEY=\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexRunner passes prompt, cwd, timeout, and log path to process executor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-"));
  const calls: ProcessRequest[] = [];
  const executor: ProcessExecutor = {
    async execute(processRequest: ProcessRequest): Promise<ProcessResult> {
      calls.push(processRequest);
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "ok",
        stderr: ""
      };
    }
  };

  try {
    const config: CodexAgentConfig = {
      kind: "codex",
      command: "codex",
      args: ["exec", "-"],
      timeoutSeconds: 42,
      logDir: path.join(root, "logs")
    };
    const result = await new CodexRunner(config, executor).run(request(root));

    assert.equal(result.success, true);
    assert.equal(result.runner, "codex");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, "codex");
    assert.deepEqual(calls[0]!.args, ["exec", "-"]);
    assert.equal(calls[0]!.cwd, path.join(root, "workspaces", "ABC-7", "repo"));
    assert.equal(calls[0]!.input, request(root).prompt);
    assert.equal(calls[0]!.timeoutMs, 42000);
    assert.equal(calls[0]!.logPath, path.join(root, "logs", "ABC-7-codex.log"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexRunner reports timeout failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-timeout-"));
  const executor: ProcessExecutor = {
    async execute(): Promise<ProcessResult> {
      return {
        exitCode: null,
        timedOut: true,
        stdout: "",
        stderr: "timed out"
      };
    }
  };

  try {
    const config: CodexAgentConfig = {
      kind: "codex",
      command: "codex",
      args: ["exec", "-"],
      timeoutSeconds: 1,
      logDir: path.join(root, "logs")
    };
    const result = await new CodexRunner(config, executor).run(request(root));

    assert.equal(result.success, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.timedOut, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexRunner captures stdout and stderr while process logs redact secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-redact-"));
  try {
    await mkdir(path.join(root, "workspaces", "ABC-7", "repo"), { recursive: true });
    const config: CodexAgentConfig = {
      kind: "codex",
      command: "node",
      args: [
        "-e",
        [
          "console.log('OPENAI_API_KEY=sk-testsecretvalue');",
          "console.error('Bearer abcdefghijklmnop');"
        ].join("")
      ],
      timeoutSeconds: 10,
      logDir: path.join(root, "logs")
    };
    const result = await new CodexRunner(config).run(request(root));
    const log = await readFile(result.logPath, "utf8");

    assert.equal(result.success, true);
    assert.match(result.stdout, /OPENAI_API_KEY=sk-testsecretvalue/);
    assert.match(result.stderr, /Bearer abcdefghijklmnop/);
    assert.match(log, /OPENAI_API_KEY=\[REDACTED\]/);
    assert.match(log, /Bearer \[REDACTED\]/);
    assert.equal(log.includes("sk-testsecretvalue"), false);
    assert.equal(log.includes("abcdefghijklmnop"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ShellRunner passes prompt through stdin and captures redacted logs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-shell-stdin-"));
  const calls: ProcessRequest[] = [];
  const executor: ProcessExecutor = {
    async execute(processRequest: ProcessRequest): Promise<ProcessResult> {
      calls.push(processRequest);
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "OPENAI_API_KEY=sk-testsecretvalue\nok",
        stderr: ""
      };
    }
  };

  try {
    await mkdir(path.join(root, "workspaces", "ABC-7", "repo"), { recursive: true });
    const result = await new ShellRunner({
      kind: "shell",
      command: "my-agent --non-interactive",
      timeoutSeconds: 60,
      logDir: path.join(root, "logs"),
      promptMode: "stdin",
      env: { AGENT_MODE: "coding" },
      savePrompt: false
    }, executor).run(request(root));
    const stdoutLog = await readFile(path.join(result.logsPath!, "stdout.log"), "utf8");

    assert.equal(result.success, true);
    assert.equal(calls[0]!.cwd, path.join(root, "workspaces", "ABC-7", "repo"));
    assert.equal(calls[0]!.input, request(root).prompt);
    assert.deepEqual(calls[0]!.env, { AGENT_MODE: "coding" });
    assert.equal(stdoutLog.includes("sk-testsecretvalue"), false);
    assert.match(stdoutLog, /OPENAI_API_KEY=\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ShellRunner writes a safe prompt file for file prompt mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-shell-file-"));
  const calls: ProcessRequest[] = [];
  const executor: ProcessExecutor = {
    async execute(processRequest: ProcessRequest): Promise<ProcessResult> {
      calls.push(processRequest);
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "ok",
        stderr: ""
      };
    }
  };

  try {
    await mkdir(path.join(root, "workspaces", "ABC-7", "repo"), { recursive: true });
    const result = await new ShellRunner({
      kind: "shell",
      command: "my-agent --prompt-file",
      timeoutSeconds: 60,
      logDir: path.join(root, "logs"),
      promptMode: "file",
      env: {},
      savePrompt: false
    }, executor).run(request(root));
    const promptPath = path.join(root, "workspaces", "ABC-7", "repo", ".orchestrator", "prompt.md");
    const prompt = await readFile(promptPath, "utf8");

    assert.equal(result.success, true);
    assert.equal(calls[0]!.input, "");
    assert.match(calls[0]!.args.join(" "), /\.orchestrator\/prompt\.md/);
    assert.match(prompt, /OPENAI_API_KEY=\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ShellRunner reports timeout failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-shell-timeout-"));
  const executor: ProcessExecutor = {
    async execute(): Promise<ProcessResult> {
      return {
        exitCode: null,
        timedOut: true,
        stdout: "",
        stderr: "timeout"
      };
    }
  };

  try {
    await mkdir(path.join(root, "workspaces", "ABC-7", "repo"), { recursive: true });
    const result = await new ShellRunner({
      kind: "shell",
      command: "slow-agent",
      timeoutSeconds: 1,
      logDir: path.join(root, "logs"),
      promptMode: "stdin",
      env: {},
      savePrompt: false
    }, executor).run(request(root));

    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.error?.type, "agent_timeout");
    assert.equal(result.error?.retryable, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createAgentRunner keeps runner construction behind the generic interface", () => {
  const root = "/tmp/symphony";
  assert.equal(createAgentRunner(workflowConfig(root)).kind, "dry-run");
  assert.equal(createAgentRunner({
    ...workflowConfig(root),
    agent: {
      kind: "codex",
      command: "codex",
      args: ["exec", "-"],
      timeoutSeconds: 60,
      logDir: path.join(root, "logs")
    }
  }).kind, "codex");
  assert.equal(createAgentRunner({
    ...workflowConfig(root),
    agent: {
      kind: "shell",
      command: "my-agent",
      timeoutSeconds: 60,
      logDir: path.join(root, "logs"),
      promptMode: "stdin",
      env: {},
      savePrompt: false
    }
  }).kind, "shell");
});
