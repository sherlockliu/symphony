# Owned Symphony

Owned Symphony is a TypeScript/Node.js coding-agent orchestrator. It reads eligible work from an
issue tracker, creates an isolated workspace, renders a `WORKFLOW.md` prompt, runs a configured
coding agent, and prepares changes for human review through draft pull requests.

It is inspired by the public OpenAI Symphony architecture, but this repository is an owned
implementation. It does not copy the OpenAI Elixir implementation.

## What It Does

- Fetches work from Mock, Jira, Plane, or GitHub Issues.
- Normalizes tracker work items into one internal issue shape.
- Creates one workspace per issue.
- Clones or updates the target repository and checks out an issue branch.
- Renders the prompt body from `WORKFLOW.md`.
- Runs DryRun, Codex, Claude Code, or Shell agent runners.
- Captures redacted logs and run state.
- Creates draft GitHub PRs when changes exist.
- Comments back to the tracker and transitions to Human Review when supported.

Owned Symphony never merges pull requests.

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, boundaries, current coupling, and extension seams. |
| [docs/TECHNICAL_ROADMAP.md](docs/TECHNICAL_ROADMAP.md) | Current state review, risks, next tasks, refactors, and release checklists. |
| [docs/deployment.md](docs/deployment.md) | Docker Compose deployment notes. |
| [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md) | How to add a new tracker adapter. |
| [docs/ADDING_AGENT_RUNNERS.md](docs/ADDING_AGENT_RUNNERS.md) | How to add a new agent runner. |
| [docs/OWNED_SYMPHONY_SPEC.md](docs/OWNED_SYMPHONY_SPEC.md) | Product/spec background. |
| [AGENTS.md](AGENTS.md) | Guidance for coding agents working in this repository. |

## Requirements

- Node.js 22+
- npm
- Git
- Optional for real runs: `gh`, `codex`, `claude`, Jira/Plane/GitHub credentials, and Postgres

## Install

```bash
npm install
npm run build
npm test
```

## Quick Start With Mock Data

The mock workflow does not require external credentials.

```bash
npm run validate:mock
npm run dry-run:mock
```

Run one daemon polling cycle:

```bash
npm run daemon:mock:once
```

Run the mock daemon continuously:

```bash
npm run daemon:mock
```

## Workflow Files

A workflow is a Markdown file with YAML front matter plus a prompt body.

Start with one of the examples:

```bash
cp examples/WORKFLOW.quickstart.mock.md WORKFLOW.md
```

Useful examples:

| File | Use case |
| --- | --- |
| `examples/WORKFLOW.quickstart.mock.md` | Local mock validation and dry-run. |
| `examples/WORKFLOW.dashboard.mock.example.md` | Mock daemon with local dashboard enabled. |
| `examples/WORKFLOW.github-issues.example.md` | GitHub Issues + Codex. |
| `examples/WORKFLOW.claude-code.example.md` | GitHub Issues + Claude Code. |
| `examples/WORKFLOW.jira.example.md` | Jira + Codex. |
| `examples/WORKFLOW.plane.example.md` | Plane + Codex. |
| `examples/WORKFLOW.shell-agent.example.md` | Generic trusted shell runner. |
| `examples/WORKFLOW.docker.mock.example.md` | Docker Compose mock workflow. |

Validate any workflow before running it:

```bash
node dist/src/cli/index.js validate ./WORKFLOW.md
```

Preview what would happen without writing to Git or trackers:

```bash
node dist/src/cli/index.js dry-run ./WORKFLOW.md
```

Run one processing cycle:

```bash
node dist/src/cli/index.js run ./WORKFLOW.md
```

Run continuously:

```bash
node dist/src/cli/index.js daemon ./WORKFLOW.md
```

## Real Task Setup

For real tracker and agent runs:

1. Copy the closest workflow example.
2. Configure tracker, repository, branch prefix, agent, states, and retry settings.
3. Set secrets through environment variables. Do not commit secrets.
4. Run `validate`.
5. Run `dry-run`.
6. Start with one low-risk issue.
7. Review the draft PR manually.

Common environment variables:

```bash
export GITHUB_TOKEN="..."
export GH_TOKEN="..."
export JIRA_EMAIL="..."
export JIRA_API_TOKEN="..."
export PLANE_API_TOKEN="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export DATABASE_URL="postgres://orchestrator:change-me@localhost:5432/orchestrator"
```

Recommended production state:

```yaml
state:
  kind: postgres
  connection_string: ${DATABASE_URL}
  lock_ttl_seconds: 900
```

## Local API And UI

Start the API against the root example workflow:

```bash
npm run api
```

Build and serve the UI in development:

```bash
npm run ui:dev
```

Open:

```text
http://127.0.0.1:5173
```

Build the static UI bundle:

```bash
npm run ui:build
```

The API/UI are local operator tooling. Do not expose them publicly without adding authentication and
authorization.

## Docker Compose

Prepare local files:

```bash
mkdir -p config workspaces logs data
cp examples/WORKFLOW.docker.mock.example.md config/WORKFLOW.md
cp examples/mock-issues.json config/mock-issues.json
mkdir -p config/template-repo
git -C config/template-repo init -b main
git -C config/template-repo config user.email "local@example.invalid"
git -C config/template-repo config user.name "Local Demo"
printf "# Docker demo repo\n" > config/template-repo/README.md
git -C config/template-repo add README.md
git -C config/template-repo commit -m "Initial demo repo"
```

Build and start:

```bash
docker compose up --build -d
```

Open:

```text
http://127.0.0.1:4001/
```

Useful commands:

```bash
docker compose ps
docker compose logs -f orchestrator-api
docker compose logs -f orchestrator-worker
docker compose run --rm orchestrator-worker validate /config/WORKFLOW.md
docker compose run --rm orchestrator-worker dry-run /config/WORKFLOW.md
```

See [docs/deployment.md](docs/deployment.md) for details.

## Development

Common commands:

```bash
npm run build
npm test
npm run lint
npm run validate:examples
npm run validate:mock
npm run dry-run:mock
npm run daemon:mock:once
```

Project layout:

```text
src/
  agents/        Agent runner registry and runner implementations
  cli/           CLI entrypoint
  core/          Older MVP/domain path retained for compatibility
  daemon/        Polling loop
  dashboard/     Daemon status dashboard
  git/           Repository clone and branch handling
  github/        Draft PR creation through gh
  logging/       Secret redaction and safe logging
  orchestrator/  Runtime orchestration cycle
  security/      Command guard and config warnings
  server/        Local API and static UI serving
  state/         Memory, JSON, and Postgres run-state stores
  trackers/      Tracker registry and adapters
  workflow/      WORKFLOW.md parsing and validation
  workspaces/    Workspace planning and path safety
ui/              React operator console
tests/           Node test suite
docs/            Design, roadmap, deployment, and extension docs
```

When changing behavior, keep `AGENTS.md` guidance in mind:

- Keep core execution tracker-agnostic.
- Keep agent execution behind `AgentRunner`.
- Keep tracker integrations behind `TrackerAdapter`.
- Never add auto-merge behavior.
- Redact secrets in logs, CLI output, API responses, and tests.
- Add tests for workflow parsing, state transitions, path safety, tracker normalization, and runner behavior.

## Safety Notes

- `run` and `daemon` can execute Git, GitHub CLI, Codex, Claude Code, Shell commands, and tracker
  write APIs depending on workflow config.
- Use `validate` and `dry-run` before real runs.
- Keep dashboard/API bindings local-only.
- Use least-privilege credentials.
- Run agents in isolated workspaces.
- Review all draft PRs manually.
