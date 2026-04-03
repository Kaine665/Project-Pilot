# 统一文档系统（设计文档与知识）

> **历史说明**：早期版本将「上下文条目」放在 `context/`、设计文档放在 `design-docs/`（均在数据根 `DATA_DIR` 下）。当前产品已**统一**到 `documents/`（正文在 `documents/content/`，元数据在 `documents/entries/` 与聚合索引 `documents/index.json`）。旧路径若仍存在磁盘上，**运行时不再读写**；布局以 [`docs/data-storage.md`](./data-storage.md) 与 `file-store` 为准。  
> 类型 `ContextEntry` / `ContextIndexData` 仍保留在 `src/types/index.ts`，仅作旧 `context/index.json` 形状的**类型标注**，不是线上 API 模型。

## 概述

用户可维护两类文档（均由同一套 API 与存储承载）：

| `documentKind` | 含义 |
|----------------|------|
| `design_doc` | 项目设计文档（默认） |
| `knowledge` | 知识类文档（含 Code Card 等，标签与覆盖路径仍用 `DocEntry` 字段） |

## 核心设计：索引 + 正文分离

与旧「context 索引表 + 扁平文件」思路一致，但路径与类型已统一为 **`DocEntry`**：

1. **聚合索引** `documents/index.json`（`DocsIndexData`）— 供 UI 与 **design-docs-index** 类资源加载器生成表格注入 prompt（仅展示设计文档类条目，逻辑见 `design-docs-index-loader.ts`）。
2. **逐条元数据** `documents/entries/<id>.json`（`DocumentDiskEntry`）— 真相源之一，由 `documents-store` 读写。
3. **正文** `documents/content/<fileName>` — 与索引中的 `fileName` 对应；API 使用 `getDocumentContentPath()`。

Agent 仍可通过描述/摘要判断是否需要读取某正文文件，避免整库塞进 prompt。

## 磁盘布局（当前）

```
{DATA_DIR}/documents/          # 默认 DATA_DIR = ~/.project-pilot
├── index.json              # 聚合索引（projects → DocEntry[]，含 categories）
├── entries/                # 每条文档一条 JSON 元数据
│   └── <docId>.json
└── content/                # 正文（.md / .json / .txt 等）
    └── <fileName>
```

路径函数（节选）：`getDocumentsIndexPath()`、`getDocumentsEntriesDir()`、`getDocumentsContentDir()`、`getDocumentContentPath()`（`file-store.ts`）。

## API（当前）

统一前缀 **`/api/docs`**（Hono 路由 `server/routes/docs.ts`）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/docs` | 列表；支持 `project`、`documentKind`、`category`、`tag`、`status` 等查询参数 |
| POST | `/api/docs` | 创建；body 含 `documentKind`（`knowledge` 或默认设计文档） |
| GET | `/api/docs/:id` | 元数据 + 正文 |
| PATCH | `/api/docs/:id` | 更新元数据与/或正文 |
| DELETE | `/api/docs/:id` | 删除条目与（若非外链）正文文件 |

分类：`/api/docs/categories` 等子路由见同文件。

## 类型模型（运行时）

- **`DocEntry`**、`DocsIndexData`、`DocumentKind` — `src/types/index.ts`
- 解析旧导出文件时仍可能用到 **`ContextEntry`**（离线/工具，非 API 响应）

## 前端入口

- **文档库（按项目）**：`/workspace/docs/[projectKey]` — 设计文档与知识文档统一列表与编辑。
- **`/workspace/context`**：保留为**跳转页**，重定向到文档库并带 `view=knowledge`（筛选知识类）。

## 与 Agent / Resource 的关系

- 设计文档索引注入：资源类型仍为 `design-docs-index`（命名历史遗留），数据来自统一 `documents` 索引。
- 知识/Code Card：见 `agent-chat-manager` 与 `readDocsIndexFromDocuments`，不再使用 `context-index` / `context` 资源类型。

## 安全与约束

- 正文路径通过 `getDocumentContentPath` 等对 `fileName` 做 basename 校验，避免路径穿越。
- JSON 读写仍有大小限制（`readJsonFile`）。

## 相关代码索引

| 职责 | 文件 |
|------|------|
| 类型 | `src/types/index.ts` — `DocEntry`, `DocsIndexData`, `DocumentKind` |
| 路径 | `src/lib/file-store.ts` — `documents/*` 路径与 `getDocumentContentPath` |
| 存储读写 | `src/lib/documents-store.ts` |
| 数据目录索引 | [`docs/data-storage.md`](./data-storage.md) |
| HTTP | `src/server/routes/docs.ts` |
| 设计文档索引加载 | `src/lib/resource-loaders/design-docs-index-loader.ts` |
