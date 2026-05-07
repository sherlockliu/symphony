import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../logging/redact.js";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  logPath: string;
  env?: Record<string, string>;
}

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface ProcessExecutor {
  execute(request: ProcessRequest): Promise<ProcessResult>;
}

export class NodeProcessExecutor implements ProcessExecutor {
  async execute(request: ProcessRequest): Promise<ProcessResult> {
    await mkdir(path.dirname(request.logPath), { recursive: true });

    return await new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env === undefined ? process.env : { ...process.env, ...request.env },
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        void writeProcessLog(request, { stdout, stderr, exitCode, timedOut })
          .then(() => {
            resolve({
              exitCode,
              timedOut,
              stdout,
              stderr
            });
          })
          .catch(reject);
      });

      child.stdin.end(request.input);
    });
  }
}

async function writeProcessLog(
  request: ProcessRequest,
  result: ProcessResult
): Promise<void> {
  const log = [
    `$ ${[request.command, ...request.args].join(" ")}`,
    `cwd: ${request.cwd}`,
    `timeout_ms: ${request.timeoutMs}`,
    `exit_code: ${result.exitCode ?? "null"}`,
    `timed_out: ${result.timedOut}`,
    "",
    "[stdout]",
    result.stdout,
    "",
    "[stderr]",
    result.stderr
  ].join("\n");

  await writeFile(request.logPath, redactSecrets(log), "utf8");
}
