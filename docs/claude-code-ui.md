# Claude Code 内置功能 UI 支持

> 记录 Task Agent 对 Claude Code CLI 各种内置交互行为的前端支持情况。

## 架构概述

Claude Code CLI 通过 `--verbose --output-format stream-json` 输出 NDJSON 事件流。所有工具调用（内置工具、MCP 工具）都以 `tool_use_start` / `tool_use_end` 事件对出现。

我们在前端通过 `toolName` 识别特殊工具，委托给专用卡片组件渲染，而非使用通用的折叠卡片。

```
ToolCallCard (入口)
  ├── toolName === 'AskUserQuestion'  → AskUserQuestionCard
  ├── toolName === 'TodoWrite'        → TodoListCard
  ├── toolName === 'Task'             → SubagentCard
  ├── toolName.startsWith('mcp__')    → 通用卡片 + MCP 标签
  └── 其他                             → 通用折叠卡片
```

---

## 1. AskUserQuestion（AI 向用户提问）

**文件**: `src/components/ask-user-question-card.tsx`

### Claude Code 行为

AskUserQuestion 是 Claude Code 的内置工具，允许 AI 暂停执行向用户提出选择题。

**关键发现**: 在 `--dangerously-skip-permissions` 模式下，此工具被**权限系统拒绝**：
- `tool_result` 返回 `is_error: true`，内容为 `"Answer questions?"`
- `result` 事件的 `permission_denials` 数组中记录了被拒绝的调用

### 事件流

```jsonl
// tool_use_start（从 content_block_stop 或 assistant.message.content 解析）
{
  "type": "tool_use_start",
  "id": "toolu_xxx",
  "toolName": "AskUserQuestion",
  "input": "{\"questions\":[{\"question\":\"你想用哪种方式？\",\"header\":\"方式\",\"options\":[{\"label\":\"选项A\",\"description\":\"描述A\"},{\"label\":\"选项B\",\"description\":\"描述B\"}],\"multiSelect\":false}]}"
}

// tool_use_end（被拒绝时 status='failed'）
{
  "type": "tool_use_end",
  "id": "toolu_xxx",
  "output": "Answer questions?",
  "status": "failed"
}
```

### Input JSON 结构

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;       // 问题文本
    header?: string;        // 短标签（如 "方式"、"语言"）
    options: Array<{
      label: string;        // 选项标签
      description?: string; // 选项描述
    }>;
    multiSelect?: boolean;  // 是否多选
  }>;
}
```

### 前端行为

| 状态 | 显示 | 交互 |
|------|------|------|
| `running` | 蓝色卡片 + 加载动画 + "AI 正在等待你的回答" | 选项按钮可点击 |
| `failed` (权限拒绝) | 橙色卡片 + "自动跳过"标签 | 选项按钮仍可点击 |
| `completed` | 蓝色卡片 + 绿色勾 | 选项按钮禁用，显示回复内容 |

**交互机制**: 用户点击选项 → 触发 `CustomEvent('ask-user-answer')` → ChatPanel 监听并调用 `doSend(answer)` → 作为普通消息发送给 AI。

即使 AI 已收到自动拒绝响应并继续执行，用户的回答会作为新消息（通过 `--resume`）发送，AI 会读到用户的真实选择。

---

## 2. TodoWrite（任务清单）

**文件**: `src/components/todo-list-card.tsx`

### Claude Code 行为

TodoWrite 是 Claude Code 的内置工具，AI 在执行复杂任务时创建和更新任务列表来跟踪进度。在 `--dangerously-skip-permissions` 模式下正常工作。

AI 会在执行过程中多次调用 TodoWrite，每次传入**完整的** todos 数组（全量替换，非增量）。

### 事件流

```jsonl
{
  "type": "tool_use_start",
  "id": "toolu_xxx",
  "toolName": "TodoWrite",
  "input": "{\"todos\":[{\"content\":\"分析代码结构\",\"status\":\"completed\",\"activeForm\":\"分析代码结构中\"},{\"content\":\"执行重构\",\"status\":\"in_progress\",\"activeForm\":\"执行重构变更中\"},{\"content\":\"验证结果\",\"status\":\"pending\",\"activeForm\":\"验证重构结果\"}]}"
}

