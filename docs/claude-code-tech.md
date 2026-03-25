# Claude Code 技术名词汇总（截至 2026-02-24）

## 核心扩展体系

| 名词 | 说明 |
|------|------|
| **CLAUDE.md** | 项目级配置文件，设定上下文、约定、指令 |
| **Skills** | 技能系统，位于 `.claude/skills/<name>/SKILL.md`，Claude 根据对话上下文自动匹配加载 |
| **Hooks** | 生命周期钩子，在特定时刻（PreToolUse / PostToolUse / WorktreeCreate 等）执行确定性代码 |
| **Subagents** | 自定义子代理，用 Markdown + YAML frontmatter 定义，可限制工具、权限、模型、MCP 等 |
| **Slash Commands** | `/command` 快捷指令，存放在 `.claude/commands/` 目录 |
| **MCP (Model Context Protocol)** | 外部工具/服务器的标准化扩展协议，支持 OAuth、allowlist/denylist、`structuredContent` 等 |

## Worktree Isolation（工作树隔离）

| 名词 | 说明 |
|------|------|
| **Worktree Isolation** | Agent 在独立的 git worktree 中运行，互不干扰，支持并行开发 |
| **`isolation: worktree`** | Agent 定义中的声明式字段，自动创建隔离工作树 |
| **WorktreeCreate / WorktreeRemove** | 工作树创建/销毁时触发的 Hook 事件 |

## Context Engineering（上下文工程）

| 名词 | 说明 |
|------|------|
| **Compaction** | 长对话自动摘要压缩，释放上下文窗口空间 |
| **Context Fork** | 上下文分叉，从当前对话状态分出新的独立分支 |
| **State Rehydration** | 通过外部可读产物（artifact）恢复代理状态，支持冷启动续作 |
| **Tool Result Persistence** | 超过 50K 字符的工具结果持久化到磁盘，减少上下文占用 |

## SDK 演进

| 名词 | 说明 |
|------|------|
| **Claude Agent SDK** | 原 Claude Code SDK 更名，反映更广泛的代理构建能力 |
| **`--agents` flag** | CLI 参数，接受 JSON 配置内联定义代理（同 frontmatter 字段） |
| **`claude agents`** | 新 CLI 命令，列出所有已配置的代理 |
| **Agent Memory** | 代理记忆系统，`memory` frontmatter 支持 user / project / local 作用域 |
| **Sub-agent Restrictions** | 通过 `Task(agent_type)` 语法限制可生成的子代理类型 |
| **Skill Hot-Reload** | 技能热重载，修改 SKILL.md 后无需重启即生效 |

## 认证与平台

| 名词 | 说明 |
|------|------|
| **`claude auth`** | 新认证子命令：`login` / `status` / `logout` |
| **CLAUDE_CODE_SIMPLE** | 极简模式环境变量，禁用 MCP、附件、Hooks、CLAUDE.md 加载 |
| **`/debug`** | 会话调试命令，Claude 自行排查当前会话问题 |
| **`/teleport`** | 跨环境迁移工作上下文（Web ↔ CLI 等） |

## 集成生态

- **Apple Xcode 26.3** — 原生集成 Claude Agent SDK，可捕获 Xcode Previews 做视觉迭代
- **Microsoft Agent Framework** — 与 Claude Agent SDK 集成，支持文件编辑、代码执行、MCP 等
- **多表面支持** — Terminal / VS Code / JetBrains / Desktop / Web / CI/CD / Chat

## 当前模型（2026-02）

- **Claude Opus 4.6** — 最新旗舰模型，Fast mode 支持完整 1M 上下文窗口
- **Claude Sonnet 4.6** — 平衡模型，更好的 agentic search 性能，更少 token 消耗

## 当前版本

Claude Code **v2.1.50**（2026 年 2 月）

## 参考来源

- [Claude Code CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Claude Code Overview](https://code.claude.com/docs/en/overview)
- [Subagents 文档](https://code.claude.com/docs/en/sub-agents)
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
