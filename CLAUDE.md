# ProjectPilot — Architecture Migration Branch

## 这是什么

这是 ProjectPilot 的**架构迁移分支** (`arch/vite-hono-migration-260325`)。

从 Next.js 全栈架构迁移到：
- **前端**：React + Vite (SPA) + React Router v7 + react-i18next
- **后端**：Hono (Node.js/Bun) — 统一后端，吸收了原 Sidecar 进程
- **桌面**：Electron (简化为 2 进程：Main + Hono Backend)

## 技术栈

- **前端**: React 19 + Vite 8 + TypeScript (strict) + Tailwind CSS 4 + shadcn/ui (Radix)
- **后端**: Hono 4 + @hono/node-server
- **国际化**: react-i18next (中/英)
- **状态管理**: Zustand
- **路由**: React Router v7 (SPA)
- **AI**: Claude Agent SDK, OpenAI Codex SDK, MCP SDK
- **桌面**: Electron 40
- **包管理**: Bun (运行时 + 包管理器)
- **开发端口**: 前端 4000, 后端 4500

## 开发命令

```bash
bun run dev            # 同时启动 Vite (4000) + Hono (4500)
bun run dev:client     # 仅 Vite 前端
bun run dev:server     # 仅 Hono 后端
bun run build          # 生产构建（Vite + Bun bundle）
bun run electron:dev   # Electron 开发模式
```

## 项目结构

```
src/
├── client/              # 前端 SPA 入口和配置
│   ├── main.tsx         # Vite 入口
│   ├── App.tsx          # React Router 配置
│   ├── i18n/            # i18n 配置 + 兼容层
│   └── routes/          # FlowsLayout 等
├── server/              # Hono 后端
│   ├── index.ts         # 服务器入口（注册所有路由）
│   ├── routes/          # 20 个路由模块
│   └── middleware/       # 错误处理等
├── components/          # React 组件（约 79 个文件）
├── hooks/               # React Hooks
├── stores/              # Zustand 状态管理
├── lib/                 # 业务逻辑（约 130 个文件，共享给 server）
├── types/               # TypeScript 类型定义
├── app/[locale]/flows/  # 页面组件（由 React Router lazy 加载）
index.html               # SPA 入口 HTML
vite.config.ts           # Vite 配置
```

## 核心架构约定

### 数据层

- 所有数据存储在 `~/.project-pilot/data/`（纯 JSON 文件，无数据库）
- 数据操作通过 `src/lib/file-store.ts`，使用原子写入（先写 .tmp 再 rename）
- `modifyJsonFile()` 带进程级写入队列（同文件路径串行）

### 后端架构

- 单一 Hono 进程处理所有 API 请求，不再有 Sidecar
- `AgentChatManager`、`SchedulerManager`、`EventTriggerManager` 直接运行在 Hono 进程内
- 20 个路由模块，覆盖全部 91 个 API 端点
- 错误处理通过 `errorHandler` 中间件统一捕获

### 前端架构

- Vite SPA + React Router v7 客户端路由
- `src/client/i18n/routing.tsx` 提供 `Link`/`useRouter`/`usePathname` 兼容层
- `src/client/i18n/use-translations.ts` 提供 `useTranslations` 兼容层（next-intl → react-i18next）
- 所有组件的 `'use client'` 指令无害保留

### 提示词系统

- `src/lib/agent-prompt-store.ts` 管理 prompt 文件的读写删
- `writePromptFile()` 写入前自动快照到 `.history/`（保留 20 份）
- 会话可拥有 runtime 工作副本 `.runtime/{sessionId}.md`

### Agent 系统

- 内置 Agent 在 `src/lib/default-agents.ts`
- Agent 通过 `executionMode` 区分：`'task'`（ProcessManager + worktree）vs `'chat'`（AgentChatManager）
- `AgentChatManager` 是进程级单例
