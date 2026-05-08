# AGENTS.md

Guidance for coding agents working in this repository.

## Mission

Owned Symphony is our own TypeScript/Node.js implementation of a Symphony-like coding-agent
orchestrator. It is inspired by the public OpenAI Symphony architecture, but it must remain an
owned implementation. Do not copy or tightly couple this project to the OpenAI Elixir reference
implementation.

The product goal is to turn eligible tracker work items into isolated coding-agent runs, then
prepare draft pull requests for human review.

## Architectural Principles

Keep orchestration modular and tracker-agnostic.

- The core orchestrator must not know Jira, Plane, Linear, GitHub Issues, or mock-specific details.
- Put all tracker-specific behavior behind `TrackerAdapter`.
- Put Jira, Plane, Linear, GitHub Issues, and mock implementations in the tracker layer.
- Put coding-agent execution behind `AgentRunner`.
- Put Codex, Claude Code, Shell, DryRun, and future agents behind the agent runner registry.
- Put workspace creation and path validation behind `WorkspaceManager`.
- Put workflow parsing/loading/rendering behind the workflow and prompt-rendering modules. Treat this
  boundary as the `WorkflowLoader` responsibility even if it is split across files.
- Keep UI/API/dashboard code separate from core execution logic.
- Keep GitHub PR creation behind a pull-request service boundary.
- Keep persistence behind `RunStateStore`; do not bind core logic directly to Postgres or future
  databases.

Core execution should depend on interfaces, not concrete vendor implementations.

## Safety Rules

These are non-negotiable.

- Never implement automatic merging.
- Never call `gh pr merge`, `git merge` for PR landing, or equivalent auto-merge APIs from the
  orchestrator.
- Default to draft PRs and human review.
- Prefer tracker transitions such as `Human Review` after PR creation succeeds.
- Do not transition tracker issues before a PR URL exists unless the user explicitly asks for a
  different safe workflow.
- Never print secrets in logs, CLI output, dashboard API responses, or test snapshots.
- Redact environment variables and config fields that look like tokens, keys, passwords, secrets,
  private keys, bearer tokens, database URLs, or provider API keys.
- Use least-privilege credentials in examples and docs.
- Do not bake secrets into Docker images.
- Do not delete workspaces by default.
- Do not add broad shell execution without explicit boundaries: workspace cwd, timeout, logs,
  redaction, and clear documentation that commands are trusted execution.
- Validate that workspace paths stay inside the configured workspace root.
- Keep dashboard/API defaults local-only unless explicitly changed by the user.

## Coding Style

- Use TypeScript strict mode.
- Prefer small, focused files.
- Define clear interfaces at boundaries.
- Keep side effects at the boundaries: CLI, process execution, filesystem, network clients,
  database clients, and tracker adapters.
- Keep core logic deterministic where possible.
- Avoid unnecessary dependencies.
- Follow existing naming and module patterns before introducing new abstractions.
- Add abstractions only when they reduce real coupling or make extension safer.
- Do not hard-code vendor-specific tracker or agent behavior in the orchestrator core.

## Testing Expectations

Add or update tests for behavior, not just implementation details.

Prioritize tests for:

- Workflow parsing and validation.
- Prompt rendering.
- Issue normalization.
- Tracker capability handling.
- Agent runner result and timeout behavior.
- Retry and run-state transitions.
- Workspace path sanitization.
- Secret redaction.
- Dry-run behavior.
- PR creation safety, especially that no merge command is emitted.

Use mock adapters and mocked process execution before real external services. Unit tests must not
require real Jira, Plane, Linear, GitHub, Codex, Claude Code, or database credentials.

## Extension Guidance

When adding a tracker:

1. Implement `TrackerAdapter`.
2. Normalize external fields into the shared issue model.
3. Register the tracker through the tracker registry.
4. Add config validation for that tracker kind.
5. Add mocked tests for fetch, normalization, comments, transitions, and unsupported capabilities.
6. Keep raw external payloads out of dashboard and CLI output unless explicitly redacted.

When adding an agent runner:

1. Implement `AgentRunner`.
2. Register it through the agent runner registry.
3. Add config validation for that agent kind.
4. Capture logs with redaction.
5. Enforce timeouts.
6. Return structured success/failure results.
7. Document trust boundaries and required credentials.

When adding persistence:

1. Extend `RunStateStore` rather than calling a database from core orchestration.
2. Make migrations idempotent.
3. Preserve existing run state.
4. Do not silently drop or rerun succeeded work.

## Documentation

Keep README examples accurate and copy-pasteable. If a feature is planned but not implemented, mark
it as planned. Do not claim commands, trackers, runners, Docker behavior, dashboard behavior, or
persistence modes work unless they are implemented and tested.

For detailed extension patterns, see:

- `docs/ADDING_TRACKERS.md`
- `docs/ADDING_AGENT_RUNNERS.md`
