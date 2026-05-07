import type { AgentRunRequest, AgentRunResult } from "../types.js";

export interface AgentCapabilities {
  canEditFiles: boolean;
  canRunCommands: boolean;
  canCreateCommits: boolean;
  canOpenPullRequests: boolean;
}

/**
 * Runs a coding agent against one prepared issue workspace.
 *
 * AgentRunRequest provides:
 * - issue: normalized tracker issue selected by the orchestrator.
 * - workspace: safe per-issue workspace, including the repo path used as the working directory.
 * - prompt: fully rendered WORKFLOW.md prompt body.
 * - workflowPath: absolute path to the workflow file that produced this run.
 * - timeoutSeconds: configured timeout budget for the runner.
 * - logDir: configured directory for runner logs.
 *
 * AgentRunResult must report success/failure explicitly, preserve stdout/stderr for callers,
 * set timedOut when a timeout kills execution, and return the log file path written by the runner.
 */
export interface AgentRunner {
  readonly kind: string;
  readonly capabilities?: AgentCapabilities;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
