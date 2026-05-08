#!/usr/bin/env node

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  if (process.env.FAKE_AGENT_FAIL === "1") {
    console.error("fake agent failed");
    process.exit(2);
  }

  console.log(`fake agent cwd=${process.cwd()}`);
  console.log(`fake agent prompt_length=${input.length}`);
  if (process.env.FAKE_AGENT_PR_URL) {
    console.log(process.env.FAKE_AGENT_PR_URL);
  }
});
