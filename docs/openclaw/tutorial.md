# OpenClaw 入门教程：从零理解整个系统

> 写给没接触过 OpenClaw 的人，用最直白的方式讲清楚它是什么、怎么运作。

## 它到底是什么？

想象你有一个 AI 管家，24 小时住在你的电脑里。你可以通过微信、Telegram、Slack 任何你习惯的聊天软件跟它说话，它能帮你查资料、发邮件、写代码、管日程——而且你睡着了它还能自己醒来检查有没有事要做。

这就是 OpenClaw。

**一句话版本**：一个跑在你自己电脑上的 AI 助手，连着你所有的聊天软件，能用各种工具帮你干活。

## 先搞懂一个核心比喻

OpenClaw 的整个架构可以用**酒店前台**来理解：

```
你（住客）── 通过电话/微信/前台面对面 ──→ 前台（Gateway）──→ 管家（Agent）
                    ↑                           ↑                    ↑
                 渠道 Channel              路由 + 管理           实际干活的 AI
```

- **你** = 用户，通过各种渠道发消息
- **前台（Gateway）** = 永远在线的总控程序，负责接消息、派活、记账
- **管家（Agent）** = AI 大脑，理解你的意思，调用工具完成任务

关键点：**前台不是管家**。前台是基础设施，管家才是产品。

---

## 六个核心概念，一个一个来

### 1. Gateway（网关）—— 永不下班的前台

Gateway 是一个 Node.js 程序，启动后一直运行。它做三件事：

- **接消息**：从 WhatsApp、Telegram、Slack 等 50+ 渠道收消息
- **派活**：把消息分给对应的 Agent 处理
- **管状态**：记住每个对话在聊什么、用的哪个 AI 模型

```
启动后监听端口 18789
你可以打开浏览器访问 http://localhost:18789 看到控制面板
```

**跟 Claude Code 的区别**：Claude Code 是你主动打开才运行，用完就关。Gateway 是一直开着的守护进程。

---

### 2. Channel（渠道）—— 你跟它说话的方式

Channel 就是消息通道。OpenClaw 支持 50 多个：

| 常用渠道 | 说明 |
|---------|------|
| WhatsApp | 手机上直接对话 |
| Telegram | Bot 模式 |
| Slack | 工作群集成 |
| Discord | 社区/游戏群 |
| WebChat | 浏览器内置聊天框 |
| iMessage | 苹果生态 |
| Signal | 加密通讯 |

**配置方式**：在 `openclaw.json` 里填对应平台的 API Key 就行。

```jsonc
// openclaw.json 片段
{
  "channels": {
    "telegram": {
      "botToken": "你的Telegram Bot Token"
    },
    "slack": {
      "botToken": "你的Slack Bot Token"
    }
  }
}
```

**直觉理解**：Channel 是"耳朵"——OpenClaw 通过它听到你说话，也通过它回复你。

---

### 3. Agent 身份三件套 —— 它"是谁"

每个 Agent 由三个 Markdown 文件定义：

| 文件 | 作用 | 例子 |
|------|------|------|
| `IDENTITY.md` | 我是谁 | "你是一个项目管理助手，擅长拆解任务" |
| `SOUL.md` | 我的性格 | "说话简洁，偶尔幽默，不用 emoji" |
| `TOOLS.md` | 我能用什么 | "你可以读写文件、发邮件、查日历" |

**为什么要分开？** 因为同一个"身份"可以配不同的"性格"，同一个"性格"可以搭配不同的"工具"。拆开就能自由组合。

**跟 Claude Code 的对比**：Claude Code 把这些全塞在一个 CLAUDE.md 和 system prompt 里。OpenClaw 拆成了三个文件，更模块化。

---

### 4. Skills（技能）—— 教它新本事

Skill 是一个 Markdown 文件，告诉 Agent "怎么做某件事"。

```
~/clawd/skills/
├── send-email/
│   └── SKILL.md        ← "当用户要发邮件时，调用 Gmail API..."
├── search-jira/
│   └── SKILL.md        ← "当用户问 Jira 工单时，用这个 API..."
└── daily-report/
    └── SKILL.md        ← "每天汇总 GitHub commits 生成日报..."
```

