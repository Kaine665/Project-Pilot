# as-is：Agents 工作区（Flows / agents）

`last_reviewed`: 2026-03-27

## 路由与入口

- 页面：`src/app/[locale]/flows/agents/page.tsx`（大型客户端页：会话列表、多 Tab、与 URL 同步等）。
- 侧栏组件：`src/components/agents-workspace-rail.tsx`（文件夹区、提示词栈、能力卡片；上下分栏比例持久化键 `pp.agentsRail.folderRatio`；文件夹区折叠状态持久化键 `pp.agentsRail.folderCollapsed`，首次打开默认折叠，用户手动展开后记住偏好）。

## 对话区

- 主对话：`AgentChatPanel` 自 `src/components/agent-chat-panel` 懒加载；可传 `workspaceMode`、`projectKey` 等（由页面组装）。

## 相关设计 / 契约

- 原则与目标态：`docs/design/agents-workspace.md`
- 当期或历史契约：`docs/contracts/`（按文件名与 front matter 查找）

## 非本文范围

- 会话消息持久化格式与 API：见 `src/lib/chat-managers/agent-chat-session-store.ts`、`src/server/routes/agent-chat.ts`（可另起 as-is 页）。
