import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { MvpWorkflow, PersistedRunRecord } from "../core/orchestrator.js";
import { RunStatus, type AgentRun, type RunEvent } from "../core/domain.js";
import type { Issue } from "../types.js";

export interface ApiServerOptions {
  workflow: MvpWorkflow;
  workflowPath?: string;
  baseDir?: string;
  runsFilePath?: string;
  issuesFilePath?: string;
  staticUiDir?: string;
  activeRunController?: {
    cancel(runId: string): Promise<boolean>;
  };
}

export interface RunningApiServer {
  url: string;
  close(): Promise<void>;
}

export interface BoardColumn {
  name: "Fetched" | "Queued" | "Running" | "Needs Review" | "Done" | "Failed";
  items: Array<Issue | PersistedRunRecord>;
}

export interface RunDetail {
  record: PersistedRunRecord;
  prompt: string | null;
  output: unknown;
  config: Awaited<ReturnType<typeof workflowSummary>>;
}

export function buildApiServer(options: ApiServerOptions): FastifyInstance {
  const server = Fastify({ logger: false });
  const reader = new LocalPersistenceReader(options);

  if (options.staticUiDir !== undefined) {
    registerStaticUi(server, options.staticUiDir);
  }

  server.get("/api/health", async () => ({
    status: "ok"
  }));

  server.get("/api/workflows/current", async () => ({
    workflowPath: options.workflowPath ?? null,
    configHash: options.workflow.configHash,
    trackerKind: options.workflow.config.tracker.kind,
    agentKind: options.workflow.config.agent.kind,
    maxConcurrentAgents: options.workflow.config.agent.maxConcurrentAgents,
    repositoryUrl: options.workflow.config.repository.url,
    defaultBranch: options.workflow.config.repository.defaultBranch,
    workspaceRoot: options.workflow.config.workspace.root,
    safety: {
      allowAutoMerge: options.workflow.config.safety.allowAutoMerge
    }
  }));

  server.get("/api/issues", async () => ({
    issues: await reader.readIssues()
  }));

  server.get("/api/runs", async () => ({
    runs: await reader.readRuns()
  }));

  server.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = await reader.findRunDetail(request.params.id);
    if (run === null) {
      return reply.code(404).send({ error: "run_not_found", id: request.params.id });
    }
    return run;
  });

  server.get<{ Params: { id: string } }>("/api/runs/:id/events", async (request, reply) => {
    const run = await reader.findRun(request.params.id);
    if (run === null) {
      return reply.code(404).send({ error: "run_not_found", id: request.params.id });
    }
    return { events: run.events };
  });

  server.post<{ Params: { id: string } }>("/api/runs/:id/retry", async (request, reply) => {
    try {
      return { record: await reader.retryRun(request.params.id) };
    } catch (error) {
      return sendOperatorActionError(reply, error);
    }
  });

  server.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    try {
      return { record: await reader.cancelRun(request.params.id) };
    } catch (error) {
      return sendOperatorActionError(reply, error);
    }
  });

  server.post<{ Params: { id: string } }>("/api/runs/:id/ignore", async (request, reply) => {
    try {
      return { record: await reader.ignoreRun(request.params.id) };
    } catch (error) {
      return sendOperatorActionError(reply, error);
    }
  });

  server.get("/api/board", async () => {
    const [issues, runs] = await Promise.all([reader.readIssues(), reader.readRuns()]);
    return {
      columns: buildBoardColumns(issues, runs)
    };
  });

  return server;
}

function sendOperatorActionError(reply: FastifyReply, error: unknown) {
  if (error instanceof OperatorActionError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message
    });
  }
  throw error;
}

function registerStaticUi(server: FastifyInstance, staticUiDir: string): void {
  const resolvedStaticUiDir = path.resolve(staticUiDir);
  const assetsDir = path.join(resolvedStaticUiDir, "assets");

  server.get("/", async (_request, reply) => {
    try {
      const html = await readFile(path.join(resolvedStaticUiDir, "index.html"), "utf8");
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return reply.code(404).send({
          error: "ui_not_built",
          message: "Static UI bundle was not found. Run npm run ui:build or rebuild the Docker image."
        });
      }
      throw error;
    }
  });

  server.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const assetPath = path.resolve(assetsDir, request.params["*"]);
    if (assetPath !== assetsDir && !assetPath.startsWith(`${assetsDir}${path.sep}`)) {
      return reply.code(400).send({ error: "invalid_asset_path" });
    }
    try {
      const asset = await readFile(assetPath);
      return reply.type(contentTypeFor(assetPath)).send(asset);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return reply.code(404).send({ error: "asset_not_found" });
      }
      throw error;
    }
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

export async function startApiServer(
  options: ApiServerOptions,
  listenOptions: { host: string; port: number }
): Promise<RunningApiServer> {
  const server = buildApiServer(options);
  const address = await server.listen(listenOptions);
  return {
    url: address,
    async close() {
      await server.close();
    }
  };
}

