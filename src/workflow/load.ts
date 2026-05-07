import { readFile } from "node:fs/promises";
import { parseWorkflow } from "./frontMatter.js";
import { validateWorkflow } from "./schema.js";

export async function loadWorkflow(workflowPath: string) {
  const source = await readFile(workflowPath, "utf8");
  const definition = parseWorkflow(source);
  const config = validateWorkflow(definition, workflowPath);
  return { definition, config };
}
