import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../src/logging/redact.js";
import type { AgentRunner } from "../src/agents/agentRunner.js";
import { registerAgentRunner, type CustomAgentConfig, type AgentValidationContext } from "../src/agents/registry.js";
import type { AgentRunRequest, AgentRunResult, JsonValue } from "../src/types.js";
import { sanitizePathSegment } from "../src/workspaces/pathSafety.js";

// Example only. This file is a template for maintainers and is not registered by default.
interface ExampleAgentConfig extends CustomAgentConfig {
  kind: "example-agent";
  command: string;
}

export class ExampleAgentRunner implements AgentRunner {
  readonly kind = "example-agent";

  constructor(private readonly config: ExampleAgentConfig) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const logPath = path.join(request.logDir, `${sanitizePathSegment(request.issue.identifier)}-example-agent.log`);
    const startedAt = Date.now();

    try {
      // Replace this block with process execution, an SDK call, or an internal runner invocation.
      const stdout = `Would run ${this.config.command} for ${request.issue.identifier}.\n`;
      const stderr = "";

      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, redactSecrets([
        `runner: ${this.kind}`,
        `issue: ${request.issue.identifier}`,
        `workflow: ${request.workflowPath}`,
        `workspace: ${request.workspace.path}`,
        `repo: ${request.workspace.repoPath}`,
        `timeout_seconds: ${request.timeoutSeconds}`,
        `elapsed_ms: ${Date.now() - startedAt}`,
        "",
        "[prompt]",
        request.prompt,
        "",
        "[stdout]",
        stdout,
        "",
        "[stderr]",
        stderr
      ].join("\n")), "utf8");

      return {
        success: true,
        runner: this.kind,
        exitCode: 0,
        timedOut: false,
        logPath,
        stdout,
        stderr
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, redactSecrets([
        `runner: ${this.kind}`,
        `issue: ${request.issue.identifier}`,
        "success: false",
        "",
        "[error]",
        message
      ].join("\n")), "utf8");

      return {
        success: false,
        runner: this.kind,
        exitCode: null,
        timedOut: false,
        logPath,
        stdout: "",
        stderr: message
      };
    }
  }
}

export function registerExampleAgentRunner(): void {
  registerAgentRunner<ExampleAgentConfig>({
    kind: "example-agent",
    capabilities: {
      canEditFiles: true,
      canRunCommands: true,
      canCreateCommits: false,
      canOpenPullRequests: false
    },
    validateConfig(raw, context) {
      const command = requiredString(raw, "command", context, "agent.command");
      const timeoutSeconds = optionalNumber(raw, "timeoutSeconds", context, "agent.timeout_seconds") ?? 900;
      const logDir = optionalString(raw, "logDir", context, "agent.log_dir") ?? "logs";

      if (timeoutSeconds <= 0) {
        context.issues.push("agent.timeout_seconds must be greater than 0.");
      }
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
}

function requiredString(
  raw: Record<string, JsonValue>,
  key: string,
  context: AgentValidationContext,
  display: string
): string | undefined {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    context.issues.push(`${display} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function optionalString(
  raw: Record<string, JsonValue>,
  key: string,
  context: AgentValidationContext,
  display: string
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    context.issues.push(`${display} must be a non-empty string when provided.`);
    return undefined;
  }
  return value;
}

function optionalNumber(
  raw: Record<string, JsonValue>,
  key: string,
  context: AgentValidationContext,
  display: string
): number | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    context.issues.push(`${display} must be a number when provided.`);
    return undefined;
  }
  return value;
}
