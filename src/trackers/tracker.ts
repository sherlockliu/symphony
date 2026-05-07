import type { Issue } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";

export interface TrackerAdapter {
  listIssues(): Promise<Issue[]>;
  addPullRequestComment?(issue: Issue, prUrl: string): Promise<void>;
  addNeedsHumanAttentionComment?(issue: Issue, state: IssueRunState): Promise<void>;
  transitionToHumanReview?(issue: Issue): Promise<void>;
}
