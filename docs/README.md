# 文档目录说明

## 作用

`docs/` 是 ProjectPilot 仓库内的文档总入口。

这里承载的是：
- 设计说明
- 架构说明
- 迁移记录
- 目录索引
- 对真实实现的解释

这里不直接充当「用户数据布局、迁移进度」的完整权威源。

## 真相关系

ProjectPilot 里有两类“真相”：

- 真实真相：代码本身、运行时行为、用户目录里的真实文件夹和文件
- 文档真相：对这些真实对象的说明文档

**分层权威**（详见仓库根 [`README.md`](../../README.md#pp-data-directory)）：

1. **目录树目标 + 迁移现实**：本机 `~/.project-pilot/README.md`、`~/.project-pilot/数据文件夹现状.md`（不在仓库内）。
2. **环境变量与当前代码默认 `DATA_DIR`**：仓库根 `README.md` 本节 + `develop-static/src/lib/file-store.ts`。

**引用记录**：`../../README.md`；**对齐日期**：2026-03-26。

`docs/` 下各文可做架构说明、路径函数索引、历史摘录；涉及「磁盘上到底有什么、能否删备份」须指向本机 **`数据文件夹现状.md`**；涉及「未设置变量时应用读哪」须指向根 `README` + `file-store.ts`。

## 当前分层

```text
docs/
  README.md
  data-spec/
  ...
```

## 子层说明

### `data-spec/`

`data-spec/` 现在只负责：
- 说明数据目录规范体系怎么组织
- 指向真实权威规范所在位置
- 记录目标状态、迁移意图和实现差距

它不再承载 `.project-pilot` 各个真实目录的完整权威正文。

参见：[data-spec/README.md](./data-spec/README.md)。**projects 域 schema**：[data-spec/projects/README.md](./data-spec/projects/README.md)。

## 规则

- **布局与迁移进度**：以本机 `~/.project-pilot/数据文件夹现状.md`（及同目录 `README.md`）为准。  
- **代码默认路径与环境变量**：以仓库根 [`README.md`](../../README.md#pp-data-directory) + `file-store.ts` 为准。  
- 仓库内摘录须标明层次并写对齐日期。
