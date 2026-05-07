import path from "node:path";
import type { Issue, PullRequestRequest, PullRequestResult, WorkflowConfig } from "../types.js";
import { sanitizePathSegment } from "../workspaces/pathSafety.js";
import { NodeProcessExecutor, type ProcessExecutor, type ProcessResult } from "../agents/processExecutor.js";

export interface PullRequestService {
  createDraftPullRequest(request: PullRequestRequest): Promise<PullRequestResult>;
}

export class GitHubPullRequestService implements PullRequestService {
  constructor(
    private readonly config: WorkflowConfig,
    private readonly executor: ProcessExecutor = new NodeProcessExecutor()
  ) {}

  planCommands(issue: Issue, branchName: string): string[] {
    return [
      "git status --porcelain",
      "git add -A",
      `git commit -m ${quote(commitMessage(issue))}`,
      `git push -u ${this.config.github.remote} ${branchName}`,
      [
        "gh pr create",
        "--draft",
        `--base ${this.config.repository.baseBranch}`,
        `--head ${branchName}`,
        `--title ${quote(prTitle(issue))}`,
        `--body ${quote(prBody(issue))}`
      ].join(" ")
    ];
  }

  async createDraftPullRequest(request: PullRequestRequest): Promise<PullRequestResult> {
    const logPaths: string[] = [];
    const status = await this.runGitHubCommand(request, "git-status", ["git", "status", "--porcelain"], "");
    logPaths.push(status.logPath);
    const changed = status.result.stdout.trim().length > 0;

    if (!changed) {
      return {
        created: false,
        url: null,
        skippedReason: "no_changes",
        changed,
        logPaths
      };
    }

    const commands = [
      { name: "git-add", args: ["git", "add", "-A"] },
      { name: "git-commit", args: ["git", "commit", "-m", commitMessage(request.issue)] },
      { name: "git-push", args: ["git", "push", "-u", this.config.github.remote, request.branchName] },
      {
        name: "gh-pr-create",
        args: [
          "gh",
          "pr",
          "create",
          "--draft",
          "--base",
          request.baseBranch,
          "--head",
          request.branchName,
          "--title",
          prTitle(request.issue),
          "--body",
          prBody(request.issue)
        ]
      }
    ];

    let prUrl: string | null = null;
    for (const command of commands) {
      const { result, logPath } = await this.runGitHubCommand(request, command.name, command.args, "");
      logPaths.push(logPath);
      if (command.name === "gh-pr-create") {
        prUrl = result.stdout.trim().split(/\s+/).find((part) => part.startsWith("http")) ?? null;
      }
    }

    return {
      created: true,
      url: prUrl,
      skippedReason: null,
      changed,
      logPaths
    };
  }

  private async runGitHubCommand(
    request: PullRequestRequest,
    name: string,
    args: string[],
    input: string
  ): Promise<{ result: ProcessResult; logPath: string }> {
    const logPath = path.join(
      this.config.github.logDir,
      `${sanitizePathSegment(request.issue.identifier)}-${name}.log`
    );
    const result = await this.executor.execute({
      command: args[0]!,
      args: args.slice(1),
      cwd: request.workspace.repoPath,
      input,
      timeoutMs: 120_000,
      logPath
    });

    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(`${args.join(" ")} failed with exit code ${result.exitCode ?? "null"}. See ${logPath}.`);
    }

    return { result, logPath };
  }
}

function commitMessage(issue: Issue): string {
  return `${issue.identifier}: ${issue.title}`;
}

function prTitle(issue: Issue): string {
  return `${issue.identifier}: ${issue.title}`;
}

function prBody(issue: Issue): string {
  const lines = [
    `Implements ${issue.identifier}.`,
    "",
    issue.url === null ? null : `Issue: ${issue.url}`,
    "",
    "Created by Symphony. This PR is intentionally draft-only and will never be merged automatically."
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

function quote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
