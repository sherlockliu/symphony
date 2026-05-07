import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../types.js";
import { redactSecrets } from "../logging/redact.js";
import { safePathJoin, sanitizePathSegment } from "../workspaces/pathSafety.js";
import type { AgentRunner } from "./agentRunner.js";
import { NodeProcessExecutor, type ProcessExecutor } from "./processExecutor.js";
import type { ShellAgentConfig } from "./registry.js";

export class ShellRunner implements AgentRunner {
  readonly kind = "shell";
  readonly capabilities = {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  };

  constructor(
    private readonly config: ShellAgentConfig,
    private readonly executor: ProcessExecutor = new NodeProcessExecutor()
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const logsDir = path.join(this.config.logDir, sanitizePathSegment(request.issue.identifier));
    const primaryLogPath = path.join(logsDir, "shell.log");
    const stdoutLogPath = path.join(logsDir, "stdout.log");
    const stderrLogPath = path.join(logsDir, "stderr.log");
    await mkdir(logsDir, { recursive: true });

    const promptInput = await this.promptInput(request);
    const result = await this.executor.execute({
      command: this.shellCommand(),
      args: this.shellArgs(promptInput),
      cwd: request.workspace.repoPath,
      input: promptInput.stdin,
      timeoutMs: this.config.timeoutSeconds * 1000,
      logPath: primaryLogPath,
      env: this.config.env
    });

    await writeFile(stdoutLogPath, redactSecrets(result.stdout), "utf8");
    await writeFile(stderrLogPath, redactSecrets(result.stderr), "utf8");

    const success = result.exitCode === 0 && !result.timedOut;
    return {
      success,
      runner: this.kind,
      summary: result.timedOut
        ? "Shell runner timed out."
        : success
          ? "Shell runner completed successfully."
          : `Shell runner exited with ${result.exitCode ?? "unknown"}.`,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      logPath: primaryLogPath,
      logsPath: logsDir,
      stdout: result.stdout,
      stderr: result.stderr,
      error: success
        ? undefined
        : {
            type: result.timedOut ? "agent_timeout" : "agent_failed",
            message: result.timedOut ? "Shell runner timed out." : `Shell runner exited with ${result.exitCode ?? "unknown"}.`,
            retryable: result.timedOut
          }
    };
  }

  private async promptInput(request: AgentRunRequest): Promise<{ stdin: string; promptFile: string | null }> {
    if (this.config.promptMode === "stdin") {
      if (this.config.savePrompt) {
        const promptPath = safePathJoin(request.workspace.repoPath, ".orchestrator", "prompt.md");
        await mkdir(path.dirname(promptPath), { recursive: true });
        await writeFile(promptPath, redactSecrets(request.prompt), "utf8");
        return { stdin: request.prompt, promptFile: promptPath };
      }
      return { stdin: request.prompt, promptFile: null };
    }

    const promptPath = safePathJoin(request.workspace.repoPath, ".orchestrator", "prompt.md");
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, redactSecrets(request.prompt), "utf8");
    return { stdin: "", promptFile: promptPath };
  }

  private shellCommand(): string {
    return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  }

  private shellArgs(promptInput: { promptFile: string | null }): string[] {
    const command = promptInput.promptFile === null
      ? this.config.command
      : `${this.config.command} ${shellQuote(promptInput.promptFile)}`;
    return process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  }
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
