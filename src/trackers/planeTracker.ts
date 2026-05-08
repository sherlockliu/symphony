import type { Issue } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";
import { redactSecrets } from "../logging/redact.js";
import type { HttpClient, HttpRequest, HttpResponse } from "./jiraTracker.js";
import type { PlaneTrackerConfig } from "./registry.js";
import type { TrackerAdapter, TrackerCapabilities } from "./tracker.js";

type PlaneConfig = PlaneTrackerConfig;

interface PlaneWorkItemPayload {
  id: string;
  identifier?: string | null;
  code?: string | null;
  name?: string;
  title?: string;
  description_stripped?: string | null;
  description_html?: string | null;
  priority?: string | null;
  state?: string | PlaneStatePayload | null;
  labels?: Array<string | { name?: string }> | null;
  sequence_id?: number | string | null;
  sequence?: number | string | null;
  url?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  project?: string | { id?: string; identifier?: string; name?: string } | null;
}

interface PlaneStatePayload {
  id: string;
  name: string;
}

export class PlaneApiClient {
  constructor(private readonly config: PlaneConfig) {}

  workItemsPath(params?: URLSearchParams): string {
    return `${this.projectPath()}/work-items/${params === undefined ? "" : `?${params.toString()}`}`;
  }

  workItemPath(issueId: string): string {
    return `${this.projectPath()}/work-items/${encodeURIComponent(issueId)}/`;
  }

  commentsPath(issueId: string): string {
    return `${this.projectPath()}/work-items/${encodeURIComponent(issueId)}/comments/`;
  }

  statesPath(): string {
    return `${this.projectPath()}/states/`;
  }

  issueUrl(item: PlaneWorkItemPayload): string {
    const directUrl = stringField(item.url) ?? stringField(item.html_url);
    if (directUrl !== undefined) {
      return directUrl;
    }
    return `${this.config.baseUrl.replace(/\/+$/, "")}/${this.config.workspaceSlug}/projects/${this.config.projectId}/issues/${planeIdentifier(item, this.config)}`;
  }

  private projectPath(): string {
    return `/api/v1/workspaces/${encodeURIComponent(this.config.workspaceSlug)}/projects/${encodeURIComponent(this.config.projectId)}`;
  }
}

export class PlaneTrackerAdapter implements TrackerAdapter {
  readonly capabilities: TrackerCapabilities = {
    canComment: true,
    canTransition: true,
    canFetchByQuery: false,
    canFetchByLabel: false
  };
  private readonly apiToken: string;
  private readonly client: PlaneApiClient;

  constructor(
    private readonly config: PlaneConfig,
    private readonly httpClient: HttpClient = defaultHttpClient,
    env: NodeJS.ProcessEnv = process.env
  ) {
    this.apiToken = resolveSecret(config.apiTokenEnv, env);
    this.client = new PlaneApiClient(config);
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return await this.listIssues();
  }

  async listIssues(): Promise<Issue[]> {
    const all: PlaneWorkItemPayload[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        limit: String(this.config.maxResults),
        offset: String(offset),
        expand: "state,labels,project"
      });
      const batch = await this.requestJson<PlaneWorkItemPayload[]>(this.client.workItemsPath(params), { method: "GET" });
      all.push(...batch);

