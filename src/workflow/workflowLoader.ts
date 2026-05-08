import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z, ZodError } from "zod";
import type {
  AgentConfig,
  CleanupPolicy,
  RepositoryConfig,
  SafetyConfig,
  TrackerConfig,
  WorkflowConfig,
  WorkflowStatesConfig,
  WorkspaceConfig
} from "../core/domain.js";
import { parseWorkflow } from "./frontMatter.js";

export interface LoadedWorkflow {
  config: WorkflowConfig;
  promptTemplate: string;
  configHash: string;
}

export class WorkflowLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLoaderError";
  }
}

const cleanupPolicySchema = z.enum(["never", "on_success", "always"]);

const repositorySchema: z.ZodType<RepositoryConfig> = z
  .object({
    provider: z.literal("github").optional(),
    url: z.string().trim().min(1, "repository.url is required"),
    defaultBranch: z.string().trim().min(1, "repository.defaultBranch is required"),
    branchNamePattern: z.string().trim().min(1, "repository.branchNamePattern is required"),
    github: z
      .object({
        owner: z.string().trim().min(1, "repository.github.owner is required"),
        repo: z.string().trim().min(1, "repository.github.repo is required"),
        tokenEnv: z.string().trim().min(1, "repository.github.tokenEnv is required")
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((repository, context) => {
    if (repository.provider === "github" && repository.github === undefined) {
      context.addIssue({
        code: "custom",
        path: ["github"],
        message: "repository.github is required when repository.provider is github."
      });
    }
  });

const workspaceSchema: z.ZodType<WorkspaceConfig> = z
  .object({
    root: z.string().trim().min(1, "workspace.root is required"),
    cleanupPolicy: cleanupPolicySchema.default("never")
  })
  .strict()
  .transform((workspace) => ({
    root: workspace.root,
    cleanupPolicy: workspace.cleanupPolicy as CleanupPolicy
  }));

const agentSchema: z.ZodType<AgentConfig> = z
  .object({
    kind: z.string().trim().min(1, "agent.kind is required"),
    command: z.string().trim().min(1, "agent.command is required"),
    maxConcurrentAgents: z.number().int().positive().default(1),
    maxTurns: z.number().int().positive("agent.maxTurns must be a positive integer"),
    timeoutSeconds: z.number().int().positive().default(1800)
  })
  .strict();

const statesSchema: z.ZodType<WorkflowStatesConfig> = z
  .object({
    ready: z.array(z.string().trim().min(1)).optional(),
    review: z.string().trim().min(1).optional(),
    done: z.array(z.string().trim().min(1)).optional(),
    eligible: z.array(z.string().trim().min(1)).optional(),
    humanReview: z.string().trim().min(1).optional(),
    terminal: z.array(z.string().trim().min(1)).optional()
  })
  .strict()
  .transform((states) => ({
    eligible: states.eligible ?? states.ready ?? [],
    humanReview: states.humanReview ?? states.review ?? "Human Review",
    terminal: states.terminal ?? states.done ?? []
  }))
  .superRefine((states, context) => {
    if (states.eligible.length === 0) {
      context.addIssue({
        code: "custom",
        message: "states.ready or states.eligible must contain at least one candidate state.",
        path: ["ready"]
      });
    }
  });

const pollingSchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalSeconds: z.number().int().positive().default(60)
  })
  .strict()
  .default({ enabled: false, intervalSeconds: 60 });

const safetySchema: z.ZodType<SafetyConfig> = z
  .object({
    requireHumanReview: z.boolean().default(true),
    allowAutoMerge: z.boolean().default(false),
    allowTicketTransitions: z.boolean().default(true),
    allowPrCreation: z.boolean().default(true),
    redactSecrets: z.boolean().default(true),
    maxConcurrentRuns: z.number().int().positive().default(1),
    allowedCommands: z.array(z.string().trim().min(1)).optional(),
    blockedCommands: z.array(z.string().trim().min(1)).optional()
  })
  .strict()
  .default({
    requireHumanReview: true,
    allowAutoMerge: false,
    allowTicketTransitions: true,
    allowPrCreation: true,
    redactSecrets: true,
    maxConcurrentRuns: 1,
    allowedCommands: undefined,
    blockedCommands: undefined
  });

const trackerSchema: z.ZodType<TrackerConfig> = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("mock"),
        issueFile: z.string().optional(),
        issuesFile: z.string().optional(),
        eventsFile: z.string().optional()
      })
      .catchall(z.unknown())
      .transform(({ kind, issueFile, issuesFile, eventsFile, ...options }) => ({
        kind,
        issueFile,
        issuesFile,
        eventsFile,
        options: emptyToUndefined(options)
      })),
    z
      .object({
        kind: z.literal("jira"),
        baseUrl: z.string().trim().min(1, "tracker.baseUrl is required for jira"),
        emailEnv: z.string().trim().min(1, "tracker.emailEnv is required for jira"),
        apiTokenEnv: z.string().trim().min(1, "tracker.apiTokenEnv is required for jira"),
        jql: z.string().trim().min(1, "tracker.jql is required for jira"),
        readyStates: z.array(z.string().trim().min(1)).default([]),
        reviewState: z.string().trim().min(1).default("Human Review"),
        maxResults: z.number().int().positive().optional()
      })
      .catchall(z.unknown())
      .transform(({ kind, baseUrl, emailEnv, apiTokenEnv, jql, readyStates, reviewState, maxResults }) => ({
        kind,
        baseUrl,
        emailEnv,
        apiTokenEnv,
        jql,
        readyStates,
        reviewState,
        maxResults
      })),
    z
      .object({
        kind: z.literal("plane"),
        baseUrl: z.string().trim().min(1, "tracker.baseUrl is required for plane"),
        apiTokenEnv: z.string().trim().min(1, "tracker.apiTokenEnv is required for plane"),
        workspaceSlug: z.string().trim().min(1, "tracker.workspaceSlug is required for plane"),
        projectId: z.string().trim().min(1, "tracker.projectId is required for plane"),
        readyStates: z.array(z.string().trim().min(1)).default([]),
        reviewState: z.string().trim().min(1).default("Human Review"),
        maxResults: z.number().int().positive().optional()
      })
      .catchall(z.unknown())
      .transform(({ kind, baseUrl, apiTokenEnv, workspaceSlug, projectId, readyStates, reviewState, maxResults }) => ({
        kind,
        baseUrl,
        apiTokenEnv,
        workspaceSlug,
        projectId,
        readyStates,
        reviewState,
        maxResults
      }))
  ])
  .transform((tracker) => tracker as TrackerConfig);

