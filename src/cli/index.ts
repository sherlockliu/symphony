#!/usr/bin/env node
import { loadWorkflow } from "../workflow/load.js";
import { redactSecrets } from "../logging/redact.js";
import { filterActiveIssues } from "../trackers/mockTracker.js";
import { renderPrompt } from "../templates/promptRenderer.js";
import { GitService } from "../git/gitService.js";
import { WorkspaceManager } from "../workspaces/workspaceManager.js";
import { createAgentRunner } from "../agents/createAgentRunner.js";
import { GitHubPullRequestService } from "../github/pullRequestService.js";
import { createTracker } from "../trackers/createTracker.js";
import type { Issue, WorkflowConfig } from "../types.js";

type Command = "validate" | "dry-run" | "run";

async function main(argv: string[]): Promise<number> {
  const [command, workflowPath] = argv;
  if (!isCommand(command) || workflowPath === undefined) {
    printUsage();
    return 1;
  }

  try {
    if (command === "validate") {
      await validateCommand(workflowPath);
      return 0;
    }
    if (command === "dry-run") {
      await dryRunCommand(workflowPath);
      return 0;
    }
    await runCommand(workflowPath);
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
  const tracker = createTracker(config);
  const workspaceManager = new WorkspaceManager(config);
  const git = new GitService(config);
  const runner = createAgentRunner(config);
  const pullRequests = new GitHubPullRequestService(config);
  const issues = await tracker.listIssues();
  const activeIssues = filterActiveIssues(issues, config.states.active);

  for (const issue of activeIssues.slice(0, config.limits.maxConcurrency)) {
    const workspace = await workspaceManager.createIssueWorkspace(issue);
    const gitPlan = await git.prepareRepository(issue, workspace);
    const prompt = renderPrompt(definition.promptTemplate, { issue, config });
    const agentResult = await runner.run({ issue, workspace, prompt });
    const pullRequestResult = agentResult.success
      ? await pullRequests.createDraftPullRequest({
          issue,
          workspace,
          branchName: gitPlan.branchName,
          baseBranch: config.repository.baseBranch
        })
      : {
          created: false,
          url: null,
          skippedReason: "agent_failed",
          changed: false,
          logPaths: []
        };
    const trackerResult = await updateTrackerAfterPullRequest(tracker, issue, pullRequestResult.url);
    console.log(redactSecrets({
      status: agentResult.success ? "completed" : "failed",
      issue: issue.identifier,
      workspace: workspace.path,
      repo: workspace.repoPath,
      branch: gitPlan.branchName,
      runner: agentResult.runner,
      exitCode: agentResult.exitCode,
      timedOut: agentResult.timedOut,
      logPath: agentResult.logPath,
      pullRequest: pullRequestResult,
      tracker: trackerResult,
      next: "Symphony never merges PRs"
    }));
  }

  if (activeIssues.length === 0) {
    console.log(redactSecrets({
      status: "idle",
      message: "no active mock issues found"
    }));
  }
}

function isCommand(value: string | undefined): value is Command {
  return value === "validate" || value === "dry-run" || value === "run";
}

function printUsage(): void {
  console.error("Usage: orchestrator <validate|dry-run|run> ./WORKFLOW.md");
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
  return tracker;
}

async function updateTrackerAfterPullRequest(
  tracker: ReturnType<typeof createTracker>,
  issue: Issue,
  prUrl: string | null
): Promise<Record<string, unknown>> {
  if (prUrl === null) {
    return {
      commented: false,
      transitioned: false,
      skippedReason: "no_pr_created"
    };
  }
  if (tracker.addPullRequestComment === undefined || tracker.transitionToHumanReview === undefined) {
    return {
      commented: false,
      transitioned: false,
      skippedReason: "tracker_writeback_not_supported"
    };
  }

  await tracker.addPullRequestComment(issue, prUrl);
  await tracker.transitionToHumanReview(issue);
  return {
    commented: true,
    transitioned: true
  };
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
