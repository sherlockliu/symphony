---
version: 1
tracker:
  kind: mock
  issue_file: ./mock-issues.json
state:
  kind: postgres
  connection_string: ${DATABASE_URL}
  lock_ttl_seconds: 900
workspace:
  root: ../.symphony/workspaces
repository:
  url: ..
  base_branch: main
  clone_dir: repo
branch:
  prefix: symphony
github:
  kind: gh
  remote: origin
  draft: true
  log_dir: ../.symphony/logs
agent:
  kind: dry-run
  timeout_seconds: 300
  log_dir: ../.symphony/logs
states:
  active: ["Ready", "In Progress"]
  terminal: ["Done", "Canceled"]
limits:
  max_concurrency: 1
retry:
  max_attempts: 2
  failure_cooldown_seconds: 300
  retryable_errors: ["agent_timeout", "network_error", "transient_tracker_error"]
daemon:
  poll_interval_seconds: 60
dashboard:
  enabled: false
  host: "127.0.0.1"
  port: 4000
---
# Agent Task

Implement {{issue.identifier}}: {{issue.title}}

Description:
{{issue.description}}

Labels: {{issue.labels}}
Workspace root: {{config.workspace.root}}
