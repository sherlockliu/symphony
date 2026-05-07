import { readFile } from "node:fs/promises";
import type { Issue } from "../types.js";
import { type TrackerAdapter, type TrackerCapabilities } from "./tracker.js";

interface MockIssueInput {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
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

export class MockTracker implements TrackerAdapter {
  readonly capabilities: TrackerCapabilities = {
    canComment: false,
    canTransition: false,
    canFetchByQuery: false,
    canFetchByLabel: false
  };

  constructor(private readonly issueFile: string) {}

  async listIssues(): Promise<Issue[]> {
    const source = await readFile(this.issueFile, "utf8");
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Mock issue file must contain a JSON array.");
    }
    return parsed.map((issue, index) => normalizeIssue(issue as MockIssueInput, index));
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
