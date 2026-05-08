---
version: 1
tracker:
  kind: jira
  base_url: https://your-domain.atlassian.net
  email_env: JIRA_EMAIL
  api_token_env: JIRA_API_TOKEN
  jql: 'project = MUL AND status = "Ready for AI" ORDER BY priority DESC'
  ready_states:
    - "Ready for AI"
  max_results: 50
  review_state: Human Review
workspace:
  root: ./.symphony/workspaces
repository:
  url: git@github.com:your-org/your-repo.git
  base_branch: main
  clone_dir: repo
branch:
  prefix: symphony
github:
  kind: gh
  remote: origin
  draft: true
  log_dir: ./.symphony/logs
agent:
  kind: codex
  command: codex
  args: ["exec", "-"]
  timeout_seconds: 900
  log_dir: ./.symphony/logs
states:
  active: ["Ready for AI", "In Progress"]
  terminal: ["Done", "Canceled"]
limits:
  max_concurrency: 1
retry:
  max_attempts: 2
  failure_cooldown_seconds: 300
  retryable_errors: ["agent_timeout", "network_error", "transient_tracker_error"]
dashboard:
  enabled: false
  host: "127.0.0.1"
  port: 4000
---
# Agent Task

Implement {{issue.identifier}}: {{issue.title}}

Description:
{{issue.description}}

Issue URL: {{issue.url}}

Requirements:
- Work on the configured issue branch.
- Make the smallest safe change.
- Run relevant tests.
- Open a draft PR for human review.
- Do not merge.
