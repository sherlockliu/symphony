import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../types.js";
import { redactSecrets } from "../logging/redact.js";
import { sanitizePathSegment } from "../workspaces/pathSafety.js";
import type { AgentRunner } from "./agentRunner.js";
import type { DryRunAgentConfig } from "./registry.js";

export class DryRunRunner implements AgentRunner {
  readonly kind = "dry-run";

  constructor(private readonly config: DryRunAgentConfig) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const logPath = this.logPathFor(request);
    const stdout = `Dry-run runner captured prompt for ${request.issue.identifier}.\n`;
    const stderr = "";

    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, redactSecrets([
      `runner: ${this.kind}`,
      `issue: ${request.issue.identifier}`,
      `workspace: ${request.workspace.path}`,
      `repo: ${request.workspace.repoPath}`,
      "",
      "[prompt]",
      request.prompt
    ].join("\n")), "utf8");

    return {
      success: true,
      runner: this.kind,
      exitCode: 0,
      timedOut: false,
      logPath,
      stdout,
      stderr
    };
  }

  private logPathFor(request: AgentRunRequest): string {
    return path.join(this.config.logDir, `${sanitizePathSegment(request.issue.identifier)}-dry-run.log`);
  }
}
