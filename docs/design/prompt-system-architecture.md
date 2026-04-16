# 提示词系统架构重设计

> **状态**: Proposed  
> **日期**: 2026-04-16  
> **性质**: `design` — 原则、目标态与分阶段路线图；与当前实现的差异见各 Phase 变更清单  
> **前置阅读**: `docs/design/conversation-agent-system-lens.md`（第 4 层「上下文工程」）  
> **last_reviewed**: 2026-04-16

---

## 0. 问题陈述

PP 的提示词系统在演进中积累了如下结构性问题：

1. **重复叙述** — 同一事实（数据目录路径、工具使用方式、Agent 协作规则）在 3-4 个来源中重复出现，措辞不一致，导致模型行为不可预测（典型表现："找得到路径却选错工具"）
2. **缺乏分层** — 所有内容（安全约束、Agent 身份、项目上下文、动态数据）拼成一个字符串作为 user prompt 发送。SDK 的 `systemPrompt` 参数未使用。模型无法从结构上区分"不可违反的约束"与"参考性上下文"
3. **覆盖顺序隐式** — 代码中有 fallback 链（会话 > 用户文件 > 内置 > 内联），但 prompt 文本里没有声明。模型只能靠位置猜测优先级
4. **priority 分散** — 优先级数字散落在 `resource-migration.ts`、`buildResourcePrompt()`、各 Loader 中，无集中管理
5. **工具策略无 SSOT** — "用什么工具操作什么路径"的指令分布在 global.md 种子、AgentDataInfoLoader、appendLocalAgentSdkToolingNotice、SystemPromptLoader 四处，相互矛盾

### 行业参照

