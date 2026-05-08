import { mkdir, writeFile } from "node:fs/promises";
import type { AgentRunInput, AgentRunResult, AgentRunner } from "../core/domain.js";
import { safePathJoin } from "../workspaces/pathSafety.js";

export class DryRunAgentRunner implements AgentRunner {
  readonly kind = "dry-run";

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const orchestratorDir = safePathJoin(input.workspacePath, ".orchestrator");
    const promptPath = safePathJoin(orchestratorDir, "prompt.md");
    const resultPath = safePathJoin(orchestratorDir, "result.json");
    const result: AgentRunResult = {
      status: "success",
      summary: "Dry run completed",
      changedFiles: [],
      prUrl: null
    };

    await mkdir(orchestratorDir, { recursive: true });
    await writeFile(promptPath, input.prompt, "utf8");
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

    return result;
  }
}
