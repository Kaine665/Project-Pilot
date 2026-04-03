# A3 — Agent 聚合根完整定义

## 背景

Agent 是系统的核心实体之一，但领域文档 §2 只有一句话定义。需要明确：Agent 配置里到底管什么、边界在哪、与 prompt / resource / session 的关系。

## 当前状态

- `领域与数据.md` §2：「可配置的 AI 执行单元：模型/供应商、能力开关、执行模式等。主系统指令外置为 `prompts/agents/<id>.md`」
- 代码侧：`types/index.ts` 的 `Agent` 接口有 ~30 个字段（id、slug、systemPrompt、defaultResources、promptRefs、capabilities 等）
- 磁盘侧：`agents/registry.json` + `definitions/` + `bindings/` + `statuses/` + `teams/` + `workspaces/`
- **实现与产品决策的差距**：当前 `Agent.projectKey` 为可选单值，`bindings/` 读入时 `pickProjectKey` 只取第一条 project binding——与下方「已定决策」不一致，属后续改造项。

---

## 已定产品决策（先写进设计，暂不改代码）

### 1. 一个 Agent 可跨多个 Project

- **语义**：同一 Agent（同一套能力、同一套默认资源与主提示词策略）可在**多个项目**下被使用、被筛选、被调度；不是「一 agent 最多绑一个 project」。
- **与 Scope 的关系**：多项目属于 **① Scope 上的可见性/归属**，与「职业 / 身份」正交。
- **实现方向（待 A3 细化后落盘到领域文档 + 排期）**：例如 `projectKeys: string[]`、或 bindings 全量参与 API/UI 与过滤逻辑，废弃「只取第一个 binding」的静默丢弃行为。具体字段名、会话默认 project、列表过滤规则在讨论中敲定。

### 2. 职业 vs 身份（当前系统缺失，需后续建模）

- **职业 / 角色**：这类 Agent **做什么、按什么套路**（如产品经理、代码审查、Butler）。偏模板、能力画像、协作场景（`triggerHints` 等可部分承载，但不等于一等概念）。
- **身份 / 具体是谁**：**这一实例**是谁、对谁说话（如「王如龙经理」、某项目的具名 PM）。偏展示名与人设锚点，通常落在主提示词与对外名称上。
- **现状**：仅有 `name`、`description` 等，职业与身份混在同一命名里，**没有**显式字段或「模板 → 实例」分层。
- **实现方向（远期，与多项目可并行设计）**：例如字段拆分（`roleLabel` + `personaName` / `displayName`）、或模板 Agent + 实例 Agent 的继承关系、或元数据扩展；具体选型待产品形态确定后再写入领域文档与 types。

---

## 方案（仍待补充的议题）

🟡 部分已定（见上）。仍需回答：

1. Agent 聚合根**管什么**（配置 + 资源引用 + 多项目归属）、**不管什么**（消息历史在 Session、业务逻辑在 Resource、执行痕迹在 Execution）
2. Agent **分类**：仅内置 vs 自定义（`builtIn` + `slug`），无单独 `agentType` 枚举是否足够
3. Agent **生命周期**：创建 → 使用 → 归档；`agentStatus` 与配置分离是否在领域层单独表述
4. 代码侧 `Agent` 类型字段与领域概念的**对照表**（含 `systemPrompt` 为读时 resolved、真相源为外置文件——已用 JSDoc 标注）

## 改动范围

- `develop-static/docs/领域与数据.md`（§2 扩展或新增 Agent 专节；写入多项目、职业/身份待建模说明）
- 实现改造另立任务（不在本卡「先不改代码」范围内执行）

## 验收标准

- 领域文档能反映：**多项目**为产品语义；**职业/身份**为已知缺口与后续方向
- Agent 的领域定义能回答「管什么、不管什么、跟谁关联、生命周期」
- 与代码侧 `Agent` 类型有对照表（含当前实现与已定决策的差异）

## 讨论记录

- 2026-04-02：**已定**——一个 Agent 可跨越多个 Project；**缺口**——职业 vs 身份尚未建模，先记入设计卡，不改代码。
- 2026-04-02：`systemPrompt` 真相源与读时填充已在 `types/index.ts`、`agents-store.ts` 用 JSDoc 理顺（非本卡「多项目/身份」范围，但同属 Agent 澄清）。