**安装技能**：把文件夹放进去就行了，不需要编译、不需要重启。Agent 下次被唤醒时自动发现新技能。

**社区生态**：ClawHub（官方技能市场）有 5700+ 社区技能，一键安装。

**直觉理解**：Skill 是"说明书"——你给管家一本《如何做咖啡》的说明书，它就会做咖啡了。

---

### 5. Memory（记忆）—— 它记得你

OpenClaw 的记忆就是一堆本地 Markdown 文件：

```
~/.openclaw/
├── memory/
│   ├── conversations/    ← 历史对话（压缩存储）
│   ├── facts/            ← 关于你的事实（"用户偏好暗色主题"）
│   └── notes/            ← Agent 自己的笔记
```

**三个特点**：
- **本地存储**：全在你电脑上，不上传云端
- **跨会话**：关机重启后还记得之前聊的
- **可编辑**：就是普通文本文件，你可以直接打开改

**跟 Claude Code 的对比**：Claude Code 也有 auto memory（`.claude/` 目录），思路完全一致。

---

### 6. Heartbeat（心跳）—— 它会自己醒来

这是 OpenClaw 最独特的概念。

普通 AI 助手：你问它才答。
OpenClaw：每 30 分钟自己醒来，检查有没有该做的事。

```
你：明天下午 3 点提醒我开会
Agent：好的，已记录

  ... 第二天下午 2:55 ...

[Heartbeat 触发]
Agent 检查记忆 → 发现"3 点有会" → 主动发消息给你：
"提醒：5 分钟后有会议"
```

**不是盲目轮询**：Heartbeat 唤醒后，Agent 会读取所有上下文，用 AI 判断"有没有事需要做"。如果没有，就静静等下一次心跳。不会打扰你。

---

## 一条消息的完整旅程

把所有概念串起来，看一条消息从发出到得到回复的全过程：

```
你在 Telegram 发了一句："帮我查一下明天的天气"

① [Channel - Telegram]
   Telegram Bot 收到消息，转发给 Gateway

② [Gateway - 路由]
   Gateway 识别：这是 Telegram 用户 @zhangsan
   查 Binding 规则 → 路由到 "assistant" Agent 的会话

③ [Policy Chain - 五层检查]
   global ✓ → provider ✓ → agent ✓ → session ✓ → sandbox ✓
   权限通过

④ [Agent - 组装上下文]
   加载：
   - IDENTITY.md（我是个人助手）
   - SOUL.md（友好简洁）
   - TOOLS.md（可用工具列表）
   - 匹配到的 Skill：weather/SKILL.md
   - Memory：用户在北京

⑤ [LLM - 思考]
   AI 决定：调用天气 API，查北京明天天气

⑥ [Tool 执行]
   调用天气 Skill → 获取结果：明天晴，12-22°C

⑦ [响应回写]
   Gateway 通过 Telegram Channel 回复：
   "明天北京晴天，12-22°C，适合出门 🌤"
```

整个过程通常在 2-5 秒内完成。

---

## Lobster —— 当任务变复杂

简单任务（查天气）一步就完成了。但复杂任务需要多步：

> "帮我写一封邮件给老板，汇总本周的 GitHub PR，然后发出去"

这涉及：① 查 GitHub PR → ② 生成汇总 → ③ 写邮件 → ④ 发送

**Lobster** 就是处理这种多步任务的工作流引擎：

```
[查 GitHub PR] → [生成汇总] → [写邮件草稿] → ⏸ 审批 → [发送]
                                                  ↑
                                            你确认后才发
```

**三个关键特性**：

1. **一次调用**：Agent 只需调用一次 Lobster，不用逐步操作
2. **审批卡点**：有副作用的步骤（发邮件、发消息）会暂停等你确认
3. **可恢复**：你确认后从暂停点继续，不会重跑已完成的步骤

**直觉理解**：Lobster 是"流水线"——把多个技能串成一条线，中间该停的地方停，该跑的地方跑。

---

## MCP —— 统一的工具接口

MCP（Model Context Protocol）是一个开放标准，定义了"AI 怎么调用外部工具"。

**不用 MCP 的世界**：每个 AI 平台自己定义工具格式，互不兼容。
**有了 MCP**：工具写一次，OpenClaw 能用，Claude Code 也能用。

