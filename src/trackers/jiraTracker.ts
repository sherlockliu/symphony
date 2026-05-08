import type { Issue } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";
import { redactSecrets } from "../logging/redact.js";
import type { JiraTrackerConfig } from "./registry.js";
import type { TrackerAdapter, TrackerCapabilities } from "./tracker.js";

type JiraConfig = JiraTrackerConfig;

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

interface JiraIssueSearchResponse {
  issues?: JiraIssuePayload[];
  nextPageToken?: string;
}

interface JiraIssuePayload {
  id: string;
  key: string;
  self?: string;
  fields?: Record<string, unknown>;
}

interface JiraTransitionResponse {
  transitions?: Array<{
    id: string;
    name: string;
    to?: {
      name?: string;
    };
  }>;
}

export class JiraTrackerAdapter implements TrackerAdapter {
  readonly capabilities: TrackerCapabilities = {
    canComment: true,
    canTransition: true,
    canFetchByQuery: true,
    canFetchByLabel: false
  };
  private readonly email: string;
  private readonly apiToken: string;

  constructor(
    private readonly config: JiraConfig,
    private readonly httpClient: HttpClient = defaultHttpClient,
    env: NodeJS.ProcessEnv = process.env
  ) {
    this.email = resolveSecret(config.emailEnv, env, "Jira email");
    this.apiToken = resolveSecret(config.apiTokenEnv, env, "Jira API token");
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return await this.listIssues();
  }

  async listIssues(): Promise<Issue[]> {
    const issues: JiraIssuePayload[] = [];
    let nextPageToken: string | undefined;

    do {
      const body: Record<string, unknown> = {
        jql: this.config.jql,
        maxResults: this.config.maxResults,
        fields: [
          "summary",
          "description",
          "priority",
          "status",
          "labels",
          "created",
          "updated",
          "issuelinks"
        ]
      };
      if (nextPageToken !== undefined) {
        body.nextPageToken = nextPageToken;
      }

      const response = await this.requestJson<JiraIssueSearchResponse>("/rest/api/3/search/jql", {
        method: "POST",
        body
      });
      issues.push(...(response.issues ?? []));
      nextPageToken = response.nextPageToken;
    } while (nextPageToken !== undefined);

    const normalized = issues.map((issue) => normalizeJiraIssue(issue, this.config.baseUrl));
    if (this.config.readyStates.length === 0) {
      return normalized;
    }
    const ready = new Set(this.config.readyStates);
    return normalized.filter((issue) => ready.has(issue.state));
  }

  async fetchIssue(id: string): Promise<Issue> {
    const issue = await this.requestJson<JiraIssuePayload>(`/rest/api/3/issue/${encodeURIComponent(id)}`, {
      method: "GET"
    });
    return normalizeJiraIssue(issue, this.config.baseUrl);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    await this.requestJson(`/rest/api/3/issue/${encodeURIComponent(id)}/comment`, {
      method: "POST",
      body: {
        body: adfText(body)
      }
    });
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.identifier, `Draft PR created by Symphony: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: Issue, state: IssueRunState): Promise<void> {
    await this.commentOnIssue(
      issue.identifier,
      `Symphony needs human attention after ${state.attemptCount} attempt(s). Last error: ${state.lastErrorMessage ?? state.lastErrorType ?? "unknown"}.`
    );
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.identifier, this.config.reviewState);
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    const transitions = await this.requestJson<JiraTransitionResponse>(
      `/rest/api/3/issue/${encodeURIComponent(id)}/transitions`,
      { method: "GET" }
    );
    const desired = targetState.toLowerCase();
    const matches = (transitions.transitions ?? []).filter((candidate) => {
      return candidate.name.toLowerCase() === desired || candidate.to?.name?.toLowerCase() === desired;
    });

    if (matches.length === 0) {
      throw new Error(`Jira transition ${targetState} is not available for ${id}.`);
    }
    if (matches.length > 1) {
      const names = matches.map((candidate) => `${candidate.name} (${candidate.id})`).join(", ");
      throw new Error(`Jira transition ${targetState} is ambiguous for ${id}: ${names}.`);
    }
    const transition = matches[0]!;

    await this.requestJson(`/rest/api/3/issue/${encodeURIComponent(id)}/transitions`, {
      method: "POST",
      body: {
        transition: {
          id: transition.id
        }
      }
    });
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
          Authorization: `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString("base64")}`
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactSecrets(`Jira request failed: ${message}`));
    }

    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(redactSecrets(`Jira request failed with HTTP ${response.status}: ${text}`));
    }
    if (text.trim().length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

export class JiraTracker extends JiraTrackerAdapter {}

function normalizeJiraIssue(issue: JiraIssuePayload, baseUrl: string): Issue {
  const fields = issue.fields ?? {};
  const priority = objectField(fields.priority);
  const status = objectField(fields.status);
  const labels = arrayField(fields.labels).filter((label): label is string => typeof label === "string");

  return {
    id: issue.id,
    identifier: issue.key,
    title: stringField(fields.summary) ?? issue.key,
    description: adfToText(fields.description),
    priority: stringField(priority?.name) ?? null,
    state: stringField(status?.name) ?? "Unknown",
    branchName: null,
    url: `${baseUrl.replace(/\/+$/, "")}/browse/${issue.key}`,
    labels,
    blockedBy: normalizeBlockers(fields.issuelinks),
    createdAt: stringField(fields.created) ?? null,
    updatedAt: stringField(fields.updated) ?? null,
    raw: issue
  };
}

function normalizeBlockers(value: unknown): Issue["blockedBy"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((link) => {
    const record = objectField(link);
    const type = objectField(record?.type);
    const inward = stringField(type?.inward)?.toLowerCase() ?? "";
    const outward = stringField(type?.outward)?.toLowerCase() ?? "";
    const linkName = stringField(type?.name)?.toLowerCase() ?? "";

    const inwardIssue = objectField(record?.inwardIssue);
    if (inwardIssue !== undefined && (inward.includes("blocked") || linkName.includes("block"))) {
      return [blockerFromIssue(inwardIssue)];
    }

    const outwardIssue = objectField(record?.outwardIssue);
    if (outwardIssue !== undefined && outward.includes("blocks")) {
      return [blockerFromIssue(outwardIssue)];
    }

    return [];
  });
}

function blockerFromIssue(issue: Record<string, unknown>): Issue["blockedBy"][number] {
  const fields = objectField(issue.fields);
  const status = objectField(fields?.status);
  return {
    id: stringField(issue.id) ?? null,
    identifier: stringField(issue.key) ?? null,
    state: stringField(status?.name) ?? null
  };
}

function adfToText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const parts: string[] = [];
  collectAdfText(value, parts);
  const text = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  return text.length === 0 ? null : text;
}

function collectAdfText(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAdfText(item, parts);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    parts.push(record.text);
  }
  if (record.type === "paragraph" || record.type === "heading") {
    parts.push("\n");
  }
  collectAdfText(record.content, parts);
  if (record.type === "paragraph" || record.type === "heading") {
    parts.push("\n");
  }
}

function adfText(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text
          }
        ]
      }
    ]
  };
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function resolveSecret(
  envName: string,
  env: NodeJS.ProcessEnv,
  label: string
): string {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${label} environment variable ${envName} is not set.`);
  }
  return value;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
