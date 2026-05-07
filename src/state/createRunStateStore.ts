import type { WorkflowConfig } from "../types.js";
import { InMemoryRunStateStore, type RunStateStore } from "./runStateStore.js";
import { PostgresRunStateStore } from "./postgresRunStateStore.js";

export async function createRunStateStore(config: WorkflowConfig): Promise<RunStateStore> {
  if (config.state.kind === "postgres") {
    const store = new PostgresRunStateStore({
      connectionString: config.state.connectionString
    });
    await store.migrate();
    return store;
  }
  return new InMemoryRunStateStore();
}
