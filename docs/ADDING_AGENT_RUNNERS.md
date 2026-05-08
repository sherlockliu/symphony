# Adding Agent Runners

Owned Symphony keeps agent-specific execution behind `AgentRunner` and `AgentRunnerRegistry`. The
orchestrator core should only depend on the runner contract, not on Codex, Shell, Claude Code,
Aider, Cursor, or internal tools directly.

---

## AgentRunner Contract

```ts
export interface AgentRunner {
  readonly kind: string;
  readonly capabilities?: AgentCapabilities;
  run(input: AgentRunRequest): Promise<AgentRunResult>;
}
```

`AgentRunRequest` provides:

| Field | Meaning |
| --- | --- |
| `issue` | Normalized tracker issue selected by the orchestrator. |
| `workspace.path` | Safe per-issue workspace directory. |
| `workspace.repoPath` | Repository checkout path where the runner should work. |
| `prompt` | Fully rendered prompt from `WORKFLOW.md`. |
| `workflowPath` | Absolute workflow path. |
| `timeoutSeconds` | Runner timeout budget. |
| `logDir` | Directory where runner logs should be written. |

`AgentRunResult` supports the current process-compatible fields plus structured metadata:

```ts
export type AgentRunResult = {
  success: boolean;
  runner: string;
  summary?: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
  logsPath?: string;
  stdout: string;
  stderr: string;
  branchName?: string;
  pullRequestUrl?: string;
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
};
```

Return failure results when the runner can report cleanly. Throw only for infrastructure failures
that prevent a meaningful result.

---

## Capabilities

```ts
export type AgentCapabilities = {
  canEditFiles: boolean;
  canRunCommands: boolean;
  canCreateCommits: boolean;
  canOpenPullRequests: boolean;
};
```

Capabilities document runner expectations. Today the orchestrator still owns commit, PR, and tracker
writeback behavior.

---

## Register A Runner

```ts
registerAgentRunner<ExampleAgentConfig>({
  kind: "example-agent",
  capabilities: {
    canEditFiles: true,
    canRunCommands: true,
    canCreateCommits: false,
    canOpenPullRequests: false
  },
  validateConfig(raw, context) {
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
  create(config, dependencies) {
    return new ExampleAgentRunner(config, dependencies?.executor);
  }
});
```

After registration, `validateWorkflow()` accepts the new `agent.kind`, and `createAgentRunner()` can
instantiate it without orchestrator changes.

---

## Example Skeleton

```ts
export class ExampleAgentRunner implements AgentRunner {
  readonly kind = "example-agent";

  async run(input: AgentRunRequest): Promise<AgentRunResult> {
    return {
      success: false,
      runner: this.kind,
      summary: "Example runner is not implemented",
      exitCode: null,
      timedOut: false,
      logPath: path.join(input.logDir, `${input.issue.identifier}-example.log`),
      stdout: "",
      stderr: "Example runner is a template only",
      error: {
        type: "agent_not_implemented",
        message: "Example runner is a template only",
        retryable: false
      }
    };
  }
}
```

See `examples/ExampleAgentRunner.ts` for a fuller template.

---

## Prompt Handling

Runner-specific options decide how prompts are passed:

- `stdin`: send the rendered prompt to the process stdin.
- `file`: write `.orchestrator/prompt.md` inside the repo workspace and pass that path to the tool.
- SDK/API runners may place the prompt in an API request body.

`agent.save_prompt` defaults to `false` for command runners. DryRun intentionally writes the prompt
because its purpose is previewing the rendered task.

Always redact prompt logs with `redactSecrets()`.

---

## Logs And Timeouts

All production runners should:

- Create a per-run log path or log directory under `request.logDir`.
- Capture stdout and stderr when process-like streams exist.
- Enforce `timeoutSeconds`.
- Redact secrets before writing logs.
- Return `logsPath` when multiple log files are created.

Use `NodeProcessExecutor` for process runners when possible; it centralizes timeout handling and
redacted process logs.

---

## Built-In Process Runners

### Codex Runner

`agent.kind: codex` runs the configured Codex command in the repo workspace and passes the rendered
prompt on stdin.

```yaml
agent:
  kind: codex
  command: codex
  args: ["exec", "-"]
  timeout_seconds: 900
  log_dir: ../.symphony/logs
```

### Claude Code Runner

`agent.kind: claude-code` runs the configured Claude Code command in the repo workspace and passes
the rendered prompt on stdin. The default command shape is `claude -p`.

```yaml
agent:
  kind: claude-code
  command: claude
  args: ["-p"]
  timeout_seconds: 1800
  log_dir: ../.symphony/logs
  env:
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

The repository tests mock process execution; they do not require Claude Code to be installed.

### Shell Runner

`agent.kind: shell` is the generic production extension point for Claude Code, Aider, Cursor CLI,
internal agents, or custom scripts.

```yaml
agent:
  kind: shell
  command: "my-agent --non-interactive"
  timeout_minutes: 60
  prompt_mode: stdin
  save_prompt: false
  env:
    AGENT_MODE: coding
```

The shell runner runs inside `request.workspace.repoPath`. Treat it as trusted code execution:
configure least-privilege credentials and isolated workspaces.

---

## Testing Strategy

Add tests without real external tools:

- Registry registration and unknown kind validation.
- Per-runner config validation.
- Prompt passing mode.
- Timeout behavior.
- Log capture and secret redaction.
- Orchestrator import guard proving concrete runners stay outside core.

---

## Security Considerations

- Run only trusted commands.
- Run inside the prepared repo workspace.
- Use least-privilege credentials.
- Prefer isolated containers or locked-down machines for real agents.
- Do not let runners merge PRs or transition tracker issues directly.
- Keep destructive cleanup out of runner defaults.
