# 统一资源引用层（Resource Binding）重构计划

> **2026-03 备忘**：本文为**历史计划**快照。当前代码已演进：`context` / `context-index` 资源与 `/api/context` 已删除；设计文档与知识文档统一在 `data/documents/` 与 **`/api/docs`**。请以 `src/types/resource.ts`、`resource-loaders/`、`docs/context-system.md` 为准。

## 范围：Phase 1-2（核心层 + Chat 模式接入）

## 一、目标

将 AgentChatManager 中散落的资源加载逻辑（contextIds 预加载、全局上下文索引表、systemPrompt 拼接）统一为 **ResourceRef + Loader + Registry** 架构。

**改造后**：加新资源类型 = 加一个 loader 文件 + 在 registry 注册。不需要改 prompt builder、类型定义、UI。

## 二、核心设计

### 2.1 ResourceRef — 统一引用格式

```typescript
// src/types/resource.ts

export type ResourceType =
  | 'context'         // ContextEntry（全局上下文条目，内容展开）
  | 'context-index'   // 全局上下文索引表（AI 按需 cat）
  | 'system-prompt'   // Agent 系统提示词
  | 'inline-text'     // 内联文本片段
  | 'knowledge-instructions'  // 知识保存指令（固定文本）
  | 'session-title-instructions'; // 会话标题指令（固定文本）

export interface ResourceRef {
  type: ResourceType;
  id: string;              // 资源标识（如 contextEntry.id、agentId）
  priority?: number;       // 排序优先级（小值靠前，默认 50）
  label?: string;          // UI 显示名
}

// inline-text 的扩展（内容直接存在 ref 中）
export interface InlineTextRef extends ResourceRef {
  type: 'inline-text';
  inlineContent: string;
}

// Loader 解析后的结果
export interface ResolvedResource {
  ref: ResourceRef;
  content: string;         // 渲染为 prompt 的文本
  sectionTitle?: string;   // prompt 中的 ## 标题（可选）
  ok: boolean;
}
```

### 2.2 ResourceLoader + Registry

```typescript
// src/lib/resource-loader.ts
export interface ResourceLoader {
  readonly type: ResourceType;
  resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource>;
}

export interface LoaderContext {
  agentId?: string;
  projectKey?: string;
}

// src/lib/resource-registry.ts — 全局单例
// - register(loader)
// - resolveAll(refs, ctx) → ResolvedResource[]（按 priority 排序）
// - formatAsPrompt(resolved) → string（拼接非空内容）
```

### 2.3 Agent 类型变更

```typescript
interface Agent {
  // ...现有字段全部保留...
  contextIds?: string[];              // @deprecated，保留向后兼容
  defaultResources?: ResourceRef[];   // 新字段：默认资源集
}
```

### 2.4 Prompt 构建改造

**改造前**（agent-chat-manager.ts:689-791）：
```
systemPrompt
  + buildContextSection()           → 全局索引表
  + buildPreloadedContextSection()  → contextIds 展开
  + KNOWLEDGE_SAVE_INSTRUCTIONS     → 固定文本
  + 会话标题指令                     → 固定文本
  + 用户消息
```

**改造后**：
```
effectiveResources = agent.defaultResources ?? migrateAgentToResources(agent)

resourceRegistry.resolveAll(effectiveResources, ctx)
  → formatAsPrompt()
  + 用户消息
```

每种原有拼接段都变成一个 ResourceRef + Loader：
| 原有逻辑 | → ResourceType | priority |
|----------|----------------|----------|
| systemPrompt 拼接 | `system-prompt` | 0 |
| buildContextSection() | `context-index` | 20 |
| buildPreloadedContextSection() | `context`（每条一个 ref） | 30 |
| KNOWLEDGE_SAVE_INSTRUCTIONS | `knowledge-instructions` | 80 |
| 会话标题指令 | `session-title-instructions` | 90 |

## 三、分步实施

### Step 1：新建类型和基础设施（0 个现有文件受影响）

