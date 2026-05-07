import type { TrackerConfig } from "./registry.js";
import type { TrackerAdapter } from "./tracker.js";
import { createTrackerFromRegistry } from "./registry.js";

export function createTracker(config: { tracker: TrackerConfig }): TrackerAdapter {
  return createTrackerFromRegistry(config.tracker);
}
