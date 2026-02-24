# 产物提取重试机制

> 2026-02-15

## 背景

AI 在各阶段需要用特定格式（`json:understanding` / `json:plan` / `json:result`）输出结构化产物，系统通过正则提取后推进阶段。但 AI 可能回复纯文本而不带格式化输出，导致阶段无法推进。

不使用 API 级 structured output（`response_format`）的原因：
- Claude CLI `-p` 模式不暴露此参数
- Claude 对代码块格式遵循度够高，正则提取 + 重试已足够可靠
- 如需 structured output 须切换 Agent SDK（付费 API），当前不值得

## 策略

3 次机会：第 1 轮正常对话，失败后自动重试 2 次，仍失败则提示用户介入。

```
attempt 1: 正常对话                              → extractXxxFromText()
attempt 2: "[系统自动重试 2/3] 请用...格式输出"   → extractXxxFromText()
attempt 3: "[系统自动重试 3/3] 请用...格式输出"   → extractXxxFromText()
全部失败:  emit error("格式提取失败，请手动指导")
```

各阶段期望产物：

| Phase | 期望产物 | 提取函数 |
|-------|---------|---------|
| understanding | `json:understanding` → TaskUnderstanding | extractUnderstandingFromText |
| planning | `json:plan` → AIPlan | extractPlanFromText |
| executing | 无（多轮执行，不期望单轮产物） | — |
| summarizing | `json:result` → TaskResult | extractResultFromText |

## 数据流

后端驱动检测，前端自动执行重试：

```
Backend (process-manager.ts)              Frontend (chat-panel.tsx)
─────────────────────────────              ────────────────────────
AI 回复完毕，Claude process exit
    ↓
提取 artifacts (extractXxxFromText)
    ↓
postTurnUpdate (phase 推进?)
    ↓
checkAndEmitRetry:
  当前 phase 期望产物未提取到?
    ↓
  retryCount < 2?
  ├─ YES → emit retry_needed          →  pendingRetryRef = retryMessage
  │        emit done                   →  finalizeStream()
  │                                        ↓
  │                                       setTimeout(500ms)
  │                                        ↓
  │                                       doSendRef.current(retryMessage)
  │                                        ↓
  │  ←────── POST /api/ai-chat ──────────  新一轮对话开始
  │
  └─ NO  → emit error("已尝试3次")    →  用户看到错误提示
           emit done                       需要手动介入
```

## 实现细节

### 后端：process-manager.ts

**重试计数**：`ProcessManager.retryCounts: Map<string, number>`
- key = `${taskId}:${phase}`（如 `task-123:understanding`）
- 产物提取成功 → `delete(key)` 清零
- 阶段推进 → key 自然失效（phase 变了，新 key 不同）

**checkAndEmitRetry(run, taskId, phase, produced)**：
1. 根据 phase 判断期望哪种产物
2. 如果期望产物已提取 → 清零计数，return
3. 如果未提取且 count < 2 → count++，emit `retry_needed` 事件
4. 如果未提取且 count >= 2 → 清零计数，emit `error` 事件

**buildRetryMessage(phase, attempt)**：
生成重试提示消息，包含格式示例：
```
[系统自动重试 2/3] 你的回复中没有检测到格式化的任务理解。请在回复末尾用以下格式输出：

```json:understanding
{ "project": "...", "action": "...", "goal": "...", "deliverable": "..." }
```
```

**SSE 事件**：
```typescript
{ type: 'retry_needed'; attempt: number; maxAttempts: number; retryMessage: string }
```

### 前端：chat-panel.tsx

**两个 ref**：
- `pendingRetryRef: Ref<string | null>` — 暂存待发送的重试消息
- `doSendRef: Ref<(text: string) => void>` — 避免 finalizeStream 闭包中 doSend 过期

**事件处理**：
```typescript
case 'retry_needed':
  pendingRetryRef.current = event.retryMessage;
  break;
```

**自动发送**（在 finalizeStream 末尾）：
```typescript
const retryMsg = pendingRetryRef.current;
pendingRetryRef.current = null;
if (retryMsg) {
  setTimeout(() => doSendRef.current(retryMsg), 500);
}
```

**取消重试**：
- 用户点击停止 → `pendingRetryRef.current = null`
- 切换任务 → `pendingRetryRef.current = null`

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | ChatSSEEvent 新增 `retry_needed` 变体 |
| `src/lib/process-manager.ts` | `retryCounts` Map + `checkAndEmitRetry()` + `buildRetryMessage()` |
| `src/components/chat-panel.tsx` | `pendingRetryRef` + `doSendRef` + 事件处理 + 自动发送 |
