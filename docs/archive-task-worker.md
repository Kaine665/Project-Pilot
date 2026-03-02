# Task Worker（任务代理）归档文档

> **归档日期**: 2026-03-01
> **归档原因**: 功能弃用，代码已从 dev 分支移除
> **相关 PR**: N/A（直接在 dev 分支清理）

本文档完整记录了 Task Worker（任务代理）的架构设计、实现细节和所有相关文件，作为历史存档供未来参考。

---

## 一、概述

Task Worker 是 ProjectPilot 的**结构化任务执行系统**，通过五阶段工作流（5-Phase Workflow）驱动 AI 完成编程任务。与轻量级的 Agent Chat（自由对话）不同，Task Worker 强制 AI 按固定流程推进：先理解任务、再制定计划、最后执行和总结。

核心特性：
- **五阶段工作流**: branching → understanding → planning → executing → summarizing
- **四要素任务理解**: 项目、做什么、为什么做、交付物
- **Git Worktree 隔离**: 每个任务在独立的 git worktree 中执行
- **结构化产物提取**: 从 AI 回复中自动提取 understanding / plan / result
- **阶段权限控制**: Phase 1-2 无工具权限，Phase 3-5 完整权限
- **自动阶段推进**: 提取到产物后自动进入下一阶段
- **自动合并**: 任务完成后自动将分支合并回目标分支
- **中断恢复**: 检测被中断的会话并支持恢复

---

## 二、架构设计

### 2.1 执行模式判定

通过 Agent 的 `executionMode` 字段判断执行路径：

```
executionMode = 'task'  → ChatPanel → ProcessManager → buildPrompt() + git worktree + phases
executionMode = 'chat'  → AgentChatPanel → AgentChatManager → agent.systemPrompt 直接对话
```

Task Worker 是唯一 `executionMode='task'` 的 Agent。`buildPrompt()` 是 Task Worker 专有基建，自定义 Agent 无法使用。

### 2.2 类继承关系

```
BaseChatManager<TRun extends BaseRun>     (base-chat-manager.ts)
  ├── ProcessManager<ProcessRun>           (process-manager.ts) ← Task Worker
  └── AgentChatManager<AgentChatRun>       (agent-chat-manager.ts) ← Agent Chat
```

### 2.3 数据流

```
用户发送消息 → POST /api/ai-chat
  → ProcessManager.start()
    → 加载任务数据、项目配置、Agent 能力
    → Phase 0? → runBranchingPhase() → 创建 git worktree → 进入 understanding
    → 构建 prompt (buildPrompt) → spawn claude 子进程
    → SSE 事件流 → GET /api/ai-chat/stream
    → 进程退出 → 提取产物 (understanding/plan/result)
    → 自动推进阶段 → 保存对话历史
    → 如果 result.status='completed' → 自动合并分支
```

---

## 三、五阶段工作流

### Phase 0: branching（分支创建）

- **触发条件**: 任务有 `projectKey` 且 `phase='branching'`
- **行为**: 调用 Claude 生成 kebab-case 分支名 slug → 创建 git worktree
- **产物格式**:
  ```json:branch
  { "slug": "fix-login-redirect" }
  ```
- **权限**: 无工具权限（`-p` 模式，不传 `--dangerously-skip-permissions`）
- **自动推进**: 提取到 slug 后自动进入 `understanding`

### Phase 1-2: understanding（理解任务）

- **触发条件**: `phase='understanding'`
- **行为**: AI 确认任务四要素（哪个项目、做什么、为什么、交付物）
- **四要素来源**:
  - 从链路发起：FlowTaskContext 自动采集（项目、任务内容、流程/环节信息）
  - 手动创建：仅任务标题 + 可选项目
- **缺口检测**: AI 识别不清楚的要素，推断或向用户提问
- **产物格式**:
  ```json:understanding
  {
    "project": "项目名",
    "action": "具体要做的事",
    "goal": "上层目标/为什么做",
    "deliverable": "交付物描述",
    "branchSlug": "fix-login-button"
  }
  ```
- **权限**: 无工具权限
- **自动推进**: 提取到 understanding 后进入 `planning`

### Phase 3: planning（制定计划）

- **触发条件**: `phase='planning'`
- **行为**: AI 制定执行计划，有完整工具权限（可阅读代码）
- **审核机制**: AI 自行判断是否需要用户审核
- **产物格式**:
  ```json:plan
  {
    "analysis": "任务分析",
    "steps": [
      { "id": 1, "type": "auto", "action": "步骤名", "description": "说明", "status": "pending", "risk_level": "low" }
    ],
    "expected_results": "预期结果",
    "risks": "风险评估"
  }
  ```
