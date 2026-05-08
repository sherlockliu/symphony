import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../types.js";
import { sanitizePathSegment } from "../workspaces/pathSafety.js";
import type { AgentRunner } from "./agentRunner.js";
import { NodeProcessExecutor, type ProcessExecutor } from "./processExecutor.js";
import type { ClaudeCodeAgentConfig } from "./registry.js";

export class ClaudeCodeRunner implements AgentRunner {
  readonly kind = "claude-code";
  readonly capabilities = {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  };

  constructor(
    private readonly config: ClaudeCodeAgentConfig,
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
      logPath,
      env: this.config.env,
      workspaceRoot: request.workspace.path,
      allowedCommands: request.allowedCommands,
      blockedCommands: request.blockedCommands,
      guardCommand: this.config.command
    });

    const success = result.exitCode === 0 && !result.timedOut;
    return {
      success,
      runner: this.kind,
      summary: result.timedOut
        ? "Claude Code runner timed out."
        : success
          ? "Claude Code runner completed successfully."
          : `Claude Code runner exited with ${result.exitCode ?? "unknown"}.`,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      logPath,
      logsPath: logPath,
      stdout: result.stdout,
      stderr: result.stderr,
      error: success
        ? undefined
        : {
            type: result.timedOut ? "agent_timeout" : "agent_failed",
            message: result.timedOut
              ? "Claude Code runner timed out."
              : `Claude Code runner exited with ${result.exitCode ?? "unknown"}.`,
            retryable: result.timedOut
          }
    };
  }

  private logPathFor(request: AgentRunRequest): string {
    return path.join(this.config.logDir, `${sanitizePathSegment(request.issue.identifier)}-claude-code.log`);
  }
}
