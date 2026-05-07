import type { Issue } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";
import type { HttpClient, HttpRequest, HttpResponse } from "./jiraTracker.js";
import type { GitHubIssuesTrackerConfig } from "./registry.js";
import type { TrackerAdapter, TrackerCapabilities } from "./tracker.js";

interface GitHubIssuePayload {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  labels?: Array<string | { name?: string | null }> | null;
  user?: { login?: string | null } | null;
  assignee?: { login?: string | null } | null;
  pull_request?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export class GitHubIssuesTracker implements TrackerAdapter {
  readonly capabilities: TrackerCapabilities = {
    canComment: true,
    canTransition: true,
    canFetchByQuery: false,
    canFetchByLabel: true
  };

  constructor(
    private readonly config: GitHubIssuesTrackerConfig,
    private readonly httpClient: HttpClient = defaultHttpClient
  ) {}

  async listIssues(): Promise<Issue[]> {
    const issues: GitHubIssuePayload[] = [];
    let page = 1;

    while (issues.length < this.config.maxResults) {
      const params = new URLSearchParams({
        state: "all",
        labels: this.config.labels.join(","),
        per_page: String(Math.min(100, this.config.maxResults)),
        page: String(page)
      });
      const batch = await this.requestJson<GitHubIssuePayload[]>(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues?${params.toString()}`,
        { method: "GET" }
      );
      issues.push(...batch.filter((issue) => issue.pull_request === undefined));
      if (batch.length < Math.min(100, this.config.maxResults)) {
        break;
      }
      page += 1;
    }

    const closedStates = new Set(this.config.closedStates.map((state) => state.toLowerCase()));
    return issues
      .filter((issue) => !closedStates.has(issue.state.toLowerCase()))
      .slice(0, this.config.maxResults)
      .map((issue) => normalizeGitHubIssue(issue, this.config));
  }

  async fetchIssue(id: string): Promise<Issue> {
    const issueNumber = issueNumberFromId(id);
    const issue = await this.requestJson<GitHubIssuePayload>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues/${issueNumber}`,
      { method: "GET" }
    );
    return normalizeGitHubIssue(issue, this.config);
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.id, `Draft PR created by Symphony: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: Issue, state: IssueRunState): Promise<void> {
    await this.commentOnIssue(
      issue.id,
      `Symphony needs human attention after ${state.attemptCount} attempt(s). Last error: ${state.lastErrorMessage ?? state.lastErrorType ?? "unknown"}.`
    );
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.id, this.config.humanReviewLabel);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    const issueNumber = issueNumberFromId(id);
    await this.requestJson(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        body: { body }
      }
    );
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    const issueNumber = issueNumberFromId(id);
    await this.requestJson(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues/${issueNumber}/labels`,
      {
        method: "POST",
        body: { labels: [targetState] }
      }
    );

    if (!this.config.removeCandidateLabelsOnReview) {
      return;
    }
    for (const label of this.config.labels) {
      if (label.toLowerCase() === targetState.toLowerCase()) {
        continue;
      }
      await this.requestJson(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE" }
      );
    }
  }

  private async requestJson<T = unknown>(
    path: string,
    options: { method: string; body?: unknown }
  ): Promise<T> {
    const response = await this.httpClient({
      method: options.method,
      url: `https://api.github.com${path}`,
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${this.config.token}`
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub Issues request failed with HTTP ${response.status}: ${text}`);
    }
    if (text.trim().length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

function normalizeGitHubIssue(issue: GitHubIssuePayload, config: GitHubIssuesTrackerConfig): Issue {
  return {
    id: `${config.owner}/${config.repo}#${issue.number}`,
    identifier: `${config.repo}#${issue.number}`,
    title: issue.title,
    description: issue.body ?? null,
    priority: null,
    state: issue.state,
    branchName: null,
    url: issue.html_url,
    labels: labels(issue.labels),
    blockedBy: [],
    createdAt: issue.created_at ?? null,
    updatedAt: issue.updated_at ?? null
  };
}

function labels(value: GitHubIssuePayload["labels"]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((label) => {
    if (typeof label === "string") {
      return [label.toLowerCase()];
    }
    return typeof label.name === "string" && label.name.length > 0 ? [label.name.toLowerCase()] : [];
  });
}

function issueNumberFromId(id: string): string {
  const match = /#(\d+)$/.exec(id) ?? /^(\d+)$/.exec(id);
  if (match === null) {
    throw new Error(`Cannot derive GitHub issue number from ${id}.`);
  }
  return match[1]!;
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
