---
tracker:
  kind: mock
  issuesFile: "./examples/mock-issues.json"
  eventsFile: "./.orchestrator/mock-tracker-events.json"

repository:
  url: "git@github.com:example/app.git"
  defaultBranch: "main"
  branchNamePattern: "ai/{{ issue.identifier }}"

workspace:
  root: "./workspaces"

agent:
  kind: dry-run
  command: "echo"
  maxConcurrentAgents: 1
  maxTurns: 20
  timeoutSeconds: 1800

states:
  ready:
    - "Ready"
    - "Ready for AI"
  review: "Human Review"
  done:
    - "Done"
    - "Closed"

safety:
  allowAutoMerge: false
  allowTicketTransitions: true
  allowPrCreation: true
---

You are working on issue {{ issue.identifier }}.

Issue title:
{{ issue.title }}

Issue description:
{{ issue.description }}

Issue metadata:
- Tracker issue ID: {{ issue.id }}
- Current state: {{ issue.state }}
- Priority: {{ issue.priority }}
- URL: {{ issue.url }}
- Run ID: {{ run.id }}
- Workspace: {{ run.workspacePath }}
- Repository: {{ config.repository.url }}
- Base branch: {{ config.repository.defaultBranch }}

Your task:
1. Inspect the repository and understand the smallest safe change that satisfies the issue.
2. Create or update code only inside the isolated workspace.
3. Keep the core orchestrator tracker-agnostic and runner-agnostic.
4. Add or update focused tests for the changed behavior.
5. Run the relevant checks before finishing.
6. Prepare the changes for human review.

Safety rules:
- Do not merge automatically.
- Do not print secrets.
- Do not make unrelated refactors.
- Prefer a small, reviewable change over a broad rewrite.
