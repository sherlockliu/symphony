import type { Issue, RunRecord, RunStatus } from "./types";

export function isRunRecord(item: Issue | RunRecord): item is RunRecord {
  return "run" in item;
}

export function statusTone(status: RunStatus | string): string {
  if (status === "FAILED" || status === "CANCELLED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "NEEDS_HUMAN_REVIEW" || status === "AGENT_COMPLETED" || status === "PR_CREATED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "RUNNING_AGENT") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function priorityTone(priority: string | number | null | undefined): string {
  const value = String(priority ?? "").toLowerCase();
  if (value === "1" || value.includes("high") || value.includes("urgent")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (value === "2" || value.includes("medium")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (value === "3" || value.includes("low")) {
    return "border-slate-200 bg-slate-50 text-slate-600";
  }
  return "border-slate-200 bg-white text-slate-500";
}

export function duration(startedAt: string | null, finishedAt: string | null): string {
  if (startedAt === null) {
    return "";
  }
  const start = Date.parse(startedAt);
  const end = finishedAt === null ? Date.now() : Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "";
  }
  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function compactDate(value: string | null): string {
  if (value === null) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function countByColumn(records: RunRecord[], issues: Issue[]) {
  return {
    fetched: issues.filter((issue) => !records.some((record) => record.run.issueId === issue.id)).length,
    queued: records.filter((record) => record.run.status === "QUEUED" || record.run.status === "PREPARING_WORKSPACE").length,
    running: records.filter((record) => record.run.status === "RUNNING_AGENT").length,
    needsReview: records.filter((record) =>
      record.run.status === "NEEDS_HUMAN_REVIEW"
      || record.run.status === "AGENT_COMPLETED"
      || record.run.status === "PR_CREATED"
    ).length,
    completed: records.filter((record) => record.run.status === "COMPLETED").length,
    failed: records.filter((record) => record.run.status === "FAILED" || record.run.status === "CANCELLED").length
  };
}

export function issueForRun(record: RunRecord, issues: Issue[]): Issue | undefined {
  return issues.find((issue) => issue.id === record.run.issueId || issue.identifier === record.run.issueIdentifier);
}
