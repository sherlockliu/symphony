import path from "node:path";
import { NodeProcessExecutor, type ProcessExecutor } from "../agents/processExecutor.js";
import { redactSecrets } from "../logging/redact.js";
import type { AgentRun, AgentRunResult, TrackedIssue, WorkflowConfig, WorkspacePlan } from "./domain.js";

export interface GitHubOutputRequest {
  issue: TrackedIssue;
  run: AgentRun;
  agentResult: AgentRunResult;
  workflow: WorkflowConfig;
  workspace: WorkspacePlan;
}

export interface GitHubOutputResult {
  prUrl: string | null;
  branchName: string | null;
  commitCount: number;
  created: boolean;
  foundExisting: boolean;
  skippedReason: string | null;
}

export interface GitHubOutputService {
  attachPullRequest(request: GitHubOutputRequest): Promise<GitHubOutputResult>;
}

export interface GitHubApiRequest {
  method: "GET" | "POST";
  path: string;
  token: string;
  body?: unknown;
}

export interface GitHubApiResponse {
  status: number;
  body: unknown;
}

export type GitHubApiClient = (request: GitHubApiRequest) => Promise<GitHubApiResponse>;

export class DefaultGitHubOutputService implements GitHubOutputService {
  constructor(
    private readonly executor: ProcessExecutor = new NodeProcessExecutor(),
    private readonly apiClient: GitHubApiClient = defaultGitHubApiClient
  ) {}

  async attachPullRequest(request: GitHubOutputRequest): Promise<GitHubOutputResult> {
    if (request.agentResult.prUrl !== null) {
      return {
        prUrl: request.agentResult.prUrl,
        branchName: request.run.branchName,
        commitCount: 0,
        created: false,
        foundExisting: true,
        skippedReason: null
      };
    }
    if (!request.workflow.safety.allowPrCreation) {
      return skipped("pr_creation_disabled", request.run.branchName, 0);
    }
    if (request.workflow.repository.provider !== "github" || request.workflow.repository.github === undefined) {
      return skipped("github_not_configured", request.run.branchName, 0);
    }

    const repoPath = request.workspace.repositoryPath;
    await this.requireGitRepo(repoPath, request);
    const branchName = await this.currentBranch(repoPath, request);
    if (branchName === request.workflow.repository.defaultBranch) {
      throw new Error("Refusing to create a pull request from the default branch.");
    }
    const commitCount = await this.commitCount(repoPath, request.workflow.repository.defaultBranch, request);
    if (commitCount < 1) {
      return skipped("no_branch_commits", branchName, commitCount);
    }

    const token = tokenFromEnv(request.workflow.repository.github.tokenEnv);
    const existing = await this.findExistingPullRequest(request, branchName, token);
    if (existing !== null) {
      return {
        prUrl: existing,
        branchName,
        commitCount,
        created: false,
        foundExisting: true,
        skippedReason: null
      };
    }

    const created = await this.createPullRequest(request, branchName, token);
    return {
      prUrl: created,
      branchName,
      commitCount,
      created: true,
      foundExisting: false,
      skippedReason: null
    };
  }

  private async requireGitRepo(repoPath: string, request: GitHubOutputRequest): Promise<void> {
    const result = await this.git(["rev-parse", "--is-inside-work-tree"], repoPath, request);
    if (result.trim() !== "true") {
      throw new Error(`Workspace repository is not a git work tree: ${repoPath}.`);
    }
  }

  private async currentBranch(repoPath: string, request: GitHubOutputRequest): Promise<string> {
    const branchName = (await this.git(["branch", "--show-current"], repoPath, request)).trim();
    if (branchName.length === 0) {
      throw new Error("Unable to determine current git branch for GitHub PR output.");
    }
    return branchName;
  }

  private async commitCount(repoPath: string, defaultBranch: string, request: GitHubOutputRequest): Promise<number> {
    const output = await this.git(["rev-list", "--count", `${defaultBranch}..HEAD`], repoPath, request);
    const count = Number(output.trim());
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Unable to determine commit count from git output: ${output.trim()}`);
    }
    return count;
  }

  private async git(args: string[], cwd: string, request: GitHubOutputRequest): Promise<string> {
    const result = await this.executor.execute({
      command: "git",
      args,
      cwd,
      input: "",
      timeoutMs: 30_000,
      logPath: path.join(request.workspace.workspacePath, ".orchestrator", "github-output.log"),
      workspaceRoot: request.workspace.workspacePath,
      allowedCommands: request.workflow.safety.allowedCommands,
      blockedCommands: request.workflow.safety.blockedCommands,
      guardCommand: "git"
    });
    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed with exit code ${result.exitCode ?? "null"}.`);
    }
    return result.stdout;
  }

  private async findExistingPullRequest(
    request: GitHubOutputRequest,
    branchName: string,
    token: string
  ): Promise<string | null> {
    const github = request.workflow.repository.github!;
    const response = await this.apiClient({
      method: "GET",
      path: `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/pulls?head=${encodeURIComponent(`${github.owner}:${branchName}`)}&state=open`,
      token
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(redactSecrets(`GitHub PR lookup failed with status ${response.status}.`));
    }
    if (!Array.isArray(response.body)) {
      throw new Error("GitHub PR lookup returned an unexpected response.");
    }
    const first = response.body[0] as Record<string, unknown> | undefined;
    return typeof first?.html_url === "string" ? first.html_url : null;
  }

  private async createPullRequest(
    request: GitHubOutputRequest,
    branchName: string,
    token: string
  ): Promise<string> {
    const github = request.workflow.repository.github!;
    const response = await this.apiClient({
      method: "POST",
      path: `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/pulls`,
      token,
      body: {
        title: `${request.issue.identifier}: ${request.issue.title}`,
        head: branchName,
        base: request.workflow.repository.defaultBranch,
        body: pullRequestBody(request.issue, request.agentResult),
        draft: true
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(redactSecrets(`GitHub PR creation failed with status ${response.status}.`));
    }
    const body = response.body as Record<string, unknown>;
    if (typeof body.html_url !== "string" || body.html_url.trim().length === 0) {
      throw new Error("GitHub PR creation did not return a pull request URL.");
    }
    return body.html_url;
  }
}

async function defaultGitHubApiClient(request: GitHubApiRequest): Promise<GitHubApiResponse> {
  const response = await fetch(`https://api.github.com${request.path}`, {
    method: request.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${request.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

function pullRequestBody(issue: TrackedIssue, agentResult: AgentRunResult): string {
  return [
    `Implements ${issue.identifier}.`,
    "",
    issue.url === null ? null : `Tracker issue: ${issue.url}`,
    "",
    agentResult.summary.trim().length === 0 ? null : `Agent summary:\n${agentResult.summary}`,
    "",
    "Safety: this pull request requires human review. Symphony will not merge it or enable auto-merge."
  ].filter((line): line is string => line !== null).join("\n");
}

function tokenFromEnv(envName: string): string {
  const token = process.env[envName];
  if (token === undefined || token.trim().length === 0) {
    throw new Error(`Missing GitHub token environment variable: ${envName}.`);
  }
  return token;
}

function skipped(reason: string, branchName: string | null, commitCount: number): GitHubOutputResult {
  return {
    prUrl: null,
    branchName,
    commitCount,
    created: false,
    foundExisting: false,
    skippedReason: reason
  };
}
