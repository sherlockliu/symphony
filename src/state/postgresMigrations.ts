export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
}

export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  {
    version: 1,
    name: "create_issue_run_states",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issue_run_states (
  id uuid PRIMARY KEY,
  tracker_kind text NOT NULL,
  tracker_issue_id text NOT NULL,
  issue_identifier text NOT NULL,
  issue_url text,
  issue_title text NOT NULL,
  state text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 1,
  last_error_type text,
  last_error_message text,
  workspace_path text,
  branch_name text,
  pull_request_url text,
  logs_path text,
  tracker_state_at_start text,
  tracker_state_latest text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  lock_owner text,
  lock_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_run_states_tracker_issue_unique
  ON issue_run_states (tracker_kind, tracker_issue_id);

CREATE INDEX IF NOT EXISTS issue_run_states_state_idx
  ON issue_run_states (state);

CREATE INDEX IF NOT EXISTS issue_run_states_next_retry_at_idx
  ON issue_run_states (next_retry_at);

CREATE INDEX IF NOT EXISTS issue_run_states_issue_identifier_idx
  ON issue_run_states (issue_identifier);

CREATE INDEX IF NOT EXISTS issue_run_states_updated_at_idx
  ON issue_run_states (updated_at);

CREATE INDEX IF NOT EXISTS issue_run_states_lock_expires_at_idx
  ON issue_run_states (lock_expires_at);

INSERT INTO schema_migrations (version, name)
VALUES (1, 'create_issue_run_states')
ON CONFLICT (version) DO NOTHING;
`
  }
];