export function buildBoardColumns(issues: Issue[], runs: PersistedRunRecord[]): BoardColumn[] {
  const columns: BoardColumn[] = [
    { name: "Fetched", items: [] },
    { name: "Queued", items: [] },
    { name: "Running", items: [] },
    { name: "Needs Review", items: [] },
    { name: "Done", items: [] },
    { name: "Failed", items: [] }
  ];
  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const runIssueIds = new Set(runs.map((record) => record.run.issueId));

  for (const issue of issues) {
    if (!runIssueIds.has(issue.id)) {
      columnsByName.get("Fetched")!.items.push(issue);
    }
  }

  for (const run of runs) {
    columnsByName.get(columnForStatus(run.run.status))!.items.push(run);
  }

  return columns;
}

function columnForStatus(status: RunStatus): BoardColumn["name"] {
  if (status === RunStatus.DISCOVERED || status === RunStatus.ELIGIBLE) {
    return "Fetched";
  }
  if (status === RunStatus.QUEUED || status === RunStatus.PREPARING_WORKSPACE) {
    return "Queued";
  }
  if (status === RunStatus.RUNNING_AGENT) {
    return "Running";
  }
  if (status === RunStatus.AGENT_COMPLETED || status === RunStatus.PR_CREATED || status === RunStatus.NEEDS_HUMAN_REVIEW) {
    return "Needs Review";
  }
  if (status === RunStatus.COMPLETED) {
    return "Done";
  }
  return "Failed";
}

class LocalPersistenceReader {
  private readonly baseDir: string;

  constructor(private readonly options: ApiServerOptions) {
    this.baseDir = options.baseDir ?? (options.workflowPath === undefined ? process.cwd() : path.dirname(path.resolve(options.workflowPath)));
  }

  async readIssues(): Promise<Issue[]> {
    const issuesFile = this.options.issuesFilePath ?? this.issueFileFromWorkflow();
    if (issuesFile === null) {
      return [];
    }
    return normalizeIssues(await readJsonFile(issuesFile, []), issuesFile);
  }

  async readRuns(): Promise<PersistedRunRecord[]> {
    const runsFile = this.runsFilePath();
    const value = await readJsonFile(runsFile, []);
    if (!Array.isArray(value)) {
      throw new Error(`Run store must contain a JSON array: ${runsFile}.`);
    }
    return value as PersistedRunRecord[];
  }

  async retryRun(id: string): Promise<PersistedRunRecord> {
    const records = await this.readRuns();
    const source = findRunRecord(records, id);
    if (source === null) {
      throw new OperatorActionError(404, "run_not_found", `Run not found: ${id}.`);
    }
    if (!isRetryAllowed(source.run.status)) {
      throw new OperatorActionError(
        409,
        "invalid_run_state",
        `Retry is only allowed for FAILED, CANCELLED, or IGNORED runs. Current status: ${source.run.status}.`
      );
    }

    const now = new Date().toISOString();
    const run: AgentRun = {
      id: randomUUID(),
      issueId: source.run.issueId,
      issueIdentifier: source.run.issueIdentifier,
      status: RunStatus.QUEUED,
      workspacePath: null,
      branchName: source.run.branchName,
      agentKind: this.options.workflow.config.agent.kind,
      startedAt: null,
      finishedAt: null,
      retryCount: source.run.retryCount + 1,
      prUrl: null,
      errorMessage: null
    };
    const record: PersistedRunRecord = {
      run,
      events: [
        createRunEvent("retry_requested", `Retry requested for ${source.run.issueIdentifier}.`, run.id, now, {
          previousRunId: source.run.id,
          retryCount: run.retryCount,
          workflowConfigHash: this.options.workflow.configHash
        })
      ]
    };
    records.push(record);
    await this.writeRuns(records);
    return record;
  }

  async cancelRun(id: string): Promise<PersistedRunRecord> {
    return this.updateRun(id, async (record, now) => {
      if (record.run.status !== RunStatus.RUNNING_AGENT) {
        throw new OperatorActionError(
          409,
          "invalid_run_state",
          `Cancel is only allowed for RUNNING_AGENT runs. Current status: ${record.run.status}.`
        );
      }
      const stopAttempted = this.options.activeRunController !== undefined;
      const childProcessStopped = this.options.activeRunController === undefined
        ? false
        : await this.options.activeRunController.cancel(record.run.id);
      record.run.status = RunStatus.CANCELLED;
      record.run.finishedAt = now;
      record.run.errorMessage = "Cancelled by operator.";
      record.events.push(createRunEvent("cancel_requested", `Cancel requested for ${record.run.issueIdentifier}.`, record.run.id, now, {
        stopAttempted,
        childProcessStopped
      }));
    });
  }

