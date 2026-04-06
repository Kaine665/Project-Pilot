# as-is：Agents 工作区（Flows / agents）

`last_reviewed`: 2026-03-27

## 路由与入口

- 页面：`src/app/[locale]/flows/agents/page.tsx`（大型客户端页：会话列表、多 Tab、与 URL 同步等）。
- 侧栏组件：`src/components/agents-workspace-rail.tsx`（VS Code 风格四面板：项目工作区、Agent 数据目录、提示词注入栈、系统能力，四块平级；每两块之间都有独立拖拽条，weights 持久化键 `pp.agentsRail.panelWeights`。折叠持久化：`pp.agentsRail.projectWorkspaceCollapsed`、`pp.agentsRail.folderCollapsed`、`pp.agentsRail.promptCollapsed`、`pp.agentsRail.capCollapsed`）。

## 对话区

- 主对话：`AgentChatPanel` 自 `src/components/agent-chat-panel` 懒加载；可传 `workspaceMode`、`projectKey` 等（由页面组装）。

## 相关设计 / 契约

- 原则与目标态：`docs/design/agents-workspace.md`
- 当期或历史契约：`docs/contracts/`（按文件名与 front matter 查找）

## 非本文范围

- 会话消息持久化格式与 API：见 `src/lib/chat-managers/agent-chat-session-store.ts`、`src/server/routes/agent-chat.ts`（可另起 as-is 页）。