{
  "type": "tool_use_end",
  "id": "toolu_xxx",
  "output": "Todos have been modified successfully...",
  "status": "completed"
}
```

### Input JSON 结构

```typescript
interface TodoWriteInput {
  todos: Array<{
    content: string;    // 任务描述（祈使句："执行重构"）
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string; // 进行时描述（"执行重构中"）
  }>;
}
```

### 前端行为

- 琥珀色卡片，顶部显示 "任务清单" + 完成数/总数
- 进度条动画显示完成比例
- 三种状态图标：
  - `pending`: 空心圆（灰色）
  - `in_progress`: 旋转加载图标（蓝色），显示 `activeForm`
  - `completed`: 勾号（绿色），文字带删除线

---

## 3. Task（子代理）

**文件**: `src/components/subagent-card.tsx`

### Claude Code 行为

Task 工具允许 Claude 派生子代理来并行或分治处理子任务。子代理有独立的上下文窗口。

子代理类型：`Explore`（探索代码）、`Plan`（规划）、`Bash`（命令执行）、`general-purpose`（通用）、`claude-code-guide`（指南查询）。

### 事件流

```jsonl
{
  "type": "tool_use_start",
  "id": "toolu_xxx",
  "toolName": "Task",
  "input": "{\"subagent_type\":\"Explore\",\"description\":\"分析代码质量\",\"prompt\":\"详细分析 src/lib/ 下的代码质量...\"}"
}

// 子代理运行可能耗时较长（30s-2min）

