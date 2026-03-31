# AI Agent 项目知识地图与多入口同步

## 为什么需要本文

不同厂商的 IDE / CLI / 产品内 Agent 会读取**不同文件**作为「项目记忆」。若不维护一张总表和同步协议，会出现：Cursor 与 Claude Code 认知不一致、内置 Butler 仍引用旧路径、文档改了但某入口未更新等问题。

**本文是仓库内「AI 应读哪些文档、改什么要联动哪里」的权威索引。** 人类或任一 AI 在变更项目级事实（路径、架构、工作流）时，应先打开本文，按检查清单更新相关入口。

## 多入口一览（须相互感知）

| 入口 | 路径 | 主要读者 | 作用 | 必须与谁对齐 |
|------|------|----------|------|----------------|
| **本知识地图** | `develop-static/docs/AI_AGENT_KNOWLEDGE_MAP.md` | 所有 AI | 索引 + 同步协议 + 变更记录 | `file-store`、下文各入口 |
| **Cursor / 通用 Agent** | 仓库根 `AGENTS.md` | Cursor 等 | 短入口，指向 `develop-static` | 本文 |
| **Claude Code** | `develop-static/CLAUDE.md` | Claude | 架构、文档驱动开发、命令 | `MEMORY.md`、本文、`data-storage.md` |
| **短记忆** | `develop-static/MEMORY.md` | Claude Code 等 | 高密度结论 | `data-storage.md`、本文 |
| **Cursor 规则** | `.cursor/rules/*.mdc` | Cursor Agent | 沙箱、终端等 | 若涉及数据路径则对齐 `data-storage.md` |
| **内置 Agent 提示词** | `develop-static/src/data/defaults/builtin-prompts.ts` | 产品内 Butler / Self-Dev 等 | 用户数据路径、能力描述 | **`docs/data-storage.md`（路径事实必须一致）** |
| **人类 docs 总入口** | `develop-static/docs/README.md` | 人类 + AI | `docs/` 分层与权威关系 | `data-storage.md` |
| **数据路径（代码对齐）** | `develop-static/docs/data-storage.md` | 所有 | 与 `get*Path` 一致的树与表 | `src/lib/file-store.ts` |
| **本机磁盘规范（不在 Git）** | `~/.project-pilot/README.md`、`数据文件夹现状.md` | 人类排错、迁移 | 真实目录与进度 | 由 `data-storage.md` 引用，重大变更时人工同步 |

可选扩展（若仓库后续增加）：`.github/copilot-instructions.md`、`.codex/config` 等。**新增时须在本表加一行**，并在变更记录登记。

## 文档体系速查（仓库内）

| 类型 | 入口 |
|------|------|
| 文档三层（as-is / design / contracts） | [`documentation-system/README.md`](./documentation-system/README.md) |
| 数据目录与路径函数 | [`data-storage.md`](./data-storage.md) |
| 数据规范索引 | [`data-spec/README.md`](./data-spec/README.md) |
| Agent Chat 架构 | [`agent-chat-architecture.md`](./agent-chat-architecture.md) |
| 统一文档（设计 + 知识） | [`context-system.md`](./context-system.md) |
| 产品说明与快速开始 | [`../README.md`](../README.md) |

## 变更时同步检查清单

### A. 数据目录 / 默认根 / 路径函数

- [ ] `develop-static/src/lib/file-store.ts`
- [ ] `develop-static/docs/data-storage.md`
- [ ] `develop-static/MEMORY.md`（「数据存储」节）
- [ ] `develop-static/CLAUDE.md`（「数据层」相关段落）
- [ ] `develop-static/src/data/defaults/builtin-prompts.ts`（凡出现 `~/.project-pilot`、域名的段落）
- [ ] 本机 `~/.project-pilot/README.md` / `数据文件夹现状.md`（若影响用户可见规范）
- [ ] `develop-static/scripts/data-layout-migration.md` 或 `run-layout-migrations.ts` 头注释（若影响离线行为）

### B. 技术栈 / 端口 / 开发命令

- [ ] `develop-static/CLAUDE.md`
- [ ] `develop-static/MEMORY.md`（若有对应条）
- [ ] `develop-static/README.md`（快速开始）

### C. 文档驱动开发 — 新能力域

- [ ] `develop-static/CLAUDE.md` 中「域索引」表
- [ ] `develop-static/docs/as-is/` 与 `docs/design/` 新页或更新
- [ ] 视需要在 `MEMORY.md` 增加一行索引

### D. 完成后的「多工具可见性」

- [ ] 在本文件底部 **变更记录** 表追加一行（日期、摘要、已更新的入口文件）
- [ ] 若某入口文件被删或重命名，**同步更新本文件「多入口一览」表**

## 变更记录

| 日期 | 摘要 | 已更新入口（示例） |
|------|------|---------------------|
| 2026-03-31 | 初版：多 AI 入口地图、同步清单 | 本文件、`AGENTS.md`、`MEMORY.md`、`CLAUDE.md`、`docs/README.md`、`.cursor/rules/ai-knowledge-sync.mdc` |
| 2026-03-31 | 数据根与文档与 `file-store` 对齐 | `data-storage.md`、`builtin-prompts.ts`、`MEMORY.md`、`CLAUDE.md` 等 |

（后续变更请继续追加表格行，勿删历史。）
