import type { WorkflowConfig } from "../types.js";
import { InMemoryRunStateStore, type RunStateStore } from "./runStateStore.js";
import { PostgresRunStateStore } from "./postgresRunStateStore.js";
import { JsonRunStateStore } from "./jsonRunStateStore.js";

export async function createRunStateStore(config: WorkflowConfig): Promise<RunStateStore> {
  if (config.state.kind === "postgres") {
    const store = new PostgresRunStateStore({
      connectionString: config.state.connectionString
    });
    await store.migrate();
    return store;
  }
  if (config.state.kind === "json") {
    return new JsonRunStateStore(config.state.filePath);
  }
  return new InMemoryRunStateStore();
}
