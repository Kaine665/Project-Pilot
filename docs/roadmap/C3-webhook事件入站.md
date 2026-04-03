# C3 — Webhook / 通用事件入站

## 背景

当前 Trigger 的 event 类型只支持 GitHub PR 轮询（`github_polling`）。要实现「主动智能」支柱，需要通用化的事件入站机制。

## 当前状态

- `src/lib/event-trigger-manager.ts`：setInterval 轮询 GitHub API
- `src/types/event-trigger.ts`：只有 `github_polling` source + `pull_request.*` events
- 只支持 `start_agent` action（开新会话）

## 方案

🔴 待讨论。预期内容：

1. **Webhook 接收端点**：通用 `POST /api/webhooks/:source` 接收外部推送
2. **事件标准化**：不同源（GitHub webhook、自定义 webhook、内部事件）统一成什么格式？
3. **与现有轮询的关系**：共存？轮询作为 webhook 不可用时的降级？
4. **新的事件源类型**：GitHub webhook、通用 HTTP webhook、内部事件（文件变更、Agent 完成等）
5. **安全**：webhook secret 验证

## 依赖

- C1（Trigger 重启恢复——基础健壮性先到位）

## 改动范围

- `src/server/routes/` 新增 webhook 路由
- `src/lib/event-trigger-manager.ts` 扩展
- `src/types/event-trigger.ts` 新增 source 类型

## 验收标准

（待 A 系列完成后细化）

## 讨论记录

（待补充）
