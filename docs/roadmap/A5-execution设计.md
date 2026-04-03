# A5 — Execution 模型设计（完整方案）

## 1. 核心决策

### 现在的代码叫什么、是什么

| 代码概念 | 实际含义 |
|---------|---------|
| `AgentChatRun` | **一轮回复**（Turn）：用户发一条消息 → 模型回复 → 结束 |
| `AgentEvent` | **流式 delta**：推给前端的细粒度事件（text_delta、tool_use_start…），不落盘 |
| `ChatMessage` | **对话记录**：user/assistant 轮次，落盘在 `messages/<sessionId>.jsonl` |
| `SessionExecution` | **上一轮摘要**：存在 `sessions/index.json` 的 meta 上 |

### 要长出来的概念

| 领域概念 | 含义 | 与代码关系 |
|---------|------|-----------|
| **ExecutionEvent** | 一次有意义的已完成动作（落盘） | 从 `AgentEvent` delta 在**回合结束时**归约为完整事件 |
| **Turn** | 一次用户消息 → assistant 回复的完整回合 | 就是今天的 `AgentChatRun`，重命名概念但不改代码 |
| **Run** | 一次目标导向的尝试，可跨多个 Turn | **新概念**，独立于 Turn |

### 关系

```
Session
  ├── ExecutionEvent 流（append-only，所有动作的完整记录）
  │     ├── turn_start
  │     ├── user_message
  │     ├── tool_call（完整：name + input + output + status + duration）
  │     ├── assistant_message（完整文本 + contentBlocks）
  │     ├── turn_end（token usage、stop reason）
  │     └── ...
  │
  └── Run 列表（可选，多数会话没有）
        └── Run #1
              ├── goal: "修复登录 bug"
              ├── startEventId / endEventId（区间标注）
              └── evaluation: { outcome: 'failed', text: "根因判断错误" }
```

---

## 2. ExecutionEvent 设计

### 通用字段

```typescript
interface ExecutionEventBase {
  id: string;        // evt-{timestamp}-{random4}
  ts: string;        // ISO 8601
  turnId: string;    // 属于哪个 Turn
  runId?: string;    // 若在 Run 中
}
```

### 事件类型

| type | payload | 何时写 |
|------|---------|--------|
| `turn_start` | `{ userId?: string }` | `start()` 收到用户消息时 |
| `user_message` | `{ content: string; images?: string[] }` | 同上 |
| `thinking` | `{ text: string }` | `finalizeRun` 时从 `contentBlocks` 提取 |
| `tool_call` | `{ toolName, input, output, status, durationMs }` | `finalizeRun` 时从 `run.toolCalls` 提取 |
| `assistant_message` | `{ content: string; contentBlocks?: ContentBlock[] }` | `finalizeRun` 时从累积文本提取 |
| `turn_end` | `{ status, tokenUsage, stopReason? }` | `finalizeRun` 最后 |
| `run_open` | `{ goal?: string; taskId?: string }` | 用户或调度开启 Run 时 |
| `run_close` | `{ outcome, evaluationText? }` | 用户或 AI 关闭 Run 时 |
| `error` | `{ message: string }` | 出错时 |

### 设计要点

- **不存 delta**（不存 `text_delta`、`thinking_delta`）。delta 是传输层概念，不是领域事件。落盘的是 Turn 结束后的**完整结果**。
- **每个 Turn 结束写一批 Event**（不是流式实时追加）。实现简单、写入原子、不改流式逻辑。
- **Event 从已有的 `run.contentBlocks` / `run.toolCalls` / `run.messages` 归约**，不需要改 `AgentEvent` 的产生逻辑。

---

## 3. Run 设计

### 数据模型

```typescript
interface ExecutionRun {
  runId: string;              // run-{timestamp}-{random4}
  goal?: string;              // 这次尝试想做什么
  taskId?: string;            // 关联的 Todo/Task（可选）
  status: 'active' | 'completed' | 'failed' | 'shelved';
  startedAt: string;          // ISO
  completedAt?: string;       // ISO
  startEventId: string;       // 第一个 Event 的 id
  endEventId?: string;        // 最后一个 Event 的 id
  evaluation?: {
    outcome: 'success' | 'failure' | 'partial' | 'shelved';
    text?: string;            // 自由文字（AI 生成或用户填）
  };
}
```

### 行为

- **一个 Session 同时最多一个 active Run**（简单、不歧义）。
- **开启**：用户在 UI 点「开始执行」，可填 goal；或 Task 派发自动开 Run（goal = Task 标题）。
- **进行中**：正常聊天，Turn 产生的 Event 自动归属当前 active Run（`runId`）。
- **关闭**：用户点「结束执行」+ 选 outcome + 可选文字；或调用 API。
- **没有 Run 也完全正常**——自由对话不开 Run，Event 照样落盘。

