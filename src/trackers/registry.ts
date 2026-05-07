import path from "node:path";
import type { JsonValue } from "../types.js";
import {
  validateTrackedIssues,
  type TrackerAdapter,
  type TrackerCapabilities,
  type TrackerCapabilityRequirements
} from "./tracker.js";
import { GitHubIssuesTracker } from "./githubIssuesTracker.js";
import { JiraTracker } from "./jiraTracker.js";
import { MockTracker } from "./mockTracker.js";
import { PlaneTracker } from "./planeTracker.js";

export interface MockTrackerConfig {
  kind: "mock";
  issueFile: string;
  requiredCapabilities?: TrackerCapabilityRequirements;
}

export interface JiraTrackerConfig {
  kind: "jira";
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxResults: number;
  reviewTransition: string;
  requiredCapabilities?: TrackerCapabilityRequirements;
}

export interface PlaneTrackerConfig {
  kind: "plane";
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  projectId: string;
  maxResults: number;
  reviewState: string;
  requiredCapabilities?: TrackerCapabilityRequirements;
}

export interface GitHubIssuesTrackerConfig {
  kind: "github-issues";
  owner: string;
  repo: string;
  token: string;
  labels: string[];
  humanReviewLabel: string;
  closedStates: string[];
  removeCandidateLabelsOnReview: boolean;
  maxResults: number;
  requiredCapabilities?: TrackerCapabilityRequirements;
}

export interface CustomTrackerConfig {
  kind: string;
  requiredCapabilities?: TrackerCapabilityRequirements;
  [key: string]: unknown;
}

export type BuiltInTrackerConfig = MockTrackerConfig | JiraTrackerConfig | PlaneTrackerConfig | GitHubIssuesTrackerConfig;
export type TrackerConfig = BuiltInTrackerConfig | CustomTrackerConfig;

export interface TrackerValidationContext {
  baseDir: string;
  issues: string[];
}

export interface TrackerDependencies {}

export interface TrackerAdapterFactory<TConfig extends TrackerConfig = TrackerConfig> {
  kind: string;
  capabilities: TrackerCapabilities;
  validateConfig(raw: Record<string, JsonValue>, context: TrackerValidationContext): TConfig | undefined;
  create(config: TConfig, dependencies: TrackerDependencies): TrackerAdapter;
}

export type TrackerRegistration<TConfig extends TrackerConfig = TrackerConfig> = TrackerAdapterFactory<TConfig>;

export class TrackerRegistry {
  private readonly factories = new Map<string, TrackerAdapterFactory>();

  register<TConfig extends TrackerConfig>(
    factory: TrackerAdapterFactory<TConfig>,
    options: { replace?: boolean } = {}
  ): void {
    if (this.factories.has(factory.kind) && options.replace !== true) {
      throw new Error(`Tracker kind ${factory.kind} is already registered.`);
    }
    this.factories.set(factory.kind, factory as TrackerAdapterFactory);
  }

  create(config: TrackerConfig, dependencies: TrackerDependencies = {}): TrackerAdapter {
    const factory = this.factories.get(config.kind);
    if (factory === undefined) {
      throw new Error(`Tracker kind ${config.kind} is not registered.`);
    }
    const adapter = factory.create(config, dependencies);
    return withTrackedIssueValidation(adapter, config.kind, factory.capabilities);
  }

  validateConfig(raw: Record<string, JsonValue>, context: TrackerValidationContext): TrackerConfig | undefined {
    const kind = stringAt(raw, "kind", context.issues, "tracker.kind");
    if (kind === undefined) {
      return undefined;
    }
    const factory = this.factories.get(kind);
    if (factory === undefined) {
      context.issues.push(`tracker.kind must be one of: ${this.listKinds().join(", ")}.`);
      return undefined;
    }
    const config = factory.validateConfig(raw, context);
    if (config === undefined) {
      return undefined;
    }
    return {
      ...config,
      requiredCapabilities: requiredCapabilitiesAt(raw, context.issues)
    };
  }

  listKinds(): string[] {
    return [...this.factories.keys()].sort();
  }

  capabilities(kind: string): TrackerCapabilities | undefined {
    return this.factories.get(kind)?.capabilities;
  }
}

export const defaultTrackerRegistry = new TrackerRegistry();

export function registerTracker<TConfig extends TrackerConfig>(
  registration: TrackerRegistration<TConfig>,
  options: { replace?: boolean } = {}
): void {
  defaultTrackerRegistry.register(registration, options);
}

export function createTrackerFromRegistry(config: TrackerConfig): TrackerAdapter {
  return defaultTrackerRegistry.create(config);
}

export function validateTrackerConfig(
  raw: Record<string, JsonValue>,
  context: TrackerValidationContext
): TrackerConfig | undefined {
  return defaultTrackerRegistry.validateConfig(raw, context);
}

