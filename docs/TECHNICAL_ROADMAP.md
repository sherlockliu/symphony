# Technical Roadmap

This review reflects the repository as currently implemented. It is intentionally practical: fix the
sharp edges that block reliable local use and controlled production pilots before expanding scope.

## 1. Current State Summary

### Architecture Quality

The codebase has good boundary intent: trackers, runners, workspaces, workflow loading, and state
storage each have dedicated modules. Tracker and agent registries exist, and the runtime
orchestrator accepts injected dependencies for tests.

The main weakness is that the project now has two orchestration paths:

- `src/orchestrator/orchestrator.ts`: newer runtime orchestrator with retry/reconciliation state.
- `src/core/orchestrator.ts`: older MVP path that powers parts of the API/UI and root workflow flow.

That split creates duplicated domain models, duplicated workflow loaders, and inconsistent behavior
between daemon/runtime state and the UI/API JSON state.

### Missing Tests

Coverage is broad for unit-level behavior, mocked trackers, mocked agent processes, examples,
retry rules, and state store serialization. The main missing areas are:

- Docker Compose smoke tests are not automated.
- No real Postgres integration test path is separated from unit tests.
- UI has no component tests or browser smoke tests.
- CLI output has limited snapshot/regression coverage.
- `GitService` uses direct child process execution and does not share the guarded executor tests.
- API/UI operator actions are tested against MVP JSON state, not runtime `RunStateStore`.
- No end-to-end test proves mock tracker -> runtime orchestrator -> JSON/Postgres state -> API/UI.

### Security Gaps

Implemented safety is meaningful: secret redaction, local dashboard defaults, command guard for
agent/process executor calls, draft-only PRs, and no merge behavior.

Remaining gaps:

- `GitService` still shells out directly with inherited stdio, bypassing the redacting
  `ProcessExecutor`.
- The Shell runner guard checks the configured top-level command, but shell payloads remain trusted
  code execution.
- The Postgres store shells out to `psql` and formats SQL parameters manually. Unit tests cover
  serialization, but a real DB driver would be safer.
- API/UI has no auth. It is local-only by convention, not by capability.
- Prompts and ticket descriptions may contain sensitive customer data; prompt-saving defaults differ
  by runner.
- Git repository URLs are trusted input and can point at arbitrary remotes.
- `allow_auto_merge: true` is warned about but not a meaningful feature; it should probably be
  rejected or removed from runtime config.

### Tracker Adapter Gaps

- Jira and Plane adapters are mocked in tests, but real API route differences and pagination need
  more production validation.
- GitHub Issues uses an interpolated `token` value in config, unlike Jira/Plane `*_env` fields.
- Tracker rate limits, backoff, and retry classification are minimal.
- Transition mapping is state-name based and may be brittle across real workflows.
- No Linear adapter yet, despite guidance mentioning it.
- Normalized issue `raw` payloads should remain excluded from API/dashboard output.

### UI Gaps

- The React UI is useful as an operator console, but it reads the local API backed by MVP JSON files.
- It does not show live runtime `RunStateStore` data from daemon mode.
- Retry/cancel/ignore actions update JSON state but do not control the runtime daemon worker.
- No auth, no RBAC, no audit trail, no log streaming.
- No UI tests.
- Settings are read-only and do not validate workflow config edits.

### Docker / Deployment Gaps

- Compose runs API/UI and worker, but does not currently include a Postgres service.
- The image includes GitHub CLI, but not Codex or Claude Code CLIs.
- Worker healthcheck only validates config; it does not prove polling is healthy.
- No automated Compose smoke test.
- No production TLS/auth story. That is fine for now; keep it local/private.
- The Dockerfile installs GitHub CLI from an external apt source during build, which needs supply
  chain review before production use.

### Data Persistence Limitations

- Memory state is dev-only.
- JSON state is useful for demos but not safe for multi-worker use.
- Postgres state is the right direction, but currently depends on `psql` and local SQL formatting.
- Runtime state has no dedicated event table.
- API/UI does not consume runtime state yet.
- Startup reconciliation is local-first and does not verify remote GitHub PR or tracker state.

### Coupling To Jira, Plane, Codex, Or GitHub

- Runtime core does not import Jira or Plane adapters directly, but CLI redaction/conversion has
  provider-specific branches.
- `src/core/domain.ts` still hardcodes tracker kinds.
- `src/core/orchestrator.ts` directly depends on Mock and GitHub output.
- Pull request output is GitHub-only.
- Workflow runtime schema requires a `github` block even when PR output may be disabled or future
  providers are desired.
- `GitService` is concrete and not behind a repository service registry.

## 2. Risk List

