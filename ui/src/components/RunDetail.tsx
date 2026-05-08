import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cancelRun, fetchRun, fetchRunEvents, ignoreRun, retryRun } from "../api";
import type { Issue, RunDetail as RunDetailType, RunEvent, WorkflowSummary } from "../types";
import { compactDate, statusTone } from "../utils";
import { EmptyState } from "./EmptyState";

interface RunDetailProps {
  runId: string | null;
  issue: Issue | null;
  workflow: WorkflowSummary | null;
  onClose: () => void;
}

const sections = ["Overview", "Prompt", "Events", "Logs", "Output", "Config"] as const;

export function RunDetail({ runId, issue, workflow, onClose }: RunDetailProps) {
  const [active, setActive] = useState<(typeof sections)[number]>("Overview");
  const [detail, setDetail] = useState<RunDetailType | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"retry" | "cancel" | "ignore" | null>(null);

  const loadRun = useCallback(async (id: string) => {
    const [runDetail, runEvents] = await Promise.all([fetchRun(id), fetchRunEvents(id)]);
    setDetail(runDetail);
    setEvents(runEvents);
  }, []);

  useEffect(() => {
    if (runId === null) {
      setDetail(null);
      setEvents([]);
      return;
    }
    setActive("Overview");
    setError(null);
    setActionError(null);
    setActionMessage(null);
    void loadRun(runId)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  }, [loadRun, runId]);

  if (runId === null && issue === null) {
    return null;
  }

  const run = detail?.record.run;
  const drawerTitle = run?.issueIdentifier ?? issue?.identifier ?? runId ?? "";
  const drawerSubtitle = run?.id ?? issue?.title ?? "";
  const canRetry = run?.status === "FAILED" || run?.status === "CANCELLED" || run?.status === "IGNORED";
  const canCancel = run?.status === "RUNNING_AGENT";
  const canIgnore = run !== undefined && run.status !== "RUNNING_AGENT" && run.status !== "IGNORED";

  async function handleRetry() {
    if (run === undefined || !canRetry) {
      return;
    }
    setBusyAction("retry");
    setActionError(null);
    setActionMessage(null);
    try {
      const record = await retryRun(run.id);
      await loadRun(record.run.id);
      setActionMessage(`Retry queued as ${record.run.id}.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancel() {
    if (run === undefined || !canCancel || !window.confirm(`Cancel run ${run.id}?`)) {
      return;
    }
    await runOperatorAction("cancel", run.id);
  }

  async function handleIgnore() {
    if (run === undefined || !canIgnore || !window.confirm(`Mark run ${run.id} as ignored?`)) {
      return;
    }
    await runOperatorAction("ignore", run.id);
  }

  async function runOperatorAction(action: "cancel" | "ignore", id: string) {
    setBusyAction(action);
    setActionError(null);
    setActionMessage(null);
    try {
      const record = action === "cancel" ? await cancelRun(id) : await ignoreRun(id);
      await loadRun(record.run.id);
      setActionMessage(action === "cancel" ? "Run cancelled." : "Run marked ignored.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/20">
      <div className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-ink">{drawerTitle}</div>
            <div className="mt-1 text-xs text-muted">{drawerSubtitle}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-slate-100">
            Close
          </button>
        </div>
        {run !== undefined && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <ActionButton disabled={!canRetry || busyAction !== null} onClick={handleRetry}>
              {busyAction === "retry" ? "Retrying" : "Retry run"}
            </ActionButton>
            <ActionButton disabled={!canCancel || busyAction !== null} onClick={handleCancel}>
              {busyAction === "cancel" ? "Cancelling" : "Cancel run"}
            </ActionButton>
            <ActionButton disabled={!canIgnore || busyAction !== null} onClick={handleIgnore}>
              {busyAction === "ignore" ? "Ignoring" : "Mark ignored"}
            </ActionButton>
            {actionMessage && <span className="text-xs font-medium text-emerald-700">{actionMessage}</span>}
            {actionError && <span className="text-xs font-medium text-red-700">{actionError}</span>}
          </div>
        )}
        <div className="flex gap-1 border-b border-line px-5 py-2">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setActive(section)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active === section ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {section}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error && <EmptyState title={error} />}
          {!error && runId !== null && detail === null && <div className="text-sm text-muted">Loading</div>}
          {!error && runId === null && issue !== null && (
            <>
              {active === "Overview" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Status" value={<span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(issue.state)}`}>{issue.state}</span>} />
                  <Field label="Tracker" value={workflow?.trackerKind ?? "Unknown"} />
                  <Field label="Title" value={issue.title} wide />
                  <Field label="Description" value={issue.description ?? "None"} wide />
                  <Field label="Priority" value={String(issue.priority ?? "Unspecified")} />
                  <Field label="URL" value={issue.url ? <a className="text-blue-600 underline" href={issue.url}>{issue.url}</a> : "None"} wide />
                  <Field label="Labels" value={issue.labels.length > 0 ? issue.labels.join(", ") : "None"} wide />
                </div>
              )}
              {active === "Prompt" && <EmptyState title="No prompt rendered yet" />}
              {active === "Events" && <EmptyState title="No run events yet" />}
              {active === "Logs" && <EmptyState title="No logs captured yet" />}
              {active === "Output" && <EmptyState title="No output captured yet" />}
              {active === "Config" && <CodeBlock value={JSON.stringify(workflow ?? {}, null, 2)} />}
            </>
          )}
          {!error && detail !== null && (
            <>
              {active === "Overview" && run && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Status" value={<span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(run.status)}`}>{run.status}</span>} />
                  <Field label="Agent" value={run.agentKind} />
                  <Field label="Started" value={compactDate(run.startedAt)} />
                  <Field label="Finished" value={compactDate(run.finishedAt)} />
                  <Field label="Workspace" value={run.workspacePath ?? ""} wide />
                  <Field label="Branch" value={run.branchName ?? ""} />
                  <Field label="Retries" value={String(run.retryCount)} />
                  <Field label="PR" value={run.prUrl ? <a className="text-blue-600 underline" href={run.prUrl}>{run.prUrl}</a> : "None"} wide />
                  <Field label="Last error" value={run.errorMessage ?? "None"} wide />
                </div>
              )}
              {active === "Prompt" && (
                detail.prompt ? <CodeBlock value={detail.prompt} /> : <EmptyState title="No prompt captured" />
              )}
              {active === "Events" && (
                events.length === 0 ? <EmptyState title="No events" /> : (
                  <div className="grid gap-2">
                    {events.map((event) => (
                      <div key={event.id} className="surface rounded-md p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-ink">{event.type}</div>
                          <div className="text-xs text-muted">{compactDate(event.timestamp)}</div>
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{event.message}</div>
                      </div>
                    ))}
                  </div>
                )
              )}
              {active === "Logs" && (
                run?.errorMessage ? <CodeBlock value={run.errorMessage} /> : <EmptyState title="No logs captured" />
              )}
              {active === "Output" && (
                detail.output === null ? <EmptyState title="No output captured" /> : <CodeBlock value={JSON.stringify(detail.output, null, 2)} />
              )}
              {active === "Config" && <CodeBlock value={JSON.stringify(detail.config, null, 2)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`surface rounded-md p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words text-sm text-ink">{value || "None"}</div>
    </div>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="surface max-h-[calc(100vh-220px)] overflow-auto rounded-md p-4 text-xs leading-5 text-slate-800">
      {value}
    </pre>
  );
}
