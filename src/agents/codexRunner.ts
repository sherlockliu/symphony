import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../types.js";
import { sanitizePathSegment } from "../workspaces/pathSafety.js";
import type { AgentRunner } from "./agentRunner.js";
import { NodeProcessExecutor, type ProcessExecutor } from "./processExecutor.js";
import type { CodexAgentConfig } from "./registry.js";

export class CodexRunner implements AgentRunner {
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
    const logPath = this.logPathFor(request);
    const result = await this.executor.execute({
      command: this.config.command,
      args: this.config.args,
      cwd: request.workspace.repoPath,
      input: request.prompt,
      timeoutMs: this.config.timeoutSeconds * 1000,
      logPath
    });

    return {
      success: result.exitCode === 0 && !result.timedOut,
      runner: this.kind,
      summary: result.timedOut
        ? "Codex runner timed out."
        : result.exitCode === 0
          ? "Codex runner completed successfully."
          : `Codex runner exited with ${result.exitCode ?? "unknown"}.`,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      logPath,
      logsPath: logPath,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.exitCode === 0 && !result.timedOut
        ? undefined
        : {
            type: result.timedOut ? "agent_timeout" : "agent_failed",
            message: result.timedOut ? "Codex runner timed out." : `Codex runner exited with ${result.exitCode ?? "unknown"}.`,
            retryable: result.timedOut
          }
    };
  }

  private logPathFor(request: AgentRunRequest): string {
    return path.join(this.config.logDir, `${sanitizePathSegment(request.issue.identifier)}-codex.log`);
  }
}
