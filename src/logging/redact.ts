export const SENSITIVE_ENV_NAME_PATTERN = /(?:TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL)/i;

const SECRET_VALUE_PATTERNS = [
  /((?:"?(?:[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL)[A-Za-z0-9_]*|DATABASE_URL|apiToken|token)"?\s*[:=]\s*"?))([^"',\s;)}]+)/gi,
  /(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s]+)(@[^/\s]+\/[^\s'";)]+)/gi,
  /(Basic\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
  /(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi,
  /(sk-[A-Za-z0-9_-]{12,})/g,
  /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g
];

export function redactSecrets(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(redactSensitiveObject(value), null, 2);
  return SECRET_VALUE_PATTERNS.reduce((text, pattern) => {
    if (pattern.source.startsWith("(Basic") || pattern.source.startsWith("(Bearer")) {
      return text.replace(pattern, "$1[REDACTED]");
    }
    if (pattern.source.startsWith("(sk-") || pattern.source.startsWith("\\b")) {
      return text.replace(pattern, "[REDACTED]");
    }
    if (pattern.source.startsWith("(postgres")) {
      return text.replace(pattern, "$1[REDACTED]$3");
    }
    return text.replace(pattern, "$1[REDACTED]");
  }, serialized);
}

export function redactEnv<T extends Record<string, string | undefined>>(env: T): T {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value !== undefined && SENSITIVE_ENV_NAME_PATTERN.test(key) ? "[REDACTED]" : value
    ])
  ) as T;
}

function redactSensitiveObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_ENV_NAME_PATTERN.test(key) ? "[REDACTED]" : redactSensitiveObject(item)
    ])
  );
}
