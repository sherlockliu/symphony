import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DryRunAgentRunner } from "../agents/dryRunAgentRunner.js";
import { AgentRunnerFactory } from "../agents/agentRunnerFactory.js";
import { DefaultGitHubOutputService, type GitHubOutputService } from "./githubOutput.js";
import { renderPrompt } from "../templates/promptRenderer.js";
import { MockTrackerAdapter } from "../trackers/mockTracker.js";
import { LocalWorkspaceManager } from "../workspaces/localWorkspaceManager.js";
import type { Issue } from "../types.js";
import type {
  AgentRun,
  AgentRunner,
  RunEvent,
  TrackedIssue,
  WorkflowConfig
} from "./domain.js";
import { RunStatus } from "./domain.js";

export interface MvpWorkflow {
  config: WorkflowConfig;
  promptTemplate: string;
  configHash: string;
}

export interface MvpTrackerAdapter {
  fetchCandidateIssues(): Promise<Array<TrackedIssue | Issue>>;
  commentOnIssue?(issueId: string, body: string): Promise<void>;
  transitionIssue?(issueId: string, state: string): Promise<void>;
}

export interface OrchestratorOptions {
  baseDir?: string;
  runsFilePath?: string;
  tracker?: MvpTrackerAdapter;
  workspaceManager?: LocalWorkspaceManager;
  agentRunner?: AgentRunner;
  agentRunnerFactory?: AgentRunnerFactory;
  githubOutput?: GitHubOutputService;
  now?: () => Date;
}

export interface PersistedRunRecord {
  run: AgentRun;
  events: RunEvent[];
  result?: {
    status: string;
    summary: string;
    changedFiles: string[];
    prUrl: string | null;
  };
}

export interface RunOnceResult {
  fetchedIssues: number;
  eligibleIssues: number;
  processedRuns: AgentRun[];
  events: RunEvent[];
  runsFilePath: string;
}

export class Orchestrator {
  private readonly baseDir: string;
  private readonly runsFilePath: string;
  private readonly workspaceManager: LocalWorkspaceManager;
  private readonly agentRunnerFactory: AgentRunnerFactory;
  private readonly githubOutput: GitHubOutputService;
  private readonly now: () => Date;
  private readonly tracker: MvpTrackerAdapter;

  constructor(
    private readonly workflow: MvpWorkflow,
    options: OrchestratorOptions = {}
  ) {
    this.baseDir = options.baseDir ?? process.cwd();
    this.runsFilePath = options.runsFilePath ?? path.resolve(this.baseDir, ".orchestrator", "runs.json");
    this.workspaceManager = options.workspaceManager ?? new LocalWorkspaceManager({ now: options.now });
    this.agentRunnerFactory = options.agentRunnerFactory ?? new AgentRunnerFactory();
    this.githubOutput = options.githubOutput ?? new DefaultGitHubOutputService();
    this.now = options.now ?? (() => new Date());
    this.tracker = options.tracker ?? this.createTracker();
    this.agentRunner = options.agentRunner;
  }

  private readonly agentRunner: AgentRunner | undefined;

