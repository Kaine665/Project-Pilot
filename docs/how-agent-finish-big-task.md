# 如何让 Agent 把一整件大事做完

> 关联：`docs/roadmap.md`、`docs/ai-task-workflow.md`、`docs/解决agent任务冲突问题的三个策略.md`、`docs/任务如何省token.md`
>
> 创建日期：2026-04-08

---

## 问题定义

"让 agent 一次做完一个大功能或大重构"——这件事现在做不好，不是因为缺一个功能，而是因为**大任务天然超出了单次 agent 执行的能力边界**。

具体来说，agent 做大事会碰到五面墙：

| # | 瓶颈 | 本质 | 当前状态 |
|---|------|------|---------|
| 1 | **上下文窗口** | 大功能涉及的文件、依赖、业务逻辑超过单次上下文能容纳的量 | 无解——模型物理限制 |
| 2 | **执行可靠性** | 步骤越多，某一步出错的概率越高，错误会级联 | Session Health Guard 仅重试一次 |
| 3 | **方向漂移** | 执行中 agent 逐渐偏离原始目标，忘记全局计划 | 有 Checkpoint 但未充分利用 |
| 4 | **状态丢失** | 跨 Turn 时 SDK resume 可能失败，历史注入有截断 | `formatConversationHistory` 上限 30 条消息 |
| 5 | **缺乏计划-执行闭环** | agent 没有"照着计划一步步执行并核对"的机制 | Run 已实现（后端），Step 暂缓 |

结论：**不是让 agent "一次做完"，而是让系统把大事拆成 agent 能可靠完成的单元，然后自动串起来。**

---

## 核心思路：三层架构

```
┌─────────────────────────────────────────┐
│  第三层：Orchestrator（编排层）           │  ← 新能力
│  把大事分解、排序、分派、监控、汇总        │
├─────────────────────────────────────────┤
│  第二层：Run（执行层）                    │  ← 已有雏形（B4）
│  一个明确目标的尝试，可跨多个 Turn         │
├─────────────────────────────────────────┤
│  第一层：Turn（回合层）                   │  ← 已完成
│  一次用户消息 → agent 回复                │
└─────────────────────────────────────────┘
```

大任务的完成路径：

```
大功能
  → Orchestrator 分解为 N 个子目标
    → 每个子目标对应一个 Run
      → 每个 Run 内 agent 自主完成（可多 Turn）
    → Run 完成后 Orchestrator 检查结果、决定下一步
  → 所有 Run 完成 → 汇总结果
```

---

## 方案分层

### 第零层：让单次执行更可靠（加固地基）

这是投入最小、收益最直接的改进，不需要新概念。

#### 0.1 更好的系统提示工程

**问题**：agent 做复杂任务时容易迷失方向，不知道自己做到哪了。

**方案**：在系统提示中注入结构化的执行框架：

```
你正在执行一个多步骤任务。请遵循以下工作流：

1. 在开始前，先列出你要做的所有步骤（numbered list）
2. 每完成一步，明确报告 "✅ 步骤 N 完成：{摘要}"
3. 如果某步遇到问题，先报告问题再决定是否继续
4. 所有步骤完成后，给出总结
```

**投入**：改 prompt template。
**效果**：agent 自我追踪进度，减少方向漂移。

#### 0.2 更长的对话历史保留

**问题**：`formatConversationHistory` 上限 30 条消息，大任务中前面的上下文容易丢失。

**方案**：
- 利用已有的 `SessionCheckpoint` 机制，在关键节点保存压缩摘要
- agent action 中已有 `<save-checkpoint>`，让 prompt 引导 agent 在完成重要步骤后主动保存 checkpoint
- checkpoint 内容在下次 Turn 开始时注入，替代原始历史

**投入**：改 prompt + 调优 checkpoint 注入逻辑。
**效果**：跨 Turn 时 agent 不丢失关键上下文。

#### 0.3 失败重试增强

**问题**：Session Health Guard 只重试一次，且当前未接线。

**方案**：
- 接线 `session-health-guard.ts`（当前没有调用者）
- 扩展重试策略：区分瞬态错误（网络/速率限制）和永久错误（代码 bug）
- 瞬态错误自动重试（退避），永久错误报告给用户

**投入**：接线现有代码 + 扩展重试逻辑。
**效果**：减少因偶发错误导致的中断。

---

### 第一层：Plan → Execute → Verify 循环（最大杠杆）

这是**投入产出比最高**的一层。不需要全新的编排系统，只需要让 agent 自己能"照着计划做事并验证"。

#### 1.1 计划制定阶段

**原理**：大任务拆成子步骤，agent 在真正动手前先输出一份结构化计划。

```typescript
interface ExecutionPlan {
  goal: string;
  steps: Array<{
    id: string;
    description: string;
    verification: string;  // 怎么验证这一步做对了
    dependsOn?: string[];  // 前置步骤
  }>;
  risks: string[];
  estimatedScope: string;  // 'small' | 'medium' | 'large'
}
```

