# 流程 walkthrough（示例）

按顺序做一次，即完成「文档驱动」的一轮最小闭环（本例**不改业务代码**，只建立文档习惯）。

## 1. 读 design（原则是否仍成立）

打开 [`../design/agents-workspace.md`](../design/agents-workspace.md)，确认 Agents 工作区的产品原则仍被本次工作接受。

## 2. 读 as-is（现在怎样）

打开 [`../as-is/agents-workspace.md`](../as-is/agents-workspace.md)，确认路由、主要文件、侧栏行为与你要动手的区域一致。若与代码不符，**先改 as-is 或先修代码再改 as-is**，避免带着错误假设开发。

## 3. 读 contract（本迭代承诺）

打开 [`../contracts/examples/2026-03-27-doc-system-bootstrap.md`](../contracts/examples/2026-03-27-doc-system-bootstrap.md)。真实工作时这里应是 `draft` → `active` 的当期契约；本例为已完成的示范。

## 4. 执行开发

按 contract 改代码。本 walkthrough 对应契约已完成（仅新增文档骨架）。

## 5. 更新 as-is

若代码行为变了：更新 [`../as-is/agents-workspace.md`](../as-is/agents-workspace.md) 相应条目与 `last_reviewed`。本 walkthrough 未改行为，可只确认 as-is 仍准确。

## 6. 关闭 contract

将 contract 标为 `completed`，或移入 `contracts/archive/` 并保留 front matter。示例文件已标 `completed`。

---

**新会话自测建议**：在 Cursor 里对新任务说：「先读 `docs/documentation-system/README.md`，再读与任务相关的 as-is、design、若有则读 contracts。」观察是否减少无契约改动。
