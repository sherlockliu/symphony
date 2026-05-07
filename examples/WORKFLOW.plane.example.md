---
version: 1
tracker:
  kind: plane
  base_url: https://api.plane.so
  api_key: ${PLANE_API_KEY}
  workspace_slug: your-workspace
  project_id: your-project-id
  max_results: 50
  review_state: Human Review
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
  kind: codex
  command: codex
  args: ["exec", "-"]
  timeout_seconds: 900
  log_dir: ../.symphony/logs
states:
  active: ["Ready for Agent", "In Progress"]
  terminal: ["Done", "Canceled"]
limits:
  max_concurrency: 1
---
# Agent Task

Implement {{issue.identifier}}: {{issue.title}}

Description:
{{issue.description}}

Issue URL: {{issue.url}}
