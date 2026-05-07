import type { JsonValue, WorkflowDefinition } from "../types.js";

export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowParseError";
  }
}

interface Frame {
  indent: number;
  value: Record<string, JsonValue> | JsonValue[];
}

export function parseWorkflow(source: string): WorkflowDefinition {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new WorkflowParseError("WORKFLOW.md must start with YAML front matter delimited by ---.");
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    throw new WorkflowParseError("WORKFLOW.md front matter must end with a closing --- delimiter.");
  }

  const frontMatter = normalized.slice(4, end);
  const bodyStart = normalized.startsWith("\n", end + 4) ? end + 5 : end + 4;
  const promptTemplate = normalized.slice(bodyStart).trim();
  if (promptTemplate.length === 0) {
    throw new WorkflowParseError("WORKFLOW.md must include a Markdown prompt body after front matter.");
  }

  return {
    config: parseSimpleYaml(frontMatter),
    promptTemplate
  };
}

function parseSimpleYaml(source: string): Record<string, JsonValue> {
  const root: Record<string, JsonValue> = {};
  const stack: Frame[] = [{ indent: -1, value: root }];
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim().length === 0) {
      continue;
    }

    const indent = leadingSpaces(withoutComment);
    if (indent % 2 !== 0) {
      throw new WorkflowParseError(`Invalid indentation on front matter line ${index + 1}; use two spaces.`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!.value;
    const trimmed = withoutComment.trim();

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new WorkflowParseError(`Unexpected YAML list item on front matter line ${index + 1}.`);
      }
      const item = trimmed.slice(2).trim();
      if (item.length === 0) {
        throw new WorkflowParseError(`Empty YAML list item on front matter line ${index + 1}.`);
      }
      parent.push(parseScalar(item, index + 1));
      continue;
    }

    if (Array.isArray(parent)) {
      throw new WorkflowParseError(`Unsupported nested YAML list value on front matter line ${index + 1}.`);
    }

    const pair = /^([A-Za-z0-9_-]+):(.*)$/.exec(trimmed);
    if (!pair) {
      throw new WorkflowParseError(`Unsupported YAML syntax on front matter line ${index + 1}.`);
    }

    const key = pair[1]!.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
    const rest = pair[2]!.trim();

    if (rest.length === 0) {
      const next = nextSignificantLine(lines, index + 1);
      const child: Record<string, JsonValue> | JsonValue[] =
        next !== null && next.indent > indent && next.trimmed.startsWith("- ") ? [] : {};
      parent[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    parent[key] = parseScalarOrInlineArray(rest, index + 1);
  }

  return root;
}

function parseScalarOrInlineArray(value: string, line: number): JsonValue {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return splitInlineArray(inner).map((item) => parseScalar(item.trim(), line));
  }

  return parseScalar(value, line);
}

function parseScalar(value: string, line: number): JsonValue {
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.includes(": ") || value.startsWith("- ")) {
    throw new WorkflowParseError(`Unsupported scalar syntax on front matter line ${line}.`);
  }
  return value;
}

function splitInlineArray(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const char of value) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (quote !== null) {
    throw new WorkflowParseError("Unterminated quoted string in inline array.");
  }
  items.push(current);
  return items;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (char === "#" && quote === null) {
      return line.slice(0, i);
    }
  }
  return line;
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function nextSignificantLine(lines: string[], startIndex: number): { indent: number; trimmed: string } | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const stripped = stripComment(lines[index]!);
    if (stripped.trim().length === 0) {
      continue;
    }
    return {
      indent: leadingSpaces(stripped),
      trimmed: stripped.trim()
    };
  }
  return null;
}