**实现方式**：纯 prompt 驱动。在系统提示中：

```
当用户给你一个涉及多个文件或多个步骤的任务时：

1. 先输出 <execution-plan> 标签，包含：
   - 总目标
   - 分步骤（每步有验证标准）
   - 风险点
2. 等用户确认后再开始执行
3. 对于你评估为低风险的任务，可以直接执行不等确认
```

**与现有系统的关系**：
- 旧 Task Worker 有 Phase 系统（understanding → planning → executing → summarizing），但那套已不活跃
- Agent Chat 路径没有阶段概念，这里通过 prompt 软实现，不需要新增 Phase 基础设施
- 计划的结构化输出可以通过 agent action 解析保存，未来用于 Step 机制（B5）

#### 1.2 步骤级执行与自检

**原理**：agent 按计划逐步执行，每完成一步自己验证。

**实现**：prompt 中注入自检指令：

```
执行计划中的每一步时：
1. 宣布正在执行哪一步
2. 完成后，执行该步的验证标准
3. 验证通过 → 继续下一步
4. 验证失败 → 尝试修复（最多 2 次），仍失败则报告并暂停
```

**自检手段（按任务类型）**：
- 代码修改 → TypeScript 编译（`tsc --noEmit`）
- API 修改 → 运行相关测试
- 配置修改 → 验证配置加载
- 文件结构 → `ls` 确认文件存在

**agent 可调用的验证工具**：不需要新建工具——Claude Agent SDK / Codex 已经有 Bash、Read、Write 等本地工具。agent 自然可以运行 `tsc`、`npm test`、`ls` 来验证。关键是 prompt 里引导它去做。

#### 1.3 进度持久化

**与 Execution 模型的关系**：

B4（Run 生命周期）已经落地：
- `ExecutionEvent` JSONL 记录每个 Turn 的动作
- `ExecutionRun` 可以跨多个 Turn

需要补充的：
- agent 在执行计划时，通过 `<save-checkpoint>` 保存当前进度
- checkpoint 内容：已完成步骤列表 + 当前步骤 + 关键发现
- 如果会话中断（网络/重启），恢复时注入 checkpoint，agent 从断点继续

```
checkpoint 示例：
---
计划：重构 agent-chat-manager.ts
已完成：
  ✅ 步骤 1：提取 buildResourcePrompt 为独立函数
  ✅ 步骤 2：提取 consumeRunnerStream 为独立函数
当前：步骤 3 — 提取 finalizeRun 为独立函数
关键发现：finalizeRun 依赖 actionRegistry.processResponse，不能简单提取
---
```

---

### 第二层：多 Run 编排（Orchestrator）

当任务大到一个 Run 做不完时，需要一个编排层。

#### 2.1 编排 Agent：用 Agent 编排 Agent

**原理**：一个"编排 Agent"负责把大任务拆成子 Run，然后分派给"执行 Agent"。

```
用户："重构整个 API 层，从 Express 迁移到 Hono"

编排 Agent：
  1. 分析任务 → 拆成子目标：
     - Run 1: 安装 Hono + 建立基础路由框架
     - Run 2: 迁移 /api/agents 路由
     - Run 3: 迁移 /api/agent-chat 路由
     - ...
     - Run N: 删除 Express 依赖 + 回归测试
  2. 按依赖关系排序
  3. 逐个启动 Run（串行或并行）
  4. 每个 Run 完成后检查结果
  5. 全部完成后汇总
```

**与现有系统的关系**：

ProjectPilot 已经有 sub-agent 机制：
- `sub-agent-watcher.ts` 监控子 agent
- `awaiting` 状态（Run 等待子 agent 完成）
- session 有 `parentSessionId`

但当前的 sub-agent 更像"旁听"（Guest Agent），不是真正的"编排→执行"关系。

**实现路径**：

```typescript
// 扩展 AgentChatSession
interface AgentChatSession {
  // ...existing fields
  orchestration?: {
    parentRunId?: string;     // 这个 session 是哪个 Run 创建的
    childSessionIds: string[]; // 编排 agent 创建的子 session
    plan: OrchestrationPlan;   // 编排计划
  };
}

interface OrchestrationPlan {
  goal: string;
  runs: Array<{
    id: string;
    goal: string;
    status: 'pending' | 'active' | 'completed' | 'failed';
    sessionId?: string;  // 实际执行的 session
    dependsOn?: string[];
    result?: string;
  }>;
}
```

#### 2.2 续接 vs 新建 Session

路线图 C2 提到的问题：`Trigger fire 时查找已有 Session 而非总开新的`。

对于编排场景，这个问题更突出：
- 编排 Agent 需要在多个 Run 之间保持上下文
- 每个子 Run 完成后，结果需要回流到编排 Agent
- 编排 Agent 根据结果决定下一步

**方案**：编排 Agent 自己是一个长期 Session。它通过 API 创建子 Session（子 Run），子 Run 完成后通过回调通知编排 Session。

