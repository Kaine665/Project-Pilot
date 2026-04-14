# as-is：Agents 工作区（Flows / agents）

`last_reviewed`: 2026-04-09

## 路由与入口

- 页面：`src/app/[locale]/flows/agents/page.tsx`（大型客户端页：会话列表、与 URL 同步等）。主内容区**不再**展示顶部多会话标签行，也**不再**展示顶栏「新开会话 / 历史」工具条；主区 Agent 信息卡**不展示**头像，**无**圆角描边/阴影的独立卡片外壳，仅保留名称、内置标识、模型/提供商一行与「配置 Agent」等操作。打开或切换具体会话主要依赖 URL 查询参数、左侧 Agent 列表与已持久化的焦点状态，以及 `AgentChatPanel` 在对话流程中通过 `onSessionChange` 回写父级（例如首条消息创建会话后写入真实 `sessionId`）。工作区模式下 `AgentChatPanel` 不展示内置会话侧栏与常规会话顶栏控件。**不再**在全局导航下方使用 `fixed top-16 lg:hidden` 的重复顶栏（避免标题与主内容区顶栏重复）。在 **lg 断点以下**左侧 Agent 列表与右侧 Rail 为抽屉，入口在主内容区 Agent 信息卡（及 Agent 设置顶栏）的 `lg:hidden` 的 `PanelLeft` / `PanelRight`；**lg 及以上**左侧列表常显，右侧 `AgentsWorkspaceRail` 可由顶栏 `PanelRight` 切换显隐（`workspaceRailVisible` + `lg:hidden`）。**桌面端该显隐**默认收起（无有效缓存时）；整页级 localStorage `pp.agentsPage.workspaceRailVisible.v1`（不按项目 / Agent），写入后 **3 小时内**刷新仍沿用上次选择，超时条目清除并回到默认收起。**md 及以上**左侧 Agent 列表列宽可拖右缘调整，最小 **240px**、最大 **520px**（并受视口约束），持久化键 `pp.agentsPage.agentListWidth.v1`；**拖至约 80px 以下**则收起整列（`pp.agentsPage.agentListCollapsed.v1`），宽度回写为上次展开值；全轨 **Agents** 在已处于 `/workspace/agents` 时点击会派发 `pp:agents-list-toggle` 以切换列表显隐（桌面：列收起/展开并写 `pp.agentsPage.agentListCollapsed.v1`；窄屏：抽屉开关）。**max-md** 抽屉宽度仍由原有 `max-md:w-[min(100%,300px)]` 等类控制。顶栏另有「更多」占位按钮（`Ellipsis`，与 refactor 相同暂无下拉逻辑）。
- **左侧 Agent 列表**：每个 Agent 行主标题下副文案为 **Agent `description`（简介）**，`line-clamp-2` 最多两行，**不**展示最近会话标题或最新消息预览；无简介时用 `workspace.defaultAgentDescription`。每个 Agent 行在悬停且该 Agent 有未归档会话时，行尾显示可点击的 **`+ N` / `− N`**，用于展开/收起该 Agent 下的历史列表（含「新会话」、草稿标签、会话项；置顶会话排序靠前，行左侧主色竖条 + 浅底；置顶成功瞬间约 1.4s 高亮 pulse）。再次点击**同一 Agent 行**仅切换该展开状态，不会把中间栏从会话缩回 Agent 概览。历史中的**已落盘会话**项支持**右键菜单**（`contextmenu` + 右键 `mousedown` 双通道，避免部分环境下菜单打不开）；菜单含置顶/重命名/标未读/分叉/归档。元数据经 `PATCH /api/agent-chat/sessions/:id` 与 `agent-chat-session-store` 持久化。重命名中的表单项也可唤出同一菜单。**草稿**（`sessionId === null`）右键仍为「从已打开列表移除」（仅草稿）。**同一 Agent** 在已打开列表中**至多一条**未落盘草稿：重复点「新会话」会激活已有草稿标签而非再追加；从工作区 UI 持久化 blob 恢复时也会去掉同 Agent 的多余草稿项；若内存或 localStorage/服务端仍残留多条，会在加载与 `openedSessions` 更新时合并并写回净化后的 tabs。
- 侧栏组件：`src/components/agents-workspace-rail.tsx`（VS Code 风格四面板：项目工作区、Agent 数据目录、提示词注入栈、系统能力，四块平级；每两块之间都有独立拖拽条，weights 持久化键 `pp.agentsRail.panelWeights`。折叠持久化：`pp.agentsRail.projectWorkspaceCollapsed`、`pp.agentsRail.folderCollapsed`、`pp.agentsRail.promptCollapsed`、`pp.agentsRail.capCollapsed`）。
- 全工作区壳层左侧轨：`WorkspaceSidebarRail` 中 **agent 模板** 的展示文案见 `messages/zh.json` / `en.json` 的 `workspaceSidebarRail.presets`；**路由与数据文件**仍为 `/workspace/presets`、`config/agent-presets.json`（历史命名，与类型名 `AgentPreset` 一致）。**「社区市场」**入口由 `WORKSPACE_SIDEBAR_COMMUNITY_ENABLED`（`workspace-sidebar-rail.tsx`）控制，当前为 **false**：不挂载对应 `SidebarNavRow`，`/workspace/community` 仍可手动打开（懒加载路由不变）。
- **任务（聚合）**：侧栏单项「任务」→ `/workspace/tasks`（`flows/tasks/layout.tsx`：顶栏标题 + 分段 `NavLink`）。子路由：`/workspace/tasks/todos`、`/workspace/tasks/triggers`、`/workspace/tasks/schedules`；原 `/workspace/todos`、`/workspace/task-triggers`、`/workspace/schedules` **重定向**至上述路径。设置里「定时运行页 / 任务触发页」开关关闭时，对应分段隐藏且访问子路径会回到待办；壳层 `workspace-shell` / `flows/layout` 的拦截路径已包含 `tasks/...`。**任务触发**（`TaskTriggersPanel` `tasksHub`）：顶部分割线工具条，内层 `max-w-3xl` 居中，左说明文案 + 右「新建触发规则」；**无** Rules/Enabled 统计卡；下列表区同宽单列可滚动。**定时运行**（`AgentSchedulesPanel` `showPageHeader={false}`）：工具条左「定时任务」标题 + 一行说明、右「新建定时任务」，内层 `max-w-3xl` 与触发对齐。**IA**：`docs/design/tasks-hub-information-architecture.md`。

