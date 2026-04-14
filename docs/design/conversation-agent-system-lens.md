# 对话与 Agent 系统：八层对照视角

> **用途**：给产品 / 架构 / 实现讨论提供**统一分层语言**，并对照业界三类实现（Claude Code harness、Hermes Agent、OpenHarness）与 ProjectPilot（PP）的差异。  
> **性质**：`design` — 原则与对照框架；实现细节与入口以 `docs/as-is/agents-workspace.md`、`docs/agent-chat-architecture.md` 为准。  
> **last_reviewed**: 2026-04-14

---

## 1. 为什么需要「八层」

「对话功能好不好」容易被拆成零散需求（流式、记忆、子代理…）。八层把**会话面、状态、循环、上下文、工具、并行、观测、学习**拆开，便于：

- 对标外部项目时，知道比的是**哪一层**，避免拿 A 的 UI 去比 B 的循环实现；
- 改 PP 时，判断应**上浮到 Hono**、**留在 SDK**、还是**做新数据面**（见第 4 节与 PP 映射）。

---

## 2. 八层定义（每层回答什么）

| 层 | 代号 | 回答的问题 |
|----|------|------------|
| 1 | **Transport / UI** | 用户在哪说话：Web、终端、Telegram…；中断、重试、流式展示 |
| 2 | **Session 身份与持久化** | `session` 的边界、存哪、恢复、多设备是否同一逻辑会话 |
| 3 | **Agent loop（回合循环）** | 谁持有 `while`：本进程自写循环，还是外包给 SDK / 子进程 |
| 4 | **上下文工程** | 系统提示、项目记忆、附件、压缩、token 预算、模型元数据 |
| 5 | **工具与权限** | 工具定义、执行、并发、审批、沙箱、生命周期 hook |
| 6 | **子代理 / 并行** | Task、worktree、回合间注入（steering）、多工作流 |
| 7 | **可观测与治理** | 用量、成本、审计、评测、CI 无人值守模式 |
| 8 | **纵向学习（跨会话）** | 技能沉淀、记忆检索、用户建模、聊完是否写回项目记忆 |

评价「对话系统」时，按层勾选：**哪层是 PP 必须自研、哪层可委托给 Claude Agent SDK / Codex SDK**。

---

## 3. 三个外部参考项目（如何分层）

以下仓库为**外部开源对照**，路径以官方 Git 为准；本地克隆仅作个人阅读，不进本仓库子模块。

### 3.1 Claude Code harness（Anthropic 系运行时本体）

- **典型形态**：`QueryEngine` + `query.ts` 中大循环；流式工具执行、终止条件（无 tool / maxTurns / budget / hook / abort）同源可见。
- **强项层**：3（循环）、4（CLAUDE.md / 自动记忆 / session memory / compact）、5（权限栈、Bash 校验、沙箱、MCP 与内置工具同链）、6（AgentTool、fork、worktree、Swarm 等）。
- **弱项（对 PP 而言）**：与 PP **产品形态不同**（终端/IDE 一体）；若要像素级抄能力，等于绑定其发布节奏与进程模型。
- **本仓库内延伸阅读**： harness 行为拆解见 `docs/claude-code-harness-study-notes.md`（基于社区可读的 harness 源码笔记）；PP 实际调用链见 `docs/agent-chat-architecture.md`（`query()` 与子进程 JSONL）。

**一句话**：**自研 Agent OS 的完整参考**；PP 通过 **Claude Agent SDK** 间接使用其能力栈的大部分。

### 3.2 Hermes Agent（`https://github.com/NousResearch/hermes-agent`）

