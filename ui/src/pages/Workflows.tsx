import { EmptyState } from "../components/EmptyState";
import type { WorkflowSummary } from "../types";

interface WorkflowsProps {
  workflow: WorkflowSummary | null;
}

export function Workflows({ workflow }: WorkflowsProps) {
  if (workflow === null) {
    return <EmptyState title="No workflow loaded" />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="surface rounded-md p-4">
        <h2 className="text-sm font-semibold text-ink">Current Workflow</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <Field label="Path" value={workflow.workflowPath ?? "Unknown"} />
          <Field label="Config hash" value={workflow.configHash} />
          <Field label="Repository" value={workflow.repositoryUrl} />
          <Field label="Default branch" value={workflow.defaultBranch} />
        </div>
      </section>
      <section className="surface rounded-md p-4">
        <h2 className="text-sm font-semibold text-ink">Runtime</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <Field label="Tracker" value={workflow.trackerKind} />
          <Field label="Agent" value={workflow.agentKind} />
          <Field label="Workspace root" value={workflow.workspaceRoot} />
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words text-ink">{value}</div>
    </div>
  );
}