新建文件：
1. `src/types/resource.ts`
2. `src/lib/resource-loader.ts`
3. `src/lib/resource-registry.ts`

### Step 2：实现 Loaders（0 个现有文件受影响）

新建文件：
4. `src/lib/resource-loaders/context-loader.ts` — 单条 ContextEntry 展开
5. `src/lib/resource-loaders/context-index-loader.ts` — 全局索引表（复用 buildContextSection 逻辑）
6. `src/lib/resource-loaders/system-prompt-loader.ts` — 读 prompts/{agentId}.md
7. `src/lib/resource-loaders/inline-text-loader.ts` — 内联文本
8. `src/lib/resource-loaders/static-text-loader.ts` — 固定文本块（知识指令、标题指令）
9. `src/lib/resource-loaders/index.ts` — 注册入口

### Step 3：迁移兼容函数（0 个现有文件受影响）

新建文件：
10. `src/lib/resource-migration.ts`
    - `migrateAgentToResources(agent)` → ResourceRef[]
    - 将现有 agent 的 systemPrompt + contextIds 映射为 ResourceRef[]
    - 自动附加 context-index、knowledge-instructions、session-title-instructions

### Step 4：改造 AgentChatManager

修改文件：
11. `src/types/index.ts` — Agent 接口添加 `defaultResources?: ResourceRef[]`
12. `src/lib/chat-managers/agent-chat-manager.ts`：
    - 三个 prompt builder 改为通过 registry 解析
    - 旧函数保留但标记 @deprecated
    - FlowContext 场景：额外注入 flow-context 相关的 inline-text ref

### Step 5：Agent API 支持

修改文件：
13. `src/app/api/agents/route.ts`：
    - POST/PATCH 接受 `defaultResources`
    - GET 返回时附加兼容处理

### Step 6：验证

- `npm run build` 无类型错误
- 启动 Agent Chat，对比 prompt 内容一致

## 四、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/types/resource.ts` | ResourceRef 等核心类型 |
| 新建 | `src/lib/resource-loader.ts` | Loader 接口 + LoaderContext |
| 新建 | `src/lib/resource-registry.ts` | Registry 单例 |
| 新建 | `src/lib/resource-loaders/context-loader.ts` | ContextEntry 展开 |
| 新建 | `src/lib/resource-loaders/context-index-loader.ts` | 全局索引表 |
| 新建 | `src/lib/resource-loaders/system-prompt-loader.ts` | SystemPrompt |
| 新建 | `src/lib/resource-loaders/inline-text-loader.ts` | 内联文本 |
| 新建 | `src/lib/resource-loaders/static-text-loader.ts` | 固定文本块 |
| 新建 | `src/lib/resource-loaders/index.ts` | 注册入口 |
| 新建 | `src/lib/resource-migration.ts` | 迁移兼容 |
| 修改 | `src/types/index.ts` | Agent 添加 defaultResources |
| 修改 | `src/lib/chat-managers/agent-chat-manager.ts` | prompt 构建改造 |
| 修改 | `src/app/api/agents/route.ts` | API 支持 |

## 五、向后兼容策略

1. **Agent.contextIds 保留不删**，标记 @deprecated
2. **磁盘数据不主动迁移**：读取时运行时兼容（migrateAgentToResources），新建/更新时写 defaultResources
3. **旧 prompt builder 函数保留**：标记 @deprecated，新代码路径不再调用
4. **prompt 输出内容不变**：改造后生成的文本与改造前格式和内容完全一致

## 六、不在本次范围

- AgentChatSession.resources（会话级资源覆写）→ Phase 3
- Agent UI 改造（contextIds checkbox → 资源编辑器）→ Phase 3
- Task 模式（ProcessManager / prompt-builder.ts）→ Phase 4
- 任务上下文对话框 UI → Phase 5
- AI 运行时动态增减资源 → Phase 6

## 七、开发流程

所有改动在 `projct-pilot-dev/` 开发目录进行，`npm run build` 验证后同步回主目录。
