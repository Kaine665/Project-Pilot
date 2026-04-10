# design（设计文档）

描述**原则、目标态、长期方向**，不必与当前代码逐行一致。与实现的重大差异应在 **contracts** 里写清「本版收哪些口」。

## 子目录

- [`decisions/`](./decisions/)：ADR（架构/产品决策记录），编号递增。
- [`product-boundary-TEMPLATE.md`](./product-boundary-TEMPLATE.md)：产品边界**填空模板**（5 项：一句话、为谁与场景、界内、界外、修订）。

## 已有页面

| 文档 | 主题 |
|------|------|
| [agents-workspace.md](./agents-workspace.md) | Agents 工作区信息架构与体验原则 |
| [superdesign-agents-workspace-chat.md](./superdesign-agents-workspace-chat.md) | Superdesign 整页聊天布局稿（含会话条焦点） |
| [google-account-cloud-sync-scope.md](./google-account-cloud-sync-scope.md) | Google 账号：云端同步**按类可选**（推荐最小云范围 **仅 AI 凭据**）；**实现参考 [PR #39](https://github.com/Kaine665/Project-Pilot/pull/39)**（本机 `accounts/<sub>/` 隔离） |
