# Agent Chat 架构文档

> 关联：`src/lib/chat-managers/agent-chat-manager.ts`、`src/server/routes/agent-chat.ts`、`src/components/agent-chat/agent-chat-panel.tsx`
>
> 更新时间：2026-04-14
>
> **参见**：[供应商/模型/SDK 支持关系](./provider-model-support.md) · [对话与 Agent 系统八层对标（设计）](./design/conversation-agent-system-lens.md)

---

## 整体架构

```
前端 AgentChatPanel
  │  POST /api/agent-chat  (message + images?)
  ▼
Hono route (agent-chat.ts)
  │  校验 → agentChatManager.start()
  ▼
AgentChatManager (extends BaseChatManager，内存单例)
  │  ResourceRegistry 加载 agent resources → 拼接 prompt
  │  createAgentRunner(provider) → runner.stream(prompt)
  ▼
AgentRunner 层（详见下节）
  │  SDKMessage / CodexEvent → EventAdapter → AgentEvent
  ▼
SSE stream  ←  前端 EventSource
```

---

## Agent Runner 层

`agent-runner.ts` 提供统一 `IAgentRunner` 接口，按 provider 路由到不同 SDK：

```
createAgentRunner(opts)
  ├─ provider === 'openai'  → CodexAgentRunner   (@openai/codex-sdk)
  └─ 其余全部                → ClaudeAgentRunner  (@anthropic-ai/claude-agent-sdk)
```

| Runner | SDK | 工具支持 | 适用供应商 |
|--------|-----|---------|-----------|
| ClaudeAgentRunner | Claude Agent SDK (`query()`) | 完整（Read/Bash/Write 等本地工具） | Anthropic、MiniMax、DeepSeek、Kimi、智谱等全量 Anthropic 兼容端 |
| CodexAgentRunner | Codex SDK (`thread.runStreamed()`) | 完整（Codex 本地沙箱工具） | OpenAI |

**设计约束：**

- **所有 Anthropic 兼容供应商必须走 ClaudeAgentRunner**。该 Runner 通过 Claude Agent SDK spawn Claude Code 子进程，子进程带完整工具定义（`tool_use` 协议）。若改走裸 Messages API，模型会丢失工具调用能力，表现为「把工具调用当文字输出」。
- 自定义供应商（`custom-*`）目前也走 ClaudeAgentRunner；仅当 `apiProtocol === 'openai'` 时此路径可能不适用，但当前实现中不做区分。

**相关文件：**

| 职责 | 文件 |
|------|------|
| Runner 工厂与实现 | `src/lib/chat-managers/agent-runner.ts` |
| Claude SDK 事件适配 | `src/lib/sdk-event-adapter.ts` |
| Codex SDK 事件适配 | `src/lib/codex-sdk-adapter.ts` |
| SDK Options 构造 | `src/lib/settings-manager.ts` — `buildSdkQueryOptions()` |
| Agent 事件类型 | `src/types/index.ts` — `AgentEvent` |

### Resource-based Prompt 构建

AgentChatManager 使用 Resource 系统动态构建 prompt，取代了旧的硬编码拼接方式：

```
agent.resources: ResourceRef[]
  → ResourceRegistry.loadAll(refs)
    → 各 ResourceLoader 按 priority 排序加载：
      ├─ SystemPromptLoader      (priority 10)  — agent.systemPrompt
      ├─ ContextIndexLoader      (priority 50)  — 全局上下文索引表
      ├─ ContextLoader           (priority 60)  — 指定上下文条目内联
      ├─ TodoListLoader          (priority 70)  — 待办事项
      ├─ InlineTextLoader        (priority *)   — 自定义内联文本
      ├─ StaticTextLoader: knowledge-instructions  (priority 80)
      ├─ StaticTextLoader: doc-save-instructions   (priority 85)
      └─ StaticTextLoader: session-title-instructions (priority 90)
  → 拼接为完整 system prompt
```

**相关文件：**
- `src/lib/resource-registry.ts` — 全局注册表单例
- `src/lib/resource-loader.ts` — ResourceLoader 接口
- `src/lib/resource-loaders/` — 各类加载器实现
- `src/lib/resource-migration.ts` — 旧版 Agent 字段到 ResourceRef[] 迁移
- `src/types/resource.ts` — ResourceType、ResourceRef 类型定义

---

## 并发策略

| 粒度 | 行为 | 原因 |
|------|------|------|
| 同一 session 内多条消息 | **阻断**（`This session is already running`） | 防止消息乱序、context 混乱 |
| 同一 agent 多个 session | **允许并行** | 各 session 状态独立，无共享 |
| 同一 project 多个 session | **允许并行** | 同上；project 文件并发写由 `modifyJsonFile` 串行化 |

`getRunningForAgent()` / `getRunningForProject()` 方法还在，未来如需限流可恢复使用。

---

## 图片支持（Multimodal）

