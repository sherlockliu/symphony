#!/usr/bin/env node
import { loadWorkflow } from "../workflow/load.js";
import { redactSecrets } from "../logging/redact.js";
import { filterActiveIssues } from "../trackers/mockTracker.js";
import { renderPrompt } from "../templates/promptRenderer.js";
import { GitService } from "../git/gitService.js";
import { WorkspaceManager } from "../workspaces/workspaceManager.js";
import { GitHubPullRequestService } from "../github/pullRequestService.js";
import { createTracker } from "../trackers/createTracker.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { PollingDaemon } from "../daemon/pollingDaemon.js";
import { DashboardStatusStore, isDashboardLocalHost } from "../dashboard/statusStore.js";
import { startDashboardServer, type RunningDashboardServer } from "../dashboard/server.js";
import { InMemoryRunStateStore } from "../state/runStateStore.js";
import type { WorkflowConfig } from "../types.js";

type Command = "validate" | "dry-run" | "run" | "daemon";

interface CliOptions {
  maxCycles?: number;
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
      await runCommand(workflowPath);
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
    daemon: config.daemon,
    dashboard: config.dashboard,
    retry: config.retry,
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

async function runCommand(workflowPath: string): Promise<void> {
  const { definition, config } = await loadWorkflow(workflowPath);
  const result = await new Orchestrator(definition, config).runOnce({
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

async function daemonCommand(workflowPath: string, cliOptions: CliOptions = {}): Promise<void> {
  const { definition, config } = await loadWorkflow(workflowPath);
  const abortController = new AbortController();
  const statusStore = new DashboardStatusStore(config);
  const runStateStore = new InMemoryRunStateStore();
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

    const daemon = new PollingDaemon(new Orchestrator(definition, config, { stateStore: runStateStore }), {
      pollIntervalMs: (config.daemon?.pollIntervalSeconds ?? 60) * 1000,
      signal: abortController.signal,
      maxCycles: cliOptions.maxCycles,
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
  return value === "validate" || value === "dry-run" || value === "run" || value === "daemon";
}

function printUsage(): void {
  console.error([
    "Usage: orchestrator <validate|dry-run|run|daemon> ./WORKFLOW.md [options]",
    "",
    "Options:",
    "  --max-cycles <n>   Stop daemon mode after n polling cycles.",
    "",
    "Examples:",
    "  orchestrator validate examples/WORKFLOW.quickstart.mock.md",
    "  orchestrator dry-run examples/WORKFLOW.quickstart.mock.md",
    "  orchestrator daemon examples/WORKFLOW.dashboard.mock.example.md"
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
    throw new Error(`Unknown option: ${arg}. Run without arguments to see usage.`);
  }
  return options;
}

function redactTrackerForOutput(tracker: WorkflowConfig["tracker"]): Record<string, unknown> {
  if (tracker.kind === "jira") {
    return {
      kind: tracker.kind,
      baseUrl: tracker.baseUrl,
      email: tracker.email,
      apiToken: "[REDACTED]",
      jql: tracker.jql,
      maxResults: tracker.maxResults,
      reviewTransition: tracker.reviewTransition
    };
  }
  if (tracker.kind === "plane") {
    return {
      kind: tracker.kind,
      baseUrl: tracker.baseUrl,
      apiKey: "[REDACTED]",
      workspaceSlug: tracker.workspaceSlug,
      projectId: tracker.projectId,
      maxResults: tracker.maxResults,
      reviewState: tracker.reviewState
    };
  }
  return { ...tracker };
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
