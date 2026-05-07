# Adding Trackers

Owned Symphony keeps tracker-specific code behind `TrackerAdapter` and the tracker registry in
`src/trackers/registry.ts`. The orchestrator core should only depend on `TrackerAdapter`, not on
Jira, Plane, Mock, or future tracker clients directly.

> [!NOTE]
> The current normalized tracker model is `Issue` in `src/types.ts`. This document uses "tracked
> issue" to mean an external tracker item after it has been normalized into that `Issue` shape.

---

## When To Add A Tracker

Add a tracker adapter when a new issue system needs to feed candidate work into the orchestrator or
receive writeback after a draft PR is created.

Good candidates:

- The system has a stable API for listing candidate issues.
- The system exposes enough fields to build a useful `Issue.identifier`, `Issue.title`,
  `Issue.description`, and `Issue.state`.
- The target workflow has a clear candidate state and human-review state.
- Authentication can be provided through environment variables or runtime secrets.

Do not add a tracker if a one-off JSON export through the Mock tracker is enough.

---

## Adapter Contract

Implement `TrackerAdapter`:

```ts
export interface TrackerAdapter {
  listIssues(): Promise<Issue[]>;
  addPullRequestComment?(issue: Issue, prUrl: string): Promise<void>;
  addNeedsHumanAttentionComment?(issue: Issue, state: IssueRunState): Promise<void>;
  transitionToHumanReview?(issue: Issue): Promise<void>;
}
```

`listIssues()` should return the tracker items that Symphony is allowed to inspect. The orchestrator
then filters those issues through `states.active` from `WORKFLOW.md`.

Optional write methods should be implemented only when the tracker supports safe mutation.

---

## Normalize External Fields

Every tracker must normalize its native payload into `Issue`:

| `Issue` field | Guidance |
| --- | --- |
| `id` | Stable external ID used for internal run state. |
| `identifier` | Human-readable key, such as `PROJ-123`. |
| `title` | Short issue title. |
| `description` | Plain text or Markdown description when available. |
| `priority` | Numeric priority, or `null` when unavailable. |
| `state` | Current workflow state name used by `states.active` and reconciliation. |
| `branchName` | External suggested branch name, or `null`. |
| `url` | Browser URL for operators, or `null`. |
| `labels` | Normalized string labels. |
| `blockedBy` | Known blockers, mapped to ID/identifier/state when available. |
| `createdAt`, `updatedAt` | ISO timestamps or `null`. |

Keep raw tracker payloads out of run state, logs, dashboard responses, and comments unless there is a
clear, redacted reason.

---

## Example Adapter

The example below includes `fetchCandidateIssues`, `fetchIssue`, `commentOnIssue`, and
`transitionIssue` helper methods. The methods required by Symphony are `listIssues`,
`addPullRequestComment`, `addNeedsHumanAttentionComment`, and `transitionToHumanReview`.

```ts
class ExampleTrackerAdapter implements TrackerAdapter {
  constructor(private readonly config: ExampleTrackerConfig) {}

  async listIssues(): Promise<Issue[]> {
    return this.fetchCandidateIssues();
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const payloads = await this.fetchJson("/issues?state=ready");
    return payloads.map(normalizeExampleIssue);
  }

  async fetchIssue(id: string): Promise<Issue> {
    const payload = await this.fetchJson(`/issues/${encodeURIComponent(id)}`);
    return normalizeExampleIssue(payload);
  }

  async addPullRequestComment(issue: Issue, prUrl: string): Promise<void> {
    await this.commentOnIssue(issue.id, `Draft PR created: ${prUrl}`);
  }

  async addNeedsHumanAttentionComment(issue: Issue, state: IssueRunState): Promise<void> {
    await this.commentOnIssue(issue.id, `Symphony needs human attention after ${state.attemptNumber} attempt(s).`);
  }

  async transitionToHumanReview(issue: Issue): Promise<void> {
    await this.transitionIssue(issue.id, this.config.reviewState);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    // POST tracker comment API.
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    // POST tracker transition/state API.
  }
}
```

See `examples/ExampleTrackerAdapter.ts` for a fuller template.

---

## Register The Tracker

Register tracker support in `src/trackers/registry.ts`:

```ts
registerTracker<ExampleTrackerConfig>({
  kind: "example",
  validate(raw, context) {
    const baseUrl = stringAt(raw, "baseUrl", context.issues, "tracker.base_url");
    const apiToken = stringAt(raw, "apiToken", context.issues, "tracker.api_token");
    const reviewState =
      optionalStringAt(raw, "reviewState", context.issues, "tracker.review_state") ?? "Human Review";

    if (baseUrl === undefined || apiToken === undefined) {
      return undefined;
    }

    return {
      kind: "example",
      baseUrl,
      apiToken,
      reviewState
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

## Add Schema Validation

Tracker validation lives with the registration. A validator should:

- Validate only fields for that tracker kind.
- Return a typed tracker config object.
- Push human-readable messages into `context.issues`.
- Resolve file paths relative to `context.baseDir` when the config points to local files.
- Apply safe defaults for optional fields.
- Reject invalid limits, empty state names, and malformed URLs where relevant.

Use secret-like names such as `api_token` / `apiToken` so CLI and log redaction can catch them.

---

## Placeholder Workflow Example

The snippet below shows the intended config shape for a custom tracker. It is documentation-only and
will not validate until a tracker with that `kind` is registered. Keep invalid placeholder configs
out of `examples/WORKFLOW*.md`; those files are expected to validate.

```yaml
tracker:
  kind: example
  base_url: https://tracker.example
  api_token: ${EXAMPLE_TRACKER_API_TOKEN}
  project_key: DEMO
  candidate_state: Ready
  review_state: Human Review
```

---

## Tests

Add tests that avoid real credentials and external services:

- Unit test the adapter's payload normalization.
- Mock network calls for fetch, comment, and transition behavior.
- Test config validation for required and optional fields.
- Test registry creation for the new `kind`.
- Add an orchestrator-level test that registers the new tracker and runs without injecting a
  tracker dependency. This proves orchestrator core still depends only on `TrackerAdapter`.

`tests/trackerRegistry.test.ts` contains the current custom-registration coverage pattern.

---

## Safety Considerations

- Do not log raw API tokens, environment variables, or full tracker payloads.
- Keep writeback idempotent when possible; duplicate daemon polls should not spam comments.
- Transition only to a configured human-review state; never auto-close or auto-merge work.
- Preserve draft PR behavior.
- Ensure errors that may be transient are classified clearly before adding retry behavior.
- Do not expose private tracker fields through the dashboard API.
- Keep workspace paths under the configured workspace root.
- Document any tracker-specific rate limits and pagination behavior.
