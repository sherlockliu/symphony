import { EmptyState } from "../components/EmptyState";
import type { RunRecord } from "../types";
import { compactDate, duration, statusTone } from "../utils";

interface RunsProps {
  runs: RunRecord[];
  onOpenRun: (id: string) => void;
}

export function Runs({ runs, onOpenRun }: RunsProps) {
  if (runs.length === 0) {
    return <EmptyState title="No runs recorded" />;
  }

  return (
    <section className="surface overflow-hidden rounded-md">
      <table className="w-full table-fixed border-collapse">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
            <th className="px-4 py-3">Issue</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">Retries</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-sm">
          {runs.map((record) => (
            <tr key={record.run.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <button type="button" onClick={() => onOpenRun(record.run.id)} className="font-medium text-ink hover:underline">
                  {record.run.issueIdentifier}
                </button>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(record.run.status)}`}>
                  {record.run.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-700">{record.run.agentKind}</td>
              <td className="tabular px-4 py-3 text-slate-700">{record.run.retryCount}</td>
              <td className="px-4 py-3 text-slate-700">{duration(record.run.startedAt, record.run.finishedAt) || "None"}</td>
              <td className="px-4 py-3 text-slate-700">{compactDate(record.run.finishedAt ?? record.run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
