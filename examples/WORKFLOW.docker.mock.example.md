---
version: 1
tracker:
  kind: mock
  issue_file: /config/mock-issues.json
workspace:
  root: /workspaces
repository:
  url: /app
  base_branch: main
  clone_dir: repo
branch:
  prefix: symphony
github:
  kind: gh
  remote: origin
  draft: true
  log_dir: /logs
agent:
  kind: dry-run
  timeout_seconds: 300
  log_dir: /logs
states:
  active: ["Ready", "In Progress"]
  terminal: ["Done", "Canceled"]
limits:
  max_concurrency: 1
retry:
  max_attempts: 2
  failure_cooldown_seconds: 30
  retryable_errors: ["agent_timeout", "network_error", "transient_tracker_error"]
daemon:
  poll_interval_seconds: 5
dashboard:
  enabled: false
  host: "127.0.0.1"
  port: 4000
---
# Agent Task

Implement {{issue.identifier}}: {{issue.title}}

Description:
{{issue.description}}

Container workspace: {{config.workspace.root}}
