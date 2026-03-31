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

- 数据布局：本机 `~/.project-pilot/README.md` + **`数据文件夹现状.md`**；仓库内与代码对齐的索引 **[`docs/data-storage.md`](docs/data-storage.md)**（`file-store` 默认 **`~/.project-pilot`**，不再默认 `~/.project-pilot/data/`）。对齐 2026-03-31
- 可通过 `PROJECT_PILOT_DATA_DIR` 环境变量自定义
- JSON 文件读写有 50MB 大小限制
- `writeJsonFile()` 自动创建父目录

## 前端布局约定

- flows 子页面用 `max-w-[1100px] px-6 py-10` 居中布局
- 卡片网格用 3 列 `grid-cols-3 gap-4`
- Flows **侧栏无「上下文」入口**：`BookOpen` 按钮 tooltip 为 **「文档」**，跳转 `/flows/docs/...`（`src/app/[locale]/flows/layout.tsx` 与 `src/client/routes/flows-layout.tsx` 内容一致）。`/flows/context` 仅为保留路由（重定向到文档库），`isContextPage` 用于与文档页共用同一高亮

## Agent 架构

- Agent 对话管理在 `src/lib/chat-managers/agent-chat-manager.ts`（SDK `query()` 路径，非继承 Task Worker 的 `BaseChatManager` 执行链）
- Prompt 构建通过 **Resource 系统**：`defaultResources` / `resourceRefs` → `ResourceRegistry.loadAll()` → 按 priority 排序加载
- Resource 类型（节选）：`design-docs-index`、`global-prompt`、`project-prompt`、`inline-text`、`todo-list`、`flow-context`、`reference-turns`、`skill` 等；**无** `context-index` / `context` 运行时加载
- Butler 是默认 agent；内置提示字符串见 `src/data/defaults/builtin-prompts.ts`
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

**Task Worker 预绑定到任务：**
- `TreeItem.agentId` 存储预绑定的 agent ID（持久化到 flows JSON）
- 点 Sparkles 启动时，`agentId` 传入 POST `/api/tasks`，写入 `task.agentId`
- `task-detail.tsx` 读取 `task.agentId` → 拉取 agent → 判断 `executionMode` → 渲染对应 panel

**相关代码：**
- `src/types/index.ts` — `Agent.executionMode` 字段定义
- `src/lib/default-agents.ts` — task worker `executionMode: 'task'`
- `src/components/task-detail.tsx` — `isChatMode` 判断 + 条件渲染
- `src/components/miller-columns.tsx` — TreeItem 绑定 agent 的 UI（Bot 按钮 + picker）

## 设计知识记录规范

对于涉及架构/设计层面的决策，必须在以下四处同步记录：

1. **函数命名** — 名字本身就要体现设计意图
2. **代码旁注释** — 在调用处写结构注释块，说明各层关系和约束
3. **MEMORY.md**（本文件）— 给 AI 下次进项目时快速获取上下文，写关键结论而非细节
4. **docs/** — 给人类读的完整架构文档，含流程图、表格、文件清单
