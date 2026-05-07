import path from "node:path";

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function assertInsideRoot(rootPath: string, candidatePath: string): string {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidate;
  }

  throw new PathSafetyError(`Path ${candidate} is outside workspace root ${root}.`);
}

export function safePathJoin(rootPath: string, ...segments: string[]): string {
  if (segments.some((segment) => segment.includes("\0"))) {
    throw new PathSafetyError("Path segment contains a null byte.");
  }
  return assertInsideRoot(rootPath, path.join(rootPath, ...segments));
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    throw new PathSafetyError(`Cannot derive a safe path segment from ${value}.`);
  }

  return sanitized.slice(0, 120);
}
