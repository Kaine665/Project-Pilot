# 提示词版本管理与运行时隔离

## 概述

两个功能在同一个分支中实现：
1. **Feature 1**: Worktree 清理提示词更新（Phase 4 改用 `cleanup` 命令）
2. **Feature 2**: 提示词版本管理 + 运行时隔离（版本历史 + session 工作副本）

## 设计决策

| 决策 | 选择 |
|------|------|
| 目录结构 | 后缀目录：`{agentId}.md` + `.history/` + `.runtime/` |
| 版本粒度 | 自动快照：每次 `writePromptFile()` 前自动保存历史版本 |
| Runtime 清理 | 会话删除时自动清理对应的 runtime 副本 |
| 版本保留数 | 最近 20 份 |

## 目录结构

```
prompts/
  agent-builtin-self-dev.md           # 正式版（= latest）
  agent-builtin-self-dev.history/     # 版本历史
    v_260301_143022.md                # YYMMDD_HHmmss
    v_260305_091500.md
  agent-builtin-self-dev.runtime/     # 会话工作副本
    agent-chat-1709640000-a1b2.md     # {sessionId}.md
```

优点：零迁移成本，现有 `.md` 文件不动。

## 实现步骤

### Step 1: `src/lib/file-store.ts` — 新增路径函数

新增 3 个函数（跟现有 `getPromptFilePath` 同级）：

```typescript
getPromptHistoryDir(agentId: string): string
// → prompts/{safeId}.history

getPromptRuntimeDir(agentId: string): string
// → prompts/{safeId}.runtime

getPromptRuntimePath(agentId: string, sessionId: string): string
// → prompts/{safeId}.runtime/{safeSessionId}.md
```

安全检查复用现有 sanitization 模式。

### Step 2: `src/lib/agent-prompt-store.ts` — 版本管理 + 运行时副本

**2a. 新增 `snapshotPromptVersion(agentId)`**
- 读取当前正式版 → 复制到 `.history/v_YYMMDD_HHmmss.md`
- 保留最近 20 份，删除多余的旧版本
- 文件不存在时静默跳过

**2b. 修改 `writePromptFile(agentId, content)`**
- 在写入前调用 `snapshotPromptVersion(agentId)`
- 其余逻辑不变

**2c. 新增 `createRuntimePromptCopy(agentId, sessionId)`**
- 读取正式版内容 → 写入到 `.runtime/{sessionId}.md`
- 返回 runtime 文件路径
- 正式版不存在时返回 undefined

**2d. 新增 `deleteRuntimePromptCopy(agentId, sessionId)`**
- 删除 `.runtime/{sessionId}.md`
- 文件不存在时静默成功

**2e. 新增查询函数（供未来 UI/CLI 使用）**
- `listPromptVersions(agentId)` — 列出版本（新→旧）
- `readPromptVersion(agentId, versionName)` — 读取特定版本
- `revertToVersion(agentId, versionName)` — 回滚（先快照当前版再覆盖）

### Step 3: `src/lib/resource-loaders/system-prompt-loader.ts` — 更新暴露路径

修改 `SystemPromptLoaderContext`：新增 `runtimePromptPath?: string`

resolve 方法逻辑：
- 有 `runtimePromptPath` → 用工作副本路径 + runtime 文案
- 否则 → 保持现有行为（正式版路径 + 现有文案）

### Step 4: `src/lib/chat-managers/agent-chat-manager.ts` — 创建/清理运行时副本

**4a. `buildResourcePrompt()` 新增 `sessionId?` 参数**
- exposePromptPath + sessionId → 创建 runtime 副本，传 runtimePromptPath
- 无 sessionId → 保持现有行为

**4b. `buildAgentChatPrompt()` 和 `buildAgentChatPromptWithFlowContext()` 透传 sessionId**

**4c. `deleteSession()` 增加 runtime 清理**
- 在 modifyJsonFile 回调中捕获被删 session 的 agentId
- 完成后调用 `deleteRuntimePromptCopy(agentId, sessionId)`

### Step 5: 更新 self-dev 提示词

修改 `~/.project-pilot/data/prompts/agent-builtin-self-dev.md`：
- Phase 4 清理：替换手动 5 步为 `worktree-ports.ts cleanup` 命令
- 自引用部分：更新说明提示词有版本管理机制

## 影响范围

| 文件 | 改动类型 |
|------|---------|
| `src/lib/file-store.ts` | 新增 3 个路径函数 |
| `src/lib/agent-prompt-store.ts` | 修改 1 个 + 新增 6 个函数 |
| `src/lib/resource-loaders/system-prompt-loader.ts` | 修改接口 + resolve 逻辑 |
| `src/lib/chat-managers/agent-chat-manager.ts` | 修改 3 个函数签名 + deleteSession |
| self-dev 提示词 .md 文件 | 内容更新 |

不需要改动：agents API route、settings import/export（`writePromptFile` 自动获得版本快照能力）
