#!/usr/bin/env node
import path from "node:path";
import { createHash } from "node:crypto";
import { loadWorkflow } from "../workflow/load.js";
import { loadWorkflowFromFile as loadCoreWorkflowFromFile } from "../workflow/workflowLoader.js";
import { redactSecrets } from "../logging/redact.js";
import { collectConfigWarnings } from "../security/configWarnings.js";
import { filterActiveIssues } from "../trackers/tracker.js";
import { renderPrompt } from "../templates/promptRenderer.js";
import { GitService } from "../git/gitService.js";
import { WorkspaceManager } from "../workspaces/workspaceManager.js";
import { GitHubPullRequestService } from "../github/pullRequestService.js";
import { createTracker } from "../trackers/createTracker.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { Orchestrator as CoreOrchestrator } from "../core/orchestrator.js";
import { PollingDaemon } from "../daemon/pollingDaemon.js";
import { DashboardStatusStore, isDashboardLocalHost } from "../dashboard/statusStore.js";
import { startDashboardServer, type RunningDashboardServer } from "../dashboard/server.js";
import { startApiServer, type RunningApiServer } from "../server/api.js";
import { createRunStateStore } from "../state/createRunStateStore.js";
import { isStaleRecoverableState } from "../state/runStateStore.js";
import type { WorkflowConfig } from "../types.js";
import type { MvpWorkflow } from "../core/orchestrator.js";
import type { WorkflowConfig as CoreWorkflowConfig } from "../core/domain.js";

type Command = "validate" | "dry-run" | "run" | "daemon" | "api";

interface CliOptions {
  maxCycles?: number;
  once?: boolean;
  poll?: boolean;
  host?: string;
  port?: number;
}

async function main(argv: string[]): Promise<number> {
  const [command, workflowPath, ...optionArgs] = argv;
  if (!isCommand(command) || workflowPath === undefined) {
    printUsage();
    return 1;
  }

  try {
    const options = parseOptions(optionArgs);
    if (command === "validate") {
      await validateCommand(workflowPath);
      return 0;
    }
    if (command === "dry-run") {
      await dryRunCommand(workflowPath);
      return 0;
    }
    if (command === "run") {
      await runCommand(workflowPath, options);
      return 0;
    }
    if (command === "api") {
      await apiCommand(workflowPath, options);
      return 0;
    }
    await daemonCommand(workflowPath, options);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecrets(message));
    return 1;
  }
}

