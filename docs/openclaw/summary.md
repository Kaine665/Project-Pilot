# OpenClaw 技术架构总结

> 作者总结，基于 2026-02-24 公开资料整理

## 一句话定位

OpenClaw 是一个**本地优先、常驻运行的开源 AI Agent 框架**，核心卖点是：一个 Node.js 网关进程 + 50+ 消息渠道 + 可插拔技能系统 + 自主心跳调度 = 7×24 个人 AI 助手。

## 项目简史

```
2025-11  Clawdbot 发布（Peter Steinberger，奥地利独立开发者）
2026-01-27  因 Anthropic 商标投诉改名 Moltbot
2026-01-29  主动改名 OpenClaw（去厂商绑定）
2026-01-30  GitHub 100K stars（2 天，峰值 710 stars/h）
2026-02-14  Steinberger 宣布加入 OpenAI，项目移交开源基金会
2026-02-22  最新版本 openclaw 2026.2.22
```

## 架构全景

```
┌──────────────────────────────────────────────────┐
│                   openclaw.json                   │
│           (配置中心，热加载，严格校验)              │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│               Gateway (port 18789)                │
│         单 Node.js 进程，五个子系统                 │
│  ┌─────────┬─────────┬─────────┬────────────────┐ │
│  │ 消息路由 │ Session │  工具   │    事件/存储    │ │
│  │         │  管理   │  分发   │                │ │
│  └────┬────┴────┬────┴────┬────┴────────────────┘ │
└───────┼─────────┼─────────┼──────────────────────┘
        │         │         │
   ┌────▼────┐ ┌──▼──┐ ┌───▼────┐
   │ Channels│ │ LLM │ │ Tools  │
   │ 50+渠道 │ │ 多供 │ │Skills  │
   │WhatsApp │ │ 应商 │ │MCP     │
   │Telegram │ │ 轮换 │ │Lobster │
   │Slack... │ │      │ │        │
   └─────────┘ └──────┘ └────────┘
```

## 核心技术名词表

### 基础设施层

| 名词 | 含义 | 对标 |
|------|------|------|
| **Gateway** | 常驻网关进程，控制平面 | — |
| **openclaw.json** | 中心化配置文件，支持 `$include`、严格 schema | CLAUDE.md（但更结构化） |
| **Channel** | 消息渠道适配器（WhatsApp/Telegram/Slack 等） | — |
| **Binding** | 入站消息 → Agent 的路由规则 | — |
| **Heartbeat** | 定时唤醒调度器（默认 30min），主动检查待办 | Cron，但带 AI 判断 |

### Agent 层

| 名词 | 含义 | 对标 |
|------|------|------|
| **IDENTITY.md** | Agent 身份定义（"我是谁"） | CLAUDE.md 的身份部分 |
| **SOUL.md** | Agent 人格/语调定义 | System prompt 人格段 |
| **TOOLS.md** | 可用工具 schema 声明 | MCP tool definitions |
| **Multi-Agent Routing** | 多 Agent 隔离路由，独立 auth + session | Claude Code Agent Teams |
| **Auth Profile Rotation** | 同 provider 内按限流轮换认证 | — |
| **Session Stickiness** | Auth profile 按 session 固定，非逐请求轮换 | — |

### 能力扩展层

| 名词 | 含义 | 对标 |
|------|------|------|
| **Skills** | Markdown 技能文件（`~/clawd/skills/<name>/SKILL.md`） | Claude Code Skills |
| **ClawHub** | 社区技能注册表（5700+ 技能） | npm / VS Code Marketplace |
| **MCP Tools** | Model Context Protocol 标准工具接入 | Claude Code MCP |
| **Lobster** | 类型化工作流引擎，pipeline + 审批 + 可恢复 | GitHub Actions（但更轻量） |
| **Cron Jobs** | 定时任务，由 Heartbeat 驱动 | 系统 Cron |

### 状态与记忆

| 名词 | 含义 | 对标 |
|------|------|------|
| **Memory** | 本地 Markdown 文件存储的跨会话记忆 | Claude Code auto memory |
| **Compaction** | 对话摘要压缩 | Claude Code Compaction |
| **Local-first** | 所有数据本地存储，用户完全拥有 | — |

### 安全层

| 名词 | 含义 |
|------|------|
| **Policy Chain** | 五层策略链：global → provider → agent → session → sandbox |
| **Device Authorization** | 设备级授权（v2026.2.19） |
| **SBOM** | 软件物料清单，每次发布自动生成 |
| **CVE Checking** | CI/CD 中自动漏洞检查 |

## 与 Claude Code 的对比

| 维度 | OpenClaw | Claude Code |
|------|----------|-------------|
| **定位** | 全渠道 AI 助手（生活+工作） | 编程 AI 助手 |
| **运行模式** | 常驻守护进程 + 心跳 | 按需启动 CLI/IDE |
| **消息渠道** | 50+ 平台 | Terminal/IDE/Web |
| **LLM** | 模型无关（多 provider 轮换） | Anthropic Claude |
| **扩展机制** | Skills + MCP + Lobster | Skills + MCP + Hooks + Subagents |
| **多 Agent** | Multi-Agent Routing | Agent Teams |
| **记忆** | Markdown 文件（本地） | auto memory（本地） |
| **数据存储** | 全本地 Markdown | 本地文件 |
| **开源** | MIT | 源码可用（非 MIT） |
| **社区规模** | 100K+ stars（2 天） | 主流 IDE 集成 |

## 对 ProjectPilot 的启发

1. **Heartbeat 模式** — Session 不一定要等用户触发，可以定期检查任务状态、主动推送进展。ProjectPilot 的 Task Agent 可以借鉴这种"主动唤醒"模式。

2. **IDENTITY.md / SOUL.md 分离** — 把 Agent 的身份和人格拆成独立文件，比全塞一个 system prompt 更清晰。ProjectPilot 的 prompt-builder 可以考虑类似分层。

3. **Lobster 审批 + 可恢复** — 工作流中的副作用需要显式审批，暂停后可恢复。ProjectPilot 的五阶段工作流中"执行阶段"涉及代码变更，可以借鉴这种 checkpoint 机制。

4. **五层 Policy Chain** — 工具执行前的分层门控。ProjectPilot 的 phase-permissions 目前是单层映射，如果未来支持多 Agent 或多项目，可以考虑类似的分层策略。

5. **Skills 即 Markdown** — 技能定义为 Markdown 文件、运行时加载、无需编译，这个模式与 Claude Code 的 Skills 一致，值得 ProjectPilot 在自定义工作流模板中采用。
