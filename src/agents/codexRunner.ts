import { mkdir, writeFile } from "node:fs/promises";
import type { AgentRunRequest, AgentRunResult } from "../types.js";
import { redactSecrets } from "../logging/redact.js";
import { safePathJoin } from "../workspaces/pathSafety.js";
import type { AgentRunner } from "./agentRunner.js";
import { NodeProcessExecutor, type ProcessExecutor } from "./processExecutor.js";
import type { CodexAgentConfig } from "./registry.js";

export class CodexAgentRunner implements AgentRunner {
  readonly kind = "codex";
  readonly capabilities = {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  };

  constructor(
    private readonly config: CodexAgentConfig,
    private readonly executor: ProcessExecutor = new NodeProcessExecutor()
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.assertSafeCommand();
    const orchestratorDir = safePathJoin(request.workspace.path, ".orchestrator");
    const promptPath = safePathJoin(orchestratorDir, "prompt.md");
    const logPath = safePathJoin(orchestratorDir, "agent.log");
    await mkdir(orchestratorDir, { recursive: true });
    await writeFile(promptPath, redactSecrets(request.prompt), "utf8");

    if (this.config.dryRun === true) {
      const stdout = `Codex dry run for ${request.issue.identifier}.\n`;
      const stderr = "";
      await writeFile(logPath, redactSecrets([
        `$ ${[this.config.command, ...this.config.args].join(" ")}`,
        `cwd: ${request.workspace.repoPath}`,
        `timeout_ms: ${this.config.timeoutSeconds * 1000}`,
        "dry_run: true",
        "exit_code: 0",
        "timed_out: false",
        "",
        "[stdout]",
        stdout,
        "",
        "[stderr]",
        stderr
      ].join("\n")), "utf8");
      return {
        success: true,
        runner: this.kind,
        summary: "Codex dry run completed without executing an external process.",
        exitCode: 0,
        timedOut: false,
        logPath,
        logsPath: orchestratorDir,
        stdout,
        stderr
      };
    }

    const result = await this.executor.execute({
      command: this.config.command,
      args: this.config.args,
      cwd: request.workspace.repoPath,
      input: request.prompt,
      timeoutMs: this.config.timeoutSeconds * 1000,
      logPath,
      workspaceRoot: request.workspace.path,
      allowedCommands: request.allowedCommands,
      blockedCommands: request.blockedCommands,
      guardCommand: this.config.command
    });
    const success = result.exitCode === 0 && !result.timedOut;
    const pullRequestUrl = detectPullRequestUrl(`${result.stdout}\n${result.stderr}`);

    return {
      success,
      runner: this.kind,
      summary: result.timedOut
        ? "Codex runner timed out."
        : success
          ? "Codex runner completed successfully."
          : `Codex runner exited with ${result.exitCode ?? "unknown"}.`,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      logPath,
      logsPath: orchestratorDir,
      stdout: result.stdout,
      stderr: result.stderr,
      pullRequestUrl,
      error: success
        ? undefined
        : {
            type: result.timedOut ? "agent_timeout" : "agent_failed",
            message: result.timedOut ? "Codex runner timed out." : `Codex runner exited with ${result.exitCode ?? "unknown"}.`,
            retryable: result.timedOut
          }
    };
  }

  private assertSafeCommand(): void {
    const commandLine = [this.config.command, ...this.config.args].join(" ").toLowerCase();
    const forbidden = [
      /\bgh\s+pr\s+merge\b/,
      /\bgit\s+merge\b/,
      /\bpr\s+merge\b/
    ];
    if (forbidden.some((pattern) => pattern.test(commandLine))) {
      throw new Error("Codex runner configuration must not include merge commands. Symphony never auto-merges.");
    }
  }
}

export class CodexRunner extends CodexAgentRunner {}

function detectPullRequestUrl(output: string): string | undefined {
  return /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/u.exec(output)?.[0];
}
