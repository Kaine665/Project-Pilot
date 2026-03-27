---
id: CONTRACT-2026-03-27-doc-system-bootstrap
status: completed
title: 建立 as-is / design / contracts 文档骨架与 walkthrough
owner: （项目维护者）
author: （项目维护者）
reviewers: []
created: 2026-03-27
completed: 2026-03-27
as_is_refs:
  - docs/as-is/agents-workspace.md
design_refs:
  - docs/design/agents-workspace.md
code_paths_touched: []
---

# 建立文档层骨架（示例契约）

## 背景

需要可重复的「先文档、后代码」协作方式；文档单向链代码，契约作为迭代入口。

## 与现状的差分

- 新增 `docs/documentation-system/`、`docs/as-is/`、`docs/design/`、`docs/contracts/` 及示例页。
- **不修改** 业务逻辑代码。

## 非目标

- 不要求迁移既有全部架构文进入 as-is（可渐进）。
- 不引入 CI 校验脚本（可后续加）。

## 实现要点

- `CLAUDE.md` 增加指向本体系的简短说明。
- `docs/README.md` 增加索引。

## 验收标准

- [x] 存在 `documentation-system/README.md` 与 `WALKTHROUGH.md`。
- [x] 存在示例 as-is / design 与一份 `completed` 示例契约。
- [x] `as-is/agents-workspace.md` 中列出的代码路径在仓库内存在。

## 修订记录

| 日期 | 变更 |
|------|------|
| 2026-03-27 | 初稿并完成（示范） |
