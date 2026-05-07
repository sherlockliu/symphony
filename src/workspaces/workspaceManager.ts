import { mkdir, stat } from "node:fs/promises";
import type { Issue, IssueWorkspace, WorkflowConfig } from "../types.js";
import { safePathJoin, sanitizePathSegment } from "./pathSafety.js";

export class WorkspaceManager {
  constructor(private readonly config: WorkflowConfig) {}

  async createIssueWorkspace(issue: Issue): Promise<IssueWorkspace> {
    const issueKey = sanitizePathSegment(issue.identifier);
    const workspacePath = safePathJoin(this.config.workspace.root, issueKey);
    const repoPath = safePathJoin(this.config.workspace.root, issueKey, this.config.repository.cloneDir);
    const existed = await pathExists(workspacePath);

    await mkdir(workspacePath, { recursive: true });

    return {
      issueKey,
      path: workspacePath,
      repoPath,
      createdNow: !existed
    };
  }

  planIssueWorkspace(issue: Issue): IssueWorkspace {
    const issueKey = sanitizePathSegment(issue.identifier);
    const workspacePath = safePathJoin(this.config.workspace.root, issueKey);
    const repoPath = safePathJoin(this.config.workspace.root, issueKey, this.config.repository.cloneDir);

    return {
      issueKey,
      path: workspacePath,
      repoPath,
      createdNow: false
    };
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
