# AI 会话工作流设计

> **关联类型**: `src/types/index.ts`（Session、TaskUnderstanding、SessionArtifacts）
> **关联类型**: `src/types/flow-context.ts`（FlowTaskContext）
> **关联类型**: `src/types/deliverable.ts`（DeliverableInference）
> **关联协议**: `docs/types/flow-task-context.md`（链路→Pilot 协作协议）
> **关联文档**: `docs/types/deliverable-types.md`（交付物类型）

## 核心概念

### Session（会话）

**Session** 是 Task Agent 的顶层容器，用户点击 AI 按钮即创建。
Session 是独立的执行单元，**Session 之间没有父子关系**。任务之间的关系（前置、并行、嵌套）全部由项目跟踪链路的树形结构管理，不带入 Task Agent。Session 在创建时通过 FlowTaskContext 拿一次上下文快照，之后独立运行。

> **ProjectPilot** 是整体应用名称，包含**项目跟踪链路**（管理任务关系）和 **Task Agent**（AI 会话执行）两个模块。

Session 本身只是一个轻量壳子，真正有意义的是它在各 Phase 中产出的平级产物：

```
Session（会话容器，点击即创建）
  ├── TaskUnderstanding  ← Phase 1 产物：任务理解（四要素）
  ├── DeliverableInference ← Phase 1 附带产物：交付物推断
  ├── AIPlan             ← Phase 3 产物：执行计划
  └── TaskResult         ← Phase 5 产物：执行结果
```

> **注意**：Session 中的"任务理解"（TaskUnderstanding）和链路中的"任务"（Flow Task）是不同的东西。
> Flow Task 是链路中的短语条目（如"开发者回复通知"），TaskUnderstanding 是 AI 产出的四要素结构化理解。

### 信息来源

Session 有两种创建方式，信息丰富度不同：

| 来源 | 上下文 | 信息丰富度 |
|------|--------|-----------|
| **从链路发起** | FlowTaskContext 自动采集项目、流程、环节、同级任务等 | 高（三个半要素自动填充） |
| **手动创建** | 仅标题 + 可选的项目 | 低（AI 需推断大部分信息） |

---

## 核心原则

**先用已有信息缩小范围，再问用户补齐剩余的关键信息。不该问废话，也不该盲目开干。**

- 从链路发起时，FlowTaskContext 能自动填充的就自动填充，填不了的必须追问，不能跳过
- 手动创建时，从任务标题、项目信息中推断，不够再问
- 不管哪种来源，AI 都必须向用户确认理解后才能推进

---

## 流程阶段

### Phase 1: 确定任务四要素

AI 拿到会话后，必须从四个角度理解任务，不清楚就没法开始：

1. **哪个项目** — 决定了工作范围和环境
2. **具体做什么** — 任务的动作是什么（分析数据？改代码？写文档？）
3. **为什么做** — 上层目标，决定了方向
4. **交付物是什么** — 产出的形式和类型组合

#### 从链路发起时的四要素映射

当 Session 携带 `flowContext` 时，四要素可以这样推导：

| 四要素 | 推导方式 |
|--------|---------|
| **项目** | `projectKey` + `projectName` → 直接确定 |
| **做什么** | `taskContent` → 任务短语（仍需 AI 展开细节） |
| **为什么** | `flowName` + `nodeName` + `nodeDescription` → 拼成目标链 |
| **交付物** | AI 根据 taskContent + 项目类型 + 信号词推断（见 `deliverable-types.md`） |

此外，FlowTaskContext 还提供增益信息：
- **siblingTasks**：已完成的同级任务说明哪些相关功能已存在
- **predecessorNodes**：前置环节说明用户旅程中之前发生了什么
- **crossCutting**：全局约束影响实现方案
- **cycleDeadline**：时间压力影响方案选择

#### 手动创建时的信息来源

| 四要素 | 信息来源 |
|--------|---------|
| **项目** | `Session.projectKey`（可能为空） |
| **做什么** | `Session.title`（通常只有短语） |
| **为什么** | 无直接来源，需 AI 推断或追问 |
| **交付物** | AI 推断 |

**不在这个阶段做的事**：读代码、查对话历史、分析技术栈。这些是执行时按需获取的。

### Phase 2: 识别缺口 → 推断或提问

