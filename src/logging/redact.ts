const SECRET_VALUE_PATTERNS = [
  /(OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|JIRA_TOKEN|JIRA_API_TOKEN|PLANE_TOKEN|SSH_(?:KEY|PRIVATE_KEY)|API_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD)=([^\s'";)]+)/gi,
  /(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi,
  /(sk-[A-Za-z0-9_-]{12,})/g
];

export function redactSecrets(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return SECRET_VALUE_PATTERNS.reduce((text, pattern) => {
    if (pattern.source.startsWith("(Bearer")) {
      return text.replace(pattern, "$1[REDACTED]");
    }
    if (pattern.source.startsWith("(sk-")) {
      return text.replace(pattern, "[REDACTED]");
    }
    return text.replace(pattern, "$1=[REDACTED]");
  }, serialized);
}
