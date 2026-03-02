# 上下文系统（Context System）架构文档

## 概述

上下文系统允许用户存储个人信息（姓名、邮箱、API key 等）和项目信息（文件夹结构、技术栈等），供 AI Agent 按需读取。

## 核心设计：索引 + 内容文件分离

```
                      ┌──────────────────────────────┐
                      │   Agent 对话启动               │
                      │                              │
                      │  1. 读取 index.json           │
                      │  2. 生成 markdown 表格         │
                      │  3. 注入 system prompt         │
                      └──────────┬───────────────────┘
                                 │
                                 ▼
                      ┌──────────────────────────────┐
                      │   Agent 运行中                 │
                      │                              │
                      │  4. 根据 description 判断      │
                      │     是否需要某个上下文           │
                      │  5. bash cat 读取具体文件       │
                      └──────────────────────────────┘
```

**为什么这样设计？**

| 问题 | 解法 | 原因 |
|------|------|------|
| 索引注入会浪费 token 吗？ | 索引很小（只有 label + description），注入成本极低 | 省掉 agent 每次都要先 `cat index.json` 的 bash 调用 |
| 内容为什么不也注入？ | 内容可能很大（几百行 JSON/Markdown），按需读取 | 减少 token 消耗，agent 只读需要的文件 |
| agent 怎么知道有哪些上下文？ | system prompt 里有一张表：标签 / 描述 / 文件路径 | agent 看描述就知道该不该读 |

## 数据模型

### 文件结构

```
~/.project-pilot/data/context/
├── index.json              ← 索引文件（所有条目的元数据）
├── personal-info.json      ← 内容文件
├── ai-api-keys.json
├── dev-environment.md
└── project-overview.md
```

### 索引条目（ContextEntry）

```typescript
interface ContextEntry {
  id: string;           // "ctx-1740464738582-a3f"
  label: string;        // "用户基本信息"
  description: string;  // "姓名、邮箱、偏好语言" — agent 靠这个决定是否读文件
  fileName: string;     // "personal-info.json"（扁平化，不支持子目录）
  format: 'json' | 'markdown' | 'text';
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}
```

## 安全设计

### 路径穿越防护

`getContextFilePath()` 使用 `path.basename()` 强制扁平化：

```typescript
// src/lib/file-store.ts
export function getContextFilePath(fileName: string): string {
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) {
    throw new Error(`Invalid context file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'context', safe);
}
```

**约束：fileName 不能包含 `/`、`\`、`..`，只能是纯文件名。**

### 文件大小限制

所有 JSON 读取有 50MB 限制（`readJsonFile` 内部检查），防止 DoS。

## API 设计

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/context` | 列出所有索引条目 |
| POST | `/api/context` | 创建条目（索引 + 内容文件） |
| GET | `/api/context/[id]` | 获取条目元数据 + 内容 |
| PATCH | `/api/context/[id]` | 更新元数据和/或内容 |
| DELETE | `/api/context/[id]` | 硬删除（索引 + 内容文件） |

### POST 创建流程

```
客户端 POST { label, description, fileName, format, content }
  ↓
验证 label、fileName 非空
  ↓
检查 fileName 唯一性（409 冲突）
  ↓
检查 format ∈ ['json', 'markdown', 'text']
  ↓
生成 ID: ctx-{Date.now()}-{random4}
  ↓
创建 context/ 目录（如不存在）
  ↓
写入内容文件
  ↓
追加索引条目 + 写回 index.json
  ↓
返回 { ok: true, entry }
```

### 删除策略

**硬删除**，不走回收站。原因：
- 上下文是配置数据，不是用户创作内容
- 误删后可以重新创建（有模板 chips）
- 简化实现，不需要 `deletedAt` / `isDeleted` 字段

## Prompt 注入

> 更新时间：2026-03-02 — 上下文注入已迁移至 Resource 系统

### 新架构：Resource-based 注入

上下文系统现在通过 Resource 系统注入 Agent prompt，不再使用旧的 `buildContextSection()` 硬编码拼接。

```
Agent.resources: ResourceRef[]
  → ResourceRegistry.loadAll(refs)
    → ContextIndexLoader (priority 50) — 注入全局索引表
    → ContextLoader      (priority 60) — 内联指定条目内容
```

**ContextIndexLoader** — 读取 `context/index.json`，生成 markdown 表格注入 prompt（等效旧 `buildContextSection()`）
**ContextLoader** — 读取指定条目的完整内容，直接内联到 prompt

### 注入结果示例（ContextIndexLoader 输出）

```markdown
## 可用上下文信息

以下是用户预设的上下文信息，你可以通过 bash cat 命令按需读取：

| 标签 | 描述 | 文件路径 |
|------|------|---------|
| 用户基本信息 | 姓名、邮箱、偏好语言 | /home/user/.project-pilot/data/context/personal-info.json |
| AI API Keys | OpenAI、Anthropic 等密钥 | /home/user/.project-pilot/data/context/ai-api-keys.json |
```

### 调用链

```
AgentChatManager.start()
  → ResourceRegistry.loadAll(agent.resources)
    → ContextIndexLoader.load()   ← 读索引，生成表格
    → ContextLoader.load()        ← 按 ref 内联指定条目
    → ...其他 ResourceLoader
  → 拼接为完整 system prompt
  → 发送给 Claude CLI
```

