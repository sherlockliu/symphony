import { readFile } from "node:fs/promises";
import { parseWorkflow } from "./frontMatter.js";
import { validateWorkflow } from "./schema.js";

export async function loadWorkflow(workflowPath: string) {
  let source: string;
  try {
    source = await readFile(workflowPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Workflow file not found: ${workflowPath}. Pass a path to a WORKFLOW.md file, for example examples/WORKFLOW.quickstart.mock.md.`);
    }
    if (isNodeError(error) && error.code === "EACCES") {
      throw new Error(`Workflow file is not readable: ${workflowPath}. Check file permissions and try again.`);
    }
    throw error;
  }
  const definition = parseWorkflow(source);
  const config = validateWorkflow(definition, workflowPath);
  return { definition, config };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
