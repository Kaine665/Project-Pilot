# A4 — Todo → Task 术语与字段对齐

## 背景

领域文档 §6 用 **Task** 描述「项目里有哪些事要做、做到哪了」。代码里的实体叫 **TodoItem**，字段和语义都有差异。需要决定：统一名字还是共存，以及补齐缺失字段。

## 当前状态

**领域文档（Task）：**
- Project 级，status: pending → doing → done
- 可关联 Session / Run
- 字段和生命周期标注「待确认」

**代码（TodoItem）：**
- 有完整 CRUD + 看板 UI + 可派发给 Agent
- 字段：id、title、description、status、priority、agentId、sessionId、projectKey、dueAt、tags、subTasks、lifecycle、activeTaskId、claimedByBranch、subjectFiles、contextRefs
- 与 Session 有双向关联（todoId ↔ sessionId）
- 与 Run 无关联（因为 Run 在代码里还不存在）

**并行执行看板（ActiveTaskEntry）：**
- 运行时协调信号，不是用户待办
- 与 TodoItem 通过 activeTaskId 可选关联

## 方案

🔴 待讨论。需要回答：

1. 产品层面叫「任务」还是「待办」？（对用户来说）
2. 代码类型是改名（TodoItem → Task）还是保留 TodoItem 并在领域文档里说明映射？
3. 领域 Task 缺的字段：与 Run 的关联、依赖关系——等 Execution 模型到位后再加？
4. 并行执行看板（ActiveTaskEntry）在 Task 体系里的定位是否需要调整？

## 改动范围

- `docs/领域与数据.md` §6
- 可能涉及 `src/types/index.ts`（如果决定改名）
- 可能涉及 UI 文案

## 验收标准

- 领域文档和代码用同一个词指同一件事
- 字段差异有明确的对照说明

## 讨论记录

（待补充）