const workflowConfigSchema: z.ZodType<WorkflowConfig> = z
  .object({
    tracker: trackerSchema,
    repository: repositorySchema,
    workspace: workspaceSchema,
    agent: agentSchema,
    polling: pollingSchema,
    states: statesSchema,
    safety: safetySchema
  })
  .strict();

export async function loadWorkflowFromFile(workflowPath: string): Promise<LoadedWorkflow> {
  const source = await readFile(workflowPath, "utf8");
  return loadWorkflowFromString(source);
}

export function loadWorkflowFromString(source: string): LoadedWorkflow {
  const definition = parseWorkflow(source);
  const config = validateWorkflowConfig(definition.config);
  return {
    config,
    promptTemplate: definition.promptTemplate,
    configHash: createConfigHash(config)
  };
}

export function validateWorkflowConfig(input: unknown): WorkflowConfig {
  const result = workflowConfigSchema.safeParse(input);
  if (!result.success) {
    throw new WorkflowLoaderError(formatZodError(result.error));
  }
  return result.data;
}

export function createConfigHash(config: WorkflowConfig): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function formatZodError(error: ZodError): string {
  const details = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "config";
    return `- ${path}: ${issue.message}`;
  });
  return ["Invalid WORKFLOW.md front matter:", ...details].join("\n");
}

function emptyToUndefined(input: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(input).length === 0 ? undefined : input;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}
