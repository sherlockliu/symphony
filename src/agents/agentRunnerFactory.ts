import type { AgentRunner, WorkflowConfig } from "../core/domain.js";
import { DryRunAgentRunner } from "./dryRunAgentRunner.js";

export class AgentRunnerFactory {
  create(config: WorkflowConfig): AgentRunner {
    if (config.agent.kind === "dry-run") {
      return new DryRunAgentRunner();
    }

    throw new Error(`Unknown agent runner kind: ${config.agent.kind}. Supported kinds: dry-run.`);
  }
}