基于四要素，判断哪些还不清楚。**不管四要素是否齐全，AI 都必须在推进前向用户确认理解。**

#### 缺口类型

| 缺口 | 何时出现 | 追问方式 |
|------|---------|---------|
| **taskContent 太模糊** | 任务短语无法确定具体范围 | 带选项提问："开发者回复通知"是指：(A) 应用内红点提示 (B) 系统推送通知 (C) 两者都要？ |
| **nodeDescription 是默认值** | 用户没填环节描述 | 推断后审查："我理解这个环节是…，对吗？" |
| **交付物不确定** | 推断 confidence 为 low/medium | 带选项确认："预计产出是 UI 组件 + 后端逻辑，还是还需要数据库变更？" |
| **技术约束不明** | crossCutting 没覆盖到的约束 | 针对性提问："通知需要用现有的消息系统，还是从零搭建？" |
| **scope 边界不清** | 无法判断功能到哪里为止 | 带选项提问："这个任务包不包括通知已读/未读状态管理？" |
| **前置依赖未就绪** | predecessorNodes 中有 planned 状态 | 主动告知："前置环节 X 还没完成，是否需要先做那个？" |

#### 追问原则

1. **不问能从上下文推断的**：项目是什么、目标是什么 — 链路已经给了
2. **不问泛泛的开放题**：不要问"你能详细描述一下吗？"
3. **优先推断后让用户确认**：给出 AI 的判断，让用户说对或不对
4. **一次最多问 2 个缺口**：多了用户会烦，少了效率低
5. **把选项从上下文里提取出来**：如果 crossCutting 里有"推送系统"，直接拿来当选项

#### 信息存储

用户的回答不修改 FlowTaskContext（它是创建时的快照），而是存入对话记录和 TaskUnderstanding：

```
FlowTaskContext（不变）     用户回答（对话中）      TaskUnderstanding（AI 产出）
─────────────────────     ──────────────────     ─────────────────────────
taskContent: "开发者      "应用内红点就行，        project: "ELApp"
  回复通知"                不需要系统推送"          action: "在反馈详情页添加
flowName: "反馈流程"                                 开发者回复的应用内通知提示"
nodeName: "提交后"            ──────┐              goal: "完成反馈闭环"
...                                │              deliverable: "通知红点组件
                                   └───────────►    + 通知查询逻辑 + 通知表"
                                                  deliverableInference: {
                                                    types: ['ui','logic','data']
                                                    confidence: 'high'
                                                  }
```

### Phase 3: 制定计划（不一定需要用户审核）

AI 制定执行计划，但**是否需要用户审核取决于 AI 的判断**：

- **自己能办好、风险不大** → 直接执行，不等用户审核
- **有风险、不确定、涉及破坏性操作** → 展示计划，等用户确认后再执行

计划内容：
- 拆解步骤
- 评估风险和依赖

**注意**：不管是否审核，计划都会保存并在前端侧栏展示，作为过程记录。

### Phase 4: 执行

**第一步：创建一次性 git 分支**
- 从当前分支（或用户指定的合并目标分支）拉出一个临时分支
- 所有改动在此分支上进行
- 分支命名：`session/{sessionId}-{简短描述}` 或类似格式

**执行过程**：
- 按计划逐步执行
- 执行过程中按需获取所需信息（读代码、查文件、分析结构等）
- 每步执行前简要说明要做什么
- 工具调用实时显示
- 遇到意外情况暂停，向用户报告

### Phase 5: 总结与合并

执行完成后：
- 报告完成情况
- 列出改动的文件
- 输出结构化的执行结果（`json:result`）

**用户决定是否合并**：
- 用户审查结果后，决定是否将分支合并到目标分支
- 合并目标分支：用户指定，未指定则用默认分支（main 或 master）
- 不合并 → 分支保留，用户可以后续处理

**链路侧状态回写**（从链路发起时）：
- Session doing → Flow Task wip
- Session done → Flow Task done

---

## 交付物推断

AI 在 Phase 1 中需要推断任务的交付物类型。

### 交付物类型

6 种标准类型（详见 `docs/types/deliverable-types.md`）：

