import type { AgentRunRequest, AgentRunResult } from "../types.js";

export interface AgentRunner {
  readonly kind: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