### 与 Turn 的关系

**一个 Run 包含一到多个 Turn**。这是与当前代码「Run = 一轮」最大的区别。

```
Run #1 (goal: "修复登录 bug")
  ├── Turn #1: 用户说 "帮我修"，AI 查了代码
  ├── Turn #2: 用户说 "不是这个文件"，AI 换了方向
  └── Turn #3: AI 提交了修复
  → evaluation: { outcome: 'success', text: "已修复" }
```

---

## 4. 存储

```
sessions/
  messages/<sessionId>.jsonl      # 不动。ChatMessage 对话记录（前端聊天视图依赖）
  events/<sessionId>.jsonl        # 新增。ExecutionEvent 流（每行一个 JSON）
  runs/<sessionId>.json           # 新增。{ runs: ExecutionRun[] }
  index.json                      # 不动。SessionMeta（含现有 execution 摘要）
```

### 为什么保留 messages JSONL

- **前端整个聊天面板**都读 messages JSONL + 运行时 snapshot，改格式影响面巨大。
- 产出的 events JSONL 是**另一个视角**（审计/观测/Run），不是聊天视图的替代。
- 长期可以从 events 归约出 messages，但短期**双写**（turn 结束时同时写两份）是最安全的。

### 文件大小

Event 比 Message 详细，但不存 delta，实际每 Turn 多几个 JSON 行（thinking、tool_call 等）。一个活跃会话几万行 events 约几 MB，与 messages 同量级。

---

## 5. 实现切入点（改哪里）

**核心变更只在一个位置**：`agent-chat-manager.ts` 的 `finalizeRun` 方法尾部（第 829 行之后的 `persistAfterClose`）。

```
finalizeRun(run, aborted)
  │
  ├── 现有：persistAfterClose → persistSessionToDisk（写 messages JSONL + index）
  │
  └── 新增：writeExecutionEvents(run)
            ├── 从 run.messages / run.contentBlocks / run.toolCalls 归约 Event 列表
            ├── 追加到 sessions/events/<sessionId>.jsonl
            └── 若有 activeRun，更新 sessions/runs/<sessionId>.json
```

**不改**：
- `AgentEvent` 类型和 SSE 推送逻辑
- `trackAndEmit` 方法
- `ChatMessage` 格式
- 前端聊天面板

---

## 6. 分期

### 第一期（B1 + B2）：Event 落盘

- 定义 `ExecutionEvent` 类型（`src/types/execution.ts`）
- 实现 `writeExecutionEvents(run: AgentChatRun)`：从 run 对象归约出 Event 列表 → append 到 JSONL
- 在 `finalizeRun` 尾部调用
- 实现 `readExecutionEvents(sessionId)`：读 JSONL 返回 Event[]
- API：`GET /api/agent-chat/events?sessionId=xxx`
- 老会话没有 events 文件 = 返回空数组，不报错

### 第二期（B3 + B4）：Run

- 定义 `ExecutionRun` 类型
- 实现 `sessions/runs/<sessionId>.json` 读写
- API：`POST /api/agent-chat/runs`（开）、`PATCH /api/agent-chat/runs/:runId`（关/评价）
- `writeExecutionEvents` 时若有 activeRun，自动给 Event 填 `runId`
- 前端：开/关 Run 的 UI
- Task 派发时自动开 Run

### 第三期（B5）：Step

- 暂缓。等 Run 稳定后，再设计 AI 声明 Step 的机制
- §3 文档标注「Step 为后续阶段，不阻塞 Event 与 Run」

---

## 7. 对 `领域与数据.md` §3 的修改建议

- **保留** Event / Run / Step / Goal / Evaluation 的语义描述不变
- **补充** 一段「实现阶段」说明：第一期 Event + 第二期 Run + 第三期 Step
- **补充** 术语对照：代码里 `AgentChatRun` = Turn（回合）；领域 Run = 目标导向尝试
- **修改** Step 那行：「**第二阶段能力**——AI 自主声明的逻辑步骤，需要模型侧配合，在 Event + Run 稳定后建设」

---

## 8. Step 为什么暂缓

Step 需要 **AI 在执行过程中主动声明** "我现在开始做第 X 步"。实现方式要么：
- 专用 tool call（`step_start` / `step_end`）
- 系统提示里要求结构化输出
- 后处理从 thinking 中提取

三种都依赖模型的稳定配合，且没有业界共识。在 Event + Run 还没稳定时做 Step，容易产生噪音数据。**先把 Event 和 Run 做扎实，Step 的设计会自然清晰**。

---

## 讨论记录

- 2026-04-02：形成完整方案。核心决策：Event 落盘为归约后的完整事件（非 delta）；Run 与 Turn 分离（1 Run : N Turn）；双写 messages + events；Step 暂缓。三期实现路径。
