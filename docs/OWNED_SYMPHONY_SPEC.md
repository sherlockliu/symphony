Read AGENTS.md and docs/OWNED_SYMPHONY_SPEC.md.

Before coding:
1. Inspect the repo.
2. Inspect the local OpenAI Symphony SPEC.md if available.
3. Summarize the architecture you will implement.
4. Confirm the milestone boundary.

Then implement Milestone 1 only.

Milestone 1:
- Create TypeScript project skeleton.
- Add CLI entrypoint.
- Add commands:
  - orchestrator validate ./WORKFLOW.md
  - orchestrator dry-run ./WORKFLOW.md
  - orchestrator run ./WORKFLOW.md
- For now, run can be a safe stub.
- Implement WORKFLOW.md parser with YAML front matter and Markdown body.
- Implement schema validation.
- Implement environment variable interpolation.
- Implement secret redaction utility.
- Implement mock tracker.
- Implement prompt renderer.
- Add example mock issues.
- Add unit tests.

Do not implement:
- Jira adapter
- Plane adapter
- Codex runner
- GitHub PR creation
- Docker Compose
- dashboard

After implementation, show:
- changed files
- test results
- example validate command
- example dry-run command
- next recommended milestone