### 相关文件

| 职责 | 文件 |
|------|------|
| 索引加载器 | `src/lib/resource-loaders/context-index-loader.ts` |
| 内容加载器 | `src/lib/resource-loaders/context-loader.ts` |
| Resource 注册表 | `src/lib/resource-registry.ts` |
| Resource 迁移 | `src/lib/resource-migration.ts` |

> **历史备注**：旧版使用 `buildContextSection()` 函数（在 `agent-chat-manager.ts` 中）直接拼接索引表。
> 现已迁移至 Resource Loader 架构，`buildContextSection()` 已移除。

### 任务级全局上下文选择

除了全局索引表注入外，每个任务可以选择性启用部分全局上下文条目。被选中的条目内容**直接内联**到该任务的 prompt 中，确保 AI 一定看到。

```
两层注入共存：

层1（全局）: buildContextSection()
  → 索引表（label + description + filePath）
  → 所有条目，AI 自行 cat 按需读取

层2（任务级）: buildTaskContext() 中 globalContextIds 分支
  → 选中条目的完整内容直接内联
  → 用户在 TaskContextDialog 中勾选
```

**数据流：**

```
TaskContextDialog (toggle 选中)
  → TreeItem.context.globalContextIds: string[]    // 存储在项目数据文件
  → collectFlowTaskContext()                       // 透传
  → FlowTaskContext.globalContextIds: string[]     // 存储在 session
  → buildTaskContext()                             // prompt-builder 读文件
  → 内联到 prompt "用户指定上下文（全局）" 区块
```

**相关代码：**

| 职责 | 文件 |
|------|------|
| 存储字段 | `src/types/flow.ts` — `TreeItem.context.globalContextIds` |
| 传输字段 | `src/types/flow-context.ts` — `FlowTaskContext.globalContextIds` |
| UI 选择 | `src/components/task-context-dialog.tsx` — 全局上下文区块 |
| 透传 | `src/components/flow-shared.tsx` / `flow-chain.tsx` — `collectFlowTaskContext()` |
| 内联注入 | `src/lib/prompt-builder.ts` — `buildTaskContext()` 中 globalContextIds 分支 |

## 前端设计

### 页面布局

```
┌─────────────────────────────────────────┐
│  📖 上下文 (3)               [+ 新建条目] │
├─────────────────────────────────────────┤
│  快速创建                                │
│  [个人信息] [AI API Keys] [服务 API Keys] │
│  [开发环境] [项目概览] [常用网址] ...       │
├─────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 个人信息  │ │ AI Keys  │ │ 开发环境  │ │
│  │ json     │ │ json     │ │ markdown │ │
│  │ 描述...  │ │ 描述...  │ │ 描述...  │ │
│  │ 2026-02  │ │ 2026-02  │ │ 2026-02  │ │
│  └──────────┘ └──────────┘ └──────────┘ │
├─────────────────────────────────────────┤
│  编辑上下文条目    🕐 创建于 ... 修改于 ... │
│  ─────────────────────────────────────── │
│  标签 *: [输入框]    描述: [输入框]        │
│  文件名 *: [输入框]  格式: [JSON|MD|Text]  │
│  内容:                                   │
│  ┌─────────────────────────────────────┐ │
│  │ (等宽字体 textarea)                  │ │
│  └─────────────────────────────────────┘ │
│  [保存]  取消                             │
└─────────────────────────────────────────┘
```

### 模板 Chips

预置 8 个模板，点击后预填表单：

| 模板 | 文件名 | 格式 |
|------|--------|------|
| 个人信息 | personal-info.json | JSON |
| AI API Keys | ai-api-keys.json | JSON |
| 服务 API Keys | service-api-keys.json | JSON |
| 开发环境 | dev-environment.md | Markdown |
| 项目概览 | project-overview.md | Markdown |
| 常用网址 | bookmarks.json | JSON |
| 数据库连接 | database-connections.json | JSON |
| 邮件 & 通知 | notifications.json | JSON |

已创建的模板（按 fileName 匹配）自动隐藏。

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/types/index.ts` | `ContextEntry`, `ContextIndexData` 类型定义 |
| `src/types/resource.ts` | `ResourceType`, `ResourceRef` 类型定义 |
| `src/lib/file-store.ts` | `getContextDir()`, `getContextIndexPath()`, `getContextFilePath()` 路径函数 |
| `src/app/api/context/route.ts` | GET（列表）/ POST（创建）API |
| `src/app/api/context/[id]/route.ts` | GET（详情）/ PATCH（更新）/ DELETE（删除）API |
| `src/lib/resource-loaders/context-index-loader.ts` | 全局索引表注入（替代旧 `buildContextSection()`） |
| `src/lib/resource-loaders/context-loader.ts` | 指定条目内容内联 |
| `src/lib/resource-registry.ts` | Resource 加载器注册表 |
| `src/lib/prompt-builder.ts` | `buildTaskContext()` — 任务级全局上下文内联注入 |
| `src/lib/default-agents.ts` | Butler agent 的上下文系统说明 |
| `src/components/task-context-dialog.tsx` | 任务上下文 Dialog（含全局上下文选择） |
| `src/app/[locale]/flows/context/page.tsx` | 前端管理页面 |
| `src/app/[locale]/flows/layout.tsx` | 侧边栏 BookOpen 按钮 |
