---
version: 1
tracker:
  kind: jira
  base_url: https://your-domain.atlassian.net
  email: ${JIRA_EMAIL}
  api_token: ${JIRA_API_TOKEN}
  jql: 'project = ENG AND status = "Ready for Agent" ORDER BY priority ASC, updated ASC'
  max_results: 50
  review_transition: Human Review
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
