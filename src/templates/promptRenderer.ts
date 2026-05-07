import type { Issue, WorkflowConfig } from "../types.js";

interface PromptContext {
  issue: Issue;
  config: WorkflowConfig;
}

export function renderPrompt(template: string, context: PromptContext): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null) {
      return "";
    }
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

function resolvePath(root: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, root);
}
