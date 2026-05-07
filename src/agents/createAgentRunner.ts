import type { WorkflowConfig } from "../types.js";
import type { AgentRunner } from "./agentRunner.js";
import { CodexRunner } from "./codexRunner.js";
import { DryRunRunner } from "./dryRunRunner.js";
import type { ProcessExecutor } from "./processExecutor.js";

export function createAgentRunner(config: WorkflowConfig, executor?: ProcessExecutor): AgentRunner {
  if (config.agent.kind === "codex") {
    return new CodexRunner(config.agent, executor);
  }
  return new DryRunRunner(config);
}
