# MEMORY — AI 快速上下文

> 本文件供 AI（Claude Code 等）进入项目时快速获取关键结论。不要写细节，只写「必须知道」的东西。

> **多厂商入口与同步协议**（改路径/架构时请联动更新）：[`docs/AI_AGENT_KNOWLEDGE_MAP.md`](docs/AI_AGENT_KNOWLEDGE_MAP.md)。仓库根 [`AGENTS.md`](../AGENTS.md) 供 Cursor 等跳转。

---

## 统一文档系统（设计文档 + 知识文档）

**存储（当前）**

- 根：`{DATA_DIR}/documents/`（默认 `~/.project-pilot/documents/`）— `index.json`、`entries/<id>.json`、`content/<fileName>`
- API：**`/api/docs`**（`server/routes/docs.ts`）；`documentKind`：`design_doc` | `knowledge`
- 旧 `context/`、`design-docs/` 等若仍存在于数据根，仅为遗留；运行时只认 `documents/`（历史数据应已合并）

**类型说明**

- **`DocEntry` / `DocsIndexData`**：当前真相模型
- **`ContextEntry`**：仍留在 `types/index.ts`，**仅作旧 `context/index.json` 形状的类型标注**，不是线上 API 类型

**Prompt / Resource**

- **领域口径**：④ Resource = 上下文来源（开放集合）；`prompts/` 按 scope 分桶存储、非独立聚合根；scope 级指令见 **`docs/领域与数据.md` §2、§5**
- 设计文档索引表：资源类型名仍为 `design-docs-index`（历史命名），数据来自统一 `documents` 索引
- Code Card 等：从知识类 `DocEntry` + `documents/content` 匹配，无独立 context API

**相关代码：**

| 职责 | 文件 |
|------|------|
| 类型 | `src/types/index.ts` — `DocEntry`, `DocumentKind`, `DocsIndexData` |
| 路径 | `src/lib/file-store.ts` — `getDocumentsIndexPath`, `getDocumentContentPath`, … |
| 存储 | `src/lib/documents-store.ts` |
| 布局说明 | `docs/data-storage.md`（与 `file-store` 对齐） |
| 前端文档库 | `src/app/[locale]/flows/docs/[projectKey]/page.tsx` |
| 旧入口跳转 | `src/app/[locale]/flows/context/page.tsx` → `?view=knowledge` |

---

## Git 分支（协作）

- **`main`** 稳定可发布；**`next`** 日常集成；**`feature/*`** 从 `next` 开、PR → `next`；**`hotfix/*`** 从 `main` 开、PR → `main` 并回灌 `next`。详情 **[`CONTRIBUTING.md`](CONTRIBUTING.md)**；GitHub 保护规则 **[`docs/github-branch-policy.md`](docs/github-branch-policy.md)**。

## 数据存储

- 数据布局：本机 `~/.project-pilot/README.md` + **`数据文件夹现状.md`**；仓库内与代码对齐的索引 **[`docs/data-storage.md`](docs/data-storage.md)**（`file-store` 默认 **`~/.project-pilot`**，不再默认 `~/.project-pilot/data/`）。对齐 2026-04-03
- **Agents 工作区 UI**：`config/agents-workspace-ui.json` 按项目保存已打开会话标签、当前面板与 **`lastFocusByAgent`**；`GET/PUT /api/data/agents-workspace-ui` 会校验 **projectKey**（格式 + 未归档项目存在）、**agentId** 在注册表、**sessionId** 在会话索引且 **agentId / projectKey** 与桶一致，并去重；实现见 `lib/agents-workspace-ui-sanitize.ts`
- 可通过 `PROJECT_PILOT_DATA_DIR` 环境变量自定义
- JSON 文件读写有 50MB 大小限制
- `writeJsonFile()` 自动创建父目录
- **Hono 启动**：`src/server/index.ts` 在 `ensureDataDirV2Migrated` 之后会 **`schedulerManager.init()`** 与 **`eventTriggerManager.init()`**，进程重启后恢复 **cron 定时**与 **GitHub PR 轮询**（路线图 C1）
- **并行执行看板**：`agents/active-tasks.json`（多 Agent 运行时登记）；与 **Todo**（`todos/`）不同，见 `docs/领域与数据.md` §6
- **会话（领域）= 连续上下文**：实现类型 **`AgentChatSession`** / 索引行 **`SessionMeta`**（`sessions/index.json` + `sessions/messages/*.jsonl`）；**`LegacyTaskWorkerSession`** 为历史形状，勿与当前会话混用。权威对照表见 **`docs/领域与数据.md` §0**
- **Execution Event 落盘**：每个 Turn 结束后从内存归约出 `ExecutionEvent`（完整事件，非 delta），追加到 `sessions/events/<sessionId>.jsonl`。Run 元数据存 `sessions/runs/<sessionId>.json`。API：`GET /api/agent-chat/sessions/:id/events`、`/runs`、`POST /runs`、`PATCH /runs/:runId`。详见 `types/execution.ts`、`lib/execution-event-store.ts`、`docs/领域与数据.md` §3

