import { useEffect, useState } from "react";
import { fetchBoard, fetchIssues, fetchRuns, fetchWorkflow } from "./api";
import { Layout } from "./components/Layout";
import { Loading } from "./components/Loading";
import { RunDetail } from "./components/RunDetail";
import { Board, type BoardFilters } from "./pages/Board";
import { Dashboard } from "./pages/Dashboard";
import { Runs } from "./pages/Runs";
import { Settings } from "./pages/Settings";
import { Workflows } from "./pages/Workflows";
import type { BoardColumn, Issue, RunRecord, WorkflowSummary } from "./types";

const defaultFilters: BoardFilters = {
  query: "",
  tracker: "all",
  agent: "all",
  status: "all",
  priority: "all"
};

export function App() {
  const [page, setPage] = useState("Board");
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [workflowResponse, issueResponse, runResponse, boardResponse] = await Promise.all([
        fetchWorkflow(),
        fetchIssues(),
        fetchRuns(),
        fetchBoard()
      ]);
      setWorkflow(workflowResponse);
      setIssues(issueResponse);
      setRuns(runResponse);
      setColumns(boardResponse.columns);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout page={page} onNavigate={setPage}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted">
          {workflow ? `${workflow.trackerKind} / ${workflow.agentKind}` : "No workflow"}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>
      {loading && <Loading />}
      {!loading && error && (
        <div className="surface rounded-md border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {!loading && !error && page === "Dashboard" && (
        <Dashboard issues={issues} runs={runs} workflow={workflow} onOpenRun={setSelectedRun} />
      )}
      {!loading && !error && page === "Board" && (
        <Board
          columns={columns}
          issues={issues}
          workflow={workflow}
          filters={filters}
          onFiltersChange={setFilters}
          onOpenRun={(runId) => {
            setSelectedIssue(null);
            setSelectedRun(runId);
          }}
          onOpenIssue={(issue) => {
            setSelectedRun(null);
            setSelectedIssue(issue);
          }}
        />
      )}
      {!loading && !error && page === "Runs" && <Runs runs={runs} onOpenRun={setSelectedRun} />}
      {!loading && !error && page === "Workflows" && <Workflows workflow={workflow} />}
      {!loading && !error && page === "Settings" && <Settings workflow={workflow} />}
      <RunDetail
        runId={selectedRun}
        issue={selectedIssue}
        workflow={workflow}
        onClose={() => {
          setSelectedRun(null);
          setSelectedIssue(null);
        }}
      />
    </Layout>
  );
}
