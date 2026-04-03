# ProjectPilot — 实施路线图

> 总控文件。每个任务的设计细节见 `roadmap/` 下的独立设计卡。
> 小任务在本文件内直接记方案，不单独建卡。

---

## 状态图例

- 🔴 待讨论（还没聊清楚）
- 🟡 已设计（方案确定，待执行）
- 🟢 已完成
- ⚪ 远期 / 暂缓

---

## 系统核心循环（全局视角）

```
触发（③ Trigger）→ 寻址（① Scope）→ 给料（④ Resource）→ 执行记录（② Execution）→ 结果追踪（⑤ Tracking）
```

五关注面不是并列的五块砖，而是一条流水线上的五段。Scope 贯穿全程（寻址系统）。

**当前实现成熟度**：

```
 ③ Trigger        ① Scope         ④ Resource       ② Execution      ⑤ Tracking
 [██████░░]       [████████]      [██████████]     [██████░░░░]     [██████░░░░]
  能跑但脆         基本完整         最扎实            Event+Run 落盘    有 Todo，
  缺续接/webhook   Agent↔Project                    已实现（后端）     缺 Task/
  重启不恢复       绑定松散                          Step 暂缓         Objective
                                                   前端待建
```

---

## 任务清单

### A. 领域文档层（概念清晰化）

| # | 任务 | 状态 | 设计卡 | 依赖 | 备注 |
|---|------|------|--------|------|------|
| A1 | Prompt / Resource 归属落盘 | 🟢 | - | - | 2026-04-02 已完成 |
| A2 | 系统核心循环写入 §1 | 🟢 | [A2](roadmap/A2-系统核心循环.md) | - | 已写入 `领域与数据.md` §1 |
| A3 | Agent 聚合根完整定义 | 🟡 | [A3](roadmap/A3-agent聚合根.md) | - | **已定**：一 Agent 可多项目；**待建模**：职业 vs 身份；实现仍单 `projectKey` |
| A4 | Todo → Task 术语与字段对齐 | 🔴 | [A4](roadmap/A4-todo-task对齐.md) | - | 代码 Todo vs 领域 Task |
| A5 | Execution 模型设计落盘 | 🟢 | [A5](roadmap/A5-execution设计.md) | - | 完整方案定稿并实现：Event JSONL + Run JSON + API |

### B. Execution 补全（最大空洞）

| # | 任务 | 状态 | 设计卡 | 依赖 | 备注 |
|---|------|------|--------|------|------|
| B1 | Event 持久化方案设计 | 🟢 | [B1](roadmap/B1-event持久化.md) | A5 | 合入 A5 完整方案 |
| B2 | Event 持久化实现 | 🟢 | - | B1 | `execution-event-store.ts` + `finalizeRun` 集成 |
| B3 | Run 生命周期设计 | 🟢 | 并入 A5 卡 | A5 | 合入 A5 完整方案 |
| B4 | Run 生命周期实现 | 🟢 | - | B3+B2 | `ExecutionRun` + API（后端完成，前端待建） |
| B5 | Step 声明机制 | ⚪ | - | B4 | 暂缓——依赖模型配合 |

### C. Trigger 健壮性

| # | 任务 | 状态 | 设计卡 | 依赖 | 备注 |
|---|------|------|--------|------|------|
| C1 | 服务重启后恢复定时器/轮询 | 🟢 | - | - | `src/server/index.ts` `startServer` 已调用两 `init()` |
| C2 | 续接已有会话（sessionMode: continue） | 🔴 | - | - | Trigger fire 时查找已有 Session 而非总开新的 |
| C3 | Webhook / 通用事件入站 | 🔴 | [C3](roadmap/C3-webhook事件入站.md) | C1 | 替代 GitHub 轮询，通用化 |

### D. Tracking 补全

| # | 任务 | 状态 | 设计卡 | 依赖 | 备注 |
|---|------|------|--------|------|------|
| D1 | Todo 字段补齐 / 与 Task 对齐 | 🔴 | 并入 A4 卡 | A4 | 确定改名还是共存，补缺失字段 |
| D2 | Task ↔ Run 关联 | 🔴 | - | B4+D1 | Todo/Task 能指向哪个 Run 在做 |
| D3 | 任务依赖关系 | ⚪ | - | D1 | Task 之间前后依赖（远期） |

### E. 三支柱新能力（远期）

| # | 任务 | 状态 | 设计卡 | 依赖 | 备注 |
|---|------|------|--------|------|------|
| E1 | 跨会话记忆（Memory / Profile） | ⚪ | - | B2 | 从 Event 流提取持久认知 |
| E2 | 数据源连接器（Connector） | ⚪ | - | - | 动态采集外部知识 |
| E3 | 战略目标（Objective） | ⚪ | - | D1 | 比 Task 更高层的方向 |

---

## 执行顺序

```
第一批：概念层（聊清楚 + 写文档，不动代码）
  A2 → A3 → A4 → A5

第二批：小而确定的修复（快速见效）
  C1 → C2

第三批：核心补全（最大的活）
  B1 → B2 → B3 → B4 → B5

第四批：Tracking 落地
  D1 → D2 → D3

第五批：远期能力
  E1 / E2 / E3（可并行探索）
```

---

## 变更记录

| 日期 | 内容 |
|------|------|
| 2026-04-02 | 初版：从领域建模讨论中提取任务清单、排定优先级 |
| 2026-04-02 | A2 落盘确认；C1：服务启动时 `schedulerManager.init()` + `eventTriggerManager.init()` | `领域与数据.md`、`src/server/index.ts`、`roadmap.md` |
| 2026-04-02 | A5：Execution 讨论草案写入设计卡（Event/Run/Step 分期、待拍板项） | `roadmap/A5-execution设计.md`、`roadmap.md` |
| 2026-04-02 | A5→B4 一次性完成：Event 落盘 + Run 生命周期（后端）| `types/execution.ts`、`lib/execution-event-store.ts`、`agent-chat-manager.ts`、`agent-chat-session-store.ts`、`file-store.ts`、`routes/agent-chat.ts`、`领域与数据.md` §3 |
