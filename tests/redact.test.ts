import test from "node:test";
import assert from "node:assert/strict";
import { redactEnv, redactSecrets } from "../src/logging/redact.js";

test("redactSecrets removes common token forms", () => {
  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecretvalue Bearer abcdefghijklmnop");

  assert.equal(redacted, "OPENAI_API_KEY=[REDACTED] Bearer [REDACTED]");
});

test("redactSecrets removes Postgres passwords from connection strings", () => {
  const redacted = redactSecrets("DATABASE_URL=postgres://orchestrator:secret@localhost:5432/orchestrator");

  assert.equal(redacted, "DATABASE_URL=[REDACTED]");
});

test("redactSecrets removes Claude Code secrets from JSON-style config output", () => {
  const redacted = redactSecrets({
    agent: {
      kind: "claude-code",
      env: {
        ANTHROPIC_API_KEY: "anthropic-secret-value"
      }
    }
  });

  assert.match(redacted, /"ANTHROPIC_API_KEY": "\[REDACTED\]"/);
  assert.equal(redacted.includes("anthropic-secret-value"), false);
});

test("redactSecrets removes generic sensitive environment-style names", () => {
  const redacted = redactSecrets("CUSTOM_CREDENTIAL=top-secret DATABASE_PASSWORD=hunter2 API_SECRET=secret-value");

  assert.equal(redacted, "CUSTOM_CREDENTIAL=[REDACTED] DATABASE_PASSWORD=[REDACTED] API_SECRET=[REDACTED]");
});

test("redactEnv redacts values whose names look sensitive", () => {
  const redacted = redactEnv({
    GITHUB_TOKEN: "ghp_secret",
    NORMAL_VALUE: "visible",
    SERVICE_KEY: "key-secret"
  });

  assert.deepEqual(redacted, {
    GITHUB_TOKEN: "[REDACTED]",
    NORMAL_VALUE: "visible",
    SERVICE_KEY: "[REDACTED]"
  });
});
