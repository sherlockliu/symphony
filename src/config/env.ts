import type { JsonValue } from "../types.js";

export class EnvironmentInterpolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentInterpolationError";
  }
}

export function interpolateEnv<T extends JsonValue>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === "string") {
    return interpolateString(value, env) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = interpolateEnv(item, env);
    }
    return result as T;
  }
  return value;
}

function interpolateString(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => {
    const resolved = env[name];
    if (resolved === undefined) {
      throw new EnvironmentInterpolationError(`Missing environment variable ${name}.`);
    }
    return resolved;
  });
}
