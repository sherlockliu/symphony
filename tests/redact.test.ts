import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/logging/redact.js";

test("redactSecrets removes common token forms", () => {
  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecretvalue Bearer abcdefghijklmnop");

  assert.equal(redacted, "OPENAI_API_KEY=[REDACTED] Bearer [REDACTED]");
});

test("redactSecrets removes Postgres passwords from connection strings", () => {
  const redacted = redactSecrets("DATABASE_URL=postgres://orchestrator:secret@localhost:5432/orchestrator");

  assert.equal(redacted, "DATABASE_URL=[REDACTED]");
});
