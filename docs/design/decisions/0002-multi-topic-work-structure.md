# ADR-0002: 多主题任务管理数据结构（树 + 引用 → 图）

- **状态**: Proposed
- **日期**: 2026-04-08

## 背景

Agent 执行复杂项目时涉及多个主题、问题、方案、任务、目标。当前 PP 的 Todo 是**扁平列表**，无法表达：

- 层级分解（目标 → 主题 → 任务）
- 跨主题依赖（一个任务被多个主题需要）
- 任务间的阻塞/关联关系

### 数据结构选型分析

| 结构 | 表达力 | Agent 友好度 | 适用场景 |
|------|--------|-------------|---------|
| 列表 | 差——丢失关系 | 高——最简单 | 线性步骤 |
| 树 | 中——强制单一归属 | 高——层次直觉 | 层级分解 |
| 图 | 高——任意关系 | 低——可能迷路 | 复杂交叉依赖 |
| 树 + 引用 | 较高——树为主、引用补充 | 较高——兼顾清晰与灵活 | **本项目选择** |

## 决策

### 阶段 1：树 + 引用

主结构为树（层级清晰），跨主题关系用轻量引用补充：

```typescript
interface WorkNode {
  id: string;
  type: 'goal' | 'topic' | 'task' | 'question' | 'decision';
  title: string;
  status: 'active' | 'blocked' | 'done' | 'parked';

  // 树结构
  parentId?: string;
  children: string[];

  // 跨主题引用（图的部分，但很克制）
  relatedTo?: Array<{
    targetId: string;
    relation: 'depends-on' | 'blocks' | 'related' | 'alternative-to';
  }>;

  // Agent 上下文
  assignedAgent?: string;
  summary?: string;
  activeContext?: string;
}
```

注入 Agent 上下文时生成**聚焦视图**（当前子树 + 相关引用摘要），而非暴露原始数据结构。

### 阶段 2：演进到图

当树 + 引用无法满足需求时（如引用过多、跨主题关系成为主要结构），迁移到完整图结构：

- 数据模型从 `parentId/children` 改为 `edges[]`
- 上下文注入逻辑加入图遍历（BFS/DFS 从当前焦点向外扩展 N 层）
- 保持聚焦视图的设计——Agent 看到的始终是裁剪后的局部视图

## 后果

- 树 + 引用阶段实现简单，Agent 容易理解
- 聚焦视图避免 Agent 在复杂结构中迷失
- 为后续图结构预留演进路径，数据可平滑迁移
