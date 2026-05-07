import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/logging/redact.js";

test("redactSecrets removes common token forms", () => {
  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecretvalue Bearer abcdefghijklmnop");

  assert.equal(redacted, "OPENAI_API_KEY=[REDACTED] Bearer [REDACTED]");
});
