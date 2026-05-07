import { spawn } from "node:child_process";
import { redactSecrets } from "../logging/redact.js";
import { POSTGRES_MIGRATIONS } from "./postgresMigrations.js";
import {
  ACTIVE_RUN_STATES,
  isRetryableRunState,
  isStaleRecoverableState,
  UNFINISHED_RUN_STATES,
  type IssueRunState,
  type RunStateStore
} from "./runStateStore.js";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
}

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<SqlQueryResult>;
}

export interface PostgresRunStateStoreOptions {
  connectionString: string;
  executor?: SqlExecutor;
}

export class PostgresRunStateStore implements RunStateStore {
  private migrationsReady = false;
  private readonly executor: SqlExecutor;

  constructor(private readonly options: PostgresRunStateStoreOptions) {
    this.executor = options.executor ?? new PsqlExecutor(options.connectionString);
  }

  async migrate(): Promise<void> {
    if (this.migrationsReady) {
      return;
    }
    try {
      for (const migration of POSTGRES_MIGRATIONS) {
        await this.executor.query(migration.sql);
      }
      this.migrationsReady = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Postgres migration failed: ${redactSecrets(message)}`);
    }
  }

  async getByIssueId(issueId: string): Promise<IssueRunState | undefined> {
    await this.migrate();
    const result = await this.executor.query(
      "SELECT * FROM issue_run_states WHERE tracker_issue_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [issueId]
    );
    return rowToState(result.rows[0]);
  }

  async getByIssueIdentifier(identifier: string): Promise<IssueRunState | undefined> {
    await this.migrate();
    const result = await this.executor.query(
      "SELECT * FROM issue_run_states WHERE issue_identifier = $1 ORDER BY updated_at DESC LIMIT 1",
      [identifier]
    );
    return rowToState(result.rows[0]);
  }

  async upsert(state: IssueRunState): Promise<void> {
    await this.migrate();
    await this.executor.query(
      [
        "INSERT INTO issue_run_states (",
        [
          "id",
          "tracker_kind",
          "tracker_issue_id",
          "issue_identifier",
          "issue_url",
          "issue_title",
          "state",
          "attempt_count",
          "max_attempts",
          "last_error_type",
          "last_error_message",
          "workspace_path",
          "branch_name",
          "pull_request_url",
          "logs_path",
          "tracker_state_at_start",
          "tracker_state_latest",
          "created_at",
          "updated_at",
          "started_at",
          "completed_at",
          "next_retry_at",
          "lock_owner",
          "lock_expires_at",
          "metadata"
        ].join(", "),
        ") VALUES (",
        Array.from({ length: 25 }, (_, index) => index === 24 ? `$${index + 1}::jsonb` : `$${index + 1}`).join(", "),
        ") ON CONFLICT (tracker_kind, tracker_issue_id) DO UPDATE SET ",
        [
          "issue_identifier = EXCLUDED.issue_identifier",
          "issue_url = EXCLUDED.issue_url",
          "issue_title = EXCLUDED.issue_title",
          "state = EXCLUDED.state",
          "attempt_count = EXCLUDED.attempt_count",
          "max_attempts = EXCLUDED.max_attempts",
          "last_error_type = EXCLUDED.last_error_type",
          "last_error_message = EXCLUDED.last_error_message",
          "workspace_path = EXCLUDED.workspace_path",
          "branch_name = EXCLUDED.branch_name",
          "pull_request_url = EXCLUDED.pull_request_url",
          "logs_path = EXCLUDED.logs_path",
          "tracker_state_at_start = EXCLUDED.tracker_state_at_start",
          "tracker_state_latest = EXCLUDED.tracker_state_latest",
          "updated_at = EXCLUDED.updated_at",
          "started_at = EXCLUDED.started_at",
          "completed_at = EXCLUDED.completed_at",
          "next_retry_at = EXCLUDED.next_retry_at",
          "lock_owner = EXCLUDED.lock_owner",
          "lock_expires_at = EXCLUDED.lock_expires_at",
          "metadata = EXCLUDED.metadata"
        ].join(", ")
      ].join(""),
      stateToParams(state)
    );
  }

  async listActive(): Promise<IssueRunState[]> {
    return await this.listByStates([...ACTIVE_RUN_STATES]);
  }

  async listUnfinished(): Promise<IssueRunState[]> {
    return await this.listByStates([...UNFINISHED_RUN_STATES]);
  }

  async listRetryable(now: Date): Promise<IssueRunState[]> {
    await this.migrate();
    const result = await this.executor.query(
      [
        "SELECT * FROM issue_run_states",
        " WHERE state = 'failed_retryable'",
        " AND attempt_count < max_attempts",
        " AND (next_retry_at IS NULL OR next_retry_at <= $1)",
        " ORDER BY updated_at DESC"
      ].join(""),
      [now.toISOString()]
    );
    return result.rows.map(rowToState).filter((state): state is IssueRunState => state !== undefined)
      .filter((state) => isRetryableRunState(state, now));
  }

  async listRecent(limit: number): Promise<IssueRunState[]> {
    await this.migrate();
    const result = await this.executor.query(
      "SELECT * FROM issue_run_states ORDER BY updated_at DESC LIMIT $1",
      [limit]
    );
    return result.rows.map(rowToState).filter((state): state is IssueRunState => state !== undefined);
  }

  async markStaleRuns(now: Date): Promise<void> {
    await this.migrate();
    const nowIso = now.toISOString();
    await this.executor.query(
      [
        "UPDATE issue_run_states",
        " SET state = CASE WHEN attempt_count >= max_attempts THEN 'needs_human_attention' ELSE 'failed_retryable' END,",
        " updated_at = $1,",
        " completed_at = $1,",
        " last_error_type = COALESCE(last_error_type, 'stale_run_recovered'),",
        " last_error_message = COALESCE(last_error_message, 'Run was unfinished during daemon startup recovery.'),",
        " next_retry_at = CASE WHEN attempt_count >= max_attempts THEN NULL ELSE next_retry_at END,",
        " lock_owner = NULL,",
        " lock_expires_at = NULL",
        " WHERE state = ANY($2)"
      ].join(""),
      [nowIso, [...ACTIVE_RUN_STATES].filter(isStaleRecoverableState)]
    );
    await this.executor.query(
      "UPDATE issue_run_states SET lock_owner = NULL, lock_expires_at = NULL, updated_at = $1 WHERE lock_expires_at IS NOT NULL AND lock_expires_at <= $1",
      [nowIso]
    );
  }

  async acquireLock(state: IssueRunState, owner: string, expiresAt: Date): Promise<boolean> {
    await this.migrate();
    const result = await this.executor.query(
      [
        "UPDATE issue_run_states",
        " SET lock_owner = $1, lock_expires_at = $2, updated_at = $3",
        " WHERE tracker_kind = $4",
        " AND tracker_issue_id = $5",
        " AND (lock_owner IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $3)",
        " RETURNING id"
      ].join(""),
      [owner, expiresAt.toISOString(), new Date().toISOString(), state.trackerKind, state.trackerIssueId]
    );
    return result.rows.length > 0;
  }

  async releaseLock(state: IssueRunState, owner: string): Promise<void> {
    await this.migrate();
    await this.executor.query(
      [
        "UPDATE issue_run_states",
        " SET lock_owner = NULL, lock_expires_at = NULL, updated_at = $1",
        " WHERE tracker_kind = $2 AND tracker_issue_id = $3 AND lock_owner = $4"
      ].join(""),
      [new Date().toISOString(), state.trackerKind, state.trackerIssueId, owner]
    );
  }

  private async listByStates(states: string[]): Promise<IssueRunState[]> {
    await this.migrate();
    const result = await this.executor.query(
      "SELECT * FROM issue_run_states WHERE state = ANY($1) ORDER BY updated_at DESC",
      [states]
    );
    return result.rows.map(rowToState).filter((state): state is IssueRunState => state !== undefined);
  }
}

export class PsqlExecutor implements SqlExecutor {
  private readonly connection: ParsedPostgresConnection;

  constructor(connectionString: string) {
    this.connection = parsePostgresConnectionString(connectionString);
  }

  async query(sql: string, params: unknown[] = []): Promise<SqlQueryResult> {
    const formattedSql = formatSql(sql, params);
    const trimmedSql = formattedSql.trim();
    const returnsRows = /^\s*select\b/i.test(trimmedSql) || /\breturning\b/i.test(trimmedSql);
    const wrapped = returnsRows ? [
      "\\set ON_ERROR_STOP on",
      "\\pset format unaligned",
      "\\pset tuples_only on",
      "\\pset fieldsep '\\t'",
      /^\s*select\b/i.test(trimmedSql)
        ? "SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM (" + formattedSql + ") q;"
        : "WITH q AS (" + formattedSql + ") SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM q;"
    ].join("\n") : [
      "\\set ON_ERROR_STOP on",
      formattedSql
    ].join("\n");

    return await new Promise<SqlQueryResult>((resolve, reject) => {
      const child = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1"], {
        env: {
          ...process.env,
          PGHOST: this.connection.host,
          PGPORT: this.connection.port,
          PGDATABASE: this.connection.database,
          PGUSER: this.connection.user,
          PGPASSWORD: this.connection.password,
          PGSSLMODE: this.connection.sslMode
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (exitCode) => {
        if (exitCode !== 0) {
          reject(new Error(`psql exited with ${exitCode}: ${redactSecrets(stderr)}`));
          return;
        }
        const text = stdout.trim();
        if (text.length === 0) {
          resolve({ rows: [] });
          return;
        }
        try {
          const rows = JSON.parse(text) as Record<string, unknown>[];
          resolve({ rows });
        } catch {
          resolve({ rows: [] });
        }
      });
      child.stdin.end(wrapped);
    });
  }
}

interface ParsedPostgresConnection {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslMode: string;
}

function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnection {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("state.connection_string must use postgres:// or postgresql://.");
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: url.searchParams.get("sslmode") ?? "prefer"
  };
}

function stateToParams(state: IssueRunState): unknown[] {
  return [
    state.id,
    state.trackerKind,
    state.trackerIssueId,
    state.issueIdentifier,
    state.issueUrl,
    state.issueTitle,
    state.state,
    state.attemptCount,
    state.maxAttempts,
    state.lastErrorType,
    state.lastErrorMessage,
    state.workspacePath,
    state.branchName,
    state.pullRequestUrl,
    state.logsPath,
    state.trackerStateAtStart,
    state.trackerStateLatest,
    state.createdAt,
    state.updatedAt,
    state.startedAt,
    state.completedAt,
    state.nextRetryAt,
    state.lockOwner,
    state.lockExpiresAt,
    JSON.stringify(state.metadata)
  ];
}

function formatSql(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (token, index: string) => {
    const paramIndex = Number(index) - 1;
    if (paramIndex < 0 || paramIndex >= params.length) {
      return token;
    }
    return sqlLiteral(params[paramIndex]);
  });
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (Array.isArray(value)) {
    return "ARRAY[" + value.map(sqlLiteral).join(", ") + "]";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot serialize non-finite number as SQL.");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function rowToState(row: Record<string, unknown> | undefined): IssueRunState | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: text(row.id),
    trackerKind: text(row.tracker_kind),
    trackerIssueId: text(row.tracker_issue_id),
    issueIdentifier: text(row.issue_identifier),
    issueUrl: nullableText(row.issue_url),
    issueTitle: text(row.issue_title),
    state: text(row.state) as IssueRunState["state"],
    attemptCount: numberValue(row.attempt_count),
    maxAttempts: numberValue(row.max_attempts),
    lastErrorType: nullableText(row.last_error_type),
    lastErrorMessage: nullableText(row.last_error_message),
    workspacePath: nullableText(row.workspace_path),
    branchName: nullableText(row.branch_name),
    pullRequestUrl: nullableText(row.pull_request_url),
    logsPath: nullableText(row.logs_path),
    trackerStateAtStart: nullableText(row.tracker_state_at_start),
    trackerStateLatest: nullableText(row.tracker_state_latest),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    startedAt: nullableText(row.started_at),
    completedAt: nullableText(row.completed_at),
    nextRetryAt: nullableText(row.next_retry_at),
    lockOwner: nullableText(row.lock_owner),
    lockExpiresAt: nullableText(row.lock_expires_at),
    metadata: parseMetadata(row.metadata)
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}
