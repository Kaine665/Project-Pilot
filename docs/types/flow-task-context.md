# 链路→Pilot 协作协议

> **对应代码**: `src/types/flow-context.ts`
> **关联类型**: `src/types/flow.ts`（链路数据结构）、`src/types/index.ts`（Session）
> **关联文档**: `docs/types/deliverable-types.md`（交付物类型）

## 核心概念

**Session（会话）** 是 Task Agent 的顶层容器，用户点击 AI 按钮即创建。
Session 本身只是一个轻量壳子，真正有意义的是它在各 Phase 中产出的平级产物：

```
Session（会话容器，点击即创建）
  ├── TaskUnderstanding  ← Phase 1 产物：任务理解（四要素）
  ├── DeliverableInference ← Phase 1 附带产物：交付物推断
  ├── AIPlan             ← Phase 3 产物：执行计划
  └── TaskResult         ← Phase 5 产物：执行结果
```

链路侧的"任务"（Flow Task）和 Session 的"任务理解"（TaskUnderstanding）是不同的东西：
- **Flow Task**：链路中的短语条目，如"开发者回复通知"
- **TaskUnderstanding**：AI 通过对话确认后产出的四要素结构化理解

## 定位

项目跟踪链路和 Task Agent 是 ProjectPilot 内的两个模块。
本协议定义：当用户从链路发起 AI 协作时，链路侧如何打包上下文、Task Agent 侧如何创建 Session 并推进各 Phase。

## 问题

用户在链路中写的任务是短语（如"开发者回复通知"），Task Agent 的 Phase 1 需要四要素（项目、动作、目标、交付物）。
如果只传一个标题过去，AI 要凭六个字猜全貌。
但链路的树形结构里已经包含了大量可直接使用的上下文。

## 数据流

```
用户在链路上点击任务的 AI 按钮
        │
        ▼
① 采集：collectFlowTaskContext() 从树形结构采集上下文
        │
        ▼
② 创建 Session：POST /api/tasks（附带 flowContext），存储到 Session.flowContext
        │
        ▼
③ 跳转到会话页面，AI 开始对话
        │
        ▼
④ AI 调用 get_task_detail(sessionId)
        │
        ├─ 聚合 Session + flowContext + ProjectConfig + Artifacts
        │
        └─ 返回四要素状态：known / inferred / unknown
                │
                ▼
⑤ AI 根据四要素状态，确认已知、展开模糊、识别未知
        │
        ├─ 信息充分 → 直接输出理解确认
        │
        └─ 存在缺口 → ⑥ 追问用户
                           │
                           ▼
                      ⑦ 用户补充信息
                           │
                           ▼
                      ⑧ AI 更新理解，输出确认
                           │
                           ▼
                      Phase 2 / Phase 3 继续
```

**关键原则**：FlowTaskContext 能自动填充的就自动填充，填不了的必须追问，不能跳过。

## FlowTaskContext 结构

### 来源映射

每个字段都从链路的树形结构中采集，以下是字段与来源的对应关系：

| 字段 | 来源 | 说明 |
|------|------|------|
| `projectKey` | FlowsLayout.activeKey | 当前选中的项目 |
| `projectName` | FlowsLayout.projects 中匹配的 name | 项目显示名 |
| `taskId` | Flow.Task.id | 链路侧任务 ID，用于回写状态 |
| `taskContent` | Flow.Task.content | 任务短语，如"开发者回复通知" |
| `flowId` | Flow.id | 所属流程 ID |
| `flowName` | Flow.name | 所属流程名，如"反馈流程" |
| `flowDescription` | Flow.description | 流程描述 |
| `nodeId` | FlowNode.id | 所属环节 ID |
| `nodeName` | FlowNode.name | 所属环节名，如"提交后" |
| `nodeDescription` | FlowNode.description | 环节描述，如"提交后的跟进和闭环" |
| `siblingTasks` | FlowNode.tasks（排除自身） | 同环节其他任务及状态 |
| `predecessorNodes` | 同 Flow 中排在当前 node 前面的 nodes | 前置环节名称和状态 |
| `crossCutting` | FlowData.crossCutting | 跨领域约束（性能、部署等） |
| `cycleDeadline` | FlowData.cycleDeadline | 周期截止日期 |

### 四要素映射

Task Agent Phase 1 需要的四要素如何从 FlowTaskContext 推导：

| 四要素 | 推导方式 |
|--------|---------|
| **项目** | `projectKey` + `projectName` → 直接确定 |
| **做什么** | `taskContent` → 任务短语（仍需 AI 展开细节） |
| **为什么** | `flowName` + `nodeName` + `nodeDescription` → 拼成目标链 |
| **交付物** | AI 根据 taskContent + 项目类型推断（见 deliverable-types.md） |

### 缺口检测与追问

FlowTaskContext 能自动填充三个半要素，但几乎不可能四个全满。
AI 必须在输出理解确认之前，检测以下缺口并向用户追问。

#### 缺口类型

