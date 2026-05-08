import type { Issue, RunRecord, WorkflowSummary } from "../types";
import { countByColumn, compactDate, statusTone } from "../utils";
import { EmptyState } from "../components/EmptyState";
import { StatCard } from "../components/StatCard";

interface DashboardProps {
  issues: Issue[];
  runs: RunRecord[];
  workflow: WorkflowSummary | null;
  onOpenRun: (id: string) => void;
}

export function Dashboard({ issues, runs, workflow, onOpenRun }: DashboardProps) {
  const counts = countByColumn(runs, issues);
  const recent = [...runs].sort((left, right) =>
    (right.run.finishedAt ?? right.run.startedAt ?? "").localeCompare(left.run.finishedAt ?? left.run.startedAt ?? "")
  ).slice(0, 8);

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Fetched" value={counts.fetched} />
        <StatCard label="Queued" value={counts.queued} />
        <StatCard label="Running" value={counts.running} />
        <StatCard label="Needs Review" value={counts.needsReview} />
        <StatCard label="Failed" value={counts.failed} />
        <StatCard label="Completed" value={counts.completed} />
      </div>
      <section className="surface rounded-md">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Recent Runs</h2>
          <span className="text-xs text-muted">{workflow?.agentKind ?? "No agent"}</span>
        </div>
        {recent.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No runs recorded" />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {recent.map((record) => (
              <button
                key={record.run.id}
                type="button"
                onClick={() => onOpenRun(record.run.id)}
                className="grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink">{record.run.issueIdentifier}</div>
                  <div className="mt-1 text-xs text-muted">{compactDate(record.run.finishedAt ?? record.run.startedAt)}</div>
                </div>
                <span className={`self-start rounded-full border px-2 py-0.5 text-xs ${statusTone(record.run.status)}`}>
                  {record.run.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