## 前端布局约定

- 主工作区（`/workspace/*`）子页面用 `max-w-[1100px] px-6 py-10` 居中布局
- 卡片网格用 3 列 `grid-cols-3 gap-4`
- **侧栏无单独「上下文」入口**：`BookOpen` 为 **「文档」**，跳转 `/workspace/docs/...`（壳组件 `src/client/routes/workspace-shell.tsx`；`app/[locale]/flows/layout.tsx` 为同源镜像）。`/workspace/context` 保留为重定向到文档库 `?view=knowledge`，`isContextPage` 与文档页共用高亮

## Agent 架构

- Agent 对话管理在 `src/lib/chat-managers/agent-chat-manager.ts`（SDK `query()` 路径，非继承 Task Worker 的 `BaseChatManager` 执行链）
- **Agent Runner 路由**（`agent-runner.ts`）：`openai` → CodexAgentRunner（Codex SDK）；**其余全部** → ClaudeAgentRunner（Claude Agent SDK）。**不可引入无工具的裸 Messages Runner**——第三方供应商（MiniMax/DeepSeek/Kimi 等）必须走 ClaudeAgentRunner 才能获得 tool_use 支持
- Prompt 构建通过 **Resource 系统**：`defaultResources` / `resourceRefs` → `ResourceRegistry.loadAll()` → 按 priority 排序加载
- Resource 类型（节选）：`design-docs-index`、`global-prompt`、`project-prompt`、`inline-text`、`todo-list`、`flow-context`、`reference-turns`、`skill` 等；**无** `context-index` / `context` 运行时加载
- Butler 是默认 agent；内置提示字符串见 `src/data/defaults/builtin-prompts.ts`
- **全局约束**（`global-prompt`）：默认模板 `PROMPT_GLOBAL` 含「Agent 数据工作区（磁盘约定）」等；用户可在 `prompts/global.md` 或设置里编辑。`agent-data-info` 仅在 **dataStore** 时列出 `agents/workspaces/<id>/` 下文件
- **未读消息**：`AgentChatSession.unreadCount` 字段，`persistSession()` 递增，`markAsRead()` 清零
- **设计文档 / 知识文档**：统一写入 `documents/`，通过 `<save-doc>` / `PATCH /api/docs/:id` 等；旧「知识草稿弹窗」已移除
- **Guest Agent**：`parentSessionId` + `importedTurnIndices` 实现对话旁听

### 内置 Agent 字段迁移（不可省略）

磁盘 `agents.json` 是旧版本写入的快照，后续新增字段（如 `capabilities`）不会自动出现。
**两处都必须做合并**，缺一不可：
1. `readAgents()`（`/api/agents/route.ts`）— API 层，每次 GET/POST/PATCH/DELETE 都会触发
2. `start()`（`agent-chat-manager.ts`）— 运行时，直接读文件不经 API

如果 `capabilities` 缺失 → `buildAgentPermissionArgs()` 回退到 `DEFAULT_AGENT_CAPABILITIES`（`skipReview: false`）→ Claude 进程无 `--dangerously-skip-permissions` → 非交互模式卡死。

