# B1 — Event 持久化方案（含 Run 生命周期）

## 背景

② Execution 是当前系统最大的空洞。Event 流只在内存/SSE 里存在，不落盘；Run 概念与领域文档不匹配。需要设计具体的持久化方案。

本卡同时涵盖 B3（Run 生命周期设计），因为 Event 格式和 Run 边界是一体的。

## 当前状态

见 [A5](A5-execution设计.md) 的「代码（现实）」部分。

## 方案

🔴 待 A5 讨论完成后细化。预期内容：

- Event JSONL 行格式定义（字段、类型枚举）
- 存储路径（沿用 `sessions/messages/` 还是新路径）
- 与现有 ChatMessage JSONL 的迁移/兼容策略
- Run 的开/关机制和持久化位置
- Goal / Evaluation 的存储
- 索引与查询方式（前端怎么读 Event 流和 Run 列表）
- 性能考虑（大量 Event 的读写）

## 依赖

- A5（Execution 模型设计）

## 改动范围

- `src/types/` 新增 Event / Run / Step 类型
- `src/lib/chat-managers/` 写盘逻辑
- `src/server/routes/` 新增或修改 API
- 可能影响前端消息渲染

## 验收标准

- 设计文档足够具体，能直接写代码
- 兼容策略明确（不破坏现有会话数据）

## 讨论记录

（待补充）