  async ignoreRun(id: string): Promise<PersistedRunRecord> {
    return this.updateRun(id, async (record, now) => {
      if (record.run.status === RunStatus.RUNNING_AGENT) {
        throw new OperatorActionError(
          409,
          "invalid_run_state",
          "Cannot ignore a running run. Cancel it first."
        );
      }
      record.run.status = RunStatus.IGNORED;
      record.run.finishedAt = record.run.finishedAt ?? now;
      record.events.push(createRunEvent("ignored_by_operator", `Run ignored for ${record.run.issueIdentifier}.`, record.run.id, now));
    });
  }

  async findRun(id: string): Promise<PersistedRunRecord | null> {
    const runs = await this.readRuns();
    return findRunRecord(runs, id);
  }

  async findRunDetail(id: string): Promise<RunDetail | null> {
    const record = await this.findRun(id);
    if (record === null) {
      return null;
    }
    const orchestratorDir = record.run.workspacePath === null
      ? null
      : path.join(record.run.workspacePath, ".orchestrator");
    return {
      record,
      prompt: orchestratorDir === null ? null : await readTextFile(path.join(orchestratorDir, "prompt.md")),
      output: orchestratorDir === null ? null : await readJsonFile(path.join(orchestratorDir, "result.json"), null),
      config: workflowSummary(this.options.workflow)
    };
  }

  private issueFileFromWorkflow(): string | null {
    const tracker = this.options.workflow.config.tracker;
    if (tracker.kind !== "mock") {
      return null;
    }
    const configured = tracker.issuesFile ?? tracker.issueFile;
    if (configured === undefined) {
      return null;
    }
    return path.resolve(this.baseDir, configured);
  }

  private runsFilePath(): string {
    return this.options.runsFilePath ?? path.resolve(this.baseDir, ".orchestrator", "runs.json");
  }

  private async writeRuns(records: PersistedRunRecord[]): Promise<void> {
    const runsFile = this.runsFilePath();
    await mkdir(path.dirname(runsFile), { recursive: true });
    await writeFile(runsFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private async updateRun(
    id: string,
    update: (record: PersistedRunRecord, now: string) => Promise<void>
  ): Promise<PersistedRunRecord> {
    const records = await this.readRuns();
    const index = records.findIndex((record) => record.run.id === id || record.run.issueIdentifier === id);
    if (index === -1) {
      throw new OperatorActionError(404, "run_not_found", `Run not found: ${id}.`);
    }
    const record = cloneRunRecord(records[index]!);
    await update(record, new Date().toISOString());
    records[index] = record;
    await this.writeRuns(records);
    return record;
  }
}

class OperatorActionError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OperatorActionError";
  }
}

function findRunRecord(records: PersistedRunRecord[], id: string): PersistedRunRecord | null {
  return records.find((record) => record.run.id === id || record.run.issueIdentifier === id) ?? null;
}

function isRetryAllowed(status: RunStatus): boolean {
  return status === RunStatus.FAILED || status === RunStatus.CANCELLED || status === RunStatus.IGNORED;
}

function createRunEvent(
  type: string,
  message: string,
  runId: string,
  timestamp: string,
  metadata: Record<string, unknown> = {}
): RunEvent {
  return {
    id: randomUUID(),
    runId,
    type,
    message,
    timestamp,
    metadata
  };
}

function cloneRunRecord(record: PersistedRunRecord): PersistedRunRecord {
  return {
    ...record,
    run: { ...record.run },
    events: record.events.map((event) => ({
      ...event,
      metadata: { ...event.metadata }
    })),
    result: record.result === undefined
      ? undefined
      : {
          ...record.result,
          changedFiles: [...record.result.changedFiles]
        }
  };
}

async function readJsonFile(filePath: string, fallback: unknown): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function workflowSummary(workflow: MvpWorkflow) {
  return {
    configHash: workflow.configHash,
    trackerKind: workflow.config.tracker.kind,
    workspaceRoot: workflow.config.workspace.root,
    agentKind: workflow.config.agent.kind,
    maxConcurrentAgents: workflow.config.agent.maxConcurrentAgents,
    safety: {
      allowAutoMerge: workflow.config.safety.allowAutoMerge
    }
  };
}

function normalizeIssues(value: unknown, source: string): Issue[] {
  if (!Array.isArray(value)) {
    throw new Error(`Issue store must contain a JSON array: ${source}.`);
  }
  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      id: stringField(record.id),
      identifier: stringField(record.identifier),
      title: stringField(record.title),
      description: nullableString(record.description),
      priority: stringNumberOrNull(record.priority),
      state: stringField(record.state),
      branchName: nullableString(record.branchName ?? record.branch_name),
      url: nullableString(record.url),
      labels: Array.isArray(record.labels) ? record.labels.filter((label): label is string => typeof label === "string") : [],
      blockedBy: [],
      createdAt: nullableString(record.createdAt ?? record.created_at),
      updatedAt: nullableString(record.updatedAt ?? record.updated_at)
    };
  });
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringNumberOrNull(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}
