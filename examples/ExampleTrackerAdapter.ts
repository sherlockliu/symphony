import type { Issue } from "../src/types.js";
import type { IssueRunState } from "../src/state/runStateStore.js";
import type { TrackerAdapter } from "../src/trackers/tracker.js";
import { registerTracker, type CustomTrackerConfig, type TrackerValidationContext } from "../src/trackers/registry.js";
import type { JsonValue } from "../src/types.js";

// Example only. This file is a template for maintainers and is not registered by default.
interface ExampleTrackerConfig extends CustomTrackerConfig {
  kind: "example";
  baseUrl: string;
  apiToken: string;
  projectKey: string;
  candidateState: string;
  reviewState: string;
}

interface ExampleTrackerPayload {
  id: string;
  key: string;
  summary: string;
  body?: string;
  state: string;
  url?: string;
  labels?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export class ExampleTrackerAdapter implements TrackerAdapter {
  constructor(private readonly config: ExampleTrackerConfig) {}

  async listIssues(): Promise<Issue[]> {
    return this.fetchCandidateIssues();
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const payloads = await this.fetchJson<ExampleTrackerPayload[]>(
      `/projects/${encodeURIComponent(this.config.projectKey)}/issues?state=${encodeURIComponent(this.config.candidateState)}`
    );
    return payloads.map(normalizeExampleIssue);
  }

  async fetchIssue(id: string): Promise<Issue> {
    const payload = await this.fetchJson<ExampleTrackerPayload>(`/issues/${encodeURIComponent(id)}`);
    return normalizeExampleIssue(payload);
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.id, `Draft PR created: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: Issue, state: IssueRunState): Promise<void> {
    await this.commentOnIssue(
      issue.id,
      `Symphony needs human attention after ${state.attemptNumber} attempt(s). Last error: ${state.lastError ?? "unknown"}.`
    );
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.id, this.config.reviewState);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    await this.fetchJson(`/issues/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body })
    });
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    await this.fetchJson(`/issues/${encodeURIComponent(id)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ state: targetState })
    });
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, this.config.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Example tracker request failed with HTTP ${response.status}.`);
    }
    return await response.json() as T;
  }
}

export function registerExampleTracker(): void {
  registerTracker<ExampleTrackerConfig>({
    kind: "example",
    validate(raw, context) {
      const baseUrl = requiredString(raw, "baseUrl", context, "tracker.base_url");
      const apiToken = requiredString(raw, "apiToken", context, "tracker.api_token");
      const projectKey = requiredString(raw, "projectKey", context, "tracker.project_key");
      const candidateState = requiredString(raw, "candidateState", context, "tracker.candidate_state");
      const reviewState = optionalString(raw, "reviewState", context, "tracker.review_state") ?? "Human Review";

      if (baseUrl === undefined || apiToken === undefined || projectKey === undefined || candidateState === undefined) {
        return undefined;
      }

      return {
        kind: "example",
        baseUrl,
        apiToken,
        projectKey,
        candidateState,
        reviewState
      };
    },
    create(config) {
      return new ExampleTrackerAdapter(config);
    }
  });
}

function normalizeExampleIssue(payload: ExampleTrackerPayload): Issue {
  return {
    id: payload.id,
    identifier: payload.key,
    title: payload.summary,
    description: payload.body ?? null,
    priority: null,
    state: payload.state,
    branchName: null,
    url: payload.url ?? null,
    labels: payload.labels ?? [],
    blockedBy: [],
    createdAt: payload.createdAt ?? null,
    updatedAt: payload.updatedAt ?? null
  };
}

function requiredString(
  raw: Record<string, JsonValue>,
  key: string,
  context: TrackerValidationContext,
  display: string
): string | undefined {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    context.issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function optionalString(
  raw: Record<string, JsonValue>,
  key: string,
  context: TrackerValidationContext,
  display: string
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    context.issues.push(`${display} must be a non-empty string when provided.`);
    return undefined;
  }
  return value;
}
