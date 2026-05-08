import path from "node:path";

export interface ConfigWarning {
  code: string;
  message: string;
}

export function collectConfigWarnings(config: unknown): ConfigWarning[] {
  const record = asRecord(config);
  const warnings: ConfigWarning[] = [];
  const safety = asRecord(record.safety);
  const agent = asRecord(record.agent);
  const limits = asRecord(record.limits);
  const workspace = asRecord(record.workspace);
  const dashboard = asRecord(record.dashboard);

  if (safety.allowAutoMerge === true) {
    warnings.push({
      code: "allow_auto_merge_enabled",
      message: "safety.allowAutoMerge is true. Symphony should require human review and must not auto-merge."
    });
  }

  const maxConcurrentAgents = numberValue(agent.maxConcurrentAgents) ?? numberValue(limits.maxConcurrency);
  if (maxConcurrentAgents !== undefined && maxConcurrentAgents > 5) {
    warnings.push({
      code: "high_agent_concurrency",
      message: `Agent concurrency is ${maxConcurrentAgents}. Values above 5 can amplify cost and operational risk.`
    });
  }

  if (typeof workspace.root === "string" && path.resolve(workspace.root) === path.parse(path.resolve(workspace.root)).root) {
    warnings.push({
      code: "workspace_root_is_filesystem_root",
      message: "workspace.root resolves to the filesystem root. Use a dedicated workspace directory."
    });
  }

  if (dashboard.host === "0.0.0.0" && !hasAuthConfig(dashboard)) {
    warnings.push({
      code: "dashboard_public_without_auth",
      message: "dashboard.host is 0.0.0.0 and no dashboard auth config is present. Bind to localhost or add authentication."
    });
  }

  return warnings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasAuthConfig(dashboard: Record<string, unknown>): boolean {
  return dashboard.auth !== undefined || dashboard.authRequired === true;
}
