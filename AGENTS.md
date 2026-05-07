# AGENTS.md

## Mission

We are building our own owned version of OpenAI Symphony: a tracker-agnostic coding-agent orchestrator.

Use the original OpenAI Symphony SPEC.md only as architectural inspiration. Do not copy or tightly couple this project to the reference implementation.

## Product direction

The orchestrator should:

1. Read work items from issue trackers.
2. Support Jira first.
3. Support Plane second.
4. Normalize external issues into a common internal model.
5. Create one isolated workspace per issue.
6. Clone the target repository into the workspace.
7. Render an agent prompt from WORKFLOW.md.
8. Run a coding agent inside the workspace.
9. Use Codex as the first concrete agent implementation.
10. Keep the agent layer generic for future agents.
11. Create a branch and pull request.
12. Comment the PR link back on the issue.
13. Move the issue to Human Review after PR creation succeeds.
14. Never auto-merge code.

## Technical choices

Use TypeScript and Node.js.

Build a CLI-first app.

Runtime priority:
1. Local CLI
2. Docker Compose
3. Server/cloud deployment later

Tracker priority:
1. Mock tracker for tests and dry-run
2. Jira
3. Plane

Agent priority:
1. Dry-run runner
2. Codex runner
3. Other agent runners later

## Safety rules

Never auto-merge.

Never expose secrets in logs.

Redact API tokens, GitHub tokens, OpenAI keys, Jira tokens, Plane tokens, and SSH credentials.

Default max concurrency to 1.

Do not delete workspaces by default.

Do not run destructive commands outside the configured workspace root.

Validate that every workspace path stays inside the configured workspace root.

Do not mutate Jira or Plane during dry-run.

Only move an issue to Human Review after PR creation succeeds.

Fail safely if configuration is ambiguous.

## Engineering rules

Keep the architecture modular.

Use interfaces between core systems.

Do not hard-code Jira or Plane into the orchestrator core.

The orchestrator core should depend on TrackerAdapter, AgentRunner, WorkspaceManager, and PullRequestService abstractions.

Prefer small milestones.

Do not build Jira, Plane, Codex, GitHub PRs, and Docker all in one pass.

Add tests with each milestone.

Do not require real Jira, Plane, GitHub, or Codex credentials in unit tests.

## Expected structure

src/
  cli/
  config/
  core/
  trackers/
  workspaces/
  agents/
  github/
  logging/
  templates/

tests/
  unit/
  integration/

examples/
  WORKFLOW.jira.example.md
  WORKFLOW.plane.example.md
  mock-issues.json

docs/
  OWNED_SYMPHONY_SPEC.md