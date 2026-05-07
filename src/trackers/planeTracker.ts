import type { Issue, WorkflowConfig } from "../types.js";
import type { HttpClient, HttpRequest, HttpResponse } from "./jiraTracker.js";
import type { TrackerAdapter } from "./tracker.js";

type PlaneConfig = Extract<WorkflowConfig["tracker"], { kind: "plane" }>;

interface PlaneWorkItemPayload {
  id: string;
  name?: string;
  description_stripped?: string | null;
  description_html?: string | null;
  priority?: string | null;
  state?: string | PlaneStatePayload | null;
  labels?: Array<string | { name?: string }> | null;
  sequence_id?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  project?: string | { id?: string; identifier?: string; name?: string } | null;
}

interface PlaneStatePayload {
  id: string;
  name: string;
}

export class PlaneTracker implements TrackerAdapter {
  constructor(
    private readonly config: PlaneConfig,
    private readonly httpClient: HttpClient = defaultHttpClient
  ) {}

  async listIssues(): Promise<Issue[]> {
    const all: PlaneWorkItemPayload[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        limit: String(this.config.maxResults),
        offset: String(offset),
        expand: "state,labels,project"
      });
      const batch = await this.requestJson<PlaneWorkItemPayload[]>(
        `/api/v1/workspaces/${encodeURIComponent(this.config.workspaceSlug)}/projects/${encodeURIComponent(this.config.projectId)}/work-items/?${params.toString()}`,
        { method: "GET" }
      );
      all.push(...batch);

      if (batch.length < this.config.maxResults) {
        break;
      }
      offset += this.config.maxResults;
    }

    return all.map((item) => normalizePlaneWorkItem(item, this.config));
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    const escapedUrl = escapeHtml(prUrl);
    await this.requestJson(
      `/api/v1/workspaces/${encodeURIComponent(this.config.workspaceSlug)}/projects/${encodeURIComponent(this.config.projectId)}/work-items/${encodeURIComponent(issue.id)}/comments/`,
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

  async transitionToHumanReview(issue: Issue): Promise<void> {
    const states = await this.requestJson<PlaneStatePayload[]>(
      `/api/v1/workspaces/${encodeURIComponent(this.config.workspaceSlug)}/projects/${encodeURIComponent(this.config.projectId)}/states/`,
      { method: "GET" }
    );
    const desired = this.config.reviewState.toLowerCase();
    const state = states.find((candidate) => candidate.name.toLowerCase() === desired);

    if (state === undefined) {
      throw new Error(`Plane state ${this.config.reviewState} is not available for project ${this.config.projectId}.`);
    }

    await this.requestJson(
      `/api/v1/workspaces/${encodeURIComponent(this.config.workspaceSlug)}/projects/${encodeURIComponent(this.config.projectId)}/work-items/${encodeURIComponent(issue.id)}/`,
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
    const response = await this.httpClient({
      method: options.method,
      url: `${this.config.baseUrl.replace(/\/+$/, "")}${path}`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Plane request failed with HTTP ${response.status}: ${text}`);
    }
    if (text.trim().length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

function normalizePlaneWorkItem(item: PlaneWorkItemPayload, config: PlaneConfig): Issue {
  const state = typeof item.state === "object" && item.state !== null ? item.state.name : stringField(item.state);
  return {
    id: item.id,
    identifier: planeIdentifier(item, config),
    title: stringField(item.name) ?? item.id,
    description: stringField(item.description_stripped) ?? stripHtml(stringField(item.description_html)) ?? null,
    priority: priorityNumber(item.priority),
    state: state ?? "Unknown",
    branchName: null,
    url: planeWorkItemUrl(item, config),
    labels: labels(item.labels),
    blockedBy: [],
    createdAt: stringField(item.created_at) ?? null,
    updatedAt: stringField(item.updated_at) ?? null
  };
}

function planeIdentifier(item: PlaneWorkItemPayload, config: PlaneConfig): string {
  const project = typeof item.project === "object" && item.project !== null ? item.project : undefined;
  const projectIdentifier = stringField(project?.identifier) ?? config.projectId;
  const sequence = item.sequence_id === undefined || item.sequence_id === null ? undefined : String(item.sequence_id);
  return sequence === undefined ? item.id : `${projectIdentifier}-${sequence}`;
}

function planeWorkItemUrl(item: PlaneWorkItemPayload, config: PlaneConfig): string {
  return `${config.baseUrl.replace(/\/+$/, "")}/${config.workspaceSlug}/projects/${config.projectId}/issues/${planeIdentifier(item, config)}`;
}

function labels(value: PlaneWorkItemPayload["labels"]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((label) => {
    if (typeof label === "string") {
      return [label.toLowerCase()];
    }
    const name = stringField(label.name);
    return name === undefined ? [] : [name.toLowerCase()];
  });
}

function priorityNumber(priority: unknown): number | null {
  const value = stringField(priority);
  if (value === undefined || value === "none") {
    return null;
  }
  return {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4
  }[value] ?? null;
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
