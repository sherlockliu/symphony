import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { redactSecrets } from "../logging/redact.js";
import type { DashboardStatusStore } from "./statusStore.js";

export interface DashboardServerOptions {
  host: string;
  port: number;
}

export interface RunningDashboardServer {
  url: string;
  close(): Promise<void>;
}

export async function startDashboardServer(
  store: DashboardStatusStore,
  options: DashboardServerOptions
): Promise<RunningDashboardServer> {
  const server = http.createServer((request, response) => {
    void routeDashboardRequest(store, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  return {
    url: `http://${options.host}:${port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function routeDashboardRequest(
  store: DashboardStatusStore,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (requestUrl.pathname === "/") {
    sendHtml(response, dashboardHtml());
    return;
  }
  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      currentMode: store.status().currentMode,
      uptimeSeconds: store.status().uptimeSeconds
    });
    return;
  }
  if (requestUrl.pathname === "/api/status") {
    sendJson(response, 200, store.status());
    return;
  }
  if (requestUrl.pathname === "/api/runs") {
    sendJson(response, 200, store.runsView());
    return;
  }
  if (requestUrl.pathname.startsWith("/api/runs/")) {
    const issueIdentifier = decodeURIComponent(requestUrl.pathname.slice("/api/runs/".length));
    const run = store.runByIssueIdentifier(issueIdentifier);
    if (run === null) {
      sendJson(response, 404, { error: "run_not_found" });
      return;
    }
    sendJson(response, 200, run);
    return;
  }
  if (requestUrl.pathname === "/api/config-summary") {
    sendJson(response, 200, store.configSummary());
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(redactSecrets(value));
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Owned Symphony Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #687385;
      --border: #d9dee7;
      --accent: #0f766e;
      --danger: #b42318;
      --ok: #067647;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 24px 28px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 24px auto 48px;
      display: grid;
      gap: 20px;
    }
    button {
      border: 1px solid var(--accent);
      background: var(--accent);
      color: white;
      border-radius: 6px;
      padding: 9px 13px;
      font-weight: 650;
      cursor: pointer;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .card, section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .card { padding: 16px; }
    .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 700;
    }
    .value {
      margin-top: 8px;
      font-size: 24px;
      font-weight: 750;
    }
    section { overflow: hidden; }
    section header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    th { color: var(--muted); font-size: 12px; }
    tr:last-child td { border-bottom: 0; }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
    .muted { color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Owned Symphony Dashboard</h1>
      <div class="muted" id="subtitle">Loading status...</div>
    </div>
    <button type="button" onclick="refresh()">Refresh</button>
  </header>
  <main>
    <div class="cards" id="cards"></div>
    <section>
      <header><h2>Active Runs</h2></header>
      <div id="active"></div>
    </section>
    <section>
      <header><h2>Recent Completed Runs</h2></header>
      <div id="succeeded"></div>
    </section>
    <section>
      <header><h2>Failed Runs</h2></header>
      <div id="failed"></div>
    </section>
  </main>
  <script>
    async function getJson(path) {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(path + " failed");
      return await response.json();
    }
    function text(value) {
      return value === null || value === undefined || value === "" ? "—" : String(value);
    }
    function card(label, value, className) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value ' + (className || '') + '">' + text(value) + '</div></div>';
    }
    function table(rows) {
      if (rows.length === 0) return '<p class="muted" style="padding: 14px 16px; margin: 0;">No runs.</p>';
      const body = rows.map((run) => '<tr><td>' + text(run.issueIdentifier) + '</td><td>' + text(run.status) + '</td><td>' + text(run.workspacePath) + '</td><td>' + (run.prUrl ? '<a href="' + run.prUrl + '">' + run.prUrl + '</a>' : '—') + '</td><td>' + text(run.lastError) + '</td></tr>').join('');
      return '<table><thead><tr><th>Issue</th><th>Status</th><th>Workspace</th><th>PR</th><th>Last Error</th></tr></thead><tbody>' + body + '</tbody></table>';
    }
    async function refresh() {
      const status = await getJson('/api/status');
      const runs = await getJson('/api/runs');
      document.getElementById('subtitle').textContent = status.currentMode + ' · ' + status.trackerKind + ' · ' + status.agentKind + ' · last poll ' + text(status.lastPollTime);
      document.getElementById('cards').innerHTML = [
        card('Active', status.activeRuns),
        card('Queued', status.queuedRuns),
        card('Succeeded', status.succeededRuns, 'ok'),
        card('Failed', status.failedRuns, status.failedRuns > 0 ? 'danger' : ''),
        card('Poll Interval', status.pollingIntervalSeconds + 's'),
        card('Uptime', status.uptimeSeconds + 's')
      ].join('');
      document.getElementById('active').innerHTML = table(runs.active);
      document.getElementById('succeeded').innerHTML = table(runs.succeeded.slice(0, 20));
      document.getElementById('failed').innerHTML = table(runs.failed);
    }
    refresh().catch((error) => {
      document.getElementById('subtitle').textContent = error.message;
    });
  </script>
</body>
</html>`;
}