export function registeredTrackerKinds(): string[] {
  return defaultTrackerRegistry.listKinds();
}

registerTracker<MockTrackerConfig>({
  kind: "mock",
  capabilities: {
    canComment: false,
    canTransition: false,
    canFetchByQuery: false,
    canFetchByLabel: false
  },
  validateConfig(raw, context) {
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
  capabilities: {
    canComment: true,
    canTransition: true,
    canFetchByQuery: true,
    canFetchByLabel: false
  },
  validateConfig(raw, context) {
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
  capabilities: {
    canComment: true,
    canTransition: true,
    canFetchByQuery: false,
    canFetchByLabel: false
  },
  validateConfig(raw, context) {
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

registerTracker<GitHubIssuesTrackerConfig>({
  kind: "github-issues",
  capabilities: {
    canComment: true,
    canTransition: true,
    canFetchByQuery: false,
    canFetchByLabel: true
  },
  validateConfig(raw, context) {
    const owner = stringAt(raw, "owner", context.issues, "tracker.owner");
    const repo = stringAt(raw, "repo", context.issues, "tracker.repo");
    const token = stringAt(raw, "token", context.issues, "tracker.token");
    const labels = stringArrayAt(raw, "labels", context.issues, "tracker.labels");
    const humanReviewLabel =
      optionalStringAt(raw, "humanReviewLabel", context.issues, "tracker.human_review_label") ?? "human-review";
    const closedStates =
      optionalStringArrayAt(raw, "closedStates", context.issues, "tracker.closed_states") ?? ["closed"];
    const removeCandidateLabelsOnReview =
      optionalBooleanAt(raw, "removeCandidateLabelsOnReview", context.issues, "tracker.remove_candidate_labels_on_review") ?? false;
    const maxResults = optionalNumberAt(raw, "maxResults", context.issues, "tracker.max_results") ?? 50;

    if (labels !== undefined && labels.length === 0) {
      context.issues.push("tracker.labels must contain at least one label.");
    }
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      context.issues.push("tracker.max_results must be an integer between 1 and 100.");
    }
    if (owner === undefined || repo === undefined || token === undefined || labels === undefined) {
      return undefined;
    }
    return {
      kind: "github-issues",
      owner,
      repo,
      token,
      labels,
      humanReviewLabel,
      closedStates,
      removeCandidateLabelsOnReview,
      maxResults
    };
  },
  create(config) {
    return new GitHubIssuesTracker(config);
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

function optionalBooleanAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): boolean | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push(`${display} must be a boolean when provided.`);
    return undefined;
  }
  return value;
}

function stringArrayAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string[] | undefined {
  const value = parent[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push(`${display} must be a non-empty string array.`);
    return undefined;
  }
  return value as string[];
}

function optionalStringArrayAt(
  parent: Record<string, JsonValue>,
  key: string,
  issues: string[],
  display = key
): string[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push(`${display} must be a string array when provided.`);
    return undefined;
  }
  return value as string[];
}

function requiredCapabilitiesAt(
  raw: Record<string, JsonValue>,
  issues: string[]
): TrackerCapabilityRequirements | undefined {
  const requirements: TrackerCapabilityRequirements = {};
  const comment = optionalBooleanAt(raw, "requireComment", issues, "tracker.require_comment");
  const transition = optionalBooleanAt(raw, "requireTransition", issues, "tracker.require_transition");
  const fetchByQuery = optionalBooleanAt(raw, "requireFetchByQuery", issues, "tracker.require_fetch_by_query");
  const fetchByLabel = optionalBooleanAt(raw, "requireFetchByLabel", issues, "tracker.require_fetch_by_label");
  if (comment !== undefined) {
    requirements.comment = comment;
  }
  if (transition !== undefined) {
    requirements.transition = transition;
  }
  if (fetchByQuery !== undefined) {
    requirements.fetchByQuery = fetchByQuery;
  }
  if (fetchByLabel !== undefined) {
    requirements.fetchByLabel = fetchByLabel;
  }
  return Object.keys(requirements).length === 0 ? undefined : requirements;
}

function withTrackedIssueValidation(
  adapter: TrackerAdapter,
  kind: string,
  registeredCapabilities: TrackerCapabilities
): TrackerAdapter {
  return {
    capabilities: adapter.capabilities ?? registeredCapabilities,
    async listIssues() {
      return validateTrackedIssues(await adapter.listIssues(), kind);
    },
    fetchIssue: adapter.fetchIssue === undefined
      ? undefined
      : async (id: string) => validateTrackedIssues([await adapter.fetchIssue!(id)], kind)[0]!,
    addPullRequestComment: adapter.addPullRequestComment?.bind(adapter),
    addNeedsHumanAttentionComment: adapter.addNeedsHumanAttentionComment?.bind(adapter),
    transitionToHumanReview: adapter.transitionToHumanReview?.bind(adapter)
  };
}