## 对话区

- 主对话：`AgentChatPanel` 自 `src/components/agent-chat-panel` 懒加载；可传 `workspaceMode`、`projectKey` 等（由页面组装）。
- 主消息列表滚动容器在 `AgentChatPanelView`（`scrollRef` 所在 div）上使用 `[overflow-anchor:none]`（与 `agents-workspace-rail` 侧栏一致），减轻流式追加内容时浏览器滚动锚定把视口「粘」在旧节点（例如推理折叠内容）上的问题；自动滚底在 `AgentChatPanel` 内用连续 `requestAnimationFrame` 紧跟布局后再写 `scrollTop`。

## 对照 `refactor/google-oauth-browser-only`（系统核对摘要）

- **已对齐**：侧栏 Agent 历史展开（`+ N` / `− N`）、同 Agent 再点仅切换展开、草稿与已落盘会话右键菜单（含 `PATCH`：`pin`/`rename`/`markAsUnread`/`fork`/`archive` 等）、移除固定移动端重复顶栏、桌面右侧 Rail 显隐与顶栏 `Ellipsis`/`PanelRight`、窄屏抽屉断点与 refactor 一致（左列 `max-md`、右 Rail `max-lg`）。
- **refactor 中存在但未接线/可删**：`SessionCard` 组件、`listClockNow` 定时器、`historyExpanded` + `conversationStripRef` 的点击外关逻辑——在该分支 JSX 中**未挂载**，属死代码；当前工作区未恢复。
- **与社区目录等分支的文案差异**：`messages/*.json` 里 `community.agent.*` 等键随分支可变，与 Agents 工作区无直接耦合。

## 相关设计 / 契约

- 原则与目标态：`docs/design/agents-workspace.md`
- 当期或历史契约：`docs/contracts/`（按文件名与 front matter 查找）

## 非本文范围

- 会话消息持久化格式与 API：见 `src/lib/chat-managers/agent-chat-session-store.ts`、`src/server/routes/agent-chat.ts`（可另起 as-is 页）。