```
编排 Session（长期活跃）
  ├── 创建子 Session A（Run 1）→ 完成 → 结果回流
  ├── 创建子 Session B（Run 2）→ 完成 → 结果回流
  └── ...
  → 所有子 Run 完成 → 编排 Agent 汇总并报告
```

---

### 第三层：自主循环（长期愿景）

这是最远期的目标，但值得提前思考方向。

#### 3.1 Objective → Task → Run 层级

```
Objective（战略目标）: "完成 v2 架构迁移"
  ├── Task 1: "API 层迁移到 Hono"
  │     ├── Run 1.1: 基础框架
  │     ├── Run 1.2: 路由迁移
  │     └── Run 1.3: 回归测试
  ├── Task 2: "前端迁移到 Vite SPA"
  │     └── ...
  └── Task 3: "删除 Next.js 依赖"
        └── ...
```

与路线图的对应关系：
- E3（Objective）→ 战略目标层
- A4/D1（Todo → Task 对齐）→ 任务层
- B3/B4（Run）→ 执行层
- B5（Step）→ 步骤层

#### 3.2 跨会话记忆

路线图 E1（Memory / Profile）的延伸。

agent 在做大任务的过程中积累的认知（代码结构理解、踩过的坑、做过的决定），需要跨 Session 持久化。这样下一个 Run 启动时不用从零开始"认识代码库"。

与 `docs/任务如何省token.md` 的关系：
- 方案二（项目级摘要注入）→ 静态知识
- 方案三（模块级缓存）→ 动态认知
- 跨会话记忆 → 两者的结合，从 ExecutionEvent 中自动提取

---

## 实施优先级

```
投入产出比
  ▲
  │
  │  ★ 0.1 提示工程          ← 零代码改动，立即见效
  │  ★ 1.1 计划制定           ← prompt + 简单 action，高杠杆
  │  ★ 0.2 Checkpoint 利用    ← 改优已有机制
  │
  │  ■ 1.2 步骤自检           ← prompt + 验证引导
  │  ■ 0.3 重试增强           ← 接线现有代码
  │  ■ 1.3 进度持久化         ← 利用 Event/Run 机制
  │
  │  ● 2.1 编排 Agent         ← 需要新的 session 关联机制
  │  ● 2.2 续接 Session       ← 路线图 C2
  │
  │  ○ 3.1 Objective 层级     ← 远期
  │  ○ 3.2 跨会话记忆         ← 远期
  │
  └──────────────────────────────────→ 实施复杂度
```

### 建议的实施批次

**第一批：提示工程 + 计划制定（改 prompt，不改代码）**

1. 设计一套"大任务系统提示模板"，引导 agent：
   - 收到大任务先制定计划
   - 逐步执行并自检
   - 主动保存 checkpoint
2. 在 Agent 配置中增加一个 preset 或 resource，让用户可以给特定 agent 启用"大任务模式"
3. 用 `<execution-plan>` action 捕获计划结构

**第二批：基础设施加固**

1. 接线 Session Health Guard
2. 优化 checkpoint 注入（利用已有 `SessionCheckpoint`）
3. 增加 "resume from checkpoint" 的 prompt 模板

**第三批：多 Run 编排**

1. 实现编排 Session 与子 Session 的关联
2. 编排 Agent 的系统提示模板
3. 子 Run 结果回流机制
4. 前端展示编排进度

---

## 关键认知

### 为什么不能"一次做完"

1. **模型窗口有限**：即使是 200k token 的窗口，一个涉及 30+ 文件的大重构也会撑爆
2. **错误累积**：执行 20 步，即使每步 95% 成功率，全部成功的概率只有 36%
3. **人的不可替代性**：大任务的方向性决策（做不做、怎么拆、优先级）需要人判断

### 系统应该做什么

系统不是要替代人做决策，而是：
1. **降低每次执行的失败率**（更好的 prompt、自检、重试）
2. **保持跨执行的连续性**（checkpoint、记忆、进度追踪）
3. **自动化串联**（编排 agent 按计划分派和汇总）
4. **在出问题时及时暴露**（而不是默默做错 10 步后才发现）

### 与现有路线图的关系

| 路线图任务 | 与本方案的关系 |
|-----------|--------------|
| B5 Step 声明 | 第一层：步骤级执行的结构化基础 |
| C2 续接 Session | 第二层：编排 agent 需要续接子 Session |
| D2 Task↔Run 关联 | 第二层：编排计划中的子目标对应 Run |
| D3 任务依赖关系 | 第二层：编排计划中的步骤依赖 |
| E1 跨会话记忆 | 第三层：跨 Run 的认知持久化 |
| E3 战略目标 | 第三层：Objective 层 |

---

## 变更记录

| 日期 | 内容 |
|------|------|
| 2026-04-08 | 初版：从"如何让 agent 做完大事"的问题出发，分析瓶颈并设计三层方案 |
