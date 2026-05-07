import type { AgentConfig } from "./registry.js";
import type { AgentRunner } from "./agentRunner.js";
import type { ProcessExecutor } from "./processExecutor.js";
import { createAgentRunnerFromRegistry } from "./registry.js";

export function createAgentRunner(config: { agent: AgentConfig }, executor?: ProcessExecutor): AgentRunner {
  return createAgentRunnerFromRegistry(config.agent, { executor });
}
