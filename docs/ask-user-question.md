# AskUserQuestion 交互设计

## 问题背景

Claude Code CLI 提供 `AskUserQuestion` 工具，让 AI 在执行过程中向用户提问、提供选项。但 ProjectPilot 使用 `-p`（print）模式 + `--dangerously-skip-permissions` 调用 CLI，这导致 `AskUserQuestion` 被自动拒绝（denied），用户无法看到问题或选择选项。

### 根因分析

```
CLI 调用方式：claude -p --verbose --output-format stream-json --dangerously-skip-permissions
```

- `-p` 模式：stdin 写入后立即 `end()`，无交互通道
- `--dangerously-skip-permissions`：自动批准所有工具调用，但 `AskUserQuestion` 被自动 **拒绝**（is_error: true, output: "Answer questions?"）
- 结果：AI 调用 AskUserQuestion → CLI 立即返回 denied → AI 继续执行（跳过用户选择）

### 备选方案评估

| 方案 | 描述 | 结论 |
|------|------|------|
| `--allowedTools` | 精确列出允许的工具，AskUserQuestion 不在列表中 | 不可行：`-p` 模式下未列出的工具被 **拒绝**，不是暂停等待 |
| `--permission-prompt-tool` | 指定一个 MCP 工具处理权限审批 | 文档稀缺，改动较大，CLI 版本依赖 |
| Agent SDK `canUseTool` | 最灵活，代码级控制 | 需要 API Key，不兼容当前 OAuth 登录方式 |
| **应用层拦截（采用）** | 在前端和提示词层面模拟暂停 | 改动最小，完全兼容现有架构 |

## 当前方案：应用层拦截

### 设计思路

既然 CLI 层面无法真正暂停，就在应用层实现"伪暂停"：

1. **提示词约束**：让 AI 调用 AskUserQuestion 后必须立即结束回复
2. **前端渲染问题卡片**：解析 denied 的 tool_call，渲染可交互的选项 UI
3. **用户选择后作为下一轮消息发送**：答案进入对话上下文，AI 据此继续

```
AI 调用 AskUserQuestion → CLI denied → AI 停止回复（提示词约束）
                                          ↓
                               前端渲染选项卡片
                                          ↓
                              用户点击选项 → 答案作为下一轮消息发送
                                          ↓
                              AI 收到答案，继续执行
```

### 关键约束：提示词注入

在两个地方注入 AskUserQuestion 停止约束，覆盖 Task Worker 和 Agent Chat 两条对话路径：

**Task Worker 路径** — `prompt-builder.ts` 对话规则第 4 条：

```
当你调用 AskUserQuestion 工具后，必须立即结束当前回复，不要猜测用户的选择，
不要在同一轮继续执行其他操作。等待用户在下一轮消息中给出选择后再继续
```

**Agent Chat 路径** — `system-prompt-loader.ts` 在所有 agent 系统提示末尾追加：

```
**重要约束**：当你调用 AskUserQuestion 工具后，必须立即结束当前回复。
不要猜测用户的选择，不要在同一轮继续执行其他操作。
等待用户在下一轮消息中给出选择后再继续。
```

## UI 设计

### 组件结构

```
chat-bubble.tsx
├── <div> (灰色气泡 — AI 文本 + 其他 tool_call)
│   └── AskUserQuestion tool_call → 跳过渲染 (return null)
│
└── <div className="mt-1.5"> (气泡外 — 独立区域)
    └── AskUserQuestion tool_call → <ToolCallCard> → <AskUserQuestionCard>
```

AskUserQuestion 卡片从 AI 聊天气泡中提取出来，渲染在气泡下方的独立区域。这样做的原因：
- 问题卡片不会被灰色气泡背景"淹没"
- 视觉上更像一个独立的交互区域，而非 AI 回复的一部分
- 用户更容易注意到需要操作

### 组件：`ask-user-question-card.tsx`

**状态管理**：

```typescript
// 每个问题的独立选择状态：{ 问题索引 → 选中的选项 label }
const [selections, setSelections] = useState<Record<number, string>>({});
// 是否已提交
const [submitted, setSubmitted] = useState(false);
```

**可回答判定**：

```typescript
const wasDenied = isFailed && toolCall.output?.includes('Answer questions');
const isAnswerable = (isRunning || wasDenied) && !submitted;
```

- `isRunning`：工具正在执行（流式传输中）
- `wasDenied`：工具被 `--dangerously-skip-permissions` 拒绝（实际触发场景）
- 两种情况都视为"等待用户回答"