### 数据流

```
用户粘贴截图
  └─ FileReader.readAsDataURL() → base64 data URL
        └─ pendingImages[] state（最多 5 张）

点击发送
  └─ data URL split(',') → {mediaType, data}
        └─ POST /api/agent-chat  body.images

API 校验
  ├─ 最多 5 张
  ├─ mediaType 白名单：png / jpeg / gif / webp
  ├─ 单张 base64 decoded ≤ 5 MB
  └─ base64 格式正则验证

AgentChatManager.start()
  └─ 每张写 tmpdir/agent-img-{random}.{ext}
        └─ spawn args 追加 ['--image', tmpPath, ...]
              └─ 进程 close 时 unlink(tmpPath)（fire-and-forget）

message history
  └─ 存 data URL（供 UI 回显），不存裸 base64
```

### 重要约束

1. `--image` flag 对 `--resume` 模式同样有效：当前轮携带图片，历史轮不重发
2. message 字段允许为空字符串，但 message 和 images 不能同时为空
3. 图片以 data URL 形式持久化到 `data/agent-chat-sessions.json`，session 加载时原样回显
4. 临时文件用 `crypto.randomBytes(8)` 命名，规避同名冲突

---

## 会话生命周期

```
generateSessionId()
    │
    ▼
POST /api/agent-chat → manager.start(sessionId, agentId, message, flowContext?, images?)
    │
    ▼
Claude 子进程运行中
    │  stdout → StreamParser → events[] → SSE listeners
    │  stderr → error events（仅含 "Error" 关键词）
    │
    ▼
close event
    ├─ 清理临时图片文件
    ├─ 提取 sessionTitle（AI 生成 <session-title> 标签 或 fallback 用户消息前30字）
    ├─ 追加 assistant message 到 messages[]
    ├─ 捕获 claudeSessionId（用于下次 --resume）
    ├─ persistSession() → data/agent-chat-sessions.json
    └─ 增加 unreadCount（未读消息计数）
```

---

## 未读消息（Unread Badge）

Agent 回复后若用户不在当前会话，需要有未读提示（类似微信红点）。

### 数据模型

`AgentChatSession.unreadCount?: number` — 未读消息计数

### 写入时机

`persistSession()` 在保存 assistant 回复时自动 `unreadCount++`：

```typescript
if (idx >= 0) {
  session.unreadCount = (data.sessions[idx].unreadCount || 0) + 1;
  data.sessions[idx] = session;
} else {
  session.unreadCount = 1;
  data.sessions.push(session);
}
```

### 清零时机

`markAsRead(sessionId)` 将 `unreadCount` 设为 0，在以下场景触发：

| 场景 | 触发位置 |
|------|---------|
| 用户点击切换到某个会话 | agents page `handleSessionClick` / `agent-chat-panel` `handleSwitchSession` |
| 活跃会话的流式回复结束 | `agent-chat-panel` `finalizeStream` |
| agents 页面的 `onSessionChange` 回调 | agents page callback |

### API

```
PATCH /api/agent-chat/sessions/{id}
Body: { "action": "markAsRead" }
Response: { "ok": true }
```

### 前端 UI

三个位置展示红色未读 badge：

1. **Agents 页面左侧边栏** — `agents/page.tsx` 会话列表项右侧
2. **Butler 全屏模式左侧栏** — `agent-chat-panel.tsx` 会话列表
3. **Sidebar 模式下拉菜单** — `session-dropdown.tsx` 会话条目

未读 badge 样式：红底白字圆形（`bg-red-500 text-white rounded-full`），超过 99 显示 `99+`。
当前活跃会话不显示 badge（`!isActive && unreadCount > 0`）。

mark-as-read 请求使用 fire-and-forget 模式（`fetch().catch(() => {})`），不阻塞 UI。

---

## Guest Agent（旁听 Agent）

Guest Agent 允许用户在一个会话中"旁听"另一个 Agent 的部分对话。

### 数据模型

```typescript
// AgentChatSession 扩展字段
parentSessionId?: string;        // 宿主会话 ID
importedTurnIndices?: number[];  // 从宿主会话导入的轮次索引
```

### 工作流程

```
用户在主会话中选择轮次
  → GuestAgentOverlay 发起请求
    → POST /api/agent-chat/guest { parentSessionId, turnIndices, agentId }
      → 创建 guest session，导入选中轮次
      → guest agent 基于导入上下文继续对话
```

### 相关文件

| 职责 | 文件 |
|------|------|
| 前端 overlay | `src/components/guest-agent-overlay.tsx` |
| API 路由 | `src/app/api/agent-chat/guest/route.ts` |
| 类型定义 | `src/types/agent-chat.ts` — `parentSessionId`, `importedTurnIndices` |

---

## 设计文档与知识文档

对话中可通过 **`<save-doc>`** 等动作将内容写入统一文档域（`documentKind` 区分设计文档与知识文档）。