      if (batch.length < this.config.maxResults) {
        break;
      }
      offset += this.config.maxResults;
    }

    const normalized = all.map((item) => normalizePlaneWorkItem(item, this.config, this.client));
    if (this.config.readyStates.length === 0) {
      return normalized;
    }
    const ready = new Set(this.config.readyStates);
    return normalized.filter((issue) => ready.has(issue.state));
  }

  async fetchIssue(id: string): Promise<Issue> {
    const item = await this.requestJson<PlaneWorkItemPayload>(this.client.workItemPath(id), { method: "GET" });
    return normalizePlaneWorkItem(item, this.config, this.client);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    await this.requestJson(this.client.commentsPath(id), {
      method: "POST",
      body: {
        comment_html: `<p>${escapeHtml(body)}</p>`,
        comment_json: {},
        access: "INTERNAL",
        external_source: "symphony",
        external_id: `symphony-comment-${id}-${Date.now()}`
      }
    });
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    const escapedUrl = escapeHtml(prUrl);
    await this.requestJson(
      this.client.commentsPath(issue.id),
      {
        method: "POST",
        body: {
          comment_html: `<p>Draft PR created by Symphony: <a href="${escapedUrl}">${escapedUrl}</a></p>`,
          comment_json: {},
          access: "INTERNAL",
          external_source: "symphony",
          external_id: `symphony-pr-${issue.identifier}`
        }
      }
    );
  }

  async addNeedsHumanAttentionComment(issue: Issue, state: IssueRunState): Promise<void> {
    const message = escapeHtml(
      `Symphony needs human attention after ${state.attemptCount} attempt(s). Last error: ${state.lastErrorMessage ?? state.lastErrorType ?? "unknown"}.`
    );
    await this.requestJson(
      this.client.commentsPath(issue.id),
      {
        method: "POST",
        body: {
          comment_html: `<p>${message}</p>`,
          comment_json: {},
          access: "INTERNAL",
          external_source: "symphony",
          external_id: `symphony-human-attention-${issue.identifier}`
        }
      }
    );
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.id, this.config.reviewState);
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    const states = await this.requestJson<PlaneStatePayload[]>(
      this.client.statesPath(),
      { method: "GET" }
    );
    const desired = targetState.toLowerCase();
    const state = states.find((candidate) => candidate.name.toLowerCase() === desired);

    if (state === undefined) {
      throw new Error(`Plane state ${targetState} is not available for project ${this.config.projectId}.`);
    }

    await this.requestJson(
      this.client.workItemPath(id),
      {
        method: "PATCH",
        body: {
          state: state.id
        }
      }
    );
  }

  private async requestJson<T = unknown>(
    path: string,
    options: { method: string; body?: unknown }
  ): Promise<T> {
    let response: HttpResponse;
    try {
      response = await this.httpClient({
        method: options.method,
        url: `${this.config.baseUrl.replace(/\/+$/, "")}${path}`,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": this.apiToken
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactSecrets(`Plane request failed: ${message}`));
    }

    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(redactSecrets(`Plane request failed with HTTP ${response.status}: ${text}`));
    }
    if (text.trim().length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

export class PlaneTracker extends PlaneTrackerAdapter {}

function normalizePlaneWorkItem(item: PlaneWorkItemPayload, config: PlaneConfig, client: PlaneApiClient): Issue {
  const state = typeof item.state === "object" && item.state !== null ? item.state.name : stringField(item.state);
  return {
    id: item.id,
    identifier: planeIdentifier(item, config),
    title: stringField(item.name) ?? stringField(item.title) ?? item.id,
    description: stringField(item.description_stripped) ?? stripHtml(stringField(item.description_html)) ?? null,
    priority: stringField(item.priority) ?? null,
    state: state ?? "Unknown",
    branchName: null,
    url: client.issueUrl(item),
    labels: labels(item.labels),
    blockedBy: [],
    createdAt: stringField(item.created_at) ?? null,
    updatedAt: stringField(item.updated_at) ?? null,
    raw: item
  };
}

function planeIdentifier(item: PlaneWorkItemPayload, config: PlaneConfig): string {
  const code = stringField(item.code) ?? stringField(item.identifier);
  if (code !== undefined) {
    return code;
  }
  const project = typeof item.project === "object" && item.project !== null ? item.project : undefined;
  const projectIdentifier = stringField(project?.identifier) ?? config.projectId;
  const sequenceValue = item.sequence_id ?? item.sequence;
  const sequence = sequenceValue === undefined || sequenceValue === null ? undefined : String(sequenceValue);
  return sequence === undefined ? item.id : `${projectIdentifier}-${sequence}`;
}

function labels(value: PlaneWorkItemPayload["labels"]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((label) => {
    if (typeof label === "string") {
      return [label];
    }
    const name = stringField(label.name);
    return name === undefined ? [] : [name];
  });
}

function stripHtml(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const stripped = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length === 0 ? null : stripped;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveSecret(envName: string, env: NodeJS.ProcessEnv): string {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Plane API token environment variable ${envName} is not set.`);
  }
  return value;
}

async function defaultHttpClient(request: HttpRequest): Promise<HttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  return {
    status: response.status,
    async text() {
      return await response.text();
    }
  };
}
