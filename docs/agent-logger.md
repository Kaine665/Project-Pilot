# Agent 交互日志（开发者向）

> 目的：让开发者能在 ProjectPilot 后端实时看到 **每一次 Agent 调用的输入 / 输出 / 工具链 / 用量**，不影响普通用户。

## 是什么 / 不是什么

- **是**：开发态调试用的结构化日志（NDJSON），落到 `~/.project-pilot/logs/agent-YYYY-MM-DD.ndjson`。
- **不是**：产品功能。**不会** 渲染到 UI、不进入用户备份/导出、默认 **完全关闭**、零开销。

设计原则（详见 `src/shared/lib/agent-logger.ts` 顶部注释）：

1. **默认关闭** — 生产打包态零开销，所有入口在第一行 short-circuit。
2. **永不抛异常** — 整条 logger 路径用 try/catch 兜底；业务永远拿不到 logger 的异常。
3. **异步落盘** — 内存队列 + 200ms 后台 flush；业务线程只 enqueue 浅拷贝过的小对象。
4. **截断 + 体量字段** — 长文本只保留前 N 字符 + 总长度（`{ preview, length, truncated }`）。
5. **滚动 + 上限** — 按日期切文件；超过 10MB 自动加序号轮转；保留 7 天。
6. **不进入产品 UI、不进入用户数据备份**。

## 启用

设置环境变量 `PP_AGENT_LOG`（默认 `off`）：

| 值          | 行为                                                          |
| ----------- | ------------------------------------------------------------- |
| `off`/`0`/未设置 | **完全关闭**（推荐：用户机器、CI）                             |
| `error`     | 仅记录错误（最低噪音）                                         |
| `info`      | turn 起止 + 工具调用 + token 用量（**日常调试推荐**）         |
| `debug`     | `info` 之上：每条 SDK message 一条记录（含 type + 短预览）   |
| `trace`     | `debug` 之上：放宽截断阈值（保留更长的 prompt / 工具输出）   |

可选环境变量（一般无需调整）：

| 变量                            | 默认                      | 含义                          |
| ------------------------------- | ------------------------- | ----------------------------- |
| `PP_AGENT_LOG_MAX_CHARS`        | 2000（trace 时 8000）     | 单字段最大字符数              |
| `PP_AGENT_LOG_MAX_FILE_BYTES`   | 10 MB                     | 单文件大小上限                |
| `PP_AGENT_LOG_RETENTION_DAYS`   | 7                         | 保留天数                      |
| `PP_AGENT_LOG_QUEUE_SIZE`       | 5000                      | 队列上限（满了丢日志、不丢业务） |
| `PP_AGENT_LOG_FLUSH_MS`         | 200                       | flush 周期                    |

## 启动示例

```bash
# Vite + Hono 同时跑，开启 info 级日志
PP_AGENT_LOG=info bun run dev

# 仅启动 Hono 后端 + 看 SDK message 级
PP_AGENT_LOG=debug bun run dev:server

# 实时尾随
tail -f ~/.project-pilot/logs/agent-$(date -u +%Y-%m-%d).ndjson | jq .
```

## 记录哪些事件

每条都是一行 NDJSON。共有字段：`ts`、`kind`、`pid`、`sessionId`、`runId`。

### `agent.turn.start`（每轮开始一条，`info+`）

```jsonc
{
  "ts": "2026-04-20T12:00:00.000Z",
  "kind": "agent.turn.start",
  "sessionId": "sess-abc",
  "runId": "run-sess-abc-1700000000",
  "agentId": "agent-default",
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "resume": false,
  "prompt": {
    "preview": "你好...",          // 截断后片段
    "length": 12345,              // 原始字符数
    "truncated": true,
    "roughInputTokens": 3086     // 4 字符 ≈ 1 token 的粗估
  },
  "images": [{ "mediaType": "image/png", "bytes": 81234 }],
  "sdkOptions": {                // 关键 SDK 选项摘要（脱敏）
    "permissionMode": "default",
    "effort": "medium",
    "maxTurns": 50,
    "includePartialMessages": true,
    "thinking": { ... },
    "baseUrl": "https://api.anthropic.com"
  }
}
```

### `agent.turn.end`（每轮结束一条，`info+`）

```jsonc
{
  "ts": "...",
  "kind": "agent.turn.end",
  "sessionId": "sess-abc",
  "runId": "run-sess-abc-1700000000",
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "durationMs": 8421,
  "ok": true,
  "assistant": {
    "preview": "...",
    "length": 4321,
    "truncated": true,
    "roughOutputTokens": 1080
  },
  "usage": { "inputTokens": 3120, "outputTokens": 1100, "contextWindow": 200000 },
  "sdkMessageCount": 42,
  "errorMessage": null         // 仅失败时填
}
```

### `agent.tool`（每次工具调用 2 条：`start` 和 `end`，`info+`）

```jsonc
{
  "ts": "...",
  "kind": "agent.tool",
  "sessionId": "sess-abc",
  "runId": "run-sess-abc-1700000000",
  "phase": "start",
  "toolId": "toolu_01...",
  "toolName": "Read",
  "input": { "preview": "{\"path\":\"/foo\"}", "length": 17, "truncated": false }
}
```

```jsonc
{
  "phase": "end",
  "toolId": "toolu_01...",
  "output": { "preview": "...", "length": 9876, "truncated": true },
  "status": "completed"        // or "failed"
}
```

### `agent.sdk.msg`（SDK 原始 message，`debug+`）

```jsonc
{
  "kind": "agent.sdk.msg",
  "msgIndex": 5,
  "msgType": "stream_event",
  "preview": "{\"type\":\"stream_event\",\"event\":..."
}
```

## 性能与稳定性保证

- 主线程在 `logTurnStart` / `logTurnEnd` / `logToolUse` 内只做：级别判断 → 浅拷贝 → 入队。不做磁盘 I/O，不做大对象 `JSON.stringify`。
- 实际写盘发生在后台 200ms 定时器里；`turn.end` 之后会 **额外** 主动 flush 一次，便于实时观察。
- **任何** 路径异常都被 `try/catch` 吞掉，logger 内部最多 `console.warn` 一次，**绝不** 让业务回调拿到 logger 异常。
- 队列满（默认 5000 条）会直接丢日志，每丢 1000 条 warn 一次。

## 接入位置

仅在 `src/shared/lib/chat-managers/agent-runner.ts` 的两个 runner 内部接：

- `ClaudeAgentRunner.stream()`
- `CodexAgentRunner.stream()`

`AgentChatManager.consumeRunnerStream()` 在调 `runner.stream()` 时透传 `observability: { sessionId, agentId, runId }`，runner 自己不知道这些字段是给谁用的。

如果 `observability` 没传，logger 不会被调用（业务路径没变化）。
