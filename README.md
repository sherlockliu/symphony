# Owned Symphony

Languages: [English](#english) | [简体中文](#简体中文) | [繁體中文](#繁體中文)

---

## English

Owned Symphony is a TypeScript/Node.js coding-agent orchestrator. It takes eligible tracker issues,
creates isolated workspaces, renders prompts from `WORKFLOW.md`, runs a coding agent, and prepares
draft pull requests for human review.

It is our owned Symphony-style implementation. It is inspired by the public OpenAI Symphony
architecture, but it does not copy the OpenAI Elixir implementation.

Owned Symphony never merges pull requests.

### Start Here

Pick the path that matches what you want to do:

| Goal | Use this | Result |
| --- | --- | --- |
| Try the CLI without credentials | [Local Mock CLI](#local-mock-cli) | Validates and previews a run using mock issues. |
| Open the operator UI locally | [Local API And UI](#local-api-and-ui) | Runs API at `127.0.0.1:4001` and UI at `127.0.0.1:5173`. |
| Run the polling worker locally | [Local Daemon](#local-daemon) | Continuously polls mock issues and shows daemon status. |
| Run API/UI + worker in containers | [Docker Compose](#docker-compose) | Runs `orchestrator-api` and `orchestrator-worker`. |
| Use Jira, Plane, GitHub Issues, Codex, or Claude Code | [Real Tasks](#real-tasks) | Processes real issues and creates draft PRs. |

### What It Does

1. Fetches work from Mock, Jira, Plane, or GitHub Issues.
2. Normalizes tracker work items into one internal issue shape.
3. Creates one workspace per issue.
4. Clones or updates the configured repository.
5. Checks out an issue branch.
6. Renders a coding-agent prompt from `WORKFLOW.md`.
7. Runs DryRun, Codex, Claude Code, or Shell.
8. Captures redacted logs and run state.
9. Creates a draft GitHub PR when changes exist.
10. Comments back to the tracker and transitions to Human Review when supported.

### Requirements

- Node.js 22+
- npm
- Git
- Docker Engine and Docker Compose, only for Docker runs
- Optional for real runs: `gh`, `codex`, `claude`, Jira/Plane/GitHub credentials, and Postgres

### Install

```bash
npm install
npm run build
npm test
```

### Local Mock CLI

This is the safest first run. It needs no external credentials.

```bash
npm run validate:mock
npm run dry-run:mock
```

Run one polling cycle:

```bash
npm run daemon:mock:once
```

What to expect:

- `validate:mock` prints the parsed workflow config and warnings.
- `dry-run:mock` prints planned workspace, Git, PR, and prompt output.
- `daemon:mock:once` runs one poll cycle and exits.

### Local API And UI

Use this when you want the browser operator console.

Terminal 1:

```bash
npm run api
```

API URL:

```text
http://127.0.0.1:4001/api/health
```

Terminal 2:

```bash
npm run ui:dev
```

UI URL:

```text
http://127.0.0.1:5173
```

Build the static UI bundle:

```bash
npm run ui:build
```

Important:

- The local API/UI are operator tooling.
- They are not authenticated.
- Keep them bound to localhost.

### Local Daemon

Use this when you want the worker loop to keep polling.

```bash
npm run daemon:mock
```

If the workflow has the daemon dashboard enabled, open:

```text
http://127.0.0.1:4000
```

Run only one cycle when testing:

```bash
npm run daemon:mock:once
```

### Workflow Commands

You can run any workflow directly after building:

```bash
npm run build
node dist/src/cli/index.js validate ./WORKFLOW.md
node dist/src/cli/index.js dry-run ./WORKFLOW.md
node dist/src/cli/index.js run ./WORKFLOW.md
node dist/src/cli/index.js daemon ./WORKFLOW.md
```

Useful workflow examples:

| File | Use case |
| --- | --- |
| `examples/WORKFLOW.quickstart.mock.md` | Local mock validation and dry-run. |
| `examples/WORKFLOW.dashboard.mock.example.md` | Mock daemon with local dashboard enabled. |
| `examples/WORKFLOW.github-issues.example.md` | GitHub Issues + Codex. |
| `examples/WORKFLOW.claude-code.example.md` | GitHub Issues + Claude Code. |
| `examples/WORKFLOW.jira.example.md` | Jira + Codex. |
| `examples/WORKFLOW.plane.example.md` | Plane + Codex. |
| `examples/WORKFLOW.shell-agent.example.md` | Generic trusted shell runner. |
| `examples/WORKFLOW.docker.mock.example.md` | Docker Compose mock workflow. |

### Docker Compose

Docker Compose runs two services:

| Service | What it does |
| --- | --- |
| `orchestrator-api` | Serves the API and built UI on `127.0.0.1:4001`. |
| `orchestrator-worker` | Runs `run /config/WORKFLOW.md --poll` as the worker loop. |

Prepare local demo files:

```bash
mkdir -p config workspaces logs data
cp examples/WORKFLOW.docker.mock.example.md config/WORKFLOW.md
cp examples/mock-issues.json config/mock-issues.json
mkdir -p config/template-repo
git -C config/template-repo init -b main
git -C config/template-repo config user.email "local@example.invalid"
git -C config/template-repo config user.name "Local Demo"
printf "# Docker demo repo\n" > config/template-repo/README.md
git -C config/template-repo add README.md
git -C config/template-repo commit -m "Initial demo repo"
```

Start everything:

```bash
docker compose up --build -d
```

Open the UI:

```text
http://127.0.0.1:4001/
```

Check status:

```bash
docker compose ps
docker compose logs -f orchestrator-api
docker compose logs -f orchestrator-worker
```

Run one-off commands inside Compose:

```bash
docker compose run --rm orchestrator-worker validate /config/WORKFLOW.md
docker compose run --rm orchestrator-worker dry-run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker daemon /config/WORKFLOW.md --max-cycles 1
```

Mounted paths:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `./config` | `/config` | Workflow and non-secret config. |
| `./workspaces` | `/workspaces` | Per-issue checkouts. |
| `./logs` | `/logs` | Agent, Git, and PR logs. |
| `./data` | `/data` | JSON state and mock tracker event files. |

See [docs/deployment.md](docs/deployment.md) for more Docker details.

### Real Tasks

For real Jira, Plane, GitHub Issues, Codex, Claude Code, or Shell runs:

1. Copy the closest workflow example.
2. Configure tracker, repository, branch prefix, agent, states, and retry settings.
3. Set secrets through environment variables.
4. Run `validate`.
5. Run `dry-run`.
6. Start with one low-risk issue.
7. Review the draft PR manually.

Common secrets:

```bash
export GITHUB_TOKEN="..."
export GH_TOKEN="..."
export JIRA_EMAIL="..."
export JIRA_API_TOKEN="..."
export PLANE_API_TOKEN="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export DATABASE_URL="postgres://orchestrator:change-me@localhost:5432/orchestrator"
```

Recommended production state:

```yaml
state:
  kind: postgres
  connection_string: ${DATABASE_URL}
  lock_ttl_seconds: 900
```

### Development

Common commands:

```bash
npm run build
npm test
npm run lint
npm run validate:examples
npm run validate:mock
npm run dry-run:mock
npm run daemon:mock:once
```

Project layout:

```text
src/      CLI, orchestrator, trackers, agents, workflow, workspaces, state, API, security
ui/       React operator console
tests/    Node test suite
docs/     Design, roadmap, deployment, and extension docs
```

Read [AGENTS.md](AGENTS.md) before changing behavior.

### More Docs

| Document | Purpose |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, boundaries, coupling, and extension seams. |
| [docs/TECHNICAL_ROADMAP.md](docs/TECHNICAL_ROADMAP.md) | Current state review, risks, next tasks, and checklists. |
| [docs/deployment.md](docs/deployment.md) | Docker Compose deployment notes. |
| [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md) | How to add a tracker adapter. |
| [docs/ADDING_AGENT_RUNNERS.md](docs/ADDING_AGENT_RUNNERS.md) | How to add an agent runner. |
| [docs/OWNED_SYMPHONY_SPEC.md](docs/OWNED_SYMPHONY_SPEC.md) | Product/spec background. |

### Safety Notes

- `run` and `daemon` can execute Git, GitHub CLI, Codex, Claude Code, Shell commands, and tracker
  write APIs depending on workflow config.
- Use `validate` and `dry-run` before real runs.
- Keep dashboard/API bindings local-only.
- Use least-privilege credentials.
- Run agents in isolated workspaces.
- Review all draft PRs manually.

---

## 简体中文

Owned Symphony 是一个 TypeScript/Node.js coding-agent 编排器。它从 issue tracker 读取符合条件的任务，
创建隔离 workspace，渲染 `WORKFLOW.md` prompt，运行配置好的 coding agent，并通过 draft pull request
把代码变更交给人工 review。

Owned Symphony 永远不会自动 merge PR。

### 从这里开始

| 目标 | 使用方式 | 结果 |
| --- | --- | --- |
| 不需要凭证试用 CLI | [本地 Mock CLI](#本地-mock-cli) | 使用 mock issue 校验和预览。 |
| 打开本地 UI | [本地 API 和 UI](#本地-api-和-ui) | API 在 `127.0.0.1:4001`，UI 在 `127.0.0.1:5173`。 |
| 本地运行轮询 worker | [本地 Daemon](#本地-daemon) | 持续轮询 mock issue，并显示 daemon 状态。 |
| 用容器运行 API/UI + worker | [Docker Compose](#docker-compose-1) | 运行 `orchestrator-api` 和 `orchestrator-worker`。 |
| 连接 Jira、Plane、GitHub Issues、Codex 或 Claude Code | [真实任务](#真实任务) | 处理真实 issue 并创建 draft PR。 |

### 它能做什么

1. 从 Mock、Jira、Plane 或 GitHub Issues 获取任务。
2. 将 tracker work item 标准化为统一内部 issue 模型。
3. 为每个 issue 创建 workspace。
4. clone 或更新目标仓库。
5. checkout issue 分支。
6. 从 `WORKFLOW.md` 渲染 prompt。
7. 运行 DryRun、Codex、Claude Code 或 Shell。
8. 记录脱敏日志和 run state。
9. 有变更时创建 GitHub draft PR。
10. 在支持的 tracker 中评论 PR，并流转到 Human Review。

### 环境要求

- Node.js 22+
- npm
- Git
- Docker Engine 和 Docker Compose，仅 Docker 运行需要
- 真实任务可选依赖：`gh`、`codex`、`claude`、Jira/Plane/GitHub 凭证、Postgres

### 安装

```bash
npm install
npm run build
npm test
```

### 本地 Mock CLI

这是最安全的首次运行方式，不需要外部凭证。

```bash
npm run validate:mock
npm run dry-run:mock
```

运行一次轮询：

```bash
npm run daemon:mock:once
```

持续运行 mock daemon：

```bash
npm run daemon:mock
```

### 本地 API 和 UI

用于打开浏览器 operator console。

终端 1：

```bash
npm run api
```

API：

```text
http://127.0.0.1:4001/api/health
```

终端 2：

```bash
npm run ui:dev
```

UI：

```text
http://127.0.0.1:5173
```

注意：

- 本地 API/UI 是 operator 工具。
- 当前没有认证。
- 请保持 localhost 绑定。

### 本地 Daemon

用于持续运行 worker loop。

```bash
npm run daemon:mock
```

如果 workflow 启用了 daemon dashboard，打开：

```text
http://127.0.0.1:4000
```

只运行一轮：

```bash
npm run daemon:mock:once
```

### Workflow 命令

构建后可以直接运行任意 workflow：

```bash
npm run build
node dist/src/cli/index.js validate ./WORKFLOW.md
node dist/src/cli/index.js dry-run ./WORKFLOW.md
node dist/src/cli/index.js run ./WORKFLOW.md
node dist/src/cli/index.js daemon ./WORKFLOW.md
```

常用示例：

| 文件 | 用途 |
| --- | --- |
| `examples/WORKFLOW.quickstart.mock.md` | 本地 mock 校验和 dry-run。 |
| `examples/WORKFLOW.dashboard.mock.example.md` | 启用本地 dashboard 的 mock daemon。 |
| `examples/WORKFLOW.github-issues.example.md` | GitHub Issues + Codex。 |
| `examples/WORKFLOW.claude-code.example.md` | GitHub Issues + Claude Code。 |
| `examples/WORKFLOW.jira.example.md` | Jira + Codex。 |
| `examples/WORKFLOW.plane.example.md` | Plane + Codex。 |
| `examples/WORKFLOW.shell-agent.example.md` | 通用可信 Shell runner。 |
| `examples/WORKFLOW.docker.mock.example.md` | Docker Compose mock workflow。 |

### Docker Compose

Docker Compose 会运行两个服务：

| 服务 | 作用 |
| --- | --- |
| `orchestrator-api` | 在 `127.0.0.1:4001` 提供 API 和构建后的 UI。 |
| `orchestrator-worker` | 以 worker loop 方式运行 `run /config/WORKFLOW.md --poll`。 |

准备本地 demo 文件：

```bash
mkdir -p config workspaces logs data
cp examples/WORKFLOW.docker.mock.example.md config/WORKFLOW.md
cp examples/mock-issues.json config/mock-issues.json
mkdir -p config/template-repo
git -C config/template-repo init -b main
git -C config/template-repo config user.email "local@example.invalid"
git -C config/template-repo config user.name "Local Demo"
printf "# Docker demo repo\n" > config/template-repo/README.md
git -C config/template-repo add README.md
git -C config/template-repo commit -m "Initial demo repo"
```

启动：

```bash
docker compose up --build -d
```

打开 UI：

```text
http://127.0.0.1:4001/
```

查看状态：

```bash
docker compose ps
docker compose logs -f orchestrator-api
docker compose logs -f orchestrator-worker
```

在 Compose 中运行一次性命令：

```bash
docker compose run --rm orchestrator-worker validate /config/WORKFLOW.md
docker compose run --rm orchestrator-worker dry-run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker daemon /config/WORKFLOW.md --max-cycles 1
```

挂载路径：

| 主机路径 | 容器路径 | 用途 |
| --- | --- | --- |
| `./config` | `/config` | Workflow 和非 secret 配置。 |
| `./workspaces` | `/workspaces` | 每个 issue 的 checkout。 |
| `./logs` | `/logs` | Agent、Git 和 PR 日志。 |
| `./data` | `/data` | JSON state 和 mock tracker 事件文件。 |

更多 Docker 说明见 [docs/deployment.md](docs/deployment.md)。

### 真实任务

连接真实 Jira、Plane、GitHub Issues、Codex、Claude Code 或 Shell 前：

1. 复制最接近的 workflow 示例。
2. 配置 tracker、repository、branch prefix、agent、states 和 retry 设置。
3. 通过环境变量设置 secret。
4. 运行 `validate`。
5. 运行 `dry-run`。
6. 先从一个低风险 issue 开始。
7. 人工 review draft PR。

常用 secret：

```bash
export GITHUB_TOKEN="..."
export GH_TOKEN="..."
export JIRA_EMAIL="..."
export JIRA_API_TOKEN="..."
export PLANE_API_TOKEN="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export DATABASE_URL="postgres://orchestrator:change-me@localhost:5432/orchestrator"
```

生产环境建议使用：

```yaml
state:
  kind: postgres
  connection_string: ${DATABASE_URL}
  lock_ttl_seconds: 900
```

### 开发

```bash
npm run build
npm test
npm run lint
npm run validate:examples
npm run validate:mock
npm run dry-run:mock
npm run daemon:mock:once
```

目录：

```text
src/      CLI、orchestrator、trackers、agents、workflow、workspaces、state、API、security
ui/       React operator console
tests/    Node test suite
docs/     设计、路线图、部署和扩展文档
```

修改行为前请阅读 [AGENTS.md](AGENTS.md)。

### 更多文档

| 文档 | 用途 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构、边界、耦合点和扩展接口。 |
| [docs/TECHNICAL_ROADMAP.md](docs/TECHNICAL_ROADMAP.md) | 当前状态、风险、后续任务和 checklist。 |
| [docs/deployment.md](docs/deployment.md) | Docker Compose 部署说明。 |
| [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md) | 如何新增 tracker adapter。 |
| [docs/ADDING_AGENT_RUNNERS.md](docs/ADDING_AGENT_RUNNERS.md) | 如何新增 agent runner。 |

### 安全说明

- `run` 和 `daemon` 会根据 workflow 配置执行 Git、GitHub CLI、Codex、Claude Code、Shell 命令和 tracker 写接口。
- 真实运行前先使用 `validate` 和 `dry-run`。
- dashboard/API 保持本地绑定。
- 使用最小权限凭证。
- 在隔离 workspace 中运行 agent。
- 所有 draft PR 都需要人工 review。

---

## 繁體中文

Owned Symphony 是一個 TypeScript/Node.js coding-agent 編排器。它從 issue tracker 讀取符合條件的工作，
建立隔離 workspace，渲染 `WORKFLOW.md` prompt，執行設定好的 coding agent，並透過 draft pull request
把程式碼變更交給人工 review。

Owned Symphony 永遠不會自動 merge PR。

### 從這裡開始

| 目標 | 使用方式 | 結果 |
| --- | --- | --- |
| 不需要憑證試用 CLI | [本機 Mock CLI](#本機-mock-cli) | 使用 mock issue 校驗和預覽。 |
| 打開本機 UI | [本機 API 和 UI](#本機-api-和-ui) | API 在 `127.0.0.1:4001`，UI 在 `127.0.0.1:5173`。 |
| 本機執行輪詢 worker | [本機 Daemon](#本機-daemon) | 持續輪詢 mock issue，並顯示 daemon 狀態。 |
| 用容器執行 API/UI + worker | [Docker Compose](#docker-compose-2) | 執行 `orchestrator-api` 和 `orchestrator-worker`。 |
| 連接 Jira、Plane、GitHub Issues、Codex 或 Claude Code | [真實任務](#真實任務) | 處理真實 issue 並建立 draft PR。 |

### 它能做什麼

1. 從 Mock、Jira、Plane 或 GitHub Issues 取得工作。
2. 將 tracker work item 標準化為統一內部 issue 模型。
3. 為每個 issue 建立 workspace。
4. clone 或更新目標儲存庫。
5. checkout issue 分支。
6. 從 `WORKFLOW.md` 渲染 prompt。
7. 執行 DryRun、Codex、Claude Code 或 Shell。
8. 記錄脫敏 log 和 run state。
9. 有變更時建立 GitHub draft PR。
10. 在支援的 tracker 中留言 PR，並流轉到 Human Review。

### 環境需求

- Node.js 22+
- npm
- Git
- Docker Engine 和 Docker Compose，僅 Docker 執行需要
- 真實任務可選依賴：`gh`、`codex`、`claude`、Jira/Plane/GitHub 憑證、Postgres

### 安裝

```bash
npm install
npm run build
npm test
```

### 本機 Mock CLI

這是最安全的首次執行方式，不需要外部憑證。

```bash
npm run validate:mock
npm run dry-run:mock
```

執行一次輪詢：

```bash
npm run daemon:mock:once
```

持續執行 mock daemon：

```bash
npm run daemon:mock
```

### 本機 API 和 UI

用於打開瀏覽器 operator console。

終端 1：

```bash
npm run api
```

API：

```text
http://127.0.0.1:4001/api/health
```

終端 2：

```bash
npm run ui:dev
```

UI：

```text
http://127.0.0.1:5173
```

注意：

- 本機 API/UI 是 operator 工具。
- 目前沒有認證。
- 請保持 localhost 綁定。

### 本機 Daemon

用於持續執行 worker loop。

```bash
npm run daemon:mock
```

如果 workflow 啟用了 daemon dashboard，打開：

```text
http://127.0.0.1:4000
```

只執行一輪：

```bash
npm run daemon:mock:once
```

### Workflow 命令

建置後可以直接執行任意 workflow：

```bash
npm run build
node dist/src/cli/index.js validate ./WORKFLOW.md
node dist/src/cli/index.js dry-run ./WORKFLOW.md
node dist/src/cli/index.js run ./WORKFLOW.md
node dist/src/cli/index.js daemon ./WORKFLOW.md
```

常用範例：

| 檔案 | 用途 |
| --- | --- |
| `examples/WORKFLOW.quickstart.mock.md` | 本機 mock 校驗和 dry-run。 |
| `examples/WORKFLOW.dashboard.mock.example.md` | 啟用本機 dashboard 的 mock daemon。 |
| `examples/WORKFLOW.github-issues.example.md` | GitHub Issues + Codex。 |
| `examples/WORKFLOW.claude-code.example.md` | GitHub Issues + Claude Code。 |
| `examples/WORKFLOW.jira.example.md` | Jira + Codex。 |
| `examples/WORKFLOW.plane.example.md` | Plane + Codex。 |
| `examples/WORKFLOW.shell-agent.example.md` | 通用可信 Shell runner。 |
| `examples/WORKFLOW.docker.mock.example.md` | Docker Compose mock workflow。 |

### Docker Compose

Docker Compose 會執行兩個服務：

| 服務 | 作用 |
| --- | --- |
| `orchestrator-api` | 在 `127.0.0.1:4001` 提供 API 和建置後的 UI。 |
| `orchestrator-worker` | 以 worker loop 方式執行 `run /config/WORKFLOW.md --poll`。 |

準備本機 demo 檔案：

```bash
mkdir -p config workspaces logs data
cp examples/WORKFLOW.docker.mock.example.md config/WORKFLOW.md
cp examples/mock-issues.json config/mock-issues.json
mkdir -p config/template-repo
git -C config/template-repo init -b main
git -C config/template-repo config user.email "local@example.invalid"
git -C config/template-repo config user.name "Local Demo"
printf "# Docker demo repo\n" > config/template-repo/README.md
git -C config/template-repo add README.md
git -C config/template-repo commit -m "Initial demo repo"
```

啟動：

```bash
docker compose up --build -d
```

打開 UI：

```text
http://127.0.0.1:4001/
```

查看狀態：

```bash
docker compose ps
docker compose logs -f orchestrator-api
docker compose logs -f orchestrator-worker
```

在 Compose 中執行一次性命令：

```bash
docker compose run --rm orchestrator-worker validate /config/WORKFLOW.md
docker compose run --rm orchestrator-worker dry-run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker run /config/WORKFLOW.md
docker compose run --rm orchestrator-worker daemon /config/WORKFLOW.md --max-cycles 1
```

掛載路徑：

| 主機路徑 | 容器路徑 | 用途 |
| --- | --- | --- |
| `./config` | `/config` | Workflow 和非 secret 設定。 |
| `./workspaces` | `/workspaces` | 每個 issue 的 checkout。 |
| `./logs` | `/logs` | Agent、Git 和 PR log。 |
| `./data` | `/data` | JSON state 和 mock tracker 事件檔。 |

更多 Docker 說明見 [docs/deployment.md](docs/deployment.md)。

### 真實任務

連接真實 Jira、Plane、GitHub Issues、Codex、Claude Code 或 Shell 前：

1. 複製最接近的 workflow 範例。
2. 設定 tracker、repository、branch prefix、agent、states 和 retry 設定。
3. 透過環境變數設定 secret。
4. 執行 `validate`。
5. 執行 `dry-run`。
6. 先從一個低風險 issue 開始。
7. 人工 review draft PR。

常用 secret：

```bash
export GITHUB_TOKEN="..."
export GH_TOKEN="..."
export JIRA_EMAIL="..."
export JIRA_API_TOKEN="..."
export PLANE_API_TOKEN="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export DATABASE_URL="postgres://orchestrator:change-me@localhost:5432/orchestrator"
```

production 建議使用：

```yaml
state:
  kind: postgres
  connection_string: ${DATABASE_URL}
  lock_ttl_seconds: 900
```

### 開發

```bash
npm run build
npm test
npm run lint
npm run validate:examples
npm run validate:mock
npm run dry-run:mock
npm run daemon:mock:once
```

目錄：

```text
src/      CLI、orchestrator、trackers、agents、workflow、workspaces、state、API、security
ui/       React operator console
tests/    Node test suite
docs/     設計、路線圖、部署和擴展文件
```

修改行為前請閱讀 [AGENTS.md](AGENTS.md)。

### 更多文件

| 文件 | 用途 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架構、邊界、耦合點和擴展介面。 |
| [docs/TECHNICAL_ROADMAP.md](docs/TECHNICAL_ROADMAP.md) | 目前狀態、風險、後續任務和 checklist。 |
| [docs/deployment.md](docs/deployment.md) | Docker Compose 部署說明。 |
| [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md) | 如何新增 tracker adapter。 |
| [docs/ADDING_AGENT_RUNNERS.md](docs/ADDING_AGENT_RUNNERS.md) | 如何新增 agent runner。 |

### 安全說明

- `run` 和 `daemon` 會依 workflow 設定執行 Git、GitHub CLI、Codex、Claude Code、Shell 命令和 tracker 寫入 API。
- 真實執行前先使用 `validate` 和 `dry-run`。
- dashboard/API 保持本機綁定。
- 使用最小權限憑證。
- 在隔離 workspace 中執行 agent。
- 所有 draft PR 都需要人工 review。
