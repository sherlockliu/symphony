import type { WorkflowConfig } from "../types.js";
import type { TrackerAdapter } from "./tracker.js";
import { JiraTracker } from "./jiraTracker.js";
import { MockTracker } from "./mockTracker.js";
import { PlaneTracker } from "./planeTracker.js";

export function createTracker(config: WorkflowConfig): TrackerAdapter {
  if (config.tracker.kind === "jira") {
    return new JiraTracker(config.tracker);
  }
  if (config.tracker.kind === "plane") {
    return new PlaneTracker(config.tracker);
  }
  return new MockTracker(config.tracker.issueFile);
}