| 类型 | 产出物 | 信号词示例 |
|------|-------|-----------|
| `ui` | React 组件、页面、样式 | 页面、组件、界面、按钮、表单 |
| `logic` | 业务逻辑函数、Hooks | 计算、校验、转换、处理、过滤 |
| `data` | 数据库表、迁移脚本 | 存储、记录、数据库、持久化 |
| `api` | API 路由、请求函数 | 接口、API、请求、端点 |
| `infra` | 配置、CI/CD、部署 | 部署、配置、环境、CI |
| `analysis` | 分析报告、调研文档 | 分析、调研、评估、诊断 |

### 推断规则

1. **信号词匹配**：从 taskContent 中提取信号词
2. **同级上下文**：siblingTasks 中已完成的任务暗示已有的基建
3. **项目类型约束**：如 React Native 项目不会有 `api` 类型（移动端不做后端路由）
4. **默认兜底**：无法判断时给 `['logic']`，confidence 为 `low`

推断结果存入 `TaskUnderstanding.deliverableInference`。

---

## 示例

### 示例 1：从链路发起 —"开发者回复通知"

**背景**：ELApp 项目，反馈流程 → 提交后环节 → "开发者回复通知"任务

**Phase 1 - 四要素推导**：

FlowTaskContext 提供：
- projectKey: `elapp`，projectName: `ELApp`
- taskContent: `开发者回复通知`
- flowName: `反馈流程`，nodeName: `提交后`，nodeDescription: `提交后的跟进和闭环`
- siblingTasks: `[{content: "查看历史反馈记录", status: "done"}]`
- crossCutting: `[{name: "推送系统", status: "planned"}]`

四要素映射：
- **项目**：ELApp（React Native 英语学习应用）✓
- **做什么**：开发者回复通知 — 不清楚是应用内通知还是系统推送 ✗
- **为什么**：反馈流程 → 提交后 → 跟进和闭环 ✓
- **交付物**：推断 `['ui', 'logic']`，confidence: `medium` — 可能还需要 `data` ✗

**Phase 2 - 缺口检测**：

两个缺口需要追问：
1. 通知类型不明 + crossCutting 有"推送系统 planned"
2. 交付物推断 confidence 不高

> AI："'开发者回复通知'是指：
> (A) 应用内红点提示（不依赖推送系统）
> (B) 系统推送通知（需要等推送系统基建）
> (C) 两者都做
>
> 另外，这个功能需要新建通知数据表，还是复用现有的？"

用户回答："应用内红点就行，不需要推送。需要新建通知表。"

AI 确认理解：
> "我理解这个任务是：在 ELApp 的反馈详情页添加开发者回复的应用内红点通知提示，包含通知红点 UI 组件、通知查询逻辑和新建通知数据表。目标是完成反馈闭环。对吗？"

产出 TaskUnderstanding：
```json
{
  "project": "ELApp",
  "action": "在反馈详情页添加开发者回复的应用内通知提示",
  "goal": "完成反馈流程的跟进闭环",
  "deliverable": "通知红点组件 + 通知查询逻辑 + 通知表",
  "deliverableInference": {
    "types": ["ui", "logic", "data"],
    "confidence": "high",
    "summary": "红点 UI 组件 + 未读查询 Hook + notifications 表"
  }
}
```

**Phase 3+**：制定计划，执行时再去读代码、查数据库结构等。

### 示例 2：手动创建 —"查看历史反馈记录"

**背景**：用户在 Session 列表中手动创建，标题为"查看历史反馈记录"，选择了项目 ELApp。

**Phase 1 - 确定四要素**：
- **哪个项目**：ELApp（React Native 英语学习应用）✓
- **具体做什么**：不明确 ✗ — "查看"是拉数据分析？还是看代码逻辑？
- **为什么做**：不明确 ✗ — 没有链路上下文，无法推断上层目标
- **交付物**：不明确 ✗ — 产出是一份分析报告？还是代码变更？

**Phase 2 - 推断后审查**：
> "这个任务是在 ELApp 中查看历史反馈记录。我理解你是要从 Supabase 拉取历史反馈数据，汇总分析后给出优化建议，对吗？"

或者（如果无法推断）**带选项提问**：
> "你需要我：
> 1. 从数据库拉取反馈数据做汇总分析？
> 2. 检查反馈功能的代码实现？
> 3. 其他？"

**Phase 3+**：确认理解后制定计划，执行时再去读代码、查数据库结构等。

---

## 实现状态

