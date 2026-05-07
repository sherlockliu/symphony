import type { Issue } from "../types.js";

export function branchNameForIssue(issue: Issue, prefix: string): string {
  const source = issue.branchName ?? `${issue.identifier}-${issue.title}`;
  const cleanPrefix = sanitizeGitRef(prefix);
  const cleanSource = sanitizeGitRef(source);
  return `${cleanPrefix}/${cleanSource}`;
}

export function sanitizeGitRef(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .split("/")
    .map((segment) => segment.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
    .join("/")
    .replace(/\.\./g, ".")
    .replace(/@\{/g, "@");

  if (sanitized.length === 0 || sanitized.endsWith(".lock")) {
    throw new Error(`Cannot derive a safe git branch name from ${value}.`);
  }

  return sanitized.slice(0, 180);
}