| Risk | Severity | Why it matters | Practical mitigation |
| --- | --- | --- | --- |
| Two orchestrator/domain paths | High | Runtime, API, docs, and examples can drift | Consolidate on runtime orchestrator and adapt UI/API to `RunStateStore` |
| Git commands bypass guarded executor | High | Logs/redaction/safety behavior is inconsistent | Move Git execution behind `ProcessExecutor` |
| UI/API is unauthenticated | High if exposed | Operator actions and run data are sensitive | Keep localhost-only; add auth before public/server use |
| Postgres via `psql` + manual SQL formatting | Medium | Operational dependency and escaping risk | Move to a Node Postgres driver when dependency policy allows |
| Shell runner trusted execution | Medium | Commands can do anything inside the workspace/user context | Require explicit `allowed_commands`, isolate containers, document trust boundary |
| GitHub-only PR provider | Medium | Blocks other forges and couples workflow schema | Add `PullRequestProvider` abstraction |
| Tracker transition brittleness | Medium | Real Jira/Plane workflows vary | Add dry-run transition validation and better mapping config |
| Docker lacks production DB service | Medium | Compose is demo-friendly, not durable by default | Add optional Postgres profile after current Compose is stable |
| No end-to-end runtime/UI test | Medium | UI may show stale or wrong state | Add mock e2e over runtime state |
| Prompt/ticket privacy | Medium | Logs and saved prompts may include sensitive content | Make save-prompt policy explicit per runner and redact known secrets |

## 3. Recommended Next 10 Implementation Tasks

1. **Unify API/UI around `RunStateStore`.** Make `src/server/api.ts` read runtime state instead of
   `.orchestrator/runs.json`.
2. **Retire or isolate the MVP core path.** Keep compatibility only through a small adapter, or remove
   `src/core/orchestrator.ts` once runtime has feature parity.
3. **Move `GitService` to `ProcessExecutor`.** Enforce workspace cwd, redacted logs, timeouts, and
   command allow/block lists for clone/fetch/checkout.
4. **Add a `PullRequestProvider` interface and registry.** Move GitHub draft PR creation behind it.
5. **Make workflow schema less GitHub-specific.** Replace top-level `github` with `pull_request` or
   `outputs` config while keeping backward compatibility.
6. **Add Docker Compose smoke tests.** Validate, dry-run, API health, and one mock worker cycle.
7. **Add optional Postgres Compose profile.** Keep current local JSON flow as default until Compose is
   stable.
8. **Add runtime e2e test.** Mock tracker + dry-run runner + JSON/Postgres store + API readback.
9. **Add UI smoke/component tests.** Cover board rendering, filters, run drawer, and failed API state.
10. **Harden tracker production behavior.** Add pagination/backoff tests and route assumptions docs for
    Jira, Plane, and GitHub Issues.

## 4. Suggested Folder / File Refactors

Recommended target shape:

```text
src/
  app/                 CLI composition and dependency wiring
  orchestrator/        Runtime orchestration only
  domain/              Shared Issue, Run, Workflow, Result types
  trackers/            Tracker adapters and registry
  agents/              Agent runners and registry
  repositories/        Git clone/branch abstraction
  pull-requests/       PullRequestProvider registry; GitHub implementation
  state/               RunStateStore implementations and migrations
  workflow/            Single workflow parser/schema
  api/                 Runtime API backed by RunStateStore
  dashboard/           Daemon dashboard status
  security/            Redaction, command guard, path validation
```

Specific refactors:

- Move `src/types.ts` and `src/core/domain.ts` into one shared domain module.
- Move `src/github/pullRequestService.ts` and `src/core/githubOutput.ts` into
  `src/pull-requests/github/`.
- Split `src/cli/index.ts` into small command handlers under `src/cli/commands/`.
- Keep `src/core/` only if it means “domain core”; otherwise retire the older MVP implementation.
- Move UI API code from `src/server/api.ts` to `src/api/` once it reads runtime state.
- Put all vendor-specific config redaction behind each adapter/factory.

## 5. MVP Release Checklist

- [ ] One supported happy path is documented and stable: Mock + DryRun + JSON state.
- [ ] One real-task path is documented and stable: GitHub Issues or Jira + Codex/Claude + draft PR.
- [ ] `npm install`, `npm run build`, `npm test`, `npm run validate:mock`, and `npm run dry-run:mock`
      pass on a clean checkout.
- [ ] All example workflows validate with example credentials.
- [ ] Runtime state is the source of truth for API/UI.
- [ ] Docker Compose mock flow validates, dry-runs, and serves UI locally.
- [ ] No command path can merge PRs.
- [ ] `GitService` uses guarded execution.
- [ ] README stays short and all deep design docs live in `docs/`.
- [ ] Known limitations are documented.

## 6. Production Hardening Checklist

- [ ] Use Postgres state for daemon/server mode.
- [ ] Replace `psql` shell execution with a Node Postgres driver.
- [ ] Add DB integration tests separate from unit tests.
- [ ] Add authentication and authorization before exposing API/UI beyond localhost.
- [ ] Add audit events for operator actions.
- [ ] Add structured runtime events table.
- [ ] Add backoff/rate-limit handling for tracker and GitHub APIs.
- [ ] Add remote reconciliation for existing PRs and tracker states on restart.
- [ ] Add per-run lease renewal for long agent runs.
- [ ] Run agent workloads in constrained environments with least-privilege credentials.
- [ ] Add Docker image provenance and dependency scanning.
- [ ] Add redaction regression tests for API responses, logs, and CLI output.
- [ ] Add production runbooks for stuck runs, failed PR creation, and tracker writeback failures.
- [ ] Keep Docker Compose stable before considering any orchestration platform beyond it.