**单问题 vs 多问题**：

| 场景 | 交互方式 | 答案格式 |
|------|----------|----------|
| 单问题 | 点击选项立即提交 | `"option label"` |
| 多问题 | 每题独立选择 → 点击"提交回答"按钮 | `"Q1 header: answer\nQ2 header: answer"` |

多问题格式参考了 VS Code Claude 插件的策略（`"Q1: answer" & "Q2: answer"`），适配为换行分隔。

**视觉状态**：

| 状态 | 图标 | 标题 | 选项样式 |
|------|------|------|----------|
| 等待回答 | Loader2 旋转 | "AI 想问你一个问题" | indigo 边框，可点击 |
| 已选中（未提交） | Loader2 旋转 | "AI 想问你一个问题" | 选中项 indigo 高亮 |
| 已提交 | CheckCircle2 绿色 | "AI 提问" + 绿色勾 | 绿色已回答摘要 |
| 已完成（正常） | CheckCircle2 绿色 | "AI 提问" + 绿色勾 | 灰色自动回复显示 |

## 消息传递机制

### 事件流

```
AskUserQuestionCard
  → dispatchAnswer(answer)
    → window.dispatchEvent(CustomEvent('ask-user-answer', { detail: { answer } }))

agent-chat-panel.tsx / chat-panel.tsx
  → window.addEventListener('ask-user-answer', handler)
    → 判断是否正在流式传输
      → 是：pendingAnswerRef.current = answer（排队）
      → 否：doSendRef.current(answer)（立即发送）
```

### 流式传输期间的排队机制

由于 AI 调用 AskUserQuestion 后 CLI 返回 denied，AI 可能还在继续输出（提示词约束不是 100% 可靠）。用户可能在流式传输结束前就点击了选项。

**agent-chat-panel.tsx**：

```typescript
const isStreamingRef = useRef(false);
const pendingAnswerRef = useRef<string | null>(null);

// 流结束时自动发送排队的答案
// finalizeStream() 末尾：
const pendingAnswer = pendingAnswerRef.current;
pendingAnswerRef.current = null;
if (pendingAnswer) {
  setTimeout(() => doSendRef.current(pendingAnswer), 300);
}
```

**chat-panel.tsx**（Task Worker）优先级：

```
finalizeStream() 中的发送优先级：
1. pendingUserMsgRef（用户手动输入的消息）
2. pendingAnswerRef（AskUserQuestion 排队答案）
3. pendingRetryRef（自动重试）
```

用户手动消息优先于排队答案，确保用户意图不被覆盖。

## 涉及文件

| 文件 | 职责 |
|------|------|
| `src/components/ask-user-question-card.tsx` | 问题渲染、选项交互、多问题状态管理 |
| `src/components/chat-bubble.tsx` | 将 AskUserQuestion 卡片从气泡内提取到气泡外 |
| `src/components/tool-call-card.tsx` | 路由：toolName === 'AskUserQuestion' → AskUserQuestionCard |
| `src/components/agent-chat-panel.tsx` | Agent Chat 事件监听 + pendingAnswerRef 排队 |
| `src/components/chat-panel.tsx` | Task Worker 事件监听 + pendingAnswerRef 排队 |
| `src/lib/prompt-builder.ts` | Task Worker 提示词：对话规则第 4 条 |
| `src/lib/resource-loaders/system-prompt-loader.ts` | Agent Chat 提示词：末尾追加约束 |

## 已知限制

1. **提示词约束非强制**：AI 可能忽略"调用 AskUserQuestion 后立即停止"的指令，继续执行其他操作。排队机制（pendingAnswerRef）缓解了这个问题，但不是根本解决。

2. **multiSelect 未完全实现**：AskUserQuestion 支持 `multiSelect: true`（多选），当前 UI 识别了这个字段并显示"可多选"提示，但实际交互仍是单选。后续可扩展为 checkbox 模式。

3. **"Other" 自由输入未集成**：AskUserQuestion 的选项列表通常隐含一个 "Other" 选项允许自由输入。当前设计中用户可以忽略选项卡片、直接在输入框中自由输入，功能上等价但 UI 未在卡片内显式提供输入框。

4. **无法真正暂停 CLI**：当前方案依赖提示词约束让 AI 自行停止。如果未来 Claude CLI 支持更好的 `--permission-prompt-tool` 机制或 Agent SDK 支持 OAuth，应迁移到 CLI 层暂停方案。