async function apiCommand(workflowPath: string, options: CliOptions = {}): Promise<void> {
  const resolvedWorkflowPath = path.resolve(workflowPath);
  const workflow = await loadWorkflowForApi(resolvedWorkflowPath);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4001;
  let server: RunningApiServer | null = null;
  const stop = (): void => {
    void server?.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    server = await startApiServer({
      workflow,
      workflowPath: resolvedWorkflowPath,
      baseDir: path.dirname(resolvedWorkflowPath),
      staticUiDir: path.resolve(process.cwd(), "dist-ui")
    }, { host, port });
    console.log(redactSecrets({
      status: "api_started",
      url: server.url,
      health: `${server.url}/api/health`
    }));
    await new Promise(() => {});
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function validateCommand(workflowPath: string): Promise<void> {
  const { config } = await loadWorkflow(workflowPath);
  console.log(redactSecrets({
    status: "valid",
    tracker: redactTrackerForOutput(config.tracker),
    workspaceRoot: config.workspace.root,
    repositoryUrl: config.repository.url,
    baseBranch: config.repository.baseBranch,
    cloneDir: config.repository.cloneDir,
    branchPrefix: config.branch.prefix,
    agent: config.agent,
    github: config.github,
    state: redactStateForOutput(config.state),
    daemon: config.daemon,
    dashboard: config.dashboard,
    retry: config.retry,
    safety: config.safety,
    warnings: collectConfigWarnings(config),
    maxConcurrency: config.limits.maxConcurrency
  }));
}

async function dryRunCommand(workflowPath: string): Promise<void> {
  const { definition, config } = await loadWorkflow(workflowPath);
  const tracker = createTracker(config);
  const workspaceManager = new WorkspaceManager(config);
  const git = new GitService(config);
  const pullRequests = new GitHubPullRequestService(config);
  const issues = await tracker.listIssues();
  const activeIssues = filterActiveIssues(issues, config.states.active);

  console.log(`dry-run: ${activeIssues.length} active issue(s), ${issues.length} total tracker issue(s)`);
  for (const issue of activeIssues) {
    const workspace = workspaceManager.planIssueWorkspace(issue);
    const gitPlan = git.planPreparation(issue, workspace);
    const prompt = renderPrompt(definition.promptTemplate, { issue, config });
    console.log(redactSecrets([
      `\n--- ${issue.identifier}: ${issue.title} ---`,
      `workspace: ${workspace.path}`,
      `repo: ${workspace.repoPath}`,
      `branch: ${gitPlan.branchName}`,
      `agent: ${config.agent.kind}`,
      `timeout_seconds: ${config.agent.timeoutSeconds}`,
      `log_dir: ${config.agent.logDir}`,
      "git commands:",
      ...gitPlan.commands.map((command) => `  ${command}`),
      "pull request commands if agent changes files:",
      ...pullRequests.planCommands(issue, gitPlan.branchName).map((command) => `  ${command}`),
      "",
      prompt
    ].join("\n")));
  }
}

async function runCommand(workflowPath: string, options: CliOptions = {}): Promise<void> {
  if (options.poll) {
    await daemonCommand(workflowPath, options);
    return;
  }
  if (options.once) {
    await coreRunOnceCommand(workflowPath);
    return;
  }

  let workflow: Awaited<ReturnType<typeof loadWorkflow>>;
  try {
    workflow = await loadWorkflow(workflowPath);
  } catch (runtimeError) {
    try {
      await coreRunOnceCommand(workflowPath);
      return;
    } catch {
      throw runtimeError;
    }
  }

  const { definition, config } = workflow;
  const runStateStore = await createRunStateStore(config);
  const result = await new Orchestrator(definition, config, { stateStore: runStateStore }).runOnce({
    onWarning: (message) => {
      console.error(redactSecrets(`Warning: ${message}`));
    }
  });

  for (const issueResult of result.results) {
    console.log(redactSecrets(issueResult));
  }

  if (result.activeIssues === 0) {
    console.log(redactSecrets({
      status: "idle",
      message: "no active mock issues found"
    }));
  }
}

async function coreRunOnceCommand(workflowPath: string): Promise<void> {
  const resolvedWorkflowPath = path.resolve(workflowPath);
  const workflow = await loadCoreWorkflowFromFile(resolvedWorkflowPath);
  const result = await new CoreOrchestrator(workflow, {
    baseDir: path.dirname(resolvedWorkflowPath)
  }).runOnce();

  console.log(redactSecrets({
    status: "completed",
    mode: "core-mvp-once",
    fetchedIssues: result.fetchedIssues,
    eligibleIssues: result.eligibleIssues,
    processedRuns: result.processedRuns.map((run) => ({
      id: run.id,
      issue: run.issueIdentifier,
      status: run.status,
      workspacePath: run.workspacePath,
      branchName: run.branchName,
      errorMessage: run.errorMessage
    })),
    runsFilePath: result.runsFilePath
  }));
}

async function daemonCommand(workflowPath: string, cliOptions: CliOptions = {}): Promise<void> {
  const { definition, config } = await loadWorkflow(workflowPath);
  const abortController = new AbortController();
  const statusStore = new DashboardStatusStore(config);
  const runStateStore = await createRunStateStore(config);
  const unfinishedBeforeRecovery = await runStateStore.listUnfinished();
  const staleBeforeRecovery = unfinishedBeforeRecovery.filter((state) => isStaleRecoverableState(state.state));
  await runStateStore.markStaleRuns(new Date());
  const firstCycleExcludeIssueIds = new Set(staleBeforeRecovery.map((state) => state.trackerIssueId));
  let dashboardServer: RunningDashboardServer | null = null;
  const stop = (): void => {
    abortController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (config.dashboard.enabled) {
      if (!isDashboardLocalHost(config.dashboard.host)) {
        console.error(redactSecrets(
          `Warning: dashboard host ${config.dashboard.host} is not 127.0.0.1 or localhost. Do not expose this dashboard publicly.`
        ));
      }
      dashboardServer = await startDashboardServer(statusStore, config.dashboard);
      console.log(redactSecrets({
        status: "dashboard_started",
        url: dashboardServer.url,
        host: config.dashboard.host,
        port: config.dashboard.port
      }));
    }

    console.log(redactSecrets({
      status: "startup_recovery",
      state: redactStateForOutput(config.state),
      unfinishedRuns: unfinishedBeforeRecovery.length,
      recoveredStaleRuns: staleBeforeRecovery.length,
      firstCycleExcludedIssues: firstCycleExcludeIssueIds.size
    }));

    const daemon = new PollingDaemon(new Orchestrator(definition, config, { stateStore: runStateStore }), {
      pollIntervalMs: (config.daemon?.pollIntervalSeconds ?? 60) * 1000,
      signal: abortController.signal,
      maxCycles: cliOptions.maxCycles,
      firstCycleExcludeIssueIds,
      onRunStateUpdated: (state) => {
        statusStore.recordRunState(state);
      },
      onIssueStarted: (issue) => {
        statusStore.recordIssueStarted(issue);
      },
      onIssueCompleted: (summary) => {
        statusStore.recordIssueCompleted(summary);
      },
      onIssueFailed: (issue, error) => {
        statusStore.recordIssueFailed(issue, error);
      },
      onWarning: (message) => {
        console.error(redactSecrets(`Warning: ${message}`));
      },
      logger: (event) => {
        statusStore.recordDaemonEvent(event);
        console.log(redactSecrets(event));
      }
    });
    await daemon.start();
  } finally {
    if (dashboardServer !== null) {
      await dashboardServer.close();
    }
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function isCommand(value: string | undefined): value is Command {
  return value === "validate" || value === "dry-run" || value === "run" || value === "daemon" || value === "api";
}

function printUsage(): void {
  console.error([
    "Usage: orchestrator <validate|dry-run|run|daemon|api> ./WORKFLOW.md [options]",
    "",
    "Options:",
    "  --once             Use the local MVP domain orchestrator for one dry-run cycle.",
    "  --poll             Use the daemon polling loop from run mode.",
    "  --max-cycles <n>   Stop daemon mode after n polling cycles.",
    "  --host <host>      Host for api mode. Defaults to 127.0.0.1.",
    "  --port <port>      Port for api mode. Defaults to 4001.",
    "",
    "Examples:",
    "  orchestrator validate examples/WORKFLOW.quickstart.mock.md",
    "  orchestrator dry-run examples/WORKFLOW.quickstart.mock.md",
    "  orchestrator run examples/WORKFLOW.quickstart.mock.md --poll",
    "  orchestrator daemon examples/WORKFLOW.dashboard.mock.example.md",
    "  orchestrator run ./WORKFLOW.example.md --once"
  ].join("\n"));
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--max-cycles") {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error("--max-cycles requires a positive integer value.");
      }
      const maxCycles = Number(raw);
      if (!Number.isInteger(maxCycles) || maxCycles < 1) {
        throw new Error("--max-cycles must be a positive integer.");
      }
      options.maxCycles = maxCycles;
      index += 1;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--poll") {
      options.poll = true;
      continue;
    }
    if (arg === "--host") {
      const host = args[index + 1];
      if (host === undefined || host.trim() === "") {
        throw new Error("--host requires a non-empty value.");
      }
      options.host = host;
      index += 1;
      continue;
    }
    if (arg === "--port") {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error("--port requires an integer value.");
      }
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be an integer between 1 and 65535.");
      }
      options.port = port;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}. Run without arguments to see usage.`);
  }
  return options;
}

function redactTrackerForOutput(tracker: WorkflowConfig["tracker"]): Record<string, unknown> {
  if (tracker.kind === "jira") {
    return {
      kind: tracker.kind,
      baseUrl: tracker.baseUrl,
      emailEnv: tracker.emailEnv,
      apiTokenEnv: tracker.apiTokenEnv,
      jql: tracker.jql,
      readyStates: tracker.readyStates,
      maxResults: tracker.maxResults,
      reviewState: tracker.reviewState
    };
  }
  if (tracker.kind === "plane") {
    return {
      kind: tracker.kind,
      baseUrl: tracker.baseUrl,
      apiTokenEnv: tracker.apiTokenEnv,
      workspaceSlug: tracker.workspaceSlug,
      projectId: tracker.projectId,
      readyStates: tracker.readyStates,
      maxResults: tracker.maxResults,
      reviewState: tracker.reviewState
    };
  }
  if (tracker.kind === "github-issues") {
    return {
      kind: tracker.kind,
      owner: tracker.owner,
      repo: tracker.repo,
      token: "[REDACTED]",
      labels: tracker.labels,
      humanReviewLabel: tracker.humanReviewLabel,
      closedStates: tracker.closedStates,
      removeCandidateLabelsOnReview: tracker.removeCandidateLabelsOnReview,
      maxResults: tracker.maxResults
    };
  }
  return { ...tracker };
}

function redactStateForOutput(state: WorkflowConfig["state"]): Record<string, unknown> {
  if (state.kind === "postgres") {
    return {
      kind: "postgres",
      connectionString: "[REDACTED]",
      lockTtlSeconds: state.lockTtlSeconds
    };
  }
  if (state.kind === "json") {
    return {
      kind: "json",
      filePath: state.filePath
    };
  }
  return { kind: "memory" };
}

async function loadWorkflowForApi(workflowPath: string): Promise<MvpWorkflow> {
  try {
    return await loadCoreWorkflowFromFile(workflowPath);
  } catch (coreError) {
    try {
      const runtimeWorkflow = await loadWorkflow(workflowPath);
      return mvpWorkflowFromRuntime(runtimeWorkflow.definition.promptTemplate, runtimeWorkflow.config);
    } catch {
      throw coreError;
    }
  }
}

function mvpWorkflowFromRuntime(promptTemplate: string, config: WorkflowConfig): MvpWorkflow {
  const coreConfig: CoreWorkflowConfig = {
    tracker: coreTrackerFromRuntime(config.tracker),
    repository: {
      url: config.repository.url,
      defaultBranch: config.repository.baseBranch,
      branchNamePattern: `${config.branch.prefix}/{{ issue.identifier }}`
    },
    workspace: {
      root: config.workspace.root,
      cleanupPolicy: "never"
    },
    agent: {
      kind: config.agent.kind,
      command: "command" in config.agent && typeof config.agent.command === "string" ? config.agent.command : config.agent.kind,
      maxConcurrentAgents: config.limits.maxConcurrency,
      maxTurns: "maxTurns" in config.agent && typeof config.agent.maxTurns === "number" ? config.agent.maxTurns : 20,
      timeoutSeconds: config.agent.timeoutSeconds
    },
    polling: {
      enabled: true,
      intervalSeconds: config.daemon?.pollIntervalSeconds ?? 60
    },
    states: {
      eligible: config.states.active,
      terminal: config.states.terminal,
      humanReview: "reviewState" in config.tracker && typeof config.tracker.reviewState === "string"
        ? config.tracker.reviewState
        : "Human Review"
    },
    safety: {
      requireHumanReview: true,
      allowAutoMerge: false,
      allowTicketTransitions: true,
      allowPrCreation: true,
      redactSecrets: true,
      maxConcurrentRuns: config.limits.maxConcurrency
    }
  };
  return {
    config: coreConfig,
    promptTemplate,
    configHash: createHash("sha256").update(JSON.stringify(config)).digest("hex")
  };
}

function coreTrackerFromRuntime(tracker: WorkflowConfig["tracker"]): CoreWorkflowConfig["tracker"] {
  if (tracker.kind === "mock") {
    const mock = tracker as { issueFile?: string; eventsFile?: string };
    return {
      kind: "mock",
      issueFile: mock.issueFile,
      issuesFile: mock.issueFile,
      eventsFile: mock.eventsFile
    };
  }
  if (tracker.kind === "jira") {
    const jira = tracker as {
      baseUrl: string;
      emailEnv: string;
      apiTokenEnv: string;
      jql: string;
      readyStates: string[];
      reviewState: string;
      maxResults?: number;
    };
    return {
      kind: "jira",
      baseUrl: jira.baseUrl,
      emailEnv: jira.emailEnv,
      apiTokenEnv: jira.apiTokenEnv,
      jql: jira.jql,
      readyStates: jira.readyStates,
      reviewState: jira.reviewState,
      maxResults: jira.maxResults
    };
  }
  if (tracker.kind === "plane") {
    const plane = tracker as {
      baseUrl: string;
      apiTokenEnv: string;
      workspaceSlug: string;
      projectId: string;
      readyStates: string[];
      reviewState: string;
      maxResults?: number;
    };
    return {
      kind: "plane",
      baseUrl: plane.baseUrl,
      apiTokenEnv: plane.apiTokenEnv,
      workspaceSlug: plane.workspaceSlug,
      projectId: plane.projectId,
      readyStates: plane.readyStates,
      reviewState: plane.reviewState,
      maxResults: plane.maxResults
    };
  }
  return {
    kind: "mock",
    issuesFile: undefined,
    issueFile: undefined
  };
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