### Session 数据模型 ✅

`src/types/index.ts`（节选；**Agent Chat 会话以 `src/types/agent-chat.ts` 为准**）：
- **LegacyTaskWorkerSession**（曾用名 **Session**，现为 @deprecated 类型别名）— 历史 Task Worker 会话容器，可含 `flowContext?: FlowTaskContext` 等
- **SessionPhase** — `'understanding' | 'planning' | 'executing' | 'summarizing'`，工作流阶段
- **TaskUnderstanding** — Phase 1 产物（四要素 + `deliverableInference`）
- **SessionArtifacts** — 各 Phase 产物的聚合视图
- **ChatSSEEvent** — 新增 `phase_changed` 事件类型
- 历史叙述中或曾有别名 `Task` / `TasksData` 与 `LegacyTaskWorkerSession` / `LegacyTaskWorkerSessionsData` 对应；**当前代码不再导出 `Session` / `SessionsData` 别名**

### FlowTaskContext 类型定义 ✅

`src/types/flow-context.ts`：
- 项目标识、任务自身、所属位置（流程/环节）、周围上下文（同级/前置/跨领域/截止日期）
- 详见 `docs/types/flow-task-context.md`

### 交付物类型系统 ✅

`src/types/deliverable.ts`：
- 6 种交付物类型 + 信号词 + 推断规则
- 详见 `docs/types/deliverable-types.md`

### FlowTaskContext 采集 ✅

`src/components/flow-chain.tsx`：
- 链路 UI 每个任务 hover 显示 AI 按钮（Sparkles 图标）
- 点击后 `collectFlowTaskContext()` 从树形结构采集完整上下文
- 采集内容：项目标识、任务内容、流程/环节信息、同级任务、前置环节、跨领域约束、截止日期
- 采集后 POST 创建 Session 并跳转到会话页面

### 阶段权限控制 ✅

`src/lib/phase-permissions.ts`：
- `getClaudeArgsForPhase(phase)` — 根据 Session 当前 phase 决定 Claude CLI 权限参数
- **understanding（Phase 1-2）**：不传 `--dangerously-skip-permissions`，`-p` 模式下所有工具自动被拒，AI 只能纯文本对话
- **planning / executing / summarizing（Phase 3-5）**：传 `--dangerously-skip-permissions`，完整工具权限
- 每次发消息 spawn 新 Claude 进程时读取当前 phase 决定权限

`src/lib/process-manager.ts`：
- spawn 时调用 `getClaudeArgsForPhase(task.phase)` 替代硬编码的 `--dangerously-skip-permissions`
- 提取到 artifact 后自动推进 phase：understanding→planning→executing→summarizing
- 推送 `phase_changed` SSE 事件通知前端

### prompt-builder ✅

`src/lib/prompt-builder.ts` 已实现：
- `buildSystemInstructions()` — 完整 Phase 1-5 行为指令，含链路上下文推导规则
- `buildTaskContext()` — 四要素注入，若有 flowContext 自动填充项目/做什么/为什么 + 链路上下文（同环节任务、前置环节、跨领域约束、截止日期）
- `buildPhaseReminder(phase)` — 阶段提醒，告知 AI 当前处于哪个阶段及可用能力
- **输出格式说明**：`json:understanding`、`json:plan`、`json:result` 三种标记指令
- **Git 分支状态**：如果已创建分支，注入分支名

### Git 分支管理 ✅

`src/app/api/git/route.ts`：
- **创建分支**：`POST /api/git` action=create-branch
- **合并分支**：`POST /api/git` action=merge，`--no-ff` 合并后自动删除分支
- **自动检测默认分支**：main → master → 当前分支

---

## 当前方案：静态注入 + 阶段权限

### 核心思路

Phase 1-2 的工具权限问题通过两道防线解决：

1. **硬限制**：Phase 1-2 不传 `--dangerously-skip-permissions`，Claude CLI 在 `-p` 模式下自动拒绝所有工具调用
2. **软指引**：prompt 中明确告知 AI "本阶段你没有工具权限，无法读取代码"

四要素上下文通过 prompt-builder 静态注入（而非 AI 调用工具获取），因为：
- Phase 1-2 没有工具权限，无法调用任何工具
- 静态注入在当前阶段已经够用，信息来自 Session + flowContext + ProjectConfig

