import { EmptyState } from "../components/EmptyState";
import type { WorkflowSummary } from "../types";

interface SettingsProps {
  workflow: WorkflowSummary | null;
}

export function Settings({ workflow }: SettingsProps) {
  if (workflow === null) {
    return <EmptyState title="No settings loaded" />;
  }

  return (
    <section className="surface max-w-3xl rounded-md p-4">
      <h2 className="text-sm font-semibold text-ink">Read-only settings</h2>
      <div className="mt-4 grid gap-3">
        <Field label="Tracker kind" value={workflow.trackerKind} />
        <Field label="Workspace root" value={workflow.workspaceRoot} />
        <Field label="Agent kind" value={workflow.agentKind} />
        <Field label="Max concurrent agents" value={String(workflow.maxConcurrentAgents ?? 1)} />
        <Field label="safety.allowAutoMerge" value={String(workflow.safety?.allowAutoMerge ?? false)} />
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-line pb-3 last:border-0 last:pb-0 sm:grid-cols-[220px_1fr]">
      <div className="text-sm text-muted">{label}</div>
      <div className="break-words text-sm font-medium text-ink">{value}</div>
    </div>
  );
}
