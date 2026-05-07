import type { Issue, IssueRunSummary, OrchestratorCycleResult, OrchestratorRunOptions } from "../types.js";
import type { IssueRunState } from "../state/runStateStore.js";

export interface PollingOrchestrator {
  runOnce(options?: OrchestratorRunOptions): Promise<OrchestratorCycleResult>;
}

export type DaemonLogEvent =
  | {
      status: "daemon_started";
      pollIntervalSeconds: number;
    }
  | {
      status: "poll_started";
      cycle: number;
    }
  | {
      status: "poll_completed";
      cycle: number;
      totalIssues: number;
      activeIssues: number;
      eligibleIssues: number;
      processedIssues: number;
    }
  | {
      status: "poll_failed";
      cycle: number;
      error: string;
    }
  | {
      status: "daemon_stopped";
      cycles: number;
    };

export interface PollingDaemonOptions {
  pollIntervalMs: number;
  signal?: AbortSignal;
  maxCycles?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  logger?: (event: DaemonLogEvent) => void;
  onIssueStarted?: (issue: Issue) => void;
  onIssueCompleted?: (summary: IssueRunSummary) => void;
  onIssueFailed?: (issue: Issue, error: unknown) => void;
  onRunStateUpdated?: (state: IssueRunState) => void;
  onWarning?: (message: string) => void;
}

export class PollingDaemon {
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly logger: (event: DaemonLogEvent) => void;

  constructor(
    private readonly orchestrator: PollingOrchestrator,
    private readonly options: PollingDaemonOptions
  ) {
    if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 1000) {
      throw new Error("pollIntervalMs must be greater than or equal to 1000.");
    }
    this.sleep = options.sleep ?? sleep;
    this.logger = options.logger ?? (() => undefined);
  }

  async start(): Promise<void> {
    let cycle = 0;
    this.logger({
      status: "daemon_started",
      pollIntervalSeconds: this.options.pollIntervalMs / 1000
    });

    while (!this.options.signal?.aborted) {
      cycle += 1;
      this.logger({
        status: "poll_started",
        cycle
      });

      try {
        const result = await this.orchestrator.runOnce({
          onIssueStarted: this.options.onIssueStarted,
          onIssueCompleted: this.options.onIssueCompleted,
          onIssueFailed: this.options.onIssueFailed,
          onRunStateUpdated: this.options.onRunStateUpdated,
          onWarning: this.options.onWarning
        });
        this.logger({
          status: "poll_completed",
          cycle,
          totalIssues: result.totalIssues,
          activeIssues: result.activeIssues,
          eligibleIssues: result.eligibleIssues,
          processedIssues: result.processedIssues
        });
      } catch (error) {
        this.logger({
          status: "poll_failed",
          cycle,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (this.options.maxCycles !== undefined && cycle >= this.options.maxCycles) {
        break;
      }
      await this.sleep(this.options.pollIntervalMs, this.options.signal);
    }

    this.logger({
      status: "daemon_stopped",
      cycles: cycle
    });
  }
}

export async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
