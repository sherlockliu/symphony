import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Issue, IssueWorkspace, WorkflowConfig } from "../types.js";
import { branchNameForIssue } from "./branch.js";

export interface GitPreparationPlan {
  branchName: string;
  commands: string[];
}

export class GitService {
  constructor(private readonly config: WorkflowConfig) {}

  planPreparation(issue: Issue, workspace: IssueWorkspace): GitPreparationPlan {
    const branchName = branchNameForIssue(issue, this.config.branch.prefix);
    const commandArgs = buildGitCommandArgs(this.config, workspace, branchName, false);
    return {
      branchName,
      commands: commandArgs.map(formatCommand)
    };
  }

  async prepareRepository(issue: Issue, workspace: IssueWorkspace): Promise<GitPreparationPlan> {
    await mkdir(path.dirname(workspace.repoPath), { recursive: true });

    const branchName = branchNameForIssue(issue, this.config.branch.prefix);
    const repoExists = await isGitRepository(workspace.repoPath);
    const commandArgs = buildGitCommandArgs(this.config, workspace, branchName, repoExists);

    for (const args of commandArgs) {
      await runCommand(args[0]!, args.slice(1));
    }

    return {
      branchName,
      commands: commandArgs.map(formatCommand)
    };
  }
}

function buildGitCommandArgs(
  config: WorkflowConfig,
  workspace: IssueWorkspace,
  branchName: string,
  repoExists: boolean
): string[][] {
  if (repoExists) {
    return [
      ["git", "-C", workspace.repoPath, "fetch", "origin", config.repository.baseBranch],
      ["git", "-C", workspace.repoPath, "checkout", "-B", branchName, `origin/${config.repository.baseBranch}`]
    ];
  }

  return [
    ["git", "clone", "--branch", config.repository.baseBranch, config.repository.url, workspace.repoPath],
    ["git", "-C", workspace.repoPath, "checkout", "-B", branchName]
  ];
}

async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await stat(path.join(repoPath, ".git"));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${formatCommand([command, ...args])} exited with code ${code}.`));
    });
  });
}

function formatCommand(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
