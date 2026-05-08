import path from "node:path";
import { assertInsideRoot } from "../workspaces/pathSafety.js";

export class CommandSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandSafetyError";
  }
}

export interface CommandGuardOptions {
  command: string;
  cwd: string;
  workspaceRoot: string;
  allowedCommands?: string[];
  blockedCommands?: string[];
  displayCommand?: string;
}

export function assertSafeCommandExecution(options: CommandGuardOptions): void {
  assertInsideRoot(options.workspaceRoot, options.cwd);
  const command = commandName(options.displayCommand ?? options.command);
  const allowed = normalizedSet(options.allowedCommands);
  const blocked = normalizedSet(options.blockedCommands);

  if (blocked.has(command)) {
    throw new CommandSafetyError(`Command is blocked by safety.blockedCommands: ${command}.`);
  }
  if (allowed.size > 0 && !allowed.has(command)) {
    throw new CommandSafetyError(`Command is not allowed by safety.allowedCommands: ${command}.`);
  }
}

function normalizedSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => commandName(value)).filter((value) => value.length > 0));
}

function commandName(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? "";
  return path.basename(first).toLowerCase();
}
