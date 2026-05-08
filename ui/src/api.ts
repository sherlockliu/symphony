import type { BoardResponse, Issue, RunDetail, RunEvent, RunRecord, WorkflowSummary } from "./types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (!response.ok) {
    let message = `${path} returned ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchHealth(): Promise<{ status: string }> {
  return request("/api/health");
}

export async function fetchWorkflow(): Promise<WorkflowSummary> {
  return request("/api/workflows/current");
}

export async function fetchIssues(): Promise<Issue[]> {
  const response = await request<{ issues: Issue[] }>("/api/issues");
  return response.issues;
}

export async function fetchRuns(): Promise<RunRecord[]> {
  const response = await request<{ runs: RunRecord[] }>("/api/runs");
  return response.runs;
}

export async function fetchRun(id: string): Promise<RunDetail> {
  return request(`/api/runs/${encodeURIComponent(id)}`);
}

export async function fetchRunEvents(id: string): Promise<RunEvent[]> {
  const response = await request<{ events: RunEvent[] }>(`/api/runs/${encodeURIComponent(id)}/events`);
  return response.events;
}

export async function fetchBoard(): Promise<BoardResponse> {
  return request("/api/board");
}

async function postRunAction(id: string, action: "retry" | "cancel" | "ignore"): Promise<RunRecord> {
  const response = await request<{ record: RunRecord }>(`/api/runs/${encodeURIComponent(id)}/${action}`, {
    method: "POST"
  });
  return response.record;
}

export async function retryRun(id: string): Promise<RunRecord> {
  return postRunAction(id, "retry");
}

export async function cancelRun(id: string): Promise<RunRecord> {
  return postRunAction(id, "cancel");
}

export async function ignoreRun(id: string): Promise<RunRecord> {
  return postRunAction(id, "ignore");
}
