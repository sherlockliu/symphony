# Adding Trackers

Owned Symphony keeps tracker-specific code behind `TrackerAdapter` and `TrackerRegistry`. The
orchestrator core should only depend on the adapter contract, not on Jira, Plane, GitHub Issues, or
future tracker clients directly.

---

## When To Add A Tracker

Add a production tracker when a new issue system should feed candidate work into the orchestrator or
receive writeback after a draft PR is created.

Good candidates:

- The API can list candidate issues by state, query, label, or another stable selector.
- The payload includes enough data for `id`, `identifier`, `title`, and `state`.
- Authentication can be provided through environment variables or a runtime secret manager.
- The writeback behavior is safe: comment and move to human review, never auto-close or auto-merge.

Use the Mock tracker for one-off JSON imports.

---

## Adapter Contract

```ts
export interface TrackerAdapter {
  readonly capabilities?: TrackerCapabilities;
  listIssues(): Promise<Issue[]>;
  fetchIssue?(id: string): Promise<Issue>;
  addPullRequestComment?(issue: Issue, prUrl: string): Promise<void>;
  addNeedsHumanAttentionComment?(issue: Issue, state: IssueRunState): Promise<void>;
  transitionToHumanReview?(issue: Issue): Promise<void>;
}
```

`listIssues()` returns normalized tracker items. The orchestrator then filters those items through
`states.active` from `WORKFLOW.md`.

Optional write methods should be implemented only when the tracker supports safe mutation.

---

## Normalized Issue Model

The normalized tracker model is `Issue` in `src/types.ts`; `TrackedIssue` is exported as the tracker
contract name in `src/trackers/tracker.ts`.

| Field | Guidance |
| --- | --- |
| `id` | Stable external ID used for durable run state. Include enough context to avoid collisions. |
| `identifier` | Human-readable key, such as `PROJ-123` or `repo#42`. |
| `title` | Short issue title. |
| `description` | Plain text or Markdown description, or `null`. |
| `priority` | Numeric priority, or `null`. |
| `state` | Current tracker state used by `states.active` and reconciliation. |
| `branchName` | External suggested branch name, or `null`. |
| `url` | Browser URL for operators, or `null`. |
| `labels` | Lowercase or consistently normalized labels. |
| `blockedBy` | Known blockers mapped to ID/identifier/state when available. |
| `createdAt`, `updatedAt` | Tracker timestamps or `null`. |

Registry-created adapters are wrapped with `validateTrackedIssues()`, so invalid normalized payloads
fail before entering the orchestrator.

Do not store raw tracker payloads in run state, logs, dashboard responses, or comments.

---

## Capabilities

Trackers declare capabilities through the registry:

```ts
export type TrackerCapabilities = {
  canComment: boolean;
  canTransition: boolean;
  canFetchByQuery: boolean;
  canFetchByLabel: boolean;
};
```

Workflow authors can require capabilities:

```yaml
tracker:
  kind: github-issues
  require_comment: true
  require_transition: true
  require_fetch_by_label: true
```

If the selected adapter does not support a required capability, the orchestrator fails during
startup with a clear error.

---

## Register The Tracker

Register a tracker through `TrackerRegistry` in `src/trackers/registry.ts`:

```ts
registerTracker<ExampleTrackerConfig>({
  kind: "example",
  capabilities: {
    canComment: true,
    canTransition: true,
    canFetchByQuery: true,
    canFetchByLabel: false
  },
  validateConfig(raw, context) {
    const baseUrl = stringAt(raw, "baseUrl", context.issues, "tracker.base_url");
    const apiToken = stringAt(raw, "apiToken", context.issues, "tracker.api_token");
    if (baseUrl === undefined || apiToken === undefined) {
      return undefined;
    }
    return {
      kind: "example",
      baseUrl,
      apiToken
    };
  },
  create(config) {
    return new ExampleTrackerAdapter(config);
  }
});
```

After registration, `validateWorkflow()` accepts `tracker.kind: example`, and `createTracker()` can
instantiate the adapter without changes to `Orchestrator`.

---

## Example Skeleton

```ts
export class ExampleTrackerAdapter implements TrackerAdapter {
  readonly capabilities = {
    canComment: true,
    canTransition: true,
    canFetchByQuery: true,
    canFetchByLabel: false
  };

  async listIssues(): Promise<TrackedIssue[]> {
    return this.fetchCandidateIssues();
  }

  async fetchCandidateIssues(): Promise<TrackedIssue[]> {
    return [];
  }

  async fetchIssue(id: string): Promise<TrackedIssue> {
    throw new Error("Not implemented");
  }

  async addPullRequestComment(issue: TrackedIssue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.id, `Draft PR created: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: TrackedIssue, state: IssueRunState): Promise<void> {
    await this.commentOnIssue(
      issue.id,
      `Symphony needs human attention after ${state.attemptCount} attempt(s). Last error: ${state.lastErrorMessage ?? state.lastErrorType ?? "unknown"}.`
    );
  }

  async transitionToHumanReview(issue: TrackedIssue): Promise<void> {
    await this.transitionIssue(issue.id, "Human Review");
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    throw new Error("Not implemented");
  }
}
```

See `examples/ExampleTrackerAdapter.ts` for a fuller template.

---

## Validation

Tracker validation lives with the registry factory. A validator should:

- Validate only fields for that tracker kind.
- Return a typed config object.
- Push human-readable messages into `context.issues`.
- Resolve local file paths relative to `context.baseDir`.
- Apply safe defaults for optional fields.
- Reject invalid limits, empty labels, empty states, and malformed URLs where relevant.
- Use secret-like config names such as `token` or `api_token` so redaction catches them.

---

## Testing Strategy

Add tests that avoid real credentials and external services:

- Adapter payload normalization.
- Mocked network calls for fetch, comment, and transition behavior.
- Config validation for required and optional fields.
- Unknown tracker kind behavior.
- Capability requirement failures.
- Registry creation for the new `kind`.
- An orchestrator-level test proving the core does not import concrete tracker adapters.

---

## Safety Considerations

- Do not log raw API tokens, environment variables, or full tracker payloads.
- Keep comments and transitions idempotent where the tracker API allows it.
- Transition only to configured human-review states or labels.
- Never close issues automatically unless a future explicit workflow adds that behavior.
- Never merge PRs from a tracker adapter.
- Preserve draft PR behavior.
- Do not expose private tracker fields through the dashboard API.
- Document tracker-specific rate limits and pagination behavior.