- **权限**: `--dangerously-skip-permissions`，完整工具权限
- **自动推进**: 提取到 plan 后进入 `executing`

### Phase 4: executing（执行）

- **触发条件**: `phase='executing'`
- **行为**: AI 按计划逐步执行，所有改动在 worktree 分支上
- **权限**: 完整工具权限
- **无自动推进**: 需要 AI 输出 result 才进入 summarizing

### Phase 5: summarizing（总结）

- **触发条件**: `phase='summarizing'`
- **行为**: AI 总结执行结果，列出改动文件
- **产物格式**:
  ```json:result
  {
    "status": "completed",
    "summary": "完成情况概述",
    "files_changed": [
      { "path": "文件路径", "action": "created|modified|deleted" }
    ]
  }
  ```
- **自动合并**: 如果 `result.status='completed'`，自动合并分支回目标分支
- **权限**: 完整工具权限

### 阶段自动推进规则

```
understanding ──[提取到 json:understanding]──► planning
planning      ──[提取到 json:plan]──────────► executing
executing     ──[提取到 json:result]─────────► summarizing
```

### 阶段权限映射

| Phase | CLI flags | 工具权限 | AI 职责 |
|-------|-----------|---------|---------|
| 0 (branching) | 无额外 flag | 无 | 生成分支名 slug |
| 1-2 (understanding) | 无额外 flag | 无 | 纯文本对话，确认四要素 |
| 3 (planning) | `--dangerously-skip-permissions` | 完整 | 读代码、制定计划 |
| 4 (executing) | `--dangerously-skip-permissions` | 完整 | 执行改动 |
| 5 (summarizing) | `--dangerously-skip-permissions` | 完整 | 总结结果 |

---

## 四、重试机制

当 AI 未按格式输出产物时，系统自动重试（最多 3 次）：

1. 检测当前阶段是否需要产物但未提取到
2. 构建重试提示消息（包含格式说明）
3. 通过 `retry_needed` SSE 事件通知前端
4. 前端自动发送重试消息
5. 3 次失败后通知用户手动干预

---

## 五、Git Worktree 管理

### 创建流程

1. Phase 0 完成后，调用 `createTaskWorktree()`
2. 生成分支名: `task/{shortId}-{slug}`（如 `task/a1b2c3d4-fix-login`）
3. 从默认分支（或用户指定分支）创建 worktree
4. Worktree 路径: `{projectDir}/.worktrees/{shortId}-{safeName}`
5. 自动将 `.worktrees/` 添加到 `.gitignore`

### 合并流程

1. 任务完成（result.status='completed'）时触发 `autoMergeBranch()`
2. 移除 worktree → checkout 目标分支 → merge 任务分支 → 删除任务分支
3. 合并失败通过 SSE 事件通知前端

### 清理

- `onStop()` 时清理 worktree
- 任务删除时清理 worktree

---

## 六、Prompt Builder

`prompt-builder.ts` 负责构建 Task Worker 的完整 prompt：

### 结构

```
Section 1: 系统身份 + 工作流指令（buildSystemInstructions）
Section 2: 任务四要素上下文（buildTaskContext）
Section 2.5: 阶段提醒（buildPhaseReminder）
Section 3: Git 分支状态
Section 4: 输出格式说明（buildPlanFormatInstructions）
Section 5: 对话历史
Section 6: 用户最新消息
```

各 Section 用 `---` 分隔。

### 系统指令核心内容

- Phase 1-5 完整行为指令
- 四要素推导规则（从 FlowTaskContext 推导）
- 对话规则（中文回复、等待用户输入、先告知再行动）
- 严禁事项（不修改 ProjectPilot 自身数据、不调用 ProjectPilot API）

### 四要素注入

根据是否有 FlowTaskContext 注入不同信息：

| 四要素 | 有 flowContext | 无 flowContext |
|--------|---------------|----------------|
| 项目 | ProjectConfig 或 flowContext.projectName | projectKey 或"未指定" |
| 做什么 | 标题 + taskContent | 标题 + 描述 |
| 为什么 | flowName + nodeName + nodeDescription | "需要推断或询问用户" |
| 交付物 | AI 推断 | AI 推断 |

有 FlowTaskContext 时额外注入：同级任务、其他板块、截止日期、用户附加上下文、用户指定全局上下文。

---

## 七、产物提取器

### artifact-extractor.ts

从 AI 回复文本中提取结构化产物：