| 缺口 | 何时出现 | 追问方式 |
|------|---------|---------|
| **taskContent 太模糊** | 任务短语无法确定具体范围 | 带选项提问："开发者回复通知"是指：(A) 应用内红点提示 (B) 系统推送通知 (C) 两者都要？ |
| **nodeDescription 是默认值** | 用户没填环节描述，仍为"描述" | 推断后审查："我理解这个环节是…，对吗？" |
| **交付物不确定** | 推断 confidence 为 low/medium | 带选项确认："预计产出是 UI 组件 + 后端逻辑，还是还需要数据库变更？" |
| **技术约束不明** | crossCutting 没有覆盖到的约束 | 针对性提问："通知需要用现有的消息系统，还是从零搭建？" |
| **scope 边界不清** | 无法判断功能到哪里为止 | 带选项提问："这个任务包不包括通知已读/未读状态管理？" |
| **前置依赖未就绪** | predecessorNodes 中有 planned 状态的环节 | 主动告知："前置环节 X 还没完成，是否需要先做那个？" |

#### 追问原则

1. **不问能从上下文推断的**：项目是什么、目标是什么 — 链路已经给了
2. **不问泛泛的开放题**：不要问"你能详细描述一下吗？"
3. **优先推断后让用户确认**：给出 AI 的判断，让用户说对或不对
4. **一次最多问 2 个缺口**：多了用户会烦，少了效率低
5. **把选项从上下文里提取出来**：如果 crossCutting 里有"推送系统"，直接拿来当选项

#### 追问后的信息存储

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

### 上下文增益

除了四要素直接映射，FlowTaskContext 还提供以下增益信息：

**siblingTasks（同环节任务）的作用**：
- 已完成的同级任务说明哪些相关功能已存在
- 例：同环节有"查看历史反馈记录"✅ → 说明反馈数据层已有，不需要从零建

**predecessorNodes（前置环节）的作用**：
- 说明用户旅程中这个任务之前发生了什么
- 例：前置"选择类型"✅"填写内容"wip → 说明提交流程还没完全做好

**crossCutting（跨领域约束）的作用**：
- 全局约束影响实现方案
- 例：有"推送系统 planned" → 通知功能可能需要先做推送基建

**cycleDeadline 的作用**：
- 时间压力影响方案选择
- 例：还有 2 天截止 → 优先做最小可行方案

## 存储方式

FlowTaskContext 作为 Session 的可选字段存储：

```typescript
// src/types/index.ts
interface Session {
  // ...现有字段
  flowContext?: FlowTaskContext;  // 从链路发起时附带的上下文
}
```

选择存在 Session 上而非 SessionArtifacts 里，因为：
- 这是会话的**来源信息**，不是 Phase 执行过程中产出的
- `get_task_detail` 工具需要在第一次对话就读到，不能等 AI 产出后才有
- 它是一次性快照，创建后不会变化

## 与 get_task_detail 的关系

> **架构图**：`docs/get-task-detail-architecture.drawio`
> **工具设计**：`docs/ai-task-workflow.md` → "get_task_detail 工具设计"

FlowTaskContext **不直接注入 prompt**，而是作为 `get_task_detail` 工具的数据源之一。

AI 需要的是"这个任务的四要素状态"，不需要关心信息是从 FlowTaskContext 来的还是从 ProjectConfig 来的。`get_task_detail` 工具聚合所有数据源，统一输出四要素的已知/模糊/未知状态。

```
get_task_detail(sessionId) 的数据源：
  ├── Session（必有）         → title, content, projectKey
  ├── FlowTaskContext（可选） → 本协议定义的链路上下文
  ├── ProjectConfig（可选）   → 项目配置
  └── SessionArtifacts（可选）→ AI 之前产出的理解
```

这样的好处：
- **手动创建的 Session** 也能通过 ProjectConfig 获取项目信息，AI 不会对项目一无所知
- **prompt-builder 更简单**，只需告诉 AI "调 get_task_detail"，不用把上下文全塞进去
- **AI 按需获取**，不会在 prompt 中堆积用不到的上下文

## 采集实现

`src/components/flow-chain.tsx`：
- `collectFlowTaskContext()` 函数从树形结构采集上下文
- 链路 UI 每个任务 hover 显示 Sparkles 按钮
- 点击后采集 → POST 创建 Session（附带 flowContext）→ 跳转到会话页面

采集映射：

| FlowTaskContext 字段 | 来源 |
|---------------------|------|
| projectKey, projectName | FlowDataContext（FlowEditor props） |
| flowTaskId, taskContent | 被点击的 Task 对象 |
| flowId, flowName, flowDescription | 所属 Flow 对象 |
| nodeId, nodeName, nodeDescription | 所属 FlowNode 对象 |
| siblingTasks | 同 FlowNode 下其他任务（排除自身） |
| predecessorNodes | 同 Flow 中排在当前 node 前面的 nodes |
| crossCutting | FlowData.crossCutting |
| cycleDeadline | FlowData.cycleDeadline |

## 链路侧回写

当 Session 的状态变化时，需要回写链路侧的 Flow Task：

| Session 状态 | Flow Task 状态 |
|-------------|---------------|
| todo | planned（不变） |
| doing | wip |
| done | done |

回写通过 `PUT /api/data?project={projectKey}` 更新链路的 JSON 文件。
回写时通过 `FlowTaskContext.flowTaskId` 定位链路侧的任务。

## 变更记录

- 2026-02-14: 更新——FlowTaskContext 从"注入 prompt"改为"get_task_detail 数据源"；补充采集实现
- 2026-02-14: 初始版本，定义协作数据流、FlowTaskContext 结构和缺口追问机制
