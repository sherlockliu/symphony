import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Issue } from "../types.js";
import { type TrackerAdapter, type TrackerCapabilities } from "./tracker.js";

export interface MockTrackerAdapterConfig {
  issuesFile: string;
  readyStates?: string[];
  eventsFile?: string;
  humanReviewState?: string;
}

interface MockIssueInput {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: string | number | null;
  state: string;
  branch_name?: string | null;
  branchName?: string | null;
  url?: string | null;
  labels?: string[];
  blocked_by?: Issue["blockedBy"];
  blockedBy?: Issue["blockedBy"];
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export type MockTrackerEvent =
  | {
      type: "comment";
      issueId: string;
      body: string;
      timestamp: string;
    }
  | {
      type: "transition";
      issueId: string;
      state: string;
      timestamp: string;
    };

export class MockTrackerAdapter implements TrackerAdapter {
  readonly capabilities: TrackerCapabilities = {
    canComment: true,
    canTransition: true,
    canFetchByQuery: false,
    canFetchByLabel: false
  };

  private readonly issuesFile: string;
  private readonly readyStates: string[] | undefined;
  private readonly eventsFile: string;
  private readonly humanReviewState: string;

  constructor(config: string | MockTrackerAdapterConfig) {
    if (typeof config === "string") {
      this.issuesFile = config;
      this.readyStates = undefined;
      this.humanReviewState = "Human Review";
    } else {
      this.issuesFile = config.issuesFile;
      this.readyStates = config.readyStates;
      this.humanReviewState = config.humanReviewState ?? "Human Review";
    }
    this.eventsFile =
      typeof config === "string" || config.eventsFile === undefined
        ? path.join(path.dirname(this.issuesFile), ".mock-tracker-events.json")
        : config.eventsFile;
  }

  async listIssues(): Promise<Issue[]> {
    return this.loadIssues();
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const issues = await this.loadIssues();
    if (this.readyStates === undefined || this.readyStates.length === 0) {
      return issues;
    }
    const ready = new Set(this.readyStates);
    return issues.filter((issue) => ready.has(issue.state));
  }

  async fetchIssue(id: string): Promise<Issue> {
    const issues = await this.loadIssues();
    const issue = issues.find((candidate) => candidate.id === id || candidate.identifier === id);
    if (issue === undefined) {
      throw new Error(`Mock issue not found: ${id}.`);
    }
    return issue;
  }

  async commentOnIssue(issueId: string, body: string): Promise<void> {
    await this.fetchIssue(issueId);
    await this.recordEvent({
      type: "comment",
      issueId,
      body,
      timestamp: new Date().toISOString()
    });
  }

  async transitionIssue(issueId: string, state: string): Promise<void> {
    await this.fetchIssue(issueId);
    await this.recordEvent({
      type: "transition",
      issueId,
      state,
      timestamp: new Date().toISOString()
    });
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.id, `Draft pull request is ready for review: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: Issue): Promise<void> {
    await this.commentOnIssue(issue.id, "This issue needs human attention before the orchestrator can continue.");
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.id, this.humanReviewState);
  }

  private async loadIssues(): Promise<Issue[]> {
    let source: string;
    try {
      source = await readFile(this.issuesFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`Mock issues file not found: ${this.issuesFile}.`);
      }
      if (isNodeError(error) && error.code === "EACCES") {
        throw new Error(`Mock issues file is not readable: ${this.issuesFile}.`);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Mock issues file must contain valid JSON: ${this.issuesFile}. ${message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Mock issues file must contain a JSON array: ${this.issuesFile}.`);
    }
    return parsed.map((issue, index) => normalizeIssue(issue as MockIssueInput, index));
  }

  private async recordEvent(event: MockTrackerEvent): Promise<void> {
    const events = await this.loadEvents();
    events.push(event);
    await mkdir(path.dirname(this.eventsFile), { recursive: true });
    await writeFile(this.eventsFile, `${JSON.stringify(events, null, 2)}\n`);
  }

  private async loadEvents(): Promise<MockTrackerEvent[]> {
    let source: string;
    try {
      source = await readFile(this.eventsFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Mock tracker events file must contain valid JSON: ${this.eventsFile}. ${message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Mock tracker events file must contain a JSON array: ${this.eventsFile}.`);
    }
    return parsed as MockTrackerEvent[];
  }
}

function normalizeIssue(issue: MockIssueInput, index: number): Issue {
  for (const key of ["id", "identifier", "title", "state"] as const) {
    if (typeof issue[key] !== "string" || issue[key].trim() === "") {
      throw new Error(`Mock issue at index ${index} is missing required string field ${key}.`);
    }
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority ?? null,
    state: issue.state,
    branchName: issue.branchName ?? issue.branch_name ?? null,
    url: issue.url ?? null,
    labels: (issue.labels ?? []).map((label) => label.toLowerCase()),
    blockedBy: issue.blockedBy ?? issue.blocked_by ?? [],
    createdAt: issue.createdAt ?? issue.created_at ?? null,
    updatedAt: issue.updatedAt ?? issue.updated_at ?? null
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class MockTracker extends MockTrackerAdapter {}
