import { EmptyState } from "../components/EmptyState";
import { RunCard } from "../components/RunCard";
import type { BoardColumn, Issue, WorkflowSummary } from "../types";
import { isRunRecord, issueForRun } from "../utils";

interface BoardProps {
  columns: BoardColumn[];
  issues: Issue[];
  workflow: WorkflowSummary | null;
  onOpenRun: (id: string) => void;
  onOpenIssue: (issue: Issue) => void;
}

export interface BoardFilters {
  query: string;
  tracker: string;
  agent: string;
  status: string;
  priority: string;
}

interface BoardWithFiltersProps extends BoardProps {
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
}

export function Board({
  columns,
  issues,
  workflow,
  onOpenRun,
  onOpenIssue,
  filters,
  onFiltersChange
}: BoardWithFiltersProps) {
  const filteredColumns = columns.map((column) => ({
    ...column,
    items: column.items.filter((item) => {
      const record = isRunRecord(item) ? item : null;
      const issue = record === null ? item as Issue : issueForRun(record, issues);
      const query = filters.query.trim().toLowerCase();
      const identifier = record?.run.issueIdentifier ?? issue?.identifier ?? "";
      const title = issue?.title ?? "";
      const priority = String(issue?.priority ?? "Unspecified");
      const agent = record?.run.agentKind ?? workflow?.agentKind ?? "";
      const tracker = workflow?.trackerKind ?? "";
      const status = record?.run.status ?? column.name;

      return (
        (query === "" || identifier.toLowerCase().includes(query) || title.toLowerCase().includes(query))
        && (filters.tracker === "all" || tracker === filters.tracker)
        && (filters.agent === "all" || agent === filters.agent)
        && (filters.status === "all" || status === filters.status || column.name === filters.status)
        && (filters.priority === "all" || priority === filters.priority)
      );
    })
  }));

  const agents = [...new Set(columns.flatMap((column) =>
    column.items.map((item) => isRunRecord(item) ? item.run.agentKind : workflow?.agentKind ?? "dry-run")
  ))].sort();
  const priorities = [...new Set(issues.map((issue) => String(issue.priority ?? "Unspecified")))].sort();

  const activeFilterCount = [filters.tracker, filters.agent, filters.status, filters.priority].filter((value) => value !== "all").length
    + (filters.query.trim() === "" ? 0 : 1);

  return (
    <div className="grid gap-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-md p-2">
        <input
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          placeholder="Search issue or title"
          className="h-9 min-w-60 flex-1 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-slate-400"
        />
        <select className="h-9 rounded-md border border-line bg-white px-2 text-sm" value={filters.tracker} onChange={(event) => onFiltersChange({ ...filters, tracker: event.target.value })}>
          <option value="all">Tracker</option>
          {workflow?.trackerKind && <option value={workflow.trackerKind}>{workflow.trackerKind}</option>}
        </select>
        <select className="h-9 rounded-md border border-line bg-white px-2 text-sm" value={filters.agent} onChange={(event) => onFiltersChange({ ...filters, agent: event.target.value })}>
          <option value="all">Agent</option>
          {agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
        </select>
        <select className="h-9 rounded-md border border-line bg-white px-2 text-sm" value={filters.status} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}>
          <option value="all">Status</option>
          {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
        </select>
        <select className="h-9 rounded-md border border-line bg-white px-2 text-sm" value={filters.priority} onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value })}>
          <option value="all">Priority</option>
          {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
        </select>
        <button
          type="button"
          onClick={() => onFiltersChange({ query: "", tracker: "all", agent: "all", status: "all", priority: "all" })}
          className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
        </button>
        <button type="button" className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-700">
          Display: Board
        </button>
        <button type="button" className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white">
          New manual run
        </button>
      </div>
      <div className="grid min-h-[calc(100vh-170px)] grid-cols-1 gap-3 overflow-x-auto md:grid-cols-2 xl:grid-cols-6">
        {filteredColumns.map((column) => (
          <section key={column.name} className="min-w-0 rounded-md border border-line bg-slate-50">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <h2 className="text-sm font-semibold text-ink">{column.name}</h2>
              <span className="tabular rounded-full bg-white px-2 py-0.5 text-xs text-muted">{column.items.length}</span>
            </div>
            <div className="grid gap-2 p-2">
              {column.items.length === 0 ? (
                <EmptyState title="No cards" />
              ) : (
                column.items.map((item, index) => {
                  const record = isRunRecord(item) ? item : null;
                  const issue = record === null ? (item as Issue) : issueForRun(record, issues);
                  const key =
                    record !== null
                      ? record.run.id
                      : `${(item as Issue).id || (item as Issue).identifier || column.name}-${index}`;
                  return (
                    <RunCard
                      key={key}
                      item={item}
                      issue={record === null ? undefined : issue}
                      trackerKind={workflow?.trackerKind ?? "mock"}
                      agentKind={workflow?.agentKind ?? "dry-run"}
                      onOpen={onOpenRun}
                      onOpenIssue={onOpenIssue}
                    />
                  );
                })
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
