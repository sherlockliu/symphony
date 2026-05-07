import path from "node:path";
import type { JsonValue } from "../types.js";
import type { TrackerAdapter } from "./tracker.js";
import { JiraTracker } from "./jiraTracker.js";
import { MockTracker } from "./mockTracker.js";
import { PlaneTracker } from "./planeTracker.js";

export interface MockTrackerConfig {
  kind: "mock";
  issueFile: string;
}

export interface JiraTrackerConfig {
  kind: "jira";
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxResults: number;
  reviewTransition: string;
}

export interface PlaneTrackerConfig {
  kind: "plane";
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  projectId: string;
  maxResults: number;
  reviewState: string;
}

export interface CustomTrackerConfig {
  kind: string;
  [key: string]: unknown;
}

export type BuiltInTrackerConfig = MockTrackerConfig | JiraTrackerConfig | PlaneTrackerConfig;
export type TrackerConfig = BuiltInTrackerConfig | CustomTrackerConfig;

export interface TrackerValidationContext {
  baseDir: string;
  issues: string[];
}

export interface TrackerRegistration<TConfig extends TrackerConfig = TrackerConfig> {
  kind: string;
  validate(raw: Record<string, JsonValue>, context: TrackerValidationContext): TConfig | undefined;
  create(config: TConfig): TrackerAdapter;
}

const registry = new Map<string, TrackerRegistration>();

export function registerTracker<TConfig extends TrackerConfig>(
  registration: TrackerRegistration<TConfig>,
  options: { replace?: boolean } = {}
): void {
  if (registry.has(registration.kind) && options.replace !== true) {
    throw new Error(`Tracker kind ${registration.kind} is already registered.`);
  }
  registry.set(registration.kind, registration as TrackerRegistration);
}

export function createTrackerFromRegistry(config: TrackerConfig): TrackerAdapter {
  const registration = registry.get(config.kind);
  if (registration === undefined) {
    throw new Error(`Tracker kind ${config.kind} is not registered.`);
  }
  return registration.create(config);
}

export function validateTrackerConfig(
  raw: Record<string, JsonValue>,
  context: TrackerValidationContext
): TrackerConfig | undefined {
  const kind = stringAt(raw, "kind", context.issues, "tracker.kind");
  if (kind === undefined) {
    return undefined;
  }
  const registration = registry.get(kind);
  if (registration === undefined) {
    context.issues.push(`tracker.kind must be one of: ${registeredTrackerKinds().join(", ")}.`);
    return undefined;
  }
  return registration.validate(raw, context);
}

export function registeredTrackerKinds(): string[] {
  return [...registry.keys()].sort();
}

registerTracker<MockTrackerConfig>({
  kind: "mock",
  validate(raw, context) {
    const issueFile = stringAt(raw, "issueFile", context.issues, "tracker.issue_file");
    if (issueFile === undefined) {
      return undefined;
    }
    return {
      kind: "mock",
      issueFile: path.resolve(context.baseDir, issueFile)
    };
  },
  create(config) {
    return new MockTracker(config.issueFile);
  }
});

registerTracker<JiraTrackerConfig>({
  kind: "jira",
  validate(raw, context) {
    const baseUrl = stringAt(raw, "baseUrl", context.issues, "tracker.base_url");
    const email = stringAt(raw, "email", context.issues, "tracker.email");
    const apiToken = stringAt(raw, "apiToken", context.issues, "tracker.api_token");
    const jql = stringAt(raw, "jql", context.issues, "tracker.jql");
    const maxResults = optionalNumberAt(raw, "maxResults", context.issues, "tracker.max_results") ?? 50;
    const reviewTransition =
      optionalStringAt(raw, "reviewTransition", context.issues, "tracker.review_transition") ?? "Human Review";

    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      context.issues.push("tracker.max_results must be an integer between 1 and 100.");
    }
    if (baseUrl === undefined || email === undefined || apiToken === undefined || jql === undefined) {
      return undefined;
    }
    return {
      kind: "jira",
      baseUrl,
      email,
      apiToken,
      jql,
      maxResults,
      reviewTransition
    };
  },
  create(config) {
    return new JiraTracker(config);
  }
});

registerTracker<PlaneTrackerConfig>({
  kind: "plane",
  validate(raw, context) {
    const baseUrl = stringAt(raw, "baseUrl", context.issues, "tracker.base_url");
    const apiKey = stringAt(raw, "apiKey", context.issues, "tracker.api_key");
    const workspaceSlug = stringAt(raw, "workspaceSlug", context.issues, "tracker.workspace_slug");
    const projectId = stringAt(raw, "projectId", context.issues, "tracker.project_id");
    const maxResults = optionalNumberAt(raw, "maxResults", context.issues, "tracker.max_results") ?? 50;
    const reviewState = optionalStringAt(raw, "reviewState", context.issues, "tracker.review_state") ?? "Human Review";

    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      context.issues.push("tracker.max_results must be an integer between 1 and 100.");
    }
    if (baseUrl === undefined || apiKey === undefined || workspaceSlug === undefined || projectId === undefined) {
      return undefined;
    }
    return {
      kind: "plane",
      baseUrl,
      apiKey,
      workspaceSlug,
      projectId,
      maxResults,
      reviewState
    };
  },
  create(config) {
    return new PlaneTracker(config);
  }
});

function stringAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string | undefined {
  const value = parent[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function optionalStringAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${display} must be a non-empty string when provided.`);
    return undefined;
  }
  return value;
}

function optionalNumberAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): number | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${display} must be a number when provided.`);
    return undefined;
  }
  return value;
}
