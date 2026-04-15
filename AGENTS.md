# ProjectPilot — AI / Agent 入口

主应用位于**本仓库根目录**（含 `package.json`、`src/`、`mcp-server/`）。辅助编程或回答项目问题时，请优先阅读：

1. **[docs/AI_AGENT_KNOWLEDGE_MAP.md](docs/AI_AGENT_KNOWLEDGE_MAP.md)**  
   仓库内有哪些文档、**多个 AI 厂商各自读哪个文件**、变更时如何**同步更新**（检查清单）。

2. **[docs/data-storage.md](docs/data-storage.md)**  
   用户数据目录与 `src/lib/file-store.ts` 路径函数对齐说明（默认 `~/.project-pilot/`）。

3. **[CLAUDE.md](CLAUDE.md)**  
   当前架构（Vite + Hono + Electron）、文档驱动开发流程、开发命令。

4. **[MEMORY.md](MEMORY.md)**  
   极简高频结论（详细仍以 `docs/` 与代码为准）。

5. **[CONTRIBUTING.md](CONTRIBUTING.md)** / **[docs/github-branch-policy.md](docs/github-branch-policy.md)**  
   协作与分支（`main`、`next`、`feature/*`、`hotfix/*`）及 GitHub 权限清单（维护者）。

6. **GitHub CLI 中文 PR 标题乱码（Windows）**  
   勿在 PowerShell 里对 `gh pr create --title` 直接传中文；应用 **UTF-8 JSON 文件 + `gh api --input`**，见 **[.cursor/rules/github-cli-utf8-pr.mdc](.cursor/rules/github-cli-utf8-pr.mdc)**。

7. **Cursor 外部 MCP（`project-pilot`）**  
   仓库根 **[`.cursor/mcp.json`](.cursor/mcp.json)** 注册 **project-pilot**（stdio）与 **paper**（`mcp-remote` → 本机 Paper Desktop，见 [Paper MCP](https://paper.design/docs/mcp)）；排错与路径约定见 **[docs/cursor-mcp-project-pilot.md](docs/cursor-mcp-project-pilot.md)**。

**约定**：修改数据路径、架构摘要或「AI 应知道的项目事实」时，按知识地图中的检查清单更新多个入口，并在知识地图文末 **变更记录** 登记。