- `extractBranchSlugFromText(text)` → 提取 ` ```json:branch` 块中的 slug
- `extractUnderstandingFromText(text)` → 提取 ` ```json:understanding` 块
- `extractResultFromText(text)` → 提取 ` ```json:result` 块
- `saveUnderstanding(taskId, understanding)` → 保存到 `task-artifacts/{taskId}.json`
- `saveResult(taskId, result)` → 保存到 `task-artifacts/{taskId}.json`
- `escapeInnerQuotes(jsonStr)` → JSON 字符串内部引号转义（状态机实现）

### plan-extractor.ts

- `extractPlanFromText(text)` → 提取 ` ```json:plan` 块
- `savePlan(taskId, planData)` → 保存到 `ai-plans.json`，支持版本号管理

---

## 八、SSE 事件类型

Task Worker 通过 SSE 推送以下事件：

| 事件类型 | 说明 |
|---------|------|
| `text_delta` | AI 文本输出增量 |
| `tool_use_start` | 工具调用开始 |
| `tool_use_end` | 工具调用结束 |
| `plan_extracted` | 提取到执行计划 |
| `understanding_extracted` | 提取到任务理解 |
| `result_extracted` | 提取到执行结果 |
| `phase_changed` | 阶段推进 |
| `branch_created` | Git 分支已创建 |
| `branch_merged` | Git 分支已合并 |
| `dangerous_tool_warning` | 危险命令警告 |
| `retry_needed` | 产物提取失败，自动重试 |
| `error` | 错误信息 |
| `done` | 流结束 |

---

## 九、API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/ai-chat` | GET | 获取对话历史 |
| `/api/ai-chat` | POST | 启动 ProcessManager 执行 |
| `/api/ai-chat` | DELETE | 清空对话历史 |
| `/api/ai-chat/stream` | GET | SSE 事件流订阅 |
| `/api/ai-chat/status` | GET | 查询执行状态 |
| `/api/ai-chat/stop` | POST | 停止执行 |
| `/api/ai-chat/conversations` | GET | 对话列表 |
| `/api/ai-chat/conversations` | POST | 创建/分支对话 |
| `/api/ai-chat/conversations` | PATCH | 归档/恢复/重命名对话 |
| `/api/ai-chat/conversations` | DELETE | 永久删除对话 |
| `/api/task-artifacts` | GET | 获取产物 |
| `/api/task-artifacts` | DELETE | 清空产物 |
| `/api/recovery` | GET | 检测中断会话 |
| `/api/recovery` | POST | 恢复中断会话 |

---

## 十、UI 组件

### ChatPanel (`chat-panel.tsx`)

Task Worker 专用对话界面：
- 显示阶段标签（branching/understanding/planning/executing/summarizing）
- SSE 流式渲染 AI 回复
- 产物提取回调（onPlanExtracted/onUnderstandingExtracted/onResultExtracted）
- 阶段转换回调（onPhaseChanged）
- Phase 0 → understanding 自动重置
- 中断恢复 UI
- 危险命令警告
- 自动重试机制
- 草稿消息持久化
- 对话自动开始

### ArtifactPanel (`artifact-panel.tsx`)

右侧栏展示 Task Worker 产物：
- 任务理解（四要素）
- 执行计划（步骤列表）
- 执行结果
- Git 分支操作（合并/丢弃）

### TaskDetail (`task-detail.tsx`)

任务详情页，根据 executionMode 路由到不同组件：
- `executionMode='task'` → ChatPanel + ArtifactPanel
- `executionMode='chat'` → AgentChatPanel（无 ArtifactPanel）

---

## 十一、数据类型

### types/index.ts 中的 Task Worker 相关类型

```typescript
// 阶段枚举
type SessionPhase = 'branching' | 'understanding' | 'planning' | 'executing' | 'summarizing';

// 四要素理解
interface TaskUnderstanding {
  project: string;
  action: string;
  goal: string;
  deliverable: string;
  branchSlug?: string;
}

// 执行计划
interface AIPlan {
  plan_id: string;
  task_id: string;
  version: number;
  status: string;
  created_at: string;
  analysis: string;
  steps: PlanStep[];
  step_count: number;
  steps_completed: number;
  execution_count: number;
  expected_results?: string;
  risks?: string;
  execution_notes?: string;
}

// 执行结果
interface TaskResult {
  status: string;
  branch?: string;
  summary: string;
  files_changed?: Array<{ path: string; action: string }>;
  stats?: Record<string, unknown>;
}

// 产物聚合
interface TaskArtifacts {
  taskId: string;
  understanding?: TaskUnderstanding;
  result?: TaskResult;
  updatedAt: string;
}

// Agent 执行模式
interface Agent {
  executionMode?: 'task' | 'chat';
  // ...
}
```

### ProcessRun 类型

```typescript
interface ProcessRun extends BaseRun {
  taskId: string;
  conversationId: string;
  session: ChatSession;
}
```

---

## 十二、内置 Agent 定义

