# 供应商 / 模型 / SDK 支持关系

> 关联：`src/lib/provider-registry.ts`、`src/lib/settings-manager.ts`、`src/lib/chat-managers/agent-chat-manager.ts`、`src/lib/codex-sdk-adapter.ts`、`src/app/api/settings/`
>
> 更新时间：2026-03-11

---

## 关系图

```
Agent Chat
  ├─→ Claude Agent SDK (Anthropic / 第三方 Anthropic 兼容)
  │     └─→ 内部 spawn Claude Code CLI (cli.js)，通过 stdin/stdout 交换 JSONL  ✅
  │           ├─→ Anthropic (API Key / OAuth)
  │           └─→ 第三方 DeepSeek/Qwen/... (API Key)
  └─→ Codex SDK (@openai/codex-sdk) (OpenAI)  ✅
        └─→ 内部 spawn Codex CLI，通过 thread.runStreamed() 消费事件流

auth-status / test-connection
  ├─→ provider=anthropic  → execClaude(['auth','status'])
  └─→ provider=openai     → execCodex(['login','status'])
```

---

## 支持矩阵

| 供应商 | 认证方式 | Agent Chat | auth-status | test-connection |
|--------|----------|------------|-------------|-----------------|
| **Anthropic** | API Key | ✅ | ✅ (claude auth status) | ✅ |
| **Anthropic** | OAuth | ✅ | ✅ | ✅ |
| **OpenAI / Codex** | API Key | ✅ | ✅ (codex login status) | ✅ |
| **OpenAI / Codex** | OAuth | ✅ | ✅ | ✅ |
| **DeepSeek / Qwen / Zhipu / ...** | API Key | ✅ | N/A | ✅ |

---

## 核心约束

### 1. Agent Chat 双路径（均通过官方 SDK）

- **Claude Agent SDK**：`query()` 内部会 spawn Claude Code 的 `cli.js` 子进程，通过 stdin/stdout 交换 JSONL。SDK 是 CLI 的程序化封装。
- **Codex SDK**：使用 `@openai/codex-sdk`，通过 `codex.startThread()` / `thread.runStreamed()` 消费事件流。SDK 内部同样 spawn Codex CLI，我们通过 `adaptCodexEvent` 将 `ThreadEvent` 转为 `ChatSSEEvent`。
- **结论**：两条路径均使用官方 SDK 封装，底层均为 CLI 子进程。
- **模型**：Anthropic 用 claude-sonnet、claude-opus 等；OpenAI 用 gpt-5.4、gpt-5.3-codex、gpt-5.2-codex 等

### 2. OpenAI OAuth 与 Claude Code 独立

- **Codex OAuth**：凭证存在 `~/.codex/auth.json`，由 `codex login` 管理
- **Claude OAuth**：凭证由 `claude auth` 管理
- **auth-status / test-connection**：按 provider 分别调用 `execClaude` 或 `execCodex`

### 3. 第三方供应商（Anthropic 兼容 API）

- 使用 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`（或 `ANTHROPIC_API_KEY` for Kimi）
- Claude Code 支持这些兼容端点，Agent Chat 可用

---

## 自定义供应商规范（Schema）

与「添加自定义供应商」表单一致，用户可添加多个自定义供应商：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `custom-${string}` | ✅ | 唯一 ID，添加时自动生成 |
| name | string | ✅ | 供应商名称 |
| tag | string | - | 服务商标签，如「云服务商」 |
| apiProtocol | `anthropic` \| `openai` | ✅ | API 协议 |
| baseUrl | string | ✅ | API Base URL |
| authMethod | `AUTH_TOKEN` \| `API_KEY` | ✅ | 认证方式 |
| modelIds | string[] | ✅ | 模型 ID 列表，至少一个 |
| apiKey | string | - | API Key/Token，可稍后设置 |

**注意**：Agent Chat 仅支持 `apiProtocol: anthropic` 的自定义供应商（Claude Code 兼容端点）。

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/provider-registry.ts` | 供应商预设、模型列表、OAuth 支持标记 |
| `src/lib/settings-manager.ts` | `buildClaudeEnv`、`buildCodexExecEnv`、`buildSdkQueryOptions` |
| `src/lib/chat-managers/agent-chat-manager.ts` | 双路径：Claude SDK / Codex SDK |
| `src/lib/codex-sdk-adapter.ts` | Codex SDK ThreadEvent → ChatSSEEvent |
| `src/lib/codex-stream-parser.ts` | 历史遗留，Agent Chat 已改用 Codex SDK |
| `src/lib/claude-cli.ts` | `execClaude` |
| `src/lib/codex-cli.ts` | `execCodex`、`spawnCodex`（auth/login/test-connection 等） |
| `src/app/api/settings/auth-status/route.ts` | 按 provider 选择 CLI |
| `src/app/api/settings/test-connection/route.ts` | 按 provider 选择 CLI |
| `src/app/api/settings/auth-login/route.ts` | OAuth 登录（codex login / claude auth） |

---

## 扩展 OpenAI 支持

**已实现**：当 `provider === 'openai'` 时，Agent Chat 使用 `@openai/codex-sdk`，通过 `thread.runStreamed()` 获取事件流，`adaptCodexEvent` 将 `ThreadEvent` 转为 `ChatSSEEvent`。

---

## 用户可见文案

当用户选择 OpenAI 协议的自定义供应商并尝试 Agent Chat 时，会看到：

> OpenAI 协议的自定义供应商暂不支持 Agent 对话。请使用 Anthropic 协议的自定义供应商或切换至内置 OpenAI。