### 存储（当前）

- 根路径：`{DATA_DIR}/documents/`（默认 `~/.project-pilot/documents/`，与 `getDocuments*()` 一致）
- 聚合索引：`documents/index.json`；逐条元数据：`documents/entries/<docId>.json`；正文：`documents/content/<fileName>`
- HTTP：**`PATCH /api/docs/:id`** / **`POST /api/docs`**（详见 `server/routes/docs.ts`）

### 已移除的路径与能力

- 不再使用独立 **`/api/context`** 与磁盘上的旧 **`context/`**、**`design-docs/`** 域（已并入 `documents/`）。
- 对话内「知识草稿」弹窗与 `SaveKnowledgeDialog` 已移除；保存走统一文档 API。

### 通知 Banner

`ChatNotificationBanners` 仍可展示与文档/任务相关的提示（具体以当前组件实现为准）。

---

## 文件清单

| 职责 | 文件 |
|------|------|
| 会话管理、进程调度 | `src/lib/chat-managers/agent-chat-manager.ts` |
| 抽象基类 | `src/lib/chat-managers/base-chat-manager.ts` |
| 进程管理 | `src/lib/chat-managers/process-manager.ts` |
| 共享类型 | `src/lib/chat-managers/types.ts` |
| Resource 注册表 | `src/lib/resource-registry.ts` |
| Resource 加载器 | `src/lib/resource-loaders/` |
| Resource 迁移 | `src/lib/resource-migration.ts` |
| Agent Chat HTTP（Hono，前缀 `/api/agent-chat`） | `src/server/routes/agent-chat.ts` |
| 前端对话面板 | `src/components/agent-chat-panel.tsx` |
| 聊天输入框 | `src/components/chat-input.tsx` |
| 会话下拉菜单 | `src/components/session-dropdown.tsx` |
| 会话标签页 | `src/components/conversation-tabs.tsx` |
| 消息气泡（含图片渲染） | `src/components/chat-bubble.tsx` |
| 通知 Banner | `src/components/chat-notification-banners.tsx` |
| Guest Agent Overlay | `src/components/guest-agent-overlay.tsx` |
| 知识保存对话框 | `src/components/save-knowledge-dialog.tsx` |
| Agent 表单（提取自 agents page） | `src/components/agent-form.tsx` |
| 会话工具函数（提取自 agents page） | `src/components/agent-session-utils.ts` |
| 会话类型 | `src/types/agent-chat.ts` — `AgentChatSession` |
| Resource 类型 | `src/types/resource.ts` — `ResourceType`, `ResourceRef` |
| 消息类型 | `src/types/index.ts` — `ChatMessage.images` |

---

## AgentChatPanel 三种渲染模式

| variant | projectKey | 场景 | 特点 |
|---------|-----------|------|------|
| 无（omit） | 无 | Agents 页面直接对话 | 简洁模式，无会话管理 |
| `'sidebar'` | 必须 | flows 布局侧边栏 | 会话下拉菜单，compact |
| `'full'` | 必须 | Butler 全屏页面 | 左侧会话列表 + 右侧对话区 |

---

## Agent 执行模式：两条路径

任务页面（`task-detail.tsx`）根据绑定 agent 的 `executionMode` 字段决定走哪条路：

```
task.agentId 存在
  └─ fetch /api/agents → 找到 agent
        ├─ agent.executionMode === 'task'  → ProcessManager 路径（ChatPanel）
        └─ agent.executionMode === 'chat'  → AgentChatManager 路径（AgentChatPanel）
              （未设置时默认 'chat'）
task.agentId 不存在
  └─ task worker（默认）→ ProcessManager 路径
```

### ProcessManager 路径（task worker 专属）

```
ChatPanel → POST /api/ai-chat → ProcessManager
  ├─ buildPrompt()：动态构建含阶段指令、任务上下文、历史的完整 prompt
  ├─ git worktree 隔离
  ├─ 阶段级权限切换（understanding: 只读 → doing: 全开）
  ├─ 产物提取：json:understanding / json:plan / json:result
  └─ ArtifactPanel 展示右侧产物
```

### AgentChatManager 路径（自定义 agent）

```
AgentChatPanel → POST /api/agent-chat → AgentChatManager
  ├─ ResourceRegistry 加载 agent.resources → 构建完整 prompt
  ├─ 无 git、无阶段、无产物提取
  ├─ 支持知识草稿提取 & 设计文档保存
  └─ ArtifactPanel 隐藏（isChatMode = true）
```

### 关键约束

- `executionMode: 'task'` 只对 task worker 有意义，自定义 agent 设此值行为不变（`buildPrompt()` 是 task worker 专属基础设施）
- `Agent.executionMode` 未设置 → 默认 `'chat'`，确保自定义 agent 都走轻量路径
- chat 模式下 ArtifactPanel 完全隐藏（`artifactOpen && !isChatMode`）
