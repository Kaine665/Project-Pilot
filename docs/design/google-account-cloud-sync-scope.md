# Google 账号与云端同步范围（设计）

**状态**：产品方向 / 实现前约定；**代码参考**见下方 **PR #39**。  
**对齐**：本机数据布局见 [`data-storage.md`](../data-storage.md)；凭据模型见 [`unified-credential-store.md`](../unified-credential-store.md)。

## 问题

用 Google（或其它账号）登录后，若默认把整份 `~/.project-pilot` 同步到云端，会带来：

- 隐私与合规压力（会话、文档、项目元数据、待办等）
- 用户不信任「一键全上传」
- 与「本地优先」的现有架构冲突

因此需要：**由用户显式选择**「云端帮忙管理哪些信息」，而不是全量同步。

## 原则

1. **默认本地优先**：未勾选的能力，数据只留在本机 `DATA_DIR`。
2. **按类别开关**：UI 上按「数据类别」展示 toggles，说明每类同步什么、不同步什么。
3. **最小可用云能力**：若只做一件事，**只同步 AI 供应商凭据**是合理默认（见下节）。

## 推荐默认：云端仅管理「AI API Key / 供应商凭据」

**建议作为首推、且可单独开启的唯一云同步项：**

- **范围**：与 [`unified-credential-store.md`](../unified-credential-store.md) 一致的 **`settings` 中与各 `ProviderId` 相关的凭据**（如 `providerCredentials` 下的 `apiKey`、`authMode` 为 `api_key` 的密钥字段；OAuth 元数据是否上云需单独论证，见下文）。
- **目的**：换机重装后不必重新填各厂商 Key；**不包含**聊天内容、Agent 配置全文、项目树、文档正文等。

**明确不纳入该「凭据同步」包（除非将来单独增加开关且单独评审）的示例：**

- `sessions/`、`documents/`、`agents/`（注册表与 workspace 文件）、`todos/`、`prompts/` 下正文、`projects/` 业务数据等 — 一律默认 **仅本地**。

## OAuth 与 Codex 等

- 当前产品内 Anthropic 应用内 OAuth 已收敛为 API Key；OpenAI 侧存在 Codex CLI / 本机 OAuth 路径。
- 若未来允许「凭据上云」，**OAuth refresh token / 本机 token 文件路径** 敏感度高，应 **默认不同步** 或与用户做 **额外风险提示 + 独立开关**，不宜与「仅 API Key」混在同一模糊开关里。

## 实现落地时检查清单（供后续 PR 使用）

- [ ] 设置页：账号登录 + 「云端同步范围」分组，**凭据类**单独一项，默认关闭或按产品策略默认仅该项可开。
- [ ] 传输：HTTPS + 服务端加密存储（KMS / 应用层加密），密钥与用户账号绑定；不在日志中打印明文 Key。
- [ ] 合并策略：与本机 `settings.json` 冲突时的规则（以云为准 / 以本地为准 / 逐项选择）需写清。
- [ ] 文档：`data-storage.md` 若增加「云同步子集」路径说明，须与 `file-store` 及本文件一致。
- [ ] [`AI_AGENT_KNOWLEDGE_MAP.md`](../AI_AGENT_KNOWLEDGE_MAP.md) 变更记录登记。

## 参考实现：PR #39（Google 登录 + 本机按账号分目录）

**PR**：[#39 feat: Google 账号登录与按用户本地数据隔离](https://github.com/Kaine665/Project-Pilot/pull/39)（当前多为 **Open / Draft**，head 分支名可能为 `cursor/...`；说明里亦提到 `origin/feature/google-account-oauth`，以 GitHub 上实际 compare 分支为准。）

**该 PR 在做什么（摘要）**

| 方向 | 内容 |
|------|------|
| 认证 | Google OAuth2；**HttpOnly Cookie + 服务端 JWT 会话** |
| 数据根 | 登录后本机数据根为 **`~/.project-pilot/accounts/<google-sub>/`**（与「整盘一份 `~/.project-pilot`」隔离） |
| 请求域 | `AsyncLocalStorage`（或等价）在 **`file-store`** 中解析当前请求的 `DATA_DIR`；切换账号时 **重置缓存与长生命周期管理器**（如 scheduler / event-trigger 等 PR 内改动） |
| 前端 | 设置页 **登录 / 登出**；`apiFetch` **带 credentials** 以支持跨源 API 携带 Cookie |
| 服务端 | 新路由：`google-auth.ts`、中间件 `account-data-root.ts`；`index.ts` 挂载；**`.env.example`** 增加 Google Client ID/Secret 等 |
| 文档 | `data-storage.md` 补充 **accounts 布局** |

**与本文「云端按类同步」的关系**

- PR #39 解决的是 **「谁登录 → 本机哪一块目录归他」**（**本地隔离**），**不是**把数据同步到你们自建云端。
- 本文解决的是 **若将来提供云端能力，同步哪几类数据**；与 #39 **可叠加**：身份仍用 Google 登录；**工作数据默认仍在** `accounts/<sub>/` **本地**；**仅当用户打开「凭据云同步」** 时，再把 `providerCredentials` 等子集加密同步到服务端。
- **合并 / 重做 PR 时建议**：以 #39 为 **鉴权 + 本机分桶** 基线，再单独开 **「云同步范围」** 能力与 UI，避免把「换账号」和「全量上云」绑死。

## 与整体产品边界的关系

若实现「Google 登录 + 用户隔离」，**隔离边界**建议定义为：

- **账号身份**：用于鉴权与（可选）**云命名空间**；
- **工作数据**：默认仍在本地 `DATA_DIR`（#39 的 `accounts/<sub>/`），除非用户为某一类数据**额外**打开云端同步。

本文中的 **「仅同步 AI 凭据」** 是 **云侧最小子集** 的产品推荐，不排斥未来增加其它可选类别，但每一类都应是 **独立开关 + 清晰说明**。