```
MCP Tool 定义（简化）：
{
  "name": "get_weather",
  "description": "查询天气",
  "input": { "city": "string" }
}
```

OpenClaw 原生支持 MCP，可以直接接入任何 MCP 兼容的工具服务器。

---

## Multi-Agent —— 一个前台，多个管家

你可以同时运行多个 Agent，各管各的：

```
openclaw.json:
{
  "agents": {
    "work-assistant": {
      "identity": "工作助手",
      "channels": ["slack"]        ← Slack 消息给工作助手
    },
    "life-assistant": {
      "identity": "生活助手",
      "channels": ["telegram"]     ← Telegram 消息给生活助手
    }
  }
}
```

**隔离**：每个 Agent 有独立的记忆、会话、认证，互不干扰。
**Binding 规则**：按 (渠道, 账号, 对话方) 决定消息送给谁。

---

## 配置文件速览

OpenClaw 的所有配置都在一个文件里：`openclaw.json`

```jsonc
{
  // 网关设置
  "gateway": {
    "port": 18789
  },

  // 消息渠道
  "channels": {
    "telegram": { "botToken": "..." },
    "slack": { "botToken": "..." }
  },

  // AI 模型
  "models": {
    "providers": {
      "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" },
      "openai": { "apiKey": "${OPENAI_API_KEY}" }
    }
  },

  // 心跳
  "heartbeat": {
    "interval": "30m"
  }
}
```

**特点**：
- 支持 `$include` 拆分子配置
- 严格校验：写错了 Gateway 直接拒绝启动（不会带着错误配置运行）
- 热加载：改完保存，大部分设置自动生效，不用重启

---

## 安全模型

OpenClaw 跑在你本地，能访问你的文件系统和网络，所以安全很重要。

### 五层策略链

每个工具调用都要过五关：

```
① Global    → 全局开关（某些工具全局禁用）
② Provider  → 模型层限制（这个 AI 模型不允许执行删除）
③ Agent     → Agent 层限制（生活助手不能碰代码仓库）
④ Session   → 会话层限制（这次对话只允许只读操作）
⑤ Sandbox   → 沙箱层（最终执行环境的硬限制）
```

全部通过才能执行。任何一层说"不行"，操作就被拦截。

### 设备授权（v2026.2.19）

新设备连接 OpenClaw 时必须先授权，防止别人连上你的 AI 助手。

---

## 总结：概念关系图

```
openclaw.json（配置一切）
    │
    ├── Gateway（常驻网关，端口 18789）
    │      │
    │      ├── Channels（50+ 消息渠道）
    │      │     你通过这里发消息 ──→
    │      │
    │      ├── Bindings（路由规则）
    │      │     ──→ 决定消息给哪个 Agent
    │      │
    │      └── Policy Chain（五层安全策略）
    │            ──→ 检查工具调用权限
    │
    ├── Agent（AI 大脑）
    │      │
    │      ├── IDENTITY.md（身份）
    │      ├── SOUL.md（人格）
    │      ├── TOOLS.md（工具声明）
    │      │
    │      ├── Skills/（技能库）
    │      │     SKILL.md 文件，教 Agent 新能力
    │      │
    │      ├── Memory/（记忆）
    │      │     Markdown 文件，跨会话保持
    │      │
    │      └── MCP Tools（标准化外部工具）
    │
    ├── Heartbeat（心跳调度器）
    │      每 30 分钟主动唤醒，检查待办
    │
    └── Lobster（工作流引擎）
           多步任务编排，带审批卡点
```

---

## 跟你可能熟悉的东西对比

| 如果你用过... | OpenClaw 里的对应概念 |
|-------------|---------------------|
| ChatGPT / Claude 网页版 | Agent（但能连你的工具和文件） |
| Siri / 小爱同学 | Heartbeat + Channel（但更强更灵活） |
| IFTTT / Zapier | Lobster（但用 AI 决策而非固定规则） |
| Slack Bot | Channel + Skills（但能跨所有平台） |
| Claude Code | 最像，但 OpenClaw 是常驻 + 全渠道 |
| Cron Job | Heartbeat（但带 AI 判断要不要执行） |
