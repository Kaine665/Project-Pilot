# ProjectPilot 经验固化与自动装配架构（v1）

状态：Draft  
日期：2026-03-12  
适用范围：ProjectPilot 核心能力设计

## 1. 问题定义

当前系统已经有大量经验、上下文和设计文档，但存在明显架构缺口：

1. 经验对象未标准化：规则、上下文、设计文档、模板混放，缺少统一模型。
2. 注入流程未统一：靠人工在 `_global.md`、`project prompt`、agent prompt 中重复维护。
3. 生命周期缺失：缺少 `draft -> active -> deprecated` 的治理路径。
4. 校验机制缺失：冲突规则、失效路径、过期经验无法被自动拦截。

结果是“各自为战”：信息越来越多，但可复用性和确定性越来越差。

## 2. 两个核心功能（目标能力）

### 2.1 经验固化
把一次次对话中的有效做法沉淀为可复用、可版本化、可审计的“经验对象”。

### 2.2 Agent 自动配置
根据 `project + agent + task` 自动装配最相关的经验、上下文和设计文档，减少人工拼 prompt。

## 3. v1 设计目标与非目标

### 3.1 目标

1. 统一对象模型：所有经验以统一 schema 存储。
2. 确定性装配：同样输入必须得到同样的 prompt bundle。
3. 可治理：支持审核、发布、废弃与追溯。
4. 低改造成本：先兼容现有 prompt/document 体系，不做一次性重构。

### 3.2 非目标（v1 不做）

1. 不做复杂语义检索引擎（先用标签 + 规则匹配）。
2. 不做全自动经验抽取（先做人机协同审核）。
3. 不改写现有所有历史文档，仅建立统一入口和规范。

## 4. 最小可落地架构（MVP）

## 4.1 统一对象：Experience Pack

每条可装配经验都必须是一个 `Experience Pack`：

```json
{
  "id": "exp-migration-decision-header-v1",
  "type": "rule",
  "scope": {
    "level": "project",
    "projectKey": "elapp",
    "agentId": null
  },
  "tags": ["migration", "database", "sql"],
  "priority": 90,
  "status": "active",
  "version": "1.0.0",
  "owner": "team",
  "reviewAt": "2026-06-30",
  "sourceRefs": [
    "C:/Projects/ELApp/docs/guides/database-migration-guidelines.md",
    "C:/Projects/ELApp/supabase/migrations/_template.sql"
  ],
  "content": {
    "summary": "migration 必须带决策头注释，复杂方案先走 ADR",
    "body": "所有 migration 必须带“决策头注释”..."
  }
}
```

关键字段（最小集）：

- `id`：全局唯一。
- `type`：`rule | context | design | decision | template | checklist`。
- `scope`：`global | project | agent | task`。
- `tags`：用于任务匹配。
- `priority`：同层冲突时排序。
- `status`：`draft | active | deprecated`。
- `reviewAt`：过期复审时间。
- `sourceRefs`：来源文档路径，必须可追溯。

## 4.2 存储与目录（建议）

在 `{DATA_DIR}/experience-packs/`（默认 `~/.project-pilot/experience-packs/`）下统一管理：

```text
experience-packs/
  index.json
  packs/
    exp-*.json
  candidates/
    cand-*.json
  bundles/
    bundle-*.json
```

- `packs/`：已结构化经验对象。
- `candidates/`：会话提炼的候选经验（待审核）。
- `bundles/`：装配结果快照（用于排查与审计）。

## 4.3 装配器：Prompt Assembler（确定性）

输入：

- `projectKey`
- `agentId`
- `taskText`
- `taskTags`（可选）

流程：

1. 读取 `status=active` 的 pack。
2. 按 `scope` 过滤（global/project/agent/task）。
3. 按 `tags` 与任务匹配。
4. 排序与裁剪（保证 token 预算）。
5. 生成最终 prompt bundle + hash。

优先级规则（固定）：

1. `task > agent > project > global`
2. 同 scope 按 `priority` 降序
3. 再按 `updatedAt` 降序
4. 仍冲突则按 `id` 字典序稳定排序

冲突规则（v1）：

- 同 scope 同主题出现互斥 `rule`：直接报错，不自动猜测。
- 高层规则可被低层 override，但必须显式 `content.overrideFrom` 记录来源。

## 4.4 生命周期治理

统一流转：

`draft -> active -> deprecated`

最小治理要求：

1. `draft` 不参与装配。
2. `active` 必须有 `owner`、`reviewAt`、`sourceRefs`。
3. `deprecated` 自动停止注入，仅保留追溯。

## 4.5 Lint 与发布门禁（必须有）

发布前执行 `experience-lint`，至少检查：

1. 必填字段缺失。
2. `id` 重复。
3. `reviewAt` 过期。
4. `sourceRefs` 路径不存在或不可读。
5. 同 scope 同主题规则冲突。
6. 高优先级规则未标注来源与责任人。

## 5. 与现有系统对齐（渐进改造）

现有资产可以先“映射”而非重写：

1. `_global.md` -> `scope=global` 的 `rule/context` pack。
2. `project-prompts/*.md` -> `scope=project` 的 `rule/design` pack。
3. 各类 `docs/*.md` -> `sourceRefs` 引用，按需提炼为 pack。

ELApp 迁移规范已经是第一批可直接结构化的对象：

- migration 唯一准绳文档
- migration 模板
- 决策头注释硬规则
- 复杂方案先走 ADR

## 6. 落地计划（v1）

### Phase 1（本周）

1. 定义 `Experience Pack` JSON Schema。
2. 建目录与基础 `index`。
3. 把 ELApp migration 规则迁入首批 pack。

### Phase 2（下周）

1. 实现 `Prompt Assembler`（可离线命令）。
2. 实现 `experience-lint` 并接入 CI。
3. 在 agent 启动链路接入 bundle 注入。

### Phase 3（后续）

1. 会话后生成候选经验 `candidates`。
2. 增加审核界面（发布/废弃）。
3. 做注入效果统计（命中率、覆盖率、冲突率）。

## 7. 验收标准（v1 Done）

满足以下条件即视为 v1 可用：

1. 给定同样输入，装配结果 hash 稳定一致。
2. 经验过期或废弃后，不再进入注入结果。
3. 冲突规则会在 lint/装配阶段被拦截。
4. 至少一个真实项目（ELApp）通过该机制稳定运行。

