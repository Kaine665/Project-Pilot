# 文档层：as-is / design / contracts

本目录说明 **develop-static** 内三层文档如何协作。原则：**文档单向链接代码**；代码一般不反向链文档（减少双链腐烂）。历史以 **Git** 为准。

## 三个目录

| 目录 | 作用 |
|------|------|
| [`../as-is/`](../as-is/) | **现状**：与当前主干实现一致的行为、入口、关键路径（链到 `src/` 等）。 |
| [`../design/`](../design/) | **设计**：原则、目标态、长期方向；可与实现有差距。重大取舍用 [`decisions/`](../design/decisions/)（ADR）。 |
| [`../contracts/`](../contracts/) | **设计契约**：某一迭代的范围、与现状的差分、验收、非目标；**当期的单一协作入口**。 |

## 推荐工作流

1. 需求进来 → 读相关 **design**（原则是否仍成立）+ **as-is**（现在究竟怎样）。
2. 新建 **contract**（从 [`TEMPLATE.md`](../contracts/TEMPLATE.md) 复制），`status: draft` → 评审 → `active`。
3. 开发按 **contract** 改代码；**酌情**读代码，不必从代码起手。
4. 合并前/后：更新对应 **as-is**；若改变长期方向，补 **design** 或新 **ADR**。
5. **contract** 标 `completed`，或 `superseded` 并指向下一份；旧版保留在 `contracts/archive/` 或同文件「修订记录」。

## as-is 与代码变更

不必每个 commit 同步 as-is。约定在 **契约交付** 或 **影响行为的合并** 时更新 as-is，并刷新文中的 `last_reviewed`；发版前可做覆盖率抽查。

## ADR 编号

**ADR** = Architecture Decision Record。文件放在 [`design/decisions/`](../design/decisions/)，命名建议 `0001-short-title.md`，编号递增；废弃不删号，文中标 `superseded by ADR-0002`。

##  walkthrough 示例

见 [WALKTHROUGH.md](./WALKTHROUGH.md)（用本仓库已落盘的第一批文档跑通一遍）。