| 来源 | 核心观点 |
|------|---------|
| [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Context 是有限且边际递减的资源；追求最小高信号 token 集合 |
| [Anthropic: Writing Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | 工具不能有功能重叠；命名空间清晰；少即是多 |
| [OpenAI: Instruction Hierarchy](https://openai.com/index/the-instruction-hierarchy) | System > Developer > User > Tool；训练级优先级 |
| [Google: System Instructions](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/system-instructions) | System instructions 只放 non-negotiables，其余放 task prompt |
| [AgentPatterns: Prompt Layering](https://agentpatterns.ai/context-engineering/prompt-layering/) | 四层栈；specificity determines precedence；子 Agent 不继承 |
| [Claude Code 源码分析](#附录-a-claude-code-提示词架构摘要) | string[] 数组 + 缓存边界；每段职责单一；工具策略唯一来源 |

---

## 1. 设计原则

| # | 原则 | 含义 |
|---|------|------|
| P1 | **每个事实只说一次** | 路径、能力、Agent 列表等事实信息只在一个来源出现。其他地方如需引用，说"参见系统注入的 xxx"，不重复原文 |
| P2 | **事实与策略分离** | 事实类信息只说"是什么"（路径、文件列表），不说"怎么做"。操作策略只在一处声明 |
| P3 | **利用 SDK 消息分离** | 不可违反的约束放进 SDK `systemPrompt`，参考性上下文放进 user prompt。利用模型对 system prompt 的更高遵从度 |
| P4 | **scope 为用户一等公民** | 用户/Agent 按 scope 文件夹组织内容（global / project / agent / session），直觉友好 |
| P5 | **concern 为开发者一等公民** | 系统自动注入的内容通过 concern 注册表确保互斥，对用户/Agent 不可见 |
| P6 | **窄 scope 覆盖宽 scope** | session > agent > project > global > system。system 层硬约束不可覆盖，软默认可被更窄 scope 调整 |
| P7 | **条件注入减少噪音** | 支持 frontmatter 声明注入条件（alwaysApply / globs / description / manual），只在相关时注入 |

---

## 2. 目标架构

### 2.1 双层架构总览

```
最终发给模型的 prompt
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃                                               ┃
┃  SDK systemPrompt（代码级系统层）                ┃
┃  ┌───────────────────────────────────────────┐ ┃
┃  │ 硬约束（安全，不可覆盖）                     │ ┃
┃  │ 默认工具策略（可被 project/agent 调整）       │ ┃
┃  │ 资源操作方式（PP 资源用什么工具/API）         │ ┃
┃  │ 资源权限地图（当前 Agent 能读写什么）         │ ┃
┃  │ 运行时环境事实（数据根、API 端口、模型名）    │ ┃
┃  │ 覆盖规则声明                                │ ┃
┃  └───────────────────────────────────────────┘ ┃
┃                                               ┃
┃  user prompt（scope 文件 + Loader 计算）        ┃
┃  ┌───────────────────────────────────────────┐ ┃
┃  │ Agent 身份        ← agents/{id}/          │ ┃
┃  │ 全局规则          ← global/               │ ┃
┃  │ 项目规则/上下文    ← projects/{key}/       │ ┃
┃  │ 提示词片段         ← blocks/              │ ┃
┃  │ 技能              ← skills/               │ ┃
┃  ├───────────────────────────────────────────┤ ┃
┃  │ 动态数据（Loader 按 concern 注册表计算）    │ ┃
┃  │  Agent 列表 / todo / 看板 / 收件箱          │ ┃
┃  │  Code Cards / 知识 / 文件列表              │ ┃
┃  ├───────────────────────────────────────────┤ ┃
┃  │ 对话历史（非 resume 时）                    │ ┃
┃  │ 用户消息                                   │ ┃
┃  └───────────────────────────────────────────┘ ┃
┃                                               ┃
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2.2 三方职责分工

| 角色 | 负责什么 | 使用什么机制 |
|------|---------|------------|
| **开发者** | 系统内容不矛盾 | concern 注册表 + Loader 代码 + builtin 种子 |
| **人类用户** | 自定义指令和规则 | scope 文件夹 + frontmatter + UI / API |
| **AI Agent** | 自己的身份和工作内容 | scope 文件夹 + 工具（Read/Write/Edit） + PP API |

### 2.3 写入路径

```
开发者 ─→ concern 注册表（代码）+ Loader 代码 + builtin/ 种子
人类用户 ─→ scope 文件夹（global/ projects/ agents/ blocks/）
AI Agent ─→ scope 文件夹（仅自己的 agent scope + 当前 project scope）
系统运行时 ─→ 内存计算，不写文件（Loader 按 concern 注册表产出）
```

Agent 权限边界：

| Agent 可写 | Agent 不可写 |
|-----------|------------|
| `prompts/agents/{自己的 id}/*` | `prompts/agents/{其他 id}/*` |
| `prompts/projects/{当前项目}/*`（慎重） | `prompts/global/*` |
| `agents/workspaces/{自己的 id}/*` | 系统层（代码内置） |

---

## 3. Concern 注册表

开发者维护的代码级契约。每个 concern 有唯一的 owner Loader，保证系统自动注入的内容不重叠。用户和 Agent 不感知此表。

```typescript
// src/lib/prompt-concerns.ts（目标态）

export const SYSTEM_CONCERNS = {

  // ── 事实类：说"是什么" ──

  'env.data-root': {
    description: '数据根路径（~/.project-pilot/ 或 PROJECT_PILOT_DATA_DIR）',
    owner: 'SystemLevelPromptBuilder',
    scope: 'system',
    injection: 'system-prompt',
  },
  'env.agent-workspace': {
    description: 'Agent 私有目录路径与文件列表',
    owner: 'AgentDataInfoLoader',
    scope: 'agent',
    injection: 'context',
    rule: '只说路径和文件列表，不说用什么工具操作',
  },
  'env.runtime-capabilities': {
    description: '当前会话挂载的工具与模型信息',
    owner: 'SystemLevelPromptBuilder',
    scope: 'session',
    injection: 'system-prompt',
  },
  'env.project-info': {
    description: '项目路径与基本元数据',
    owner: 'FlowContextLoader',
    scope: 'project',
    injection: 'context',
  },
  'env.resource-permissions': {
    description: '当前 Agent 的资源读写权限地图',
    owner: 'SystemLevelPromptBuilder',
    scope: 'session',
    injection: 'system-prompt',
  },

  // ── 策略类：说"怎么做" ──

  'strategy.tool-usage': {
    description: '工具使用策略（专用工具优先于 bash）+ PP 资源操作方式',
    owner: 'SystemLevelPromptBuilder',
    scope: 'system',
    injection: 'system-prompt',
    rule: '唯一的工具策略来源。其他 Loader 不得包含工具使用建议',
  },
  'strategy.collaboration-principles': {
    description: '团队协作原则（先帮忙再引荐、交接清单格式）',
    owner: 'GlobalPromptLoader',
    scope: 'global',
    injection: 'context',
    rule: '只说原则，不包含 call-agent CLI 细节',
  },

  // ── 清单类：说"有什么可用" ──

  'catalog.callable-agents': {
    description: '可调用 Agent 列表 + call-agent CLI 用法',
    owner: 'AvailableAgentsLoader',
    scope: 'computed',
    injection: 'context',
    rule: '只说列表和 CLI 参数，不重复协作原则',
  },
  'catalog.design-docs': {
    description: '设计文档索引表',
    owner: 'DesignDocsIndexLoader',
    scope: 'project',
    injection: 'context',
  },

  // ── 动态数据类 ──

  'dynamic.todo-list':     { owner: 'TodoListLoader',       scope: 'agent',   injection: 'context' },
  'dynamic.active-tasks':  { owner: 'ActiveTasksLoader',    scope: 'agent',   injection: 'context' },
  'dynamic.inbox':         { owner: 'InboxDigestLoader',    scope: 'agent',   injection: 'context' },
  'dynamic.shared-memory': { owner: 'SharedMemoryLoader',   scope: 'agent',   injection: 'context' },
  'dynamic.code-cards':    { owner: 'CodeCardLoader',       scope: 'project', injection: 'context' },
  'dynamic.distiller':     { owner: 'DistillerKnowledgeLoader', scope: 'project', injection: 'context' },

  // ── 约束类 ──

  'constraint.safety': {
    description: '不可逆操作确认、数据安全、AskUserQuestion 行为约束',
    owner: 'SystemLevelPromptBuilder',
    scope: 'system',
    injection: 'system-prompt',
    rule: '不可被任何 scope 覆盖',
  },

} as const;
```

---

## 4. Scope 文件系统（用户侧）

### 4.1 目录结构

```
prompts/
├── global/                          ← scope=global，用户可编辑，所有 Agent 共享
│   ├── *.md                         ← 自由内容
│   └── rules/                       ← 条件注入规则
│       └── *.md                     ← frontmatter 控制注入条件
│
├── projects/
│   └── {projectKey}/                ← scope=project
│       ├── *.md
│       └── rules/
│           └── *.md
│
├── agents/
│   └── {agentId}/                   ← scope=agent
│       ├── identity.md              ← Agent 人设（对应现有 system prompt 文件）
│       ├── *.md                     ← 其他自由内容
│       └── rules/
│           └── *.md
│
├── blocks/                          ← 跨 scope 复用片段，通过 promptRefs 引用
│   └── {blockId}.md
│
├── builtin/                         ← 内置种子，版本化同步
│   ├── manifest.json
│   └── ...
│
├── history/                         ← 版本历史（现有机制保留）
└── runtime/                         ← 会话级覆盖（现有机制保留）
```

### 4.2 Frontmatter 规范

用户文件可选的 frontmatter 字段：

```yaml
---
# 注入条件（四选一，不填则默认 alwaysApply: true）
alwaysApply: true                    # 始终注入
globs: ["src/api/**", "**/*.test.*"] # 操作匹配路径的文件时注入
description: "API 设计规范"           # 让 AI 判断是否相关时注入
manual: true                         # 只在显式引用时注入

# 可选元数据
concern: "tools"                     # 可选标签，系统可用于冲突提示
---
```

### 4.3 组装顺序与合并策略

1. 收集所有 scope 匹配的文件：global → project（若有 projectKey）→ agent
2. 按注入条件过滤：alwaysApply 直接进，globs 检查当前上下文，description 让模型判断
3. 按 scope 顺序拼接（global → project → agent → session），利用 recency bias
4. system 层内容通过 SDK `systemPrompt` 参数独立发送

覆盖规则：
- **system 层硬约束**：不可覆盖
- **system 层软默认**：可被 project / agent scope 的显式声明调整
- **同 concern 不同 scope**：窄 scope 覆盖宽 scope（因为它位置更靠后）

---

## 5. 系统层 Prompt 结构

`buildSystemLevelPrompt()` 产出的内容模板（实际为代码函数，以下为结构示意）：

```markdown
# 系统约束（不可覆盖）

- 执行不可逆操作（删除文件、推送代码、DROP TABLE 等）前必须向用户确认
- 不在回复中暴露 API Key、密码等敏感信息
- 调用 AskUserQuestion 工具后必须立即结束当前回复，等待用户回答

# 默认工具策略

以下为默认策略，项目或 Agent 级别的指令可针对特定场景调整。

文件操作必须使用专用工具，不要用 Bash 替代：
- 读文件：Read（不要用 cat / head / tail）
- 写文件：Write（不要用 echo / cat heredoc）
- 编辑文件：Edit（不要用 sed / awk）
- 搜索文件名：Glob（不要用 find / ls）
- 搜索文件内容：Grep（不要用 grep / rg）
- Bash 仅用于真正需要 shell 执行的系统命令

PP 结构化数据须通过 API 操作，不要直接用 Write 修改 JSON 文件：
（具体 API 列表按实际端点动态生成）

# 资源权限
（按当前 agentId / capabilities / projectKey 动态生成）

# 运行时环境
（数据根路径、API 端口、模型名 — 各只出现一次）

# 覆盖规则

当后续上下文中的指令与本段矛盾时：
- 「系统约束」部分：始终以本段为准，不可覆盖
- 「默认工具策略」部分：项目或 Agent 级别指令可针对特定场景调整
- 「资源权限」部分：始终以本段为准
```

---

## 6. 信息归属总表

所有可能出现的提示词信息及其唯一归属：

| # | 信息 | scope | injection | owner |
|---|------|-------|-----------|-------|
| 1 | Agent 人设与专长 | agent | context（身份区） | 用户文件 `agents/{id}/identity.md` |
| 2 | 默认行为风格（中文、简洁） | global | context | 用户文件 `global/*.md` |
| 3 | 安全约束（不可逆确认等） | system | system-prompt | `SystemLevelPromptBuilder` |
| 4 | AskUserQuestion 行为约束 | system | system-prompt | `SystemLevelPromptBuilder` |
| 5 | 工具策略 SSOT | system | system-prompt | `SystemLevelPromptBuilder` |
| 6 | PP 资源操作方式 | system | system-prompt | `SystemLevelPromptBuilder` |
| 7 | 资源权限地图 | session | system-prompt | `SystemLevelPromptBuilder` |
| 8 | 数据根路径 | system | system-prompt | `SystemLevelPromptBuilder` |
| 9 | API 端口、模型名 | session | system-prompt | `SystemLevelPromptBuilder` |
| 10 | Agent 私有目录路径+文件列表 | agent | context | `AgentDataInfoLoader` |
| 11 | 项目路径与基本信息 | project | context | `FlowContextLoader` |
| 12 | 团队协作原则 | global | context | `GlobalPromptLoader` |
| 13 | 交接清单格式 | global | context | `GlobalPromptLoader` |
| 14 | 可调用 Agent 列表 + CLI | computed | context | `AvailableAgentsLoader` |
| 15 | 项目特有约定 | project | context | 用户文件 `projects/{key}/*.md` |
| 16 | Code Cards | project | context | `CodeCardLoader` |
| 17 | 设计文档索引 | project | context | `DesignDocsIndexLoader` |
| 18 | 蒸馏知识 | project | context | `DistillerKnowledgeLoader` |
| 19 | 待办事项 | agent | context | `TodoListLoader` |
| 20 | 并行任务看板 | agent | context | `ActiveTasksLoader` |
| 21 | 收件箱 | agent | context | `InboxDigestLoader` |
| 22 | 共享记忆 | agent | context | `SharedMemoryLoader` |
| 23 | 技能 | 级联 | context | `SkillResourceLoader` |
| 24 | 提示词片段 | 引用 | context | `PromptBlockLoader` |
| 25 | 会话补充提示词 | session | context | `InlineTextLoader` |
| 26 | Prompt 文件路径 | agent | context（身份区尾部） | `SystemPromptLoader` |
| 27 | 对话历史 | session | context（尾部） | `formatConversationHistory` |

---

## 7. 分阶段路线图

### Phase 0：本设计文档

- 产出本文档，作为后续实施的依据
- 更新 `docs/as-is/` 记录当前现状（如需要）
- 在 `docs/AI_AGENT_KNOWLEDGE_MAP.md` 变更记录中登记

### Phase 1：建系统层

**目标**：将安全约束、工具策略、资源权限等从散落各处提取为独立的系统层，通过 SDK `systemPrompt` 发送。

**变更清单**：

| 文件 | 变更 |
|------|------|
| 新建 `src/lib/prompt-concerns.ts` | concern 注册表（声明文件） |
| 新建 `src/lib/system-level-prompt.ts` | `buildSystemLevelPrompt()` 函数 |
| `src/lib/chat-managers/agent-runner.ts` | `createClaudeAgentRunner` 传 `systemPrompt` 给 `buildSdkQueryOptions` |
| `src/lib/settings-manager.ts` | `buildSdkQueryOptions` 接受并传递 `systemPrompt` |

**不动的**：ResourceRegistry、Loader 模式、priority 排序机制、现有 prompts/ 文件夹结构。

**验收标准**：系统层内容出现在 SDK systemPrompt 中，user prompt 中不再包含安全约束和工具策略。

### Phase 2：清理重复叙述

**目标**：按 concern 注册表的 owner 分工，删除各来源的越权内容。

**变更清单**：

| 文件 | 变更 |
|------|------|
| `src/data/defaults/prompts/builtin/global.md` | 删除路径段落（移到系统层）、删除工具相关表述、协作部分只保留原则 |
| `src/lib/resource-loaders/agent-data-info-loader.ts` | 删除 "bash cat/echo/node 等" 工具建议，只保留路径和文件列表 |
| `src/lib/agent-provider-capabilities.ts` | `appendLocalAgentSdkToolingNotice` 改造为系统层的一个段落，不再硬追加 |
| `src/lib/resource-loaders/system-prompt-loader.ts` | 移出 AskUserQuestion 硬编码（移到系统层），prompt 路径只说路径不说工具 |
| `src/lib/resource-loaders/available-agents-loader.ts` | 删除协作原则重复叙述，只保留 Agent 表格 + CLI 参数 |

**验收标准**：每个事实/策略只在一个来源出现。concern 注册表中每个条目的 `rule` 字段得到遵守。

### Phase 3：规范 scope 文件夹

**目标**：prompts/ 目录结构微调，支持条件注入，priority 集中管理。

**变更清单**：

| 文件 | 变更 |
|------|------|
| 新建 `src/lib/prompt-priorities.ts` | 集中的 priority 常量表，替代散落各处的魔法数字 |
| `src/lib/resource-migration.ts` | 引用 priority 常量 |
| `src/lib/chat-managers/agent-chat-manager.ts` | `buildResourcePrompt` 中的硬编码 priority 改为引用常量 |
| scope 文件夹 | 按 4.1 结构微调（主要是 global/ 目录的规范化） |
| Loader | 支持 frontmatter `globs` / `alwaysApply` / `description` / `manual` 条件注入 |

**验收标准**：所有 priority 数字来自一个常量文件。条件注入对至少 globs 模式可用。

### Phase 4（长期）：PP 内置 MCP

**目标**：将 PP 的 prompt / skill / knowledge 等操作封装为 MCP 工具，Agent 不再需要知道文件路径和 API 端口。

**工具集草案**：

| MCP 工具 | 功能 | 替代什么 |
|---------|------|---------|
| `pp.prompt.read` | 读取提示词文件（自动 scope 权限检查） | Agent 用 Read + 猜路径 |
| `pp.prompt.write` | 写入提示词文件（自动历史快照） | Agent 用 Write + 手动路径 |
| `pp.skill.save` | 保存 Skill（自动处理格式和目录） | Agent 用 Write + 知道 skill 目录结构 |
| `pp.knowledge.save` | 保存知识条目 | Agent 用 curl + API |
| `pp.todo.update` | 更新待办 | Agent 用 curl + API |
| `pp.memory.write` | 写 Agent 记忆 | Agent 用 Write + 知道 workspace 路径 |

**验收标准**：Agent 可以通过语义化 MCP 工具完成所有 PP 资源操作，不需要在 prompt 中写操作路径表。

---

## 8. 与现有架构的兼容性

| 现有组件 | 影响 |
|---------|------|
| ResourceRegistry | **保留**。继续负责 user prompt 部分的资源加载和排序 |
| Loader 模式 | **保留**。每个 Loader 按 concern 注册表只产出自己负责的内容 |
| priority 排序 | **保留**。Phase 3 集中管理后更清晰 |
| 分段模式（segmented prompt） | **保留**。global.d/ / agents/{id}.d/ 继续支持 |
| 种子同步（builtin + manifest） | **保留**。种子内容按 Phase 2 瘦身 |
| 会话级覆盖（sessionConfig） | **保留**。sessionConfig.systemPrompt 继续作为 Agent 身份的会话级 override |
| `formatAsPrompt` 预算控制 | **保留**。400K 字符上限继续生效于 user prompt 部分 |

---

## 附录 A：Claude Code 提示词架构摘要

Claude Code 的系统提示词是一个 `readonly string[]` 数组，通过 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记分为静态和动态两部分。静态部分跨用户/跨会话可缓存。

关键设计：
- 每个段落是一个纯函数（`getSimpleSystemSection()`、`getUsingYourToolsSection()` 等），职责单一
- 工具策略只在 `getUsingYourToolsSection()` 一处声明："use Read instead of cat"
- Memory (CLAUDE.md) 按 Managed → User → Project → Local 四层加载，后加载优先（利用 recency bias）
- `buildEffectiveSystemPrompt()` 有明确的优先级链：Override > Coordinator > Agent > Custom > Default
- 子 Agent 不继承父 Agent 的 system prompt，只拿到自己的 prompt + 环境信息
- `systemPromptSection()` 计算一次后缓存，`DANGEROUS_uncachedSystemPromptSection()` 强制每轮重算并要求说明理由

详细分析见本次讨论记录。源码参考：`github.com/Kaine665/claude-code-main_run`。

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-04-16 | 初稿。基于提示词系统现状分析 + 行业最佳实践 + Claude Code 源码拆解 |