- **典型形态**：**网关**（CLI / Telegram / Discord / Slack…）与 **`run_agent` / `AIAgent`** 核心分离；多通道会话状态、打断、流式批处理在 gateway 层大量工程化。
- **强项层**：1–2（多会话面与连续性）、3（Python 自研循环 + 多厂商适配）、4（`prompt_builder`、`context_compressor`、`model_metadata` 等模块边界清晰）、**8（学习闭环：技能自演进、会话检索、用户建模等，产品叙事强）**。
- **一句话**：**多入口 + 长生命周期 + 显式上下文管线 + 跨会话学习**；适合对标「会话平台化」与「聊完变聪明」，而非仅 Web 内嵌聊天。

### 3.3 OpenHarness（`https://github.com/AgentBoardTT/openharness`，PyPI 名 `harness-agent`）

- **典型形态**：`harness.core.engine.run()` 组装 **Provider + ToolManager + Session + PermissionManager + hooks + MCP + steering + sandbox** → **`AgentLoop`**（`user → model → tools → …` 全在本仓库 Python 内）。
- **强项层**：**模块化边界**（3/4/5/6 分包清晰）、**steering**（回合间注入用户消息）、7（eval / audit / observability 目录存在）。
- **一句话**：**可嵌入的教科书式循环**；适合对标「若 PP 要在服务端显式掌控循环与策略，模块应如何切」。

---

## 4. ProjectPilot 的映射（与飞轮的关系）

| 层 | PP 现状（概括） | 与五模块飞轮的近似关系 |
|----|----------------|------------------------|
| 1 | Web `AgentChatPanel` + SSE；工作区壳与侧栏 | 偏 **Dashboard / 工作区** 呈现 |
| 2 | 会话落盘、列表、分叉、归档等（见 as-is） | **Memory** 的「会话实例」载体，非长期知识本身 |
| 3 | **Claude `query()` / Codex SDK** 持有主循环；`AgentChatManager` 编排启动与事件适配 | **Runtime** 主体在 SDK；PP 做编排 |
| 4 | ResourceRegistry、prompt 文件、skills、运行时副本等 | **Loader** + 部分 **Memory** 输入 |
| 5 | 大量在 SDK/CLI；PP 有危险命令检测、设置与 UI | 安全与体验在 PP 与 SDK 间**分工** |
| 6 | Task/worktree 等另一条执行线；Chat 内子代理能力相对轻 | **Runtime** 扩展，与 Chat 深度可继续设计 |
| 7 | 应用内为主；评测/审计非核心 | 可随企业需求增强 |
| 8 | 架构上 **Distiller 仍缺**（见根 `CLAUDE.md` 飞轮表） | **Distiller** 空白 = 纵向学习缺口 |

**设计结论（可重复引用）**：

- PP 是 **「强工作区 + 会话管理 + 资源注入」包在商用 Agent 运行时外」**；对标 Claude Code **本体**时，应清楚哪些行为在 **SDK 黑盒** 内、哪些必须在 **PP 文档与 as-is** 里写清。
- 若产品要向 **Hermes** 靠拢，优先投资 **1–2（多面与会话连续性）** 与 **8（沉淀闭环）**，而不是先自研整套 tool loop。
- 若要向 **OpenHarness** 靠拢，优先把 **3–5 的策略**（压缩、权限回调、steering 语义）在 **Hono 与类型事件** 上**显式化**、可测试。

---

## 5. 相关文档（必读顺序建议）

| 顺序 | 文档 | 作用 |
|------|------|------|
| 1 | `docs/AI_AGENT_KNOWLEDGE_MAP.md` | 多入口同步与总索引 |
| 2 | `docs/agent-chat-architecture.md` | PP Agent Chat 数据流与 Runner 约束 |
| 3 | `docs/as-is/agents-workspace.md` | 工作区 UI 与会话列表现状 |
| 4 | `docs/design/agents-workspace.md` | 工作区原则与目标态 |
| 5 | `docs/claude-code-harness-study-notes.md` | Claude Code harness 能力拆解（只读参考） |

---

## 6. 修订记录

| 日期 | 摘要 |
|------|------|
| 2026-04-14 | 初版：八层模型 + 三外部项目对照 + PP 映射与读序 |
