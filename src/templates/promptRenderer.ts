import type {
  AgentRun,
  TrackedIssue,
  WorkflowConfig as DomainWorkflowConfig
} from "../core/domain.js";
import type { Issue, WorkflowConfig as RuntimeWorkflowConfig } from "../types.js";

interface PromptContext {
  issue: Issue | TrackedIssue;
  config: RuntimeWorkflowConfig | DomainWorkflowConfig;
  run?: AgentRun;
}

/**
 * Renders a small Mustache-style prompt template.
 *
 * Supported expressions are dotted property lookups such as
 * {{ issue.identifier }}, {{ run.workspacePath }}, and
 * {{ config.repository.url }}. Missing variables render as an empty string.
 * The renderer never evaluates JavaScript or calls functions from templates.
 */
export function renderPrompt(template: string, context: PromptContext): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = resolvePath(context, path) ?? resolveCompatibilityAlias(context, path);
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
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      return undefined;
    }
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, root);
}

function resolveCompatibilityAlias(context: PromptContext, dottedPath: string): unknown {
  if (dottedPath === "config.repository.defaultBranch") {
    return resolvePath(context, "config.repository.baseBranch");
  }
  return undefined;
}