### 并发策略：Session 级互斥，Agent/Project 无限制

- **同一个 session** 内不能并发两条消息（`This session is already running`）— 防乱序，保留
- **同一个 agent** 的多个 session 可以并行运行 — per-agent 并发检查已删除
- **同一个 project** 的多个 agent/session 可以并行运行 — per-project 并发检查已删除
- 以前存在的 `getRunningForAgent()` / `getRunningForProject()` 方法还在，但不再用于阻断

### 图片支持（Multimodal）

链路：前端粘贴 → base64 data URL → POST body `{mediaType, data}` → API 校验 → manager 写 tmpdir → `--image /tmp/xxx.png` flag → Claude CLI → 进程结束后 `unlink` 清理。

**关键约束：**
- 图片以 data URL 形式存入 session message history（供 UI 回显），**不存 base64 裸数据**
- API 层校验：最多 5 张 / 每张 ≤5MB (decoded) / MIME 白名单 `['image/png','image/jpeg','image/gif','image/webp']`
- 临时文件用 `crypto.randomBytes(8).toString('hex')` 命名，进程 `close` 事件里 `unlink`（fire-and-forget）
- `--image` flag 对 `--resume` 模式同样有效（当前轮可带图，下一轮不重发）
- 允许纯图无文字发送：API message 字段允许空字符串，但 message 和 images 不能同时为空

### 前端错误必须可见

`agent-chat-panel.tsx` 所有错误路径（POST 失败、SSE 断连、stream error 事件）都必须通过 `setErrorMsg()` 暴露到 UI。绝不能只 `console.error`，否则用户看到的是"管家不理我"。

### 统一管家（Planner 已删除）

- Planner 系统已删除，管家功能统一到 Agent Chat
- `agent-chat-panel.tsx` 三种渲染模式：plain（agents 页面）、sidebar（布局侧边栏）、full（全屏 butler 页面）
- `variant` 和 `projectKey` 都是可选 props，agents 页面不传 → 零侵入
- 组件已拆分提取：`chat-input.tsx`、`session-dropdown.tsx`、`conversation-tabs.tsx`、`chat-notification-banners.tsx`、`guest-agent-overlay.tsx`、`agent-form.tsx`、`agent-session-utils.ts`

### Agent 执行模式（executionMode）

`Agent.executionMode?: 'task' | 'chat'` 决定任务页面走哪条执行路径：

| executionMode | 执行路径 | Prompt 来源 | Git/Phases |
|--------------|---------|------------|-----------|
| `'task'`（仅 task worker） | ProcessManager | `buildPrompt()` 动态构建 | 有（worktree、阶段切换）|
| `'chat'`（默认，所有自定义 agent） | AgentChatManager | `agent.systemPrompt` | 无 |

**不可动摇的约束：**
1. `executionMode: 'task'` 只对 task worker 有意义 — `buildPrompt()` 是 task worker 专属基础设施，自定义 agent 设为 `'task'` 无法获得不同行为
2. 自定义 agent 未设置 `executionMode` 时，`task-detail.tsx` 默认按 `'chat'` 处理（`executionMode ?? 'chat'`）
3. chat 模式不显示 ArtifactPanel（无阶段/产物概念）

**Task Worker（已归档）与树形链路 UI：** 原 `TreeItem` / Miller 看板 / 独立看板 JSON 已移除；磁盘遗留为 `workflows/legacy-board/`（未迁移时可能仍为 `workflows/flows/`）；`Session.flowContext`（`FlowTaskContext`）类型仍保留以兼容旧会话数据。

## 设计知识记录规范

对于涉及架构/设计层面的决策，必须在以下四处同步记录：

1. **函数命名** — 名字本身就要体现设计意图
2. **代码旁注释** — 在调用处写结构注释块，说明各层关系和约束
3. **MEMORY.md**（本文件）— 给 AI 下次进项目时快速获取上下文，写关键结论而非细节
4. **docs/** — 给人类读的完整架构文档，含流程图、表格、文件清单
