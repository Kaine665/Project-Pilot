# 多 CLI 统一生命周期设计

> 状态：设计完成，待实现
> 前置依赖：前端 provider/model 选择器（提供触发入口）

## 问题

当用户选了 OpenAI 作为 provider 时，后端需要 spawn Codex CLI 而非 Claude CLI。
两个 CLI 的 stdout 输出格式不同，但高层生命周期相同。

## 现状

`BaseChatManager.spawnAndManage()` 硬编码了 `spawnClaude` 和 `ClaudeStreamParser`。
develop-static 在此基础上实现了 ActionRegistry、HealthGuard、SessionConfig 等增强，
这些增强必须对所有 CLI 后端生效。

## 核心结论

统一 lifecycle 可行，解析器必须分开。

```
CLI 专属 StreamParser（每个 CLI 一个）
        ↓
  ChatSSEEvent[]（统一内部格式）
        ↓
  BaseChatManager（共享 lifecycle：事件追踪、ActionRegistry、HealthGuard、persist）
```

## 三大 CLI 输出格式对比

| | Claude CLI | Codex CLI | Gemini CLI |
|---|---|---|---|
| 协议 | NDJSON | NDJSON | NDJSON |
| 文本流 | token 级增量 (`content_block_delta`) | 不流式，item 完成后一次性给 | 消息块级 |
| 工具调用 | 通用 `tool_use` + `name`/`input` | 领域化 item：`command_execution`、`file_change`、`mcp_tool_call` | 通用 `tool_use` |
| 工具结果 | 独立 `user` 消息事件 | 内嵌在 `item.completed` 里 | 独立 `tool_result` |
| 会话 ID | `system.init` 里 | `thread.started` 里 | `init` 里 |
| 结束事件 | `result`（subtype: success） | `turn.completed` | `result` |

高层生命周期一致：`INIT → (TURN: 文本 + 工具调用 + 工具结果)* → DONE/ERROR`

## 改造方案

### 1. SpawnConfig 加 cliBackend 字段

```typescript
// chat-managers/types.ts
interface SpawnConfig {
  // ...现有字段...
  cliBackend?: 'claude' | 'codex';  // 默认 'claude'
  codexArgs?: string[];             // codex exec 的参数
}
```

### 2. 抽出 IStreamParser 接口

```typescript
// claude-stream-parser.ts
interface IStreamParser {
  parse(line: string): ChatSSEEvent[];
  sessionId?: string;
}
```

现有 `StreamParser` 类 rename 为 `ClaudeStreamParser`（或保持现名，export alias）。

### 3. 新增 CodexStreamParser

映射规则：

| Codex 事件 | → ChatSSEEvent |
|---|---|
| `thread.started` → `{ thread_id }` | 记录 `sessionId` |
| `item.started` → `{ type: 'command_execution', id, command }` | `tool_use_start { toolName: 'Bash', input: command }` |
| `item.completed` → `{ type: 'command_execution', aggregated_output, exit_code }` | `tool_use_end { output, status }` |
| `item.completed` → `{ type: 'agent_message', text }` | `text_delta { text }` (一次性完整文本) |
| `item.started` → `{ type: 'file_change' }` | `tool_use_start { toolName: 'Edit' }` |
| `turn.completed` | close 事件自然触发 done |
| `turn.failed` → `{ error }` | `error { message }` |

### 4. BaseChatManager.spawnAndManage() 改造

```typescript
// 步骤 2：根据 cliBackend spawn 不同 CLI
const cliProcess = config.cliBackend === 'codex'
  ? spawnCodex(config.codexArgs ?? [], { cwd, env, shell: false })
  : spawnClaude(['-p', '--verbose', '--output-format', 'stream-json', ...extraCliArgs], { cwd, env, shell: false });

// 步骤 4：选择 parser
const streamParser = config.cliBackend === 'codex'
  ? new CodexStreamParser()
  : new ClaudeStreamParser();

// 其余步骤（stdin 写入、stdout 解析循环、stderr、close、error）完全不变
```

### 5. AgentChatManager.start() 改造

```typescript
const effectiveProvider = providerOverride ?? settings.claude.provider;

if (effectiveProvider === 'openai') {
  config.cliBackend = 'codex';
  config.codexArgs = ['exec', '--json', '--skip-git-repo-check', '-m', model, ...];
}
```

## 影响范围

| 文件 | 改动量 | 说明 |
|---|---|---|
| `base-chat-manager.ts` | ~20 行 | spawn 和 parser 选择 |
| `claude-stream-parser.ts` | ~5 行 | 抽 IStreamParser 接口 |
| **新增** `codex-stream-parser.ts` | ~100 行 | Codex NDJSON → ChatSSEEvent |
| `chat-managers/types.ts` | ~3 行 | SpawnConfig 加 cliBackend |
| `agent-chat-manager.ts` | ~30 行 | start() 按 provider 设置 cliBackend |

ActionRegistry、HealthGuard、SessionConfig、persist 逻辑 **零改动**。

## UX 注意

Codex 不支持 token 级流式输出，用户会看到长时间空白后文字一次性出现。
这是 Codex CLI 本身的限制，不影响架构设计。

## 实施顺序

1. 先做前端 provider/model 选择器（打通触发入口）
2. 再做 CodexStreamParser + BaseChatManager 改造
3. 端到端测试