  async runOnce(): Promise<RunOnceResult> {
    const fetched = await this.tracker.fetchCandidateIssues();
    const events: RunEvent[] = [];
    const processedRuns: AgentRun[] = [];
    const seenIssueIds = new Set<string>();
    const eligibleIssues = fetched
      .map((issue) => toTrackedIssue(issue, this.workflow.config.tracker.kind))
      .filter((issue) => {
        if (seenIssueIds.has(issue.id)) {
          return false;
        }
        seenIssueIds.add(issue.id);
        return this.workflow.config.states.eligible.includes(issue.state);
      });

    const selectedIssues = eligibleIssues.slice(0, this.workflow.config.agent.maxConcurrentAgents);
    for (const issue of selectedIssues) {
      const runEvents: RunEvent[] = [];
      const run = this.createRun(issue);
      processedRuns.push(run);
      this.recordEvent(runEvents, "issue_fetched", `Fetched ${issue.identifier}.`, run.id, { issueId: issue.id });
      this.recordEvent(runEvents, "issue_eligible", `${issue.identifier} is eligible.`, run.id);

      try {
        run.status = RunStatus.PREPARING_WORKSPACE;
        const workspace = await this.workspaceManager.prepareWorkspace(issue, this.workflow.config, run, this.workflow.configHash);
        run.workspacePath = workspace.workspacePath;
        run.branchName = workspace.branchName;
        this.recordEvent(runEvents, "workspace_created", `Workspace created at ${workspace.workspacePath}.`, run.id);

        const prompt = renderPrompt(this.workflow.promptTemplate, { issue, config: this.workflow.config, run });
        this.recordEvent(runEvents, "prompt_rendered", `Prompt rendered for ${issue.identifier}.`, run.id);

        run.status = RunStatus.RUNNING_AGENT;
        this.recordEvent(runEvents, "agent_started", `Agent started for ${issue.identifier}.`, run.id);
        const agentResult = await (this.agentRunner ?? this.agentRunnerFactory.create(this.workflow.config)).run({
          issue,
          workflow: this.workflow.config,
          workspacePath: workspace.workspacePath,
          prompt
        });

        if (agentResult.status !== "success") {
          throw new Error(agentResult.errorMessage ?? agentResult.summary);
        }

        run.status = RunStatus.AGENT_COMPLETED;
        this.recordEvent(runEvents, "agent_completed", agentResult.summary, run.id, {
          changedFiles: agentResult.changedFiles,
          prUrl: agentResult.prUrl
        });

        const githubOutput = await this.githubOutput.attachPullRequest({
          issue,
          run,
          agentResult,
          workflow: this.workflow.config,
          workspace
        });
        if (githubOutput.branchName !== null) {
          run.branchName = githubOutput.branchName;
        }
        if (githubOutput.prUrl !== null) {
          run.prUrl = githubOutput.prUrl;
          run.status = RunStatus.PR_CREATED;
          this.recordEvent(runEvents, githubOutput.created ? "pr_created" : "pr_found", `Pull request ready: ${githubOutput.prUrl}`, run.id, {
            prUrl: githubOutput.prUrl,
            commitCount: githubOutput.commitCount
          });
        }

        if (this.workflow.config.safety.allowTicketTransitions && this.tracker.commentOnIssue !== undefined) {
          const comment = run.prUrl === null
            ? agentResult.summary
            : `Draft pull request is ready for human review: ${run.prUrl}`;
          await this.tracker.commentOnIssue(issue.id, comment);
          this.recordEvent(runEvents, "tracker_commented", `Commented result on ${issue.identifier}.`, run.id);
        }

        if (this.workflow.config.safety.allowTicketTransitions && this.tracker.transitionIssue !== undefined) {
          await this.tracker.transitionIssue(issue.id, this.workflow.config.states.humanReview);
          run.status = RunStatus.NEEDS_HUMAN_REVIEW;
          this.recordEvent(runEvents, "tracker_transitioned", `Transitioned ${issue.identifier} to ${this.workflow.config.states.humanReview}.`, run.id);
        }

        await this.appendRunRecord({ run, events: runEvents, result: { ...agentResult, prUrl: run.prUrl } });
      } catch (error) {
        run.status = RunStatus.FAILED;
        run.errorMessage = error instanceof Error ? error.message : String(error);
        this.recordEvent(runEvents, "run_failed", run.errorMessage, run.id);
        await this.appendRunRecord({ run, events: runEvents });
      }
      events.push(...runEvents);
    }

    return {
      fetchedIssues: fetched.length,
      eligibleIssues: eligibleIssues.length,
      processedRuns,
      events,
      runsFilePath: this.runsFilePath
    };
  }

  private createRun(issue: TrackedIssue): AgentRun {
    return {
      id: randomUUID(),
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      status: RunStatus.QUEUED,
      workspacePath: null,
      branchName: null,
      agentKind: this.workflow.config.agent.kind,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      retryCount: 0,
      prUrl: null,
      errorMessage: null
    };
  }

  private createTracker(): MvpTrackerAdapter {
    const tracker = this.workflow.config.tracker;
    if (tracker.kind !== "mock") {
      throw new Error(`MVP orchestrator only supports tracker.kind mock. Received: ${tracker.kind}.`);
    }
    const issuesFile = tracker.issuesFile ?? tracker.issueFile;
    if (issuesFile === undefined) {
      throw new Error("tracker.issuesFile is required for the MVP mock orchestrator.");
    }
    return new MockTrackerAdapter({
      issuesFile: path.resolve(this.baseDir, issuesFile),
      eventsFile: tracker.eventsFile === undefined ? undefined : path.resolve(this.baseDir, tracker.eventsFile),
      humanReviewState: this.workflow.config.states.humanReview
    });
  }

  private recordEvent(
    events: RunEvent[],
    type: string,
    message: string,
    runId = "workflow",
    metadata: Record<string, unknown> = {}
  ): void {
    events.push({
      id: randomUUID(),
      runId,
      type,
      message,
      timestamp: this.now().toISOString(),
      metadata
    });
  }

  private async appendRunRecord(record: PersistedRunRecord): Promise<void> {
    const existing = await this.readRunRecords();
    existing.push({
      ...record,
      run: {
        ...record.run,
        finishedAt: this.now().toISOString()
      }
    });
    await mkdir(path.dirname(this.runsFilePath), { recursive: true });
    await writeFile(this.runsFilePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  }

  private async readRunRecords(): Promise<PersistedRunRecord[]> {
    try {
      const source = await readFile(this.runsFilePath, "utf8");
      const parsed = JSON.parse(source) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Run store must contain a JSON array: ${this.runsFilePath}.`);
      }
      return parsed as PersistedRunRecord[];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

function toTrackedIssue(issue: TrackedIssue | Issue, trackerKind: string): TrackedIssue {
  if ("trackerKind" in issue) {
    return issue;
  }
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
    trackerKind: trackerKind === "mock" || trackerKind === "jira" || trackerKind === "plane" ? trackerKind : "mock",
    state: issue.state,
    priority: issue.priority,
    labels: issue.labels,
    assignee: null,
    raw: issue
  };
}

export function createDryRunWorkflowForTests(config: WorkflowConfig, promptTemplate: string, configHash: string): MvpWorkflow {
  return { config, promptTemplate, configHash };
}