### 阶段与权限映射

| Phase | 名称 | CLI flags | 工具权限 | AI 职责 |
|-------|------|-----------|---------|---------|
| 1-2 | understanding | 无额外 flag | 无 | 纯文本对话，确认四要素，输出 `json:understanding` |
| 3 | planning | `--dangerously-skip-permissions` | 完整 | 读代码、查结构、制定计划，输出 `json:plan` |
| 4 | executing | `--dangerously-skip-permissions` | 完整 | 创建 git 分支、执行改动 |
| 5 | summarizing | `--dangerously-skip-permissions` | 完整 | 总结结果，输出 `json:result` |

### 阶段自动推进

artifact 提取触发 phase 推进，持久化到 tasks.json 并通过 SSE 通知前端：

```
understanding ──[提取到 json:understanding]──► planning
planning      ──[提取到 json:plan]──────────► executing
executing     ──[提取到 json:result]─────────► summarizing
```

### prompt-builder 中的四要素注入

`buildTaskContext()` 根据可用数据源填充四要素：

| 四要素 | 有 flowContext 时 | 无 flowContext 时 |
|--------|------------------|------------------|
| **项目** | ProjectConfig（优先）或 flowContext.projectName | Session.projectKey 或"未指定" |
| **做什么** | 任务标题 + flowContext.taskContent | 任务标题 + 任务描述 |
| **为什么** | flowContext.flowName + nodeName + nodeDescription | "需要推断或询问用户" |
| **交付物** | AI 根据上下文推断 | AI 根据上下文推断 |

有 flowContext 时额外注入链路上下文：同环节任务、前置环节、跨领域约束、截止日期。

### 未来演进：get_task_detail 工具

当前方案是够用的最小实现。未来如果需要更精细的控制（如 AI 在 Phase 3 按需查询已有 artifacts），可以引入 `get_task_detail` MCP 工具：

```
get_task_detail(sessionId) → TaskDetail
  - elements: { project, action, goal, deliverable } (each with status: known|inferred|unknown)
  - context?: { siblingTasks, predecessorNodes, crossCutting, cycleDeadline }
  - artifacts?: { understanding, planId, result }
```

这需要：MCP server 实现 + Claude CLI 工具注册。目前不是优先级。

---

## 待完成

- [x] **FlowTaskContext 采集**：链路 UI 的 AI 按钮 + `collectFlowTaskContext()` 采集逻辑
- [x] **Session 创建 API 支持 flowContext**：`POST /api/tasks` 接受 flowContext 字段并存储
- [x] **阶段权限控制**：`phase-permissions.ts` 根据 phase 决定 Claude CLI 权限参数，Phase 1-2 无工具权限
- [x] **Session phase 字段**：Session 类型新增 `phase?: SessionPhase`，PATCH API 支持更新
- [x] **prompt-builder 增强**：flowContext 数据注入四要素 + `buildPhaseReminder()` 阶段提醒
- [x] **阶段自动推进**：process-manager 提取 artifact 后自动更新 phase + SSE 通知前端
- [x] **前端 phase 展示**：chat-panel 显示阶段标签，task-detail 跟踪 phase 状态
- [ ] **交付物推断 prompt 指令**：在行为指令中加入信号词规则，AI 看完四要素后自行推断
- [ ] **缺口检测 prompt 指令**：在行为指令中加入缺口类型表，AI 看完四要素后自行检测
- [ ] **链路侧状态回写**：Session 状态变化时回写 Flow Task 状态
- [ ] **API / 前端术语迁移**：`/api/tasks` → `/api/sessions`，组件中 Task → Session
- [ ] **get_task_detail MCP 工具**：如果需要更精细的 AI 信息获取机制（当前静态注入已够用）

---

## 变更记录

- 2026-02-14: 实现阶段权限控制——Phase 1-2 无工具权限、prompt flowContext 注入、phase 自动推进、前端阶段标签。get_task_detail 工具设计降级为未来演进方向
- 2026-02-14: 架构调整——引入 get_task_detail 工具设计，FlowTaskContext 从"注入 prompt"变为"工具数据源之一"
- 2026-02-14: 重写——引入 Session 模型、FlowTaskContext 协作协议、交付物推断、缺口检测机制
- 2026-02-12: 初始版本——定义五阶段工作流和四要素模型
