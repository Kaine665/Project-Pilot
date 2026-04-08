# Claude Code Harness 六大核心能力 — 源码学习笔记

> **Author**: Kaine
> **Date**: 2026-04-07
> **Source Repo**: [CCsoleilpeking/claude-code-main_run](https://github.com/CCsoleilpeking/claude-code-main_run)
> **性质**: 个人学习笔记，基于对 Claude Code 开源 harness 源码的逐模块拆解

---

## 目录

1. [Agent Loop（智能体循环）](#一agent-loop智能体循环)
2. [Tool System（工具系统）](#二tool-system工具系统)
3. [Security & Permissions（安全与权限）](#三security--permissions安全与权限)
4. [Multi-Agent Orchestration（多智能体编排）](#四multi-agent-orchestration多智能体编排)
5. [Memory System（记忆系统）](#五memory-system记忆系统)
6. [Extension Ecosystem（拓展生态）](#六extension-ecosystem拓展生态)
7. [架构全景](#架构全景)

---

## 一、Agent Loop（智能体循环）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/QueryEngine.ts` | 会话入口，管理整个对话生命周期 |
| `src/query.ts` | 核心 `while(true)` 循环 |
| `src/services/api/claude.ts` | API 通信、流式处理、模型配置 |
| `src/services/tools/StreamingToolExecutor.ts` | 流式工具执行器 |

### 运行流程

```
用户输入
  ↓
QueryEngine.submitMessage()
  ↓
queryLoop() ─── while(true) ───┐
  │                              │
  ├─ 1. 消息准备                  │
  │   ├─ 微压缩 (microCompact)   │
  │   ├─ 上下文折叠               │
  │   └─ 自动压缩                 │
  │                              │
  ├─ 2. 调用 Claude API (流式)    │
  │   └─ queryModel() → stream   │
  │                              │
  ├─ 3. 流式工具执行              │
  │   └─ StreamingToolExecutor   │
  │     (边接收边执行,不等完整响应) │
  │                              │
  ├─ 4. 判定: 继续 or 结束?       │
  │   ├─ 无 tool_use → 结束 ✓    │
  │   ├─ 超 maxTurns → 结束 ✓   │
  │   ├─ 超预算 → 结束 ✓         │
  │   ├─ stop hook 阻止 → 结束 ✓ │
  │   └─ 有 tool_use → 继续 ↓    │
  │                              │
  ├─ 5. 执行剩余工具 + 收集结果    │
  ├─ 6. 注入附件 (记忆/技能等)     │
  └─ 7. 回到循环顶部 ────────────┘
```

### 关键设计

- **流式工具执行**：`StreamingToolExecutor` 在 API 还在输出时就开始执行已完整接收的工具调用，大幅降低延迟
- **并发安全分批**：只读工具可并行（默认最多 10 个，可通过 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 配置），写操作串行
- **状态跨轮持久**：同一 `QueryEngine` 实例跨多次 `submitMessage()` 保留消息历史、token 用量、文件缓存等

### 循环终止条件

| 条件 | 触发位置 |
|------|---------|
| 无 tool_use 块 | `query.ts` L1062 |
| 超过 maxTurns | `query.ts` L1704-1711 |
| 超过预算 maxBudgetUsd | `QueryEngine.ts` L972-1002 |
| stop hook 阻止 | `query.ts` L1278 |
| 用户中断 (abort) | `query.ts` L1015-1051 |
| prompt_too_long 不可恢复 | `query.ts` L1173 |

### QueryEngine 跨轮持久状态

- `mutableMessages`：完整对话历史
- `totalUsage`：累计 API 用量
- `permissionDenials`：权限拒绝记录
- `discoveredSkillNames`：本会话发现的技能
- `readFileState`：文件读取缓存

---

## 二、Tool System（工具系统）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/Tool.ts` | 工具接口定义 + `buildTool()` 工厂 |
| `src/tools.ts` | 工具注册表 `getAllBaseTools()` |
| `src/services/tools/toolExecution.ts` | 工具执行引擎 |
| `src/services/tools/toolOrchestration.ts` | 并发编排 |
| `src/utils/api.ts` | `toolToAPISchema()` 转换 |

### 工具定义结构

```typescript
Tool {
  name: string
  aliases?: string[]                // 向后兼容名
  inputSchema: ZodType              // 输入校验 (Zod)
  inputJSONSchema?: ToolInputJSONSchema  // JSON Schema 格式 (MCP 用)
  call()                            // 主处理函数
  description() / prompt()          // 发给 Claude 的描述

  // 行为标记
  isConcurrencySafe()               // 可否并行
  isReadOnly()                      // 只读操作?
  isDestructive()                   // 不可逆操作?
  isEnabled()                       // 运行时是否可用

  // 权限
  checkPermissions()                // 工具级权限检查
  validateInput()                   // 输入校验

  // 渲染 (UI)
  renderToolUseMessage()            // 初始展示
  renderToolUseProgressMessage()    // 进度更新
  renderToolResultMessage()         // 结果展示
  renderToolUseRejectedMessage()    // 拒绝展示

  // 元数据
  maxResultSizeChars: number        // 结果尺寸阈值
  searchHint?: string               // 工具搜索关键词
  shouldDefer?: boolean             // 延迟加载 (需 ToolSearch)
}
```

### 内置工具全景 (~48 个)

```
├── 系统工具
│   ├── AgentTool, BashTool, PowerShellTool
│   ├── SkillTool, REPLTool
│   └── ConfigTool
├── 文件操作
│   ├── FileReadTool, FileEditTool, FileWriteTool
│   ├── NotebookEditTool
│   ├── GlobTool, GrepTool
│   └── LSPTool
├── 信息获取
│   ├── WebFetchTool, WebSearchTool
│   └── ListMcpResourcesTool
├── 交互
│   ├── TodoWriteTool, AskUserQuestionTool
│   └── SendMessageTool
├── 规划
│   ├── EnterPlanModeTool, ExitPlanModeV2Tool
│   └── VerifyPlanExecutionTool
├── 任务管理
│   ├── TaskCreateTool, TaskGetTool
│   ├── TaskUpdateTool, TaskListTool
│   └── TaskStopTool
└── 功能门控工具
    ├── ScheduleCronTool, CronDeleteTool, CronListTool
    ├── SleepTool, WorkflowTool
    └── ...
```

### 工具执行生命周期（8 步）

```
1. 查找工具 ─────── by name / alias, fallbackTool 兜底
2. 输入校验 ─────── Zod schema 解析 + validateInput()
3. 输入回填 ─────── backfillObservableInput() (让 hooks 可见)
4. Pre-Tool Hooks ─ runPreToolUseHooks() 可批准/拒绝/修改输入
5. 权限检查 ─────── 规则 → 分类器 → 用户审批
6. 执行 ─────────── tool.call(input, context, canUseTool, ...)
7. Post-Tool Hooks ─ runPostToolUseHooks()
8. 结果映射 ─────── mapToolResultToToolResultBlockParam()
```

### 并发控制

```
runTools() 分批策略:
  ├─ 连续多个 isReadOnly + isConcurrencySafe → 一个并发批次
  ├─ 非只读工具 → 独占执行
  └─ 并发批次通过 all() + max concurrency 控制
```

### MCP 工具集成

- MCP 服务器发现工具后，动态创建 `Tool` 对象
- 命名格式：`mcp__<serverName>__<toolName>`
- 与内置工具统一调度，走同样的权限和执行链路
- 大结果 (>maxResultSizeChars) 持久化到磁盘，只传摘要 + 文件路径给 Claude

---

## 三、Security & Permissions（安全与权限）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/utils/permissions/permissions.ts` | 权限决策引擎 |
| `src/utils/permissions/permissionRuleParser.ts` | 规则解析器 |
| `src/tools/BashTool/bashSecurity.ts` | 20+ Bash 安全校验器 |
| `src/tools/BashTool/pathValidation.ts` | 路径限制检查 |
| `src/utils/sandbox/sandbox-adapter.ts` | 沙箱适配 |
| `src/hooks/useCanUseTool.tsx` | 权限审批 UI + 竞态处理 |
| `src/utils/permissions/yoloClassifier.ts` | AI 分类器 |

### 权限模式

| 模式 | 行为 | 场景 |
|------|------|------|
| `default` | 未知工具 → 弹窗询问用户 | 普通交互 |
| `acceptEdits` | 文件操作自动允许 | 信任编辑 |
| `bypassPermissions` | 跳过所有检查 | 全信任 |
| `dontAsk` | 未知工具 → 自动拒绝 | 保守模式 |
| `auto` | AI 分类器自动判定 | 内部/高级 |
| `plan` | 规划模式，延迟执行 | 方案确认 |

### 权限规则格式

```
"Bash(git *)"           → Bash 工具 + git 前缀命令
"FileEdit(/tmp/*)"      → 只允许编辑 /tmp 下文件
"BashTool"              → 任意 Bash 命令
"mcp__server"           → 某 MCP 服务器的所有工具
"WebFetch(domain:example.com)" → 限定域名
```

规则来源（优先级从高到低）：

1. CLI 参数 (`--allow-tools`, `--deny-tools`)
2. 会话状态
3. 命令级设置
4. 策略设置 (企业/管理)
5. 本地设置 (`.claude/settings.local.json`)
6. 项目设置 (`.claude/settings.json`)
7. 用户设置 (`~/.claude/settings.json`)

### 权限决策链（10 层）

```
工具调用到达
  ↓
 1. Allow 规则匹配? ──────── → 直接放行
 2. Deny 规则匹配?  ──────── → 直接拒绝
 3. 权限模式判定
    ├─ acceptEdits → 文件操作放行
    ├─ bypassPermissions → 全放行
    └─ dontAsk → 未知拒绝
 4. Ask 规则匹配? ─────────── → 弹窗
 5. 权限 Hooks (自定义逻辑) ── → hook 可批准/拒绝
 6. 沙箱违规检查 ───────────── → 沙箱策略
 7. 工作目录限制检查 ────────── → 目录范围
 8. Bash 专用校验器 (20+项) ── → 安全硬拦截
 9. AI 分类器 (auto 模式) ──── → Sonnet 判定
10. 默认 → 'ask' 弹窗询问用户
```

### Bash 安全校验器（硬编码拦截）

| 检查项 | 拦截内容 |
|--------|---------|
| Shell 元字符注入 | `; && \|\| ` 等 |
| 命令替换 | `$()`, `` ` ` ``, `<()` |
| 危险变量扩展 | `IFS`, `BASH_ENV`, `/proc/self/environ` |
| 花括号展开绕过 | `{a,b}` |
| Zsh 模块加载 | `zmodload`, `sysopen`, `ztcp` |
| Unicode 空白伪装 | 控制字符、零宽字符 |
| JQ `@sh` 滥用 | 命令注入 |
| 危险路径删除 | `/`, `/etc`, `/System`, `/Windows` |
| Claude 配置保护 | `.claude/settings.json` 永远禁写 |

### 沙箱隔离

通过 `@anthropic-ai/sandbox-runtime` 实现：
- **网络限制**：`allowedDomains` / `deniedDomains`，代理配置
- **文件系统**：`allowWrite` / `denyWrite` / `denyRead` 路径列表
- **永远禁写**：`.claude/settings.json`（原始和当前 cwd 都保护）

### 权限审批竞态

审批请求同时发给多个源，**先到先赢**：

1. 用户键盘输入（本地审批）
2. CCR（claude.ai Web UI）响应
3. 权限 Hooks（异步自定义逻辑）
4. Bash 分类器（异步安全评估）
5. Abort 信号（用户取消）

---

## 四、Multi-Agent Orchestration（多智能体编排）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/tools/AgentTool/AgentTool.tsx` | 子智能体生成入口 |
| `src/tools/AgentTool/forkSubagent.ts` | Fork 模式（继承父上下文） |
| `src/tools/AgentTool/loadAgentsDir.ts` | Agent 定义加载与合并 |
| `src/tools/AgentTool/builtInAgents.ts` | 6 个内置 Agent |
| `src/tools/SendMessageTool/SendMessageTool.ts` | 智能体间通信 |
| `src/utils/worktree.ts` | Git Worktree 隔离 |
| `src/utils/agentContext.ts` | AsyncLocalStorage 上下文隔离 |
| `src/utils/swarm/` | 多智能体 Swarm 系统 |

### 两种生成路径

```
AgentTool.call()
  ├─ Fork 路径 (无 subagent_type)
  │   ├─ 子进程继承父亲完整上下文
  │   ├─ prompt cache 共享（字节级相同前缀）
  │   ├─ 所有 fork 强制后台运行
  │   └─ FORK_BOILERPLATE_TAG 防止递归 fork
  │
  └─ Agent 选择路径 (指定 subagent_type)
      ├─ 从注册表加载 agent 定义
      ├─ 校验 MCP 服务器可用性
      ├─ 应用权限模式
      └─ 调用 runAgent() 执行
```

### 内置 Agent 类型

| Agent | 用途 | 工具范围 |
|-------|------|---------|
| `general-purpose` | 全能型 | 所有工具 |
| `Explore` | 代码探索 | 只读工具 |
| `Plan` | 架构规划 | 只读，不能编辑 |
| `claude-code-guide` | 用户指导 | Glob/Grep/Read/WebFetch/WebSearch |
| `statusline-setup` | IDE 集成 | Read/Edit |
| `verification` | 测试验证 | 测试相关工具 |

### Agent 定义结构

```typescript
AgentDefinition {
  agentType: string                    // 唯一标识
  whenToUse: string                    // 使用场景描述
  tools?: string[]                     // 可用工具白名单
  disallowedTools?: string[]           // 禁用工具
  skills?: string[]                    // 预加载技能
  mcpServers?: AgentMcpServerSpec[]    // MCP 服务器依赖
  hooks?: HooksSettings                // 会话级 hooks
  model?: string | 'inherit'          // 模型选择
  permissionMode?: PermissionMode      // 权限模式
  maxTurns?: number                    // 最大轮次
  background?: boolean                 // 强制后台运行
  isolation?: 'worktree' | 'remote'    // 执行隔离
  memory?: 'user' | 'project' | 'local' // 持久记忆范围
}
```

Agent 定义来源（优先级从低到高）：built-in → plugin → user → project → flag → policy

### 上下文隔离：AsyncLocalStorage

```typescript
type AgentContext = SubagentContext | TeammateAgentContext

// 为什么用 AsyncLocalStorage?
// 当多个 Agent 通过 ctrl+b 后台运行时，它们共享同一进程。
// AsyncLocalStorage 隔离每条异步执行链，
// 防止 Agent A 的事件使用 Agent B 的上下文。
```

### Swarm 多智能体协作

```
Leader (主智能体)
  ├─ Tmux Backend  → 每个 teammate 一个 tmux pane
  ├─ iTerm2 Backend → 原生分屏
  └─ In-Process Backend → 同进程 AsyncLocalStorage 隔离

通信方式:
  ├─ Mailbox (文件系统信箱)
  │   └─ ~/.claude/teams/<team>/mail/<teammate>
  ├─ SendMessage 工具
  │   ├─ 点对点: to="teammate-name"
  │   ├─ 广播: to="*"
  │   └─ UDS/Bridge: to="uds:<socket>" / "bridge:<session>"
  └─ 结构化消息类型:
      ├─ shutdown_request / shutdown_response
      └─ plan_approval_response
```

### Worktree 隔离

```
设置 isolation: "worktree" 时:
  ├─ 创建独立 Git Worktree → .claude/worktrees/<slug>
  ├─ 独立分支: worktree-<slug>
  ├─ 大目录 (node_modules) 通过 symlink 共享
  ├─ 可选 sparse-checkout 减少文件
  └─ Agent 完成后自动清理 (无更改时)
```

### 后台执行

```
run_in_background: true 时:
  ├─ 注册为 LocalAgentTask
  ├─ ProgressTracker 追踪进度
  │   ├─ toolUseCount, latestInputTokens
  │   ├─ cumulativeOutputTokens
  │   └─ recentActivities (最近 5 个工具调用)
  ├─ 完成后通过 <task-notification> XML 通知父智能体
  └─ 可自动后台化 (2 分钟阈值)
```

---

## 五、Memory System（记忆系统）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/utils/claudemd.ts` | CLAUDE.md 发现与加载 |
| `src/memdir/` | 自动记忆系统 (扫描/选择/路径) |
| `src/memdir/findRelevantMemories.ts` | 记忆相关性评估 |
| `src/memdir/memoryScan.ts` | 记忆目录扫描 |
| `src/services/compact/` | 上下文压缩 |
| `src/services/SessionMemory/` | 会话记忆 |
| `src/services/extractMemories/` | 记忆自动提取 |
| `src/context.ts` | 项目上下文收集 |
| `src/utils/systemPrompt.ts` | 系统提示词构建 |

### 三层记忆架构

```
┌──────────────────────────────────────────────────────┐
│ Layer 1: CLAUDE.md (静态项目指令)                      │
│                                                        │
│  优先级: managed(/etc) > user(~/) > project > local    │
│  发现: 从 CWD 向上遍历到 repo root                     │
│  上限: 40,000 字符 (MAX_MEMORY_CHARACTER_COUNT)        │
│  支持: @include 指令引入其他文件                        │
│  来源:                                                  │
│    ├─ /etc/claude-code/CLAUDE.md (全局管理)             │
│    ├─ ~/.claude/CLAUDE.md (用户私有)                    │
│    ├─ <project>/CLAUDE.md (项目公共)                    │
│    ├─ <project>/.claude/CLAUDE.md                      │
│    ├─ <project>/.claude/rules/*.md                     │
│    └─ <project>/CLAUDE.local.md (本地私有)              │
├──────────────────────────────────────────────────────┤
│ Layer 2: Auto-Memory (动态用户记忆)                     │
│                                                        │
│  路径: ~/.claude/projects/<sanitized-git-root>/memory/  │
│  索引: MEMORY.md (最多 200 行)                          │
│  类型: user / feedback / project / reference            │
│  格式: Markdown + YAML frontmatter (name/desc/type)    │
│  选择: Sonnet 模型评估相关性, 最多注入 5 条              │
│  新鲜度: >1 天的记忆附带过期警告                         │
├──────────────────────────────────────────────────────┤
│ Layer 3: Session Memory (会话级)                        │
│                                                        │
│  转录存储: JSONL 格式 (MAX_HISTORY_ITEMS=100)           │
│  路径: ~/.claude/projects/<id>/<prompt-id>.jsonl        │
│  压缩: 微压缩 + 分叉 Agent 摘要                        │
│  自维护笔记: 后台 Agent 定期更新, 包含:                  │
│    Session Title / Current State / Task Spec            │
│    Files & Functions / Workflow / Errors                │
│    Learnings / Key Results / Worklog                    │
│  阈值: 初始化 10K tokens, 更新间隔 5K tokens            │
│  最大: 12,000 tokens / section ~2000 tokens             │
└──────────────────────────────────────────────────────┘
```

### 系统提示词构建顺序

```
1. Override (如有, 替换全部)
2. Coordinator (coordinator 模式)
3. Agent 系统提示词 (proactive 时追加, 否则替换)
4. Custom (--system-prompt)
5. Default (标准 Claude Code 提示词)
6. Append (--append-system-prompt, 始终追加)
```

### 记忆选择流程

```
用户消息到达
  ↓
1. startRelevantMemoryPrefetch() → 非阻塞异步预取
  ↓
2. selectRelevantMemories() → Sonnet 模型评估
   ├─ 输入: 用户提示 + 所有记忆头部 (name/desc/type)
   ├─ 过滤: 最近已使用的工具的 reference 文档
   └─ 输出: 最多 5 条相关记忆 ID
  ↓
3. getRelevantMemoryAttachments() → 读取 + 截断 + 包装
   ├─ 截断: MAX_MEMORY_LINES / MAX_MEMORY_BYTES
   ├─ 包装: <system-reminder> 标签
   └─ 警告: >1 天 → "这是历史快照, 请验证当前状态"
  ↓
4. 注入为 relevant_memories 附件类型
```

### 上下文压缩策略

| 策略 | 方式 | 触发条件 |
|------|------|---------|
| 微压缩 (microCompact) | 轻量 token 削减，不丢信息 | 每轮自动 |
| 全压缩 | Fork 子智能体做对话摘要 | token 超阈值 |
| 上下文折叠 | 标记压缩区域，UI 可折叠 | feature gate |
| 工具摘要 | 压缩重复工具操作 | 工具结果过长 |

### 项目上下文收集

会话启动时并行收集（memoized）：
- 当前分支 + 默认分支
- Git status（截断 2000 字符）
- 最近 5 条 commit
- Git 用户名

---

## 六、Extension Ecosystem（拓展生态）

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/utils/hooks/AsyncHookRegistry.ts` | Hook 全局注册表 |
| `src/utils/hooks/hookEvents.ts` | Hook 事件广播 |
| `src/utils/hooks/hooksSettings.ts` | Hook 配置管理 |
| `src/services/mcp/config.ts` | MCP 配置解析 |
| `src/services/mcp/client.ts` | MCP 客户端 (119K) |
| `src/services/mcp/auth.ts` | MCP OAuth 认证 (89K) |
| `src/tools/SkillTool/SkillTool.ts` | 技能执行 |
| `src/utils/plugins/pluginLoader.ts` | 插件加载引擎 (110K) |
| `src/utils/plugins/schemas.ts` | 插件 manifest 校验 (58K) |

### 6.1 Hook 系统

**支持 25+ 事件：**

```
生命周期:    SessionStart, SessionEnd, Setup
工具相关:    PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, PermissionRequest
智能体:      SubagentStart, SubagentStop, Stop, StopFailure
压缩:        PreCompact, PostCompact
任务:        TaskCreated, TaskCompleted, TeammateIdle
用户输入:    UserPromptSubmit, Elicitation, ElicitationResult
环境:        CwdChanged, FileChanged, InstructionsLoaded, ConfigChange
工作树:      WorktreeCreate, WorktreeRemove
通知:        Notification
```

**Hook 类型：**

| 类型 | 说明 |
|------|------|
| `command` | 执行 shell 命令 |
| `prompt` | LLM 提示词 |
| `agent` | 多轮 Agent 验证器 |
| `http` | POST 到外部服务 (支持 header 模板) |
| `function` | SDK 回调 (仅 Agent SDK) |

**配置示例：**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "lint.sh",
            "if": "Write(*.py)",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### 6.2 MCP (Model Context Protocol) 集成

```
传输协议: stdio | HTTP | SSE | WebSocket | SDK
配置来源:
  ├─ .mcp.json (项目级)
  ├─ settings.json 的 mcp 字段
  └─ .claude/managed/managed-mcp.json (企业级)
工具命名: mcp__<serverName>__<toolName>
认证: OAuth + URL elicitation 重试 (-32042 错误码)
```

### 6.3 Skill/技能系统

```
位置: .claude/skills/ 或 ~/.claude/skills/
格式: SKILL.md (Markdown + YAML frontmatter)
执行: SkillTool 在 forked subagent 上下文中运行
命名: plugin:namespace:skillName (支持命名空间)
热重载: skillChangeDetector 监视目录变更
```

### 6.4 Plugin 架构

**plugin.json manifest 结构：**

```
plugin.json
  ├─ metadata: name, description, version, author
  ├─ commands/    → 自定义斜杠命令
  ├─ agents/      → 自定义 Agent 定义
  ├─ skills/      → SKILL.md 技能文件
  ├─ hooks/       → 钩子配置 (inline 或 hooks/hooks.json)
  ├─ mcp/         → 嵌入式 MCP 服务器定义
  └─ output-styles/ → 自定义渲染样式
```

**安装与管理：**
- 路径：`~/.claude/plugins/repos/`
- 来源：GitHub URL / Git URL / 本地路径
- 管理：marketplace + CLI 命令
- 热重载：文件变更检测自动更新

### 6.5 Settings 分层配置

```
优先级 (从低到高):
  1. 用户级    ~/.claude/settings.json
  2. 项目级    .claude/settings.json
  3. 本地级    .claude/settings.local.json  (不提交到 git)
  4. 企业级    .claude/managed/settings.json (管理员锁定)
  5. 策略级    远程推送的配置 (policy)

settings.json 核心字段:
  {
    hooks:           { [HookEvent]: [HookMatcher] }
    mcp:             { [serverName]: McpServerConfig }
    skills:          { [skillName]: SkillConfig }
    agents:          { [agentName]: AgentConfig }
    enabledPlugins:  { [pluginId]: PluginConfig }
    permissions:     { allow, deny, ask, defaultMode }
    environment:     { [varName]: value }
  }
```

---

## 架构全景

```
┌───────────────────── Claude Code Harness ─────────────────────┐
│                                                                 │
│  ┌─ Agent Loop ──────────────────────────────────────────┐     │
│  │  QueryEngine → queryLoop() → queryModel()             │     │
│  │       ↕ StreamingToolExecutor (边流边执行)              │     │
│  │  终止条件: 无工具/超轮次/超预算/hook阻止/用户中断       │     │
│  └───────────────────────────────────────────────────────┘     │
│          ↕                                                      │
│  ┌─ Tool System ─────────────────────────────────────────┐     │
│  │  48 内置 + MCP 动态 + Plugin 自定义                     │     │
│  │  Zod 校验 → Hooks → 权限 → 执行 → 结果映射             │     │
│  │  并发安全分批: 只读并行(max 10), 写操作串行              │     │
│  └───────────────────────────────────────────────────────┘     │
│          ↕                                                      │
│  ┌─ Security ────────────────────────────────────────────┐     │
│  │  10 层权限决策链 + 20+ Bash 安全校验器                   │     │
│  │  沙箱隔离(网络+文件) + AI 分类器 + 竞态审批              │     │
│  └───────────────────────────────────────────────────────┘     │
│          ↕                                                      │
│  ┌─ Multi-Agent ─────────────────────────────────────────┐     │
│  │  Fork(缓存共享) / Select(注册表) 两种生成路径            │     │
│  │  Worktree 隔离 + AsyncLocalStorage 上下文隔离           │     │
│  │  Swarm: Tmux/iTerm2/In-Process + Mailbox 通信          │     │
│  └───────────────────────────────────────────────────────┘     │
│          ↕                                                      │
│  ┌─ Memory ──────────────────────────────────────────────┐     │
│  │  L1: CLAUDE.md (静态指令, @include, 40K上限)            │     │
│  │  L2: Auto-Memory (Sonnet 选择, 5条, 新鲜度警告)         │     │
│  │  L3: Session Memory (JSONL转录, 微压缩, 自维护笔记)     │     │
│  └───────────────────────────────────────────────────────┘     │
│          ↕                                                      │
│  ┌─ Extensions ──────────────────────────────────────────┐     │
│  │  Hooks: 25+事件 × 5种类型 (command/prompt/agent/http/fn)│     │
│  │  MCP: 5种传输 + OAuth 认证                              │     │
│  │  Plugins: manifest驱动 + marketplace + 热重载           │     │
│  │  Skills: SKILL.md + forked subagent 执行                │     │
│  │  Settings: 5层分级配置                                   │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

> **后续学习方向**：可以针对单个模块深入读源码，例如 `StreamingToolExecutor` 的并发模型、`yoloClassifier` 的 AI 安全评估、Swarm 的 Mailbox 通信协议等。
