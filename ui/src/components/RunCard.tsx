import type { Issue, RunRecord } from "../types";
import { duration, isRunRecord, priorityTone, statusTone } from "../utils";

interface RunCardProps {
  item: Issue | RunRecord;
  issue?: Issue;
  trackerKind: string;
  agentKind: string;
  onOpen?: (id: string) => void;
  onOpenIssue?: (issue: Issue) => void;
}

function labelForKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function RunCard({ item, issue: linkedIssue, trackerKind, agentKind, onOpen, onOpenIssue }: RunCardProps) {
  const runRecord = isRunRecord(item) ? item : null;
  const issue: Issue | undefined = runRecord === null ? item as Issue : linkedIssue;
  const identifier = runRecord?.run.issueIdentifier ?? issue?.identifier ?? "";
  const status = runRecord?.run.status ?? issue?.state ?? "Fetched";
  const title = issue?.title ?? identifier;
  const description = issue?.description ?? "No description captured.";
  const priority = issue?.priority ?? "Unspecified";
  const elapsed = runRecord === null ? "" : duration(runRecord.run.startedAt, runRecord.run.finishedAt);
  const prUrl = runRecord?.run.prUrl;

  return (
    <button
      type="button"
      onClick={() => {
        if (runRecord !== null) {
          onOpen?.(runRecord.run.id);
          return;
        }
        if (issue !== undefined) {
          onOpenIssue?.(issue);
        }
      }}
      className="surface group w-full rounded-md p-3 text-left transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">{identifier}</div>
          <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-800">{title}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(status)}`}>
          {status}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
        <span className={`rounded-full border px-2 py-0.5 ${priorityTone(priority)}`}>P {priority ?? "None"}</span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
          {labelForKind(trackerKind)}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
          {labelForKind(runRecord?.run.agentKind ?? agentKind)}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">Local</span>
        {runRecord !== null && runRecord.run.retryCount > 0 && (
          <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-purple-700">
            Retry {runRecord.run.retryCount}
          </span>
        )}
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">{elapsed || "No duration"}</span>
        {prUrl && (
          <a className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700" href={prUrl}>
            PR
          </a>
        )}
      </div>
    </button>
  );
}
