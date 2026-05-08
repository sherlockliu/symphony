import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  isActiveRunState,
  isRetryableRunState,
  isStaleRecoverableState,
  isUnfinishedRunState,
  type IssueRunState,
  type RunStateStore
} from "./runStateStore.js";

interface JsonStateFile {
  version: 1;
  states: IssueRunState[];
}

export class JsonRunStateStore implements RunStateStore {
  constructor(private readonly filePath: string) {}

  async getByIssueId(issueId: string): Promise<IssueRunState | undefined> {
    return cloneState((await this.readStates()).find((state) => state.trackerIssueId === issueId));
  }

  async getByIssueIdentifier(identifier: string): Promise<IssueRunState | undefined> {
    return cloneState((await this.readStates()).find((state) => state.issueIdentifier === identifier));
  }

  async upsert(state: IssueRunState): Promise<void> {
    const states = await this.readStates();
    const index = states.findIndex((existing) =>
      existing.trackerKind === state.trackerKind && existing.trackerIssueId === state.trackerIssueId
    );
    const next = cloneState(state)!;
    if (index === -1) {
      states.push(next);
    } else {
      states[index] = next;
    }
    await this.writeStates(states);
  }

  async listActive(): Promise<IssueRunState[]> {
    return this.listWhere((state) => isActiveRunState(state.state));
  }

  async listUnfinished(): Promise<IssueRunState[]> {
    return this.listWhere((state) => isUnfinishedRunState(state.state));
  }

  async listRetryable(now: Date): Promise<IssueRunState[]> {
    return this.listWhere((state) => isRetryableRunState(state, now));
  }

  async listRecent(limit: number): Promise<IssueRunState[]> {
    return (await this.readStates())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((state) => cloneState(state)!);
  }

  async markStaleRuns(now: Date): Promise<void> {
    const nowIso = now.toISOString();
    const states = await this.readStates();
    const next = states.map((state) => {
      if (!isStaleRecoverableState(state.state)) {
        return state;
      }
      return {
        ...state,
        state: state.attemptCount >= state.maxAttempts ? "needs_human_attention" : "failed_retryable",
        updatedAt: nowIso,
        completedAt: nowIso,
        lastErrorType: state.lastErrorType ?? "stale_run_recovered",
        lastErrorMessage: state.lastErrorMessage ?? "Run was unfinished during daemon startup recovery.",
        nextRetryAt: state.attemptCount >= state.maxAttempts ? null : state.nextRetryAt,
        lockOwner: null,
        lockExpiresAt: null
      } satisfies IssueRunState;
    });
    await this.writeStates(next);
  }

  async acquireLock(state: IssueRunState, owner: string, expiresAt: Date): Promise<boolean> {
    const states = await this.readStates();
    const index = states.findIndex((existing) =>
      existing.trackerKind === state.trackerKind && existing.trackerIssueId === state.trackerIssueId
    );
    if (index === -1) {
      return false;
    }
    const existing = states[index]!;
    const now = new Date();
    if (existing.lockOwner !== null && existing.lockExpiresAt !== null && Date.parse(existing.lockExpiresAt) > now.getTime()) {
      return false;
    }
    states[index] = {
      ...existing,
      lockOwner: owner,
      lockExpiresAt: expiresAt.toISOString(),
      updatedAt: now.toISOString()
    };
    await this.writeStates(states);
    return true;
  }

  async releaseLock(state: IssueRunState, owner: string): Promise<void> {
    const states = await this.readStates();
    const index = states.findIndex((existing) =>
      existing.trackerKind === state.trackerKind && existing.trackerIssueId === state.trackerIssueId
    );
    if (index === -1 || states[index]!.lockOwner !== owner) {
      return;
    }
    states[index] = {
      ...states[index]!,
      lockOwner: null,
      lockExpiresAt: null,
      updatedAt: new Date().toISOString()
    };
    await this.writeStates(states);
  }

  private async listWhere(predicate: (state: IssueRunState) => boolean): Promise<IssueRunState[]> {
    return (await this.readStates())
      .filter(predicate)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((state) => cloneState(state)!);
  }

  private async readStates(): Promise<IssueRunState[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<JsonStateFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.states)) {
        throw new Error(`Run-state file must contain { "version": 1, "states": [...] }: ${this.filePath}`);
      }
      return parsed.states.map((state) => cloneState(state)!);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeStates(states: IssueRunState[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify({ version: 1, states }, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function cloneState(state: IssueRunState | undefined): IssueRunState | undefined {
  return state === undefined
    ? undefined
    : {
        ...state,
        metadata: { ...state.metadata }
      };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
