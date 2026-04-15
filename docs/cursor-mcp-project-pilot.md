# Cursor 中接入 ProjectPilot MCP（`project-pilot`）

本文说明如何在 Cursor 里通过 **stdio MCP** 连接本仓库自带的 `mcp-server`，让外部 Agent 只读访问项目注册表、知识库文档、Todo、Agent 配置、技能与提示词等。

## 配置文件位置

在**仓库根**（含 `mcp-server/`、`package.json`、`docs/` 的那一层）使用：

`.cursor/mcp.json`

（勿与 `.gitignore` 所忽略的 **`.mcp.json`** 混淆——若你把主应用放在**子目录**（例如历史上曾用 `develop-static/`），该文件用于可能含密钥的本地 MCP，默认不入库。）

## 布局 A：官方仓库（应用与依赖在仓库根）

与 **GitHub `Kaine665/Project-Pilot`** 的 `next` 线一致：工作区根即 `package.json` 所在目录。

Cursor 对工作区 MCP 的 `args` 路径常以 **`${workspaceFolder}`** 为基准解析；`tsx` 在 **`node_modules`**。同时 `src/lib/*` 使用 **`@/`** 别名，须在子进程里让 tsx 读到 **`tsconfig.json`**（通过 **`TSX_TSCONFIG_PATH`**）。

推荐配置（与仓库内 `.cursor/mcp.json` 一致）：

```json
{
  "mcpServers": {
    "project-pilot": {
      "command": "node",
      "args": [
        "node_modules/tsx/dist/cli.mjs",
        "mcp-server/index.ts"
      ],
      "cwd": "${workspaceFolder}",
      "env": {
        "TSX_TSCONFIG_PATH": "tsconfig.json"
      }
    }
  }
}
```

## 布局 B：嵌套子目录（主应用在 monorepo 子包）

若你以**外层 monorepo 根**打开 Cursor，而 Node 依赖与 `mcp-server` 在子目录 **`develop-static/`**（路径名可按你的仓库调整）下：

- **`args`** 中凡相对**工作区根**的路径须加前缀 **`develop-static/`**（否则 Cursor 会解析到 **`仓库根/node_modules`**，找不到 `tsx`）。
- **`TSX_TSCONFIG_PATH`** 设为 **`develop-static/tsconfig.json`**（相对工作区根）。

```json
{
  "mcpServers": {
    "project-pilot": {
      "command": "node",
      "args": [
        "develop-static/node_modules/tsx/dist/cli.mjs",
        "develop-static/mcp-server/index.ts"
      ],
      "cwd": "${workspaceFolder}",
      "env": {
        "TSX_TSCONFIG_PATH": "develop-static/tsconfig.json"
      }
    }
  }
}
```

修改后请 **Developer: Reload Window**。在 **Settings → MCP** 中确认 `project-pilot` 为已连接（绿）。

## 排错速查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `Cannot find module '...\Project-Pilot\node_modules\tsx\...'` 且实际装在子目录 | `args` 用了 `./node_modules/...`，被解析到错误根 | 布局 B：改为 `develop-static/node_modules/...`（前缀与真实子目录名一致） |
| `Cannot find module '@/lib/file-store'` | 未加载正确的 `tsconfig.json`，`@/*` 未解析 | 设置 `TSX_TSCONFIG_PATH`（见上表两布局） |
| MCP 面板无 `project-pilot` | 打开的不是含 `.cursor/mcp.json` 的工作区根 | 用**含该文件的目录**作为 Cursor 文件夹 |
| 不要用 `npm run mcp` 作为 Cursor 的启动命令 | npm 会把 `> project-pilot@...` 等打到 **stdout**，污染 MCP 的 JSON-RPC | 使用 `node` + `tsx/dist/cli.mjs`，或等价的无 npm 横幅启动方式 |

## 本地自检

在**布局 A** 仓库根：

```bash
npm install
node node_modules/tsx/dist/cli.mjs mcp-server/index.ts
```

**布局 B** 在 monorepo 根且带 `TSX_TSCONFIG_PATH=develop-static/tsconfig.json` 时：

```bash
node develop-static/node_modules/tsx/dist/cli.mjs develop-static/mcp-server/index.ts
```

（进程会等待 stdio；无立即报错即表示入口与依赖可加载。）

## 能力与实现

工具列表与语义见 `mcp-server/index.ts`（`list_projects`、`list_documents`、`search_documents`、`list_todos`、`list_agents` 等）。

## Paper（设计画布 MCP）

仓库根 `.cursor/mcp.json` 中与 **`project-pilot` 并列** 配置了 [Paper MCP](https://paper.design/docs/mcp)：通过 **`npx -y mcp-remote http://127.0.0.1:29979/mcp`** 桥接到本机 **Paper Desktop** 在打开设计文件时启动的服务。

**使用前**：安装 [Paper Desktop](https://paper.design/downloads)，在应用里**打开至少一个设计文件**（后台才会监听 `29979`）。然后在 Cursor **Developer: Reload Window**，在 **Settings → Tools & MCP** 中确认 `paper` 已连接。若 Agent 仍看不到工具，按 Paper 文档对 MCP 开关做一次重载。

**WSL**：若从 Linux 子环境连不上 `127.0.0.1:29979`，见 Paper 文档中的 **Windows WSL / mirrored networking** 说明。

## 变更记录

| 日期 | 摘要 |
|------|------|
| 2026-04-12 | 增补：与 `.cursor/mcp.json` 一致的 **Paper** MCP（`mcp-remote` → Paper Desktop）、前置条件与排错 |
| 2026-04-08 | 初版：布局 A/B、Cursor 路径解析、`TSX_TSCONFIG_PATH`、禁止 `npm run` 污染 stdout、自检命令 |
