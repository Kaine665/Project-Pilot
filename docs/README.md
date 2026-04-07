# 文档目录说明

## 作用

`docs/` 是 ProjectPilot 仓库内的文档总入口。

**给 AI 的总索引（含多厂商入口如何同步）**：[`AI_AGENT_KNOWLEDGE_MAP.md`](./AI_AGENT_KNOWLEDGE_MAP.md)。

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

**分层权威**：

1. **目录树目标 + 迁移现实**：本机 `~/.project-pilot/README.md`、`~/.project-pilot/数据文件夹现状.md`（不在仓库内）。
2. **环境变量与当前代码默认 `DATA_DIR` + 路径树索引**：[`docs/data-storage.md`](./data-storage.md) + [`src/lib/file-store.ts`](../src/lib/file-store.ts)；产品说明见 [`../README.md`](../README.md)「数据目录」。

**对齐日期**：2026-03-31。

`docs/` 下各文可做架构说明、历史摘录；涉及「磁盘上到底有什么」须指向本机 **`数据文件夹现状.md`**；涉及「代码里路径怎么定」须以 **`data-storage.md`** 与 **`file-store.ts`** 为准。

## 当前分层

```text
docs/
  README.md
  documentation-system/   # as-is / design / contracts 体系说明与 walkthrough
  as-is/                  # 现状（链到代码）
  design/                 # 设计原则 + decisions/（ADR）
  contracts/              # 迭代契约（TEMPLATE + examples）
  data-spec/
  ...
```

**文档三层入口**：[documentation-system/README.md](./documentation-system/README.md)。

### 协作与 Git

- **分支语义与 GitHub 权限（维护者清单）**：[github-branch-policy.md](./github-branch-policy.md)
- **贡献者日常流程**：仓库 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)

### 领域与路线图

- **领域概念模型**：[领域与数据.md](./领域与数据.md)（Scope / Execution / Trigger / Resource / Tracking）
- **实施路线图（任务总控 + 设计卡）**：[roadmap.md](./roadmap.md) + [`roadmap/`](./roadmap/)
- **Google 账号与云端同步范围（可选同步、凭据优先）**：[design/google-account-cloud-sync-scope.md](./design/google-account-cloud-sync-scope.md)

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
- **代码默认路径与环境变量**：以 [`data-storage.md`](./data-storage.md) + `file-store.ts` 为准。  
- 仓库内摘录须标明层次并写对齐日期。