{
  "type": "tool_use_end",
  "id": "toolu_xxx",
  "output": "分析结果：...",  // 子代理的完整输出（可能很长）
  "status": "completed"
}
```

### Input JSON 结构

```typescript
interface TaskInput {
  subagent_type: 'Explore' | 'Plan' | 'Bash' | 'general-purpose' | 'claude-code-guide';
  description: string;  // 3-5 词简述
  prompt: string;       // 详细任务描述
  model?: string;       // 可选：指定子代理模型
  run_in_background?: boolean; // 后台运行
}
```

### 前端行为

- 蓝色卡片，显示子代理类型标签（带颜色编码）和描述
- 运行中：脉冲进度条动画
- 完成后：输出预览（前 200 字符），点击展开查看完整 prompt 和 output
- 子代理内部的工具调用链不可见（受限于 CLI 事件流粒度）

---

## 4. 危险命令检测

**文件**: `src/lib/danger-detector.ts`, `src/components/danger-warning.tsx`

### 问题

`--dangerously-skip-permissions` 模式下，所有 Bash 命令自动执行，包括破坏性操作。我们无法在执行前拦截（看到 `tool_use_start` 时命令已经在跑），但可以：

1. **检测**: 命令匹配危险模式时立即发出警告
2. **自动停止**: `critical` 级别命令触发 SIGTERM 终止进程

### 危险等级

| 等级 | 行为 | 示例 |
|------|------|------|
| `critical` | 自动 SIGTERM 停止进程 + 红色警告 | `rm -rf /`, `git push --force`, `git reset --hard`, `DROP TABLE` |
| `warning` | 橙色通知，不停止 | `git push`, `git clean -fd`, `npm publish`, `kill -9` |

### 事件类型

```typescript
{
  type: 'dangerous_tool_warning';
  toolCallId: string;   // 对应的 tool_use id
  toolName: string;     // 'Bash'
  command: string;      // 原始命令 JSON
  reason: string;       // 中文原因描述
  level: 'warning' | 'critical';
}
```

### 前端行为

- 警告横幅显示在消息列表上方
- `critical`: 红色横幅 + "危险操作已自动拦截" + "进程已停止"
- `warning`: 橙色横幅 + "检测到敏感操作"
- 可通过 X 按钮关闭
- 切换任务时自动清除

### 局限性

- 基于模式匹配，可能有误报/漏报
- `critical` 自动停止有竞态：命令可能在 SIGTERM 前已部分执行
- 不能替代真正的权限审批系统

---

## 5. MCP 工具

### Claude Code 行为

Claude Code 连接 MCP 服务器后，MCP 工具与内置工具以相同格式出现在事件流中。工具名格式为 `mcp__serverName__toolName`。

### 事件流

```jsonl
{
  "type": "tool_use_start",
  "id": "toolu_xxx",
  "toolName": "mcp__pencil__batch_design",
  "input": "{...}"
}
```

### 前端行为

- 工具名解析：`mcp__pencil__batch_design` → 显示为 `pencil/batch_design`
- 紫色 "MCP" 标签
- 插头图标（Plug）替代默认终端图标
- 其余展示与通用工具卡片相同

---

## 6. EnterPlanMode / ExitPlanMode

### Claude Code 行为

Claude Code 有内置的计划模式切换。AI 可以调用 `EnterPlanMode` 进入规划模式（只规划不执行），然后用 `ExitPlanMode` 请求用户审批计划。

**当前处理**: 作为普通工具卡片显示（剪贴板图标）。不与我们的 Phase 3 规划阶段冲突，因为这是 Claude 自发的行为。

### 未来可能的增强

- 检测 `EnterPlanMode` → 在 UI 中显示"AI 进入规划模式"指示器
- 检测 `ExitPlanMode` → 显示计划审批 UI

---

## 7. 其他内置工具图标映射

| 工具名 | 图标 | 说明 |
|--------|------|------|
| Bash | Terminal | 命令行执行 |
| Read | FileText | 文件读取 |
| Edit | Pencil | 文件编辑 |
| Write | Pencil | 文件写入 |
| Glob | Search | 文件搜索 |
| Grep | Search | 内容搜索 |
| WebFetch | Globe | HTTP 请求 |
| WebSearch | Globe | 网页搜索 |
| NotebookEdit | FileText | Jupyter 编辑 |
| Task | Blocks | 子代理 |
| AskUserQuestion | MessageCircleQuestion | 向用户提问 |
| TodoWrite | ListTodo | 任务清单 |
| EnterPlanMode | ClipboardList | 进入计划模式 |
| ExitPlanMode | ClipboardList | 退出计划模式 |
| mcp__* | Plug | MCP 工具 |
| 其他 | Terminal | 默认图标 |

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/components/tool-call-card.tsx` | 工具卡片入口，按 toolName 路由到专用组件 |
| `src/components/ask-user-question-card.tsx` | AskUserQuestion 专用卡片 |
| `src/components/todo-list-card.tsx` | TodoWrite 专用卡片 |
| `src/components/subagent-card.tsx` | Task 子代理专用卡片 |
| `src/components/danger-warning.tsx` | 危险命令警告横幅 |
| `src/lib/danger-detector.ts` | 危险命令模式匹配 |
| `src/lib/claude-stream-parser.ts` | NDJSON → ChatSSEEvent 解析 |
| `src/lib/process-manager.ts` | 进程管理 + 危险检测集成 |
| `src/types/index.ts` | ChatSSEEvent 类型定义 |

---

## CLI 实测记录

### AskUserQuestion（2025-02-24）

```
模式: -p --dangerously-skip-permissions
结果: 工具被权限系统拒绝
tool_result: { is_error: true, content: "Answer questions?" }
result.permission_denials: [{ tool_name: "AskUserQuestion", ... }]
```

### TodoWrite（2025-02-24）

```
模式: -p --dangerously-skip-permissions
结果: 正常执行
tool_result: { content: "Todos have been modified successfully..." }
tool_use_result: { oldTodos: [], newTodos: [...] }
```
