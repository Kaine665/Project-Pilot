# OpenClaw 搜索资料汇编

> 搜索日期：2026-02-24

## 一、项目概况

OpenClaw（原 Clawdbot → Moltbot → OpenClaw）是由奥地利开发者 **Peter Steinberger** 创建的开源自主 AI Agent 框架。2025 年 11 月首次发布，2026 年 1 月底爆火，2 天内 GitHub 达到 100K stars（峰值 710 stars/hour）。

### 改名时间线

| 时间 | 名称 | 原因 |
|------|------|------|
| 2025-11 | **Clawdbot** | 初始名，源自 Anthropic 的 Claude |
| 2026-01-27 | **Moltbot** | Anthropic 商标投诉，改为 Moltbot（龙虾蜕壳 = molting） |
| 2026-01-29 | **OpenClaw** | 主动改名，强调开源 + 保留 claw 标识，不再绑定任何厂商品牌 |
| 2026-02-14 | — | Steinberger 宣布加入 OpenAI，项目移交开源基金会 |

来源：[Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)、[CNBC](https://www.cnbc.com/2026/02/02/openclaw-open-source-ai-agent-rise-controversy-clawdbot-moltbot-moltbook.html)、[Fortune](https://fortune.com/2026/02/19/openclaw-who-is-peter-steinberger-openai-sam-altman-anthropic-moltbook/)、[LumaDock](https://lumadock.com/blog/clawdbot-moltbot-openclaw-rebrand)

---

## 二、核心架构

### Gateway（网关）

> "The Gateway is the always-on control plane; the assistant is the product."

- 单个持久化 Node.js 进程，无微服务
- 默认端口 18789，提供 Control UI + WebChat 界面
- 热加载配置：监听 `~/.openclaw/openclaw.json`，大部分改动无需重启
- 五个核心子系统：消息路由、Agent 会话管理、工具分发、事件系统、存储

来源：[ppaolo.substack.com](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)、[practiceoverflow.substack.com](https://practiceoverflow.substack.com/p/deep-dive-into-the-openclaw-gateway)

### 消息处理流程

每条入站消息的执行顺序：
1. Channel adapter 接收消息
2. Gateway 路由到对应 session
3. 组装 System prompt：
   - `IDENTITY.md`（Agent 身份）
   - `SOUL.md`（人格/语调）
   - `TOOLS.md`（可用工具 schema）
   - 活跃 Skills 注入
   - Memory 文件前置
4. LLM 处理 → 可选工具调用 → 响应回写原始 channel

来源：[DEV Community](https://dev.to/entelligenceai/inside-openclaw-how-a-persistent-ai-agent-actually-works-1mnk)

### 五层策略链（Policy Chain）

工具执行前经过五层策略验证：

```
global → provider → agent → session → sandbox
```

分层门控确保未授权操作不会到达执行层。

来源：[OpenClaw Architecture Deep Dive](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)

---

## 三、配置体系

### openclaw.json

- 支持 `$include` 指令引入外部配置（如 `./agents.json5`）
- 严格 schema 校验，未知键 / 类型错误 → Gateway 拒绝启动
- 主要区块：
  - `gateway` — 端口等基础设置
  - `channels.<provider>` — 各平台配置（WhatsApp / Telegram / Discord / Slack / Signal 等）
  - `models.providers` — LLM 提供商配置（API Key、baseUrl、api type）
  - `agents` — 多 Agent 定义
  - `heartbeat` — 心跳调度器配置

来源：[OpenClaw Docs - Configuration](https://docs.openclaw.ai/gateway/configuration)、[GitHub config example](https://gist.github.com/digitalknk/4169b59d01658e20002a093d544eb391)、[CoClaw Guides](https://coclaw.com/guides/openclaw-configuration/)

---

## 四、核心概念

### Skills（技能）

- 文件路径：`~/clawd/skills/<skill-name>/SKILL.md`
- Markdown 格式定义，运行时加载，无需编译
- 公共注册表 **ClawHub** 托管 5,705+ 社区技能（截至 2026-02-07）
- 安装即时生效

来源：[VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)、[LobeHub Skills Marketplace](https://lobehub.com/skills/openclaw-skills-memory-complete)

### Memory（记忆）

- 本地优先：存储为 `~/.openclaw/` 下的 Markdown 平面文件
- 每次对话压缩存储，跨会话保持上下文
- 可直接在文件管理器中浏览/编辑

来源：[OpenClaw Docs - Memory Research](https://docs.openclaw.ai/experiments/research/memory)

### Heartbeat（心跳）

- 默认每 30 分钟唤醒一次
- 读取 Agent 所有文件，检查是否有需要主动处理的事项
- 仅在确实需要时发送消息（非盲目轮询）

来源：[DEV Community](https://dev.to/entelligenceai/inside-openclaw-how-a-persistent-ai-agent-actually-works-1mnk)

### Multi-Agent Routing（多代理路由）

- 通过 **bindings** 将入站消息路由到指定 agentId
- 按 (channel, accountId, peer) 和可选的 guild/team id 匹配
- 每个 Agent 独立的 auth + session，默认无交叉通信

来源：[OpenClaw Docs - Multi-Agent](https://docs.openclaw.ai/concepts/multi-agent)

### Auth Profile Rotation（认证轮换）

- 同一 provider 内按限流自动轮换 auth profile（OAuth → API keys）
- Session 粘性：auth profile 按 session 固定（非逐请求轮换），保持缓存
- `/new`、`/reset` 或 compaction 时重置
- `auth.order` 控制 failover 顺序

来源：[OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)

---

## 五、Lobster 工作流引擎

[GitHub - openclaw/lobster](https://github.com/openclaw/lobster)

- **定位**：OpenClaw 原生的类型化工作流 shell
- **核心价值**：将 skills/tools 组合为可编排的 pipeline，一次调用替代多步操作
- **审批内置**：有副作用的步骤（发邮件、发评论）暂停等待显式审批
- **可恢复**：暂停的工作流返回 token，审批后继续执行，不重跑已完成步骤

来源：[OpenClaw Docs - Lobster](https://docs.openclaw.ai/tools/lobster)

---

## 六、MCP 集成

- 支持 MCP（Model Context Protocol）标准
- 自定义 MCP 工具接入 OpenClaw Gateway
- 生产案例：13 cron jobs + 78 custom MCP tools + 多个 skills

来源：[Context Studios Blog](https://www.contextstudios.ai/blog/build-your-own-ai-workflows-skills-cron-jobs-custom-mcp-tools-in-openclaw)

---

## 七、生态与集成

### 平台支持

50+ 渠道集成：WhatsApp、Telegram、Slack、Discord、Signal、iMessage、Google Chat、Microsoft Teams、Matrix、Zalo 等

### 企业集成

- **Runlayer** — 为大型企业提供安全的 OpenClaw agentic 能力
- **ClawWork**（HKUDS）— OpenClaw 作为 AI Coworker
- **ClawApp**（SaharaAI）— 简化版 OpenClaw 部署
- **ClawRouter**（BlockRunAI）— Agent-native LLM 路由器

### 安全

- v2026.2.19 引入设备授权安全模型
- 自动 CVE 检查、SBOM 生成、可重现构建

来源：[VentureBeat](https://venturebeat.com/orchestration/runlayer-is-now-offering-secure-openclaw-agentic-capabilities-for-large)、[CrowdStrike](https://www.crowdstrike.com/en-us/blog/what-security-teams-need-to-know-about-openclaw-ai-super-agent/)

---

## 八、当前版本

**openclaw 2026.2.22**（2026 年 2 月 22 日）— 支持 Mistral provider + memory embeddings + voice

来源：[GitHub Releases](https://github.com/openclaw/openclaw/releases)
