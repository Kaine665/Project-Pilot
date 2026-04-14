# design（设计文档）

描述**原则、目标态、长期方向**，不必与当前代码逐行一致。与实现的重大差异应在 **contracts** 里写清「本版收哪些口」。

## 子目录

- [`decisions/`](./decisions/)：ADR（架构/产品决策记录），编号递增。
- [`product-boundary-TEMPLATE.md`](./product-boundary-TEMPLATE.md)：产品边界**填空模板**（5 项：一句话、为谁与场景、界内、界外、修订）。

## 已有页面

| 文档 | 主题 |
|------|------|
| [conversation-agent-system-lens.md](./conversation-agent-system-lens.md) | **对话与 Agent 系统八层对照**（Claude Code / Hermes / OpenHarness vs PP；Agent 进入仓库先读） |
| [agents-workspace.md](./agents-workspace.md) | Agents 工作区信息架构与体验原则 |
| [brainstorm-paper-frontend-design-workflow.md](./brainstorm-paper-frontend-design-workflow.md) | **Brainstorm/轻量 PRD → Paper → `frontend-design`** 联合工作流（防蛮干） |
| [tasks-hub-information-architecture.md](./tasks-hub-information-architecture.md) | **任务**聚合壳（三子页）IA + Layer 1，供 Paper/改版对照 |
| [superdesign-agents-workspace-chat.md](./superdesign-agents-workspace-chat.md) | Superdesign 整页聊天布局稿（含会话条焦点） |
| [google-account-cloud-sync-scope.md](./google-account-cloud-sync-scope.md) | Google 账号：云端同步**按类可选**（推荐最小云范围 **仅 AI 凭据**）；**实现参考 [PR #39](https://github.com/Kaine665/Project-Pilot/pull/39)**（本机 `accounts/<sub>/` 隔离） |
| [product-boundary.md](./product-boundary.md) | 产品与能力边界（与 `product-direction-and-dashboard` 同一叙事）：上下文图、界内/相邻/界外、与 roadmap 五段流水线对照 |