```typescript
// default-agents.ts
const TASK_WORKER_AGENT_ID = 'agent-builtin-task-worker';

const taskWorkerAgent: Agent = {
  id: TASK_WORKER_AGENT_ID,
  slug: 'task-worker',
  builtIn: true,
  name: '任务执行者',
  description: 'ProjectPilot 默认任务执行 Agent，在项目 git worktree 中完成编码、修改等具体任务',
  icon: 'bot',
  systemPrompt: TASK_WORKER_SYSTEM_PROMPT,
  executionMode: 'task',
  capabilities: {
    bash: true,
    fileAccess: true,
    web: true,
    subAgent: true,
    skipReview: true,
    todoRead: false,
    exposePromptPath: false,
  },
};
```

---

## 十三、交付物类型系统

6 种标准交付物类型，用于 Phase 1 推断：

| 类型 | 产出物 | 信号词示例 |
|------|-------|-----------|
| `ui` | React 组件、页面、样式 | 页面、组件、界面、按钮、表单 |
| `logic` | 业务逻辑函数、Hooks | 计算、校验、转换、处理 |
| `data` | 数据库表、迁移脚本 | 存储、记录、数据库 |
| `api` | API 路由、请求函数 | 接口、API、请求 |
| `infra` | 配置、CI/CD、部署 | 部署、配置、环境 |
| `analysis` | 分析报告、调研文档 | 分析、调研、评估 |

---

## 十四、FlowTaskContext 协作协议

链路→Task Worker 的上下文传递机制。当用户从项目跟踪链路的任务上点击 AI 按钮时：

1. `collectFlowTaskContext()` 从树形结构采集上下文
2. POST 创建 Session（附带 flowContext）
3. AI 开始对话时，prompt-builder 将 flowContext 注入四要素

FlowTaskContext 包含：
- 项目标识 (projectKey, projectName)
- 任务信息 (flowTaskId, taskContent)
- 板块信息 (sectionId, sectionName) 或旧格式的流程/环节信息
- 上下文增益 (同级任务, 其他板块, 截止日期)
- 用户附加上下文 (customContext)
- 全局上下文 ID (globalContextIds)

---

## 十五、被移除的文件清单

### 核心实现文件
- `src/lib/chat-managers/process-manager.ts` — ProcessManager 类
- `src/lib/process-manager.ts` — 向后兼容 re-export
- `src/lib/prompt-builder.ts` — Prompt 构建器
- `src/lib/artifact-extractor.ts` — 产物提取器
- `src/lib/plan-extractor.ts` — 计划提取器
- `src/components/chat-panel.tsx` — Task Worker 专用对话 UI

### API 路由
- `src/app/api/ai-chat/route.ts` — 执行启动 + 对话历史
- `src/app/api/ai-chat/stream/route.ts` — SSE 事件流
- `src/app/api/ai-chat/status/route.ts` — 状态查询
- `src/app/api/ai-chat/stop/route.ts` — 停止执行
- `src/app/api/task-artifacts/route.ts` — 产物 CRUD
- `src/app/api/recovery/route.ts` — 中断恢复

### 文档
- `docs/ai-task-workflow.md` — 五阶段工作流设计文档
- `docs/types/flow-task-context.md` — FlowTaskContext 协议
- `docs/types/deliverable-types.md` — 交付物类型契约
- `docs/artifact-retry.md` — 产物重试机制文档
- `docs/get-task-detail-architecture.drawio` — 架构图

### 修改的共享文件
- `src/lib/default-agents.ts` — 移除 Task Worker agent 定义和 TASK_WORKER_AGENT_ID
- `src/lib/chat-managers/index.ts` — 移除 ProcessManager 导出
- `src/types/index.ts` — 移除 Task Worker 专有类型（SessionPhase, TaskUnderstanding, AIPlan, TaskResult, TaskArtifacts 等）
- `src/components/task-detail.tsx` — 移除 ChatPanel 分支和 ArtifactPanel
- `src/app/api/tasks/route.ts` — 移除 processManager.getStatus() 调用

---

## 十六、设计反思

### 优点
- 结构化流程确保 AI 不会盲目开干
- 四要素框架帮助 AI 全面理解任务
- Git worktree 隔离保证安全
- 产物自动提取减少人工操作

### 不足（导致弃用的原因）
- 五阶段流程过于刚性，简单任务也要走完整流程
- 产物格式提取脆弱，AI 输出不规范时需要多次重试
- 阶段权限切换导致 AI 在理解阶段无法查看代码
- 与 Agent Chat 模式共存增加了系统复杂度
- ProcessManager 和 AgentChatManager 的继承关系导致耦合

---

*本文档由 AI 助手于 2026-03-01 生成，基于被移除代码的完整阅读和分析。*
