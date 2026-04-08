# Cursor 中接入 ProjectPilot MCP（`project-pilot`）

本文说明如何在 Cursor 里通过 **stdio MCP** 连接本仓库自带的 `mcp-server`，让外部 Agent 只读访问项目注册表、知识库文档、Todo、Agent 配置、技能与提示词等。

## 配置文件位置

在**仓库根**（含 `mcp-server/`、`package.json`、`docs/` 的那一层）使用：

`.cursor/mcp.json`

（勿与 `develop-static/.gitignore` 所忽略的 **`develop-static/.mcp.json`** 混淆——若你使用带 `develop-static/` 子目录的派生布局，该文件用于可能含密钥的本地 MCP，默认不入库。）

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

## 布局 B：嵌套 `develop-static/`（应用只在子目录）

若你以**外层 monorepo 根**打开 Cursor，而 Node 依赖与 `mcp-server` 在 **`develop-static/`** 下：

- **`args`** 中凡相对仓库根的路径须加前缀 **`develop-static/`**（否则 Cursor 会解析到 **`仓库根/node_modules`**，找不到 `tsx`）。
- **`TSX_TSCONFIG_PATH`** 设为 **`develop-static/tsconfig.json`**（相对仓库根）。

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
| `Cannot find module '...\Project-Pilot\node_modules\tsx\...'` 且实际装在子目录 | `args` 用了 `./node_modules/...`，被解析到错误根 | 布局 B：改为 `develop-static/node_modules/...` |
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

## 变更记录

| 日期 | 摘要 |
|------|------|
| 2026-04-08 | 初版：布局 A/B、Cursor 路径解析、`TSX_TSCONFIG_PATH`、禁止 `npm run` 污染 stdout、自检命令 |
