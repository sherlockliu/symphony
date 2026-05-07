# Adding Agent Runners

Owned Symphony keeps agent-specific execution behind `AgentRunner` and the agent runner registry in
`src/agents/registry.ts`. The orchestrator core should only depend on `AgentRunner`, not on Codex,
Claude Code, Aider, Cursor, or internal execution tools directly.

---

## When To Add A Runner

Add a runner when a new coding tool needs to receive the rendered Symphony prompt and operate inside
the prepared issue workspace.

Good candidates:

- The tool can run non-interactively from a command or SDK.
- It accepts a prompt through stdin, a file, an API call, or another deterministic input channel.
- It can be constrained to the prepared repository path.
- It returns a clear success/failure signal.
- It can produce logs that are useful for audit and debugging.

Do not add a runner if a different `agent.command` / `agent.args` for the existing Codex runner is
enough.

---

## AgentRunner Contract

```ts
export interface AgentRunner {
  readonly kind: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
```

`AgentRunRequest` provides:

| Field | Meaning |
| --- | --- |
| `issue` | Normalized tracker issue selected by the orchestrator. |
| `workspace.path` | Safe per-issue workspace directory. |
| `workspace.repoPath` | Repository checkout path where the agent should operate. |
| `prompt` | Fully rendered prompt from the `WORKFLOW.md` Markdown body. |
| `workflowPath` | Absolute path to the workflow file that produced the run. |
| `timeoutSeconds` | Timeout budget configured for this runner. |
| `logDir` | Directory where runner logs should be written. |

`AgentRunResult` must report:

| Field | Meaning |
| --- | --- |
| `success` | `true` only when the runner completed successfully. |
| `runner` | Runner kind or concrete runner name. |
| `exitCode` | Process exit code, or `null` if unavailable. |
| `timedOut` | `true` when timeout handling terminated the run. |
| `logPath` | Path to the primary redacted log file. |
| `stdout`, `stderr` | Captured output, if the runner has process-like streams. |

Failure should be represented in the result when possible. Throw only for infrastructure failures
that prevent the runner from producing a meaningful result.

---

## How Prompts Are Passed

The orchestrator renders the prompt before calling the runner:

```ts
const agentResult = await runner.run({
  issue,
  workspace,
  prompt,
  workflowPath,
  timeoutSeconds,
  logDir
});
```

The runner decides how to pass that prompt to the tool:

- stdin for process runners.
- a temporary file for tools that prefer file input.
- an SDK/API request body for internal runners.

Prompt logs must be redacted before writing to disk.

---

## Logs

Each runner should write a primary log under `request.logDir`, usually using the issue identifier in
the file name.

Logs should include:

- runner kind
- issue identifier
- workspace and repo path
- command or API operation summary
- timeout
- exit code or status
- stdout/stderr or equivalent diagnostic output

Logs should not include:

- raw API tokens
- environment variables containing secrets
- unredacted bearer tokens
- raw private tracker payloads

Use `redactSecrets()` from `src/logging/redact.ts` before writing logs.

---

## Codex Runner

Codex is the first concrete process runner.

Current behavior:

- Uses configured `agent.command` and `agent.args`.
- Runs in `request.workspace.repoPath`.
- Sends the rendered prompt on stdin.
- Captures stdout and stderr.
- Writes a redacted process log through `NodeProcessExecutor`.
- Enforces `agent.timeout_seconds`.
- Reports `success: false`, `exitCode: null`, and `timedOut: true` when the process times out.

The Codex runner does not merge PRs and does not write tracker comments directly. Those actions stay
in the orchestrator and PR/tracker services.

---

## Register A Runner

Register runner support in `src/agents/registry.ts`:

```ts
registerAgentRunner<ExampleAgentConfig>({
  kind: "example-agent",
  validate(raw, context) {
    const command = stringAt(raw, "command", context.issues, "agent.command");
    const timeoutSeconds = optionalNumberAt(raw, "timeoutSeconds", context.issues, "agent.timeout_seconds") ?? 900;
    const logDir = optionalStringAt(raw, "logDir", context.issues, "agent.log_dir") ?? "logs";

    if (command === undefined) {
      return undefined;
    }

    return {
      kind: "example-agent",
      command,
      timeoutSeconds,
      logDir: path.resolve(context.baseDir, logDir)
    };
  },
  create(config) {
    return new ExampleAgentRunner(config);
  }
});
```

After registration, `validateWorkflow()` accepts `agent.kind: example-agent`, and
`createAgentRunner()` can instantiate it without changes to `Orchestrator`.

---

## Add Schema Validation

Agent validation lives with the registration. A validator should:

- Validate only fields for that agent kind.
- Return a typed agent config object.
- Push readable messages into `context.issues`.
- Resolve log paths relative to `context.baseDir`.
- Apply safe defaults for optional fields.
- Reject invalid timeout values.
- Keep secret values out of config summaries and logs.

Use `timeout_seconds` and `log_dir` in `WORKFLOW.md`; the parser normalizes them to
`timeoutSeconds` and `logDir`.

---

## Example Template

See `examples/ExampleAgentRunner.ts` for a template runner. It demonstrates:

- typed config
- registry validation
- prompt handling
- redacted log writing
- timeout-aware result shape

---

## Tests

Add tests that do not require real external tools:

- Unit test config validation for required and optional fields.
- Unit test the runner with mocked process execution or fake SDK calls.
- Assert logs are redacted.
- Assert timeout behavior.
- Add an orchestrator-level test that registers the new runner and runs without injecting a runner
  dependency. This proves orchestrator core still depends only on `AgentRunner`.

`tests/agentRegistry.test.ts` contains the current custom-registration coverage pattern.

---

## Safety Considerations

- Run only inside `request.workspace.repoPath`.
- Enforce the configured timeout.
- Capture logs for auditability.
- Redact secrets before writing logs.
- Avoid returning raw secrets in stdout/stderr if a service call may echo credentials.
- Do not let runners create, merge, or close PRs directly.
- Do not let runners transition tracker issues directly.
- Keep destructive cleanup out of runner defaults.
