---
version: 1
tracker:
  kind: github-issues
  owner: your-org
  repo: your-repo
  token: ${GITHUB_TOKEN}
  labels:
    - ready-for-ai
  human_review_label: human-review
  closed_states:
    - closed
  remove_candidate_labels_on_review: true
workspace:
  root: ../.symphony/workspaces
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
  log_dir: ../.symphony/logs
agent:
  kind: claude-code
  command: claude
  args: ["-p"]
  timeout_seconds: 1800
  log_dir: ../.symphony/logs
  env:
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
states:
  active: ["open"]
  terminal: ["closed"]
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
Issue URL: {{issue.url}}

Open a small, reviewable change. Do not merge anything.
