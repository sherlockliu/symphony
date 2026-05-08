import type { Issue } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";

export type TrackedIssue = Issue;

export interface TrackerCapabilities {
  canComment: boolean;
  canTransition: boolean;
  canFetchByQuery: boolean;
  canFetchByLabel: boolean;
}

export interface TrackerCapabilityRequirements {
  comment?: boolean;
  transition?: boolean;
  fetchByQuery?: boolean;
  fetchByLabel?: boolean;
}

export interface TrackerAdapter {
  readonly capabilities?: TrackerCapabilities;
  listIssues(): Promise<Issue[]>;
  fetchIssue?(id: string): Promise<Issue>;
  addPullRequestComment?(issue: Issue, prUrl: string): Promise<void>;
  addNeedsHumanAttentionComment?(issue: Issue, state: IssueRunState): Promise<void>;
  transitionToHumanReview?(issue: Issue): Promise<void>;
}

export const READ_ONLY_TRACKER_CAPABILITIES: TrackerCapabilities = {
  canComment: false,
  canTransition: false,
  canFetchByQuery: false,
  canFetchByLabel: false
};

export function filterActiveIssues(issues: Issue[], activeStates: string[]): Issue[] {
  const active = new Set(activeStates);
  return issues.filter((issue) => active.has(issue.state));
}

export function validateTrackedIssue(issue: Issue, source = "tracker"): Issue {
  const problems: string[] = [];
  for (const key of ["id", "identifier", "title", "state"] as const) {
    if (typeof issue[key] !== "string" || issue[key].trim().length === 0) {
      problems.push(`${key} must be a non-empty string`);
    }
  }
  if (issue.description !== null && typeof issue.description !== "string") {
    problems.push("description must be a string or null");
  }
  if (issue.priority !== null && typeof issue.priority !== "number" && typeof issue.priority !== "string") {
    problems.push("priority must be a string, number, or null");
  }
  if (issue.branchName !== null && typeof issue.branchName !== "string") {
    problems.push("branchName must be a string or null");
  }
  if (issue.url !== null && typeof issue.url !== "string") {
    problems.push("url must be a string or null");
  }
  if (!Array.isArray(issue.labels) || issue.labels.some((label) => typeof label !== "string")) {
    problems.push("labels must be a string array");
  }
  if (!Array.isArray(issue.blockedBy)) {
    problems.push("blockedBy must be an array");
  }
  if (issue.createdAt !== null && typeof issue.createdAt !== "string") {
    problems.push("createdAt must be a string or null");
  }
  if (issue.updatedAt !== null && typeof issue.updatedAt !== "string") {
    problems.push("updatedAt must be a string or null");
  }
  if (problems.length > 0) {
    throw new Error(`${source} returned an invalid tracked issue ${issue.identifier || issue.id || "(unknown)"}: ${problems.join(", ")}.`);
  }
  return issue;
}

export function validateTrackedIssues(issues: Issue[], source = "tracker"): Issue[] {
  return issues.map((issue) => validateTrackedIssue(issue, source));
}

export function capabilitiesFor(adapter: TrackerAdapter): TrackerCapabilities {
  return {
    canComment: adapter.capabilities?.canComment ?? adapter.addPullRequestComment !== undefined,
    canTransition: adapter.capabilities?.canTransition ?? adapter.transitionToHumanReview !== undefined,
    canFetchByQuery: adapter.capabilities?.canFetchByQuery ?? false,
    canFetchByLabel: adapter.capabilities?.canFetchByLabel ?? false
  };
}

export function assertTrackerCapabilities(
  adapter: TrackerAdapter,
  requirements: TrackerCapabilityRequirements | undefined,
  source = "tracker"
): void {
  if (requirements === undefined) {
    return;
  }
  const capabilities = capabilitiesFor(adapter);
  const missing: string[] = [];
  if (requirements.comment === true && !capabilities.canComment) {
    missing.push("comment");
  }
  if (requirements.transition === true && !capabilities.canTransition) {
    missing.push("transition");
  }
  if (requirements.fetchByQuery === true && !capabilities.canFetchByQuery) {
    missing.push("fetch_by_query");
  }
  if (requirements.fetchByLabel === true && !capabilities.canFetchByLabel) {
    missing.push("fetch_by_label");
  }
  if (missing.length > 0) {
    throw new Error(`${source} requires unsupported tracker capability: ${missing.join(", ")}.`);
  }
}
