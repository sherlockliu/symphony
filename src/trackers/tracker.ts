import type { Issue } from "../types.js";

export interface TrackerAdapter {
  listIssues(): Promise<Issue[]>;
  addPullRequestComment?(issue: Issue, prUrl: string): Promise<void>;
  transitionToHumanReview?(issue: Issue): Promise<void>;
}
