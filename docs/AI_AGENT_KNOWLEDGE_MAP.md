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
| **Cursor MCP（PP stdio）** | 仓库根 `.cursor/mcp.json` + `docs/cursor-mcp-project-pilot.md` | Cursor Agent | 外部 MCP 连接 PP 数据；路径与 `TSX_TSCONFIG_PATH`（根目录 vs `develop-static/` 嵌套） | `mcp-server/index.ts`、本文 |
| **内置 Agent 提示词** | 仓库种子 `src/data/defaults/prompts/builtin/`（`manifest.json` 递增触发覆盖）；运行时 `{DATA_DIR}/prompts/builtin/` + `.applied-builtin-prompts.json`（`builtin-prompt-materialize.ts`） | 产品内 Butler / Self-Dev 等 | 用户数据路径、能力描述 | **`docs/data-storage.md`（路径事实必须一致）** |
| **人类 docs 总入口** | `develop-static/docs/README.md` | 人类 + AI | `docs/` 分层与权威关系 | `data-storage.md` |
| **Git 分支与 GitHub 保护** | `develop-static/docs/github-branch-policy.md` | 维护者 + 贡献者 | `main` / `next` / `feature/*` / `hotfix/*`；Rulesets 清单 | `CONTRIBUTING.md` |
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
| Git 分支策略与 GitHub 权限（维护者） | [`github-branch-policy.md`](./github-branch-policy.md) |
| 社区市场（LobeHub 对标 OKR + 契约） | [`community-marketplace-lobechat-okr.md`](./community-marketplace-lobechat-okr.md) |
| Google 账号与云端同步范围（产品方向；代码参考 **PR #39**） | [`design/google-account-cloud-sync-scope.md`](./design/google-account-cloud-sync-scope.md) |
| 产品说明与快速开始 | [`../README.md`](../README.md) |

## 变更时同步检查清单

### A. 数据目录 / 默认根 / 路径函数

- [ ] `develop-static/src/lib/file-store.ts`
- [ ] `develop-static/docs/data-storage.md`
- [ ] `develop-static/MEMORY.md`（「数据存储」节）
- [ ] `develop-static/CLAUDE.md`（「数据层」相关段落）
- [ ] `src/data/defaults/prompts/builtin/**/*.md` 与 **`manifest.json` version**（凡出现 `~/.project-pilot`、域名的段落）
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

### D. Git 分支策略 / 贡献流程 / GitHub 保护规则

- [ ] `develop-static/CONTRIBUTING.md`（分支表、PR base）
- [ ] `develop-static/docs/github-branch-policy.md`（维护者权限清单）
- [ ] `develop-static/.github/PULL_REQUEST_TEMPLATE.md`（base 分支勾选）
- [ ] `develop-static/docs/README.md`（docs 速查表链接，若新增独立文档）
- [ ] `develop-static/MEMORY.md`（若需 AI 一句速记）
- [ ] `develop-static/CLAUDE.md`（若贡献流程与文档驱动并列时加一句索引）

### E. 完成后的「多工具可见性」

- [ ] 在本文件底部 **变更记录** 表追加一行（日期、摘要、已更新的入口文件）
- [ ] 若某入口文件被删或重命名，**同步更新本文件「多入口一览」表**

## 变更记录

| 日期 | 摘要 | 已更新入口（示例） |
|------|------|---------------------|
| 2026-03-31 | 初版：多 AI 入口地图、同步清单 | 本文件、`AGENTS.md`、`MEMORY.md`、`CLAUDE.md`、`docs/README.md`、`.cursor/rules/ai-knowledge-sync.mdc` |
| 2026-03-31 | 数据根与文档与 `file-store` 对齐 | `data-storage.md`、`builtin-prompts.ts`、`MEMORY.md`、`CLAUDE.md` 等 |
| 2026-03-31 | 统一 Git 分支模型（`main`/`next`/`feature`/`hotfix`）与 GitHub 保护说明 | `CONTRIBUTING.md`、`docs/github-branch-policy.md`、`.github/PULL_REQUEST_TEMPLATE.md`、`docs/README.md`、`MEMORY.md`、`CLAUDE.md`、仓库根 `AGENTS.md`、`.cursor/rules/ai-knowledge-sync.mdc`、本文件 |
| 2026-03-31 | 贡献相关文档与模板：中文优先、中英对照 | `CONTRIBUTING.md`、`docs/github-branch-policy.md`、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/*`、本文件 `github-branch-policy` 变更记录 |
| 2026-03-31 | `CONTRIBUTING`：Issue/PR/Push 分工与「文档模板如何修改」 | `CONTRIBUTING.md`、本文件 |
| 2026-03-31 | `github-branch-policy`：§2.1 `main`/`next` 对齐与受保护时 PR 路径 | `docs/github-branch-policy.md`、本文件 |
| 2026-04-01 | Windows 上 `gh`/GitHub API 传中文 PR 标题易乱码：UTF-8 JSON + `gh api --input` | 仓库根 `AGENTS.md`、`.cursor/rules/github-cli-utf8-pr.mdc`、本文件 |
| 2026-04-01 | 旧版看板数据目录规范为 `workflows/legacy-board/`；设置 `POST /clear` 目标为 `legacyBoard`，导出占位键 `legacyBoard`，导入统计与文案对齐 | `file-store.ts`（既有）、`src/server/routes/settings.ts`、`settings-sections.tsx`、`app/[locale]/settings/page.tsx`、`messages/zh.json` & `en.json`、`docs/data-storage.md`、`builtin-prompts.ts`、`scripts/migrate-data.js`、`docs/data-spec/projects/README.md`、`scripts/data-layout-migration.md`、`scripts/migrate-flow-index-to-projects-index.mjs`、本文件 |
| 2026-04-01 | 统一中文产品口径：`agents/active-tasks.json` 称 **并行执行看板**（非用户 Todo） | `docs/data-storage.md`、`docs/领域与数据.md`、`MEMORY.md`、`active-tasks.ts`、`file-store.ts`、`builtin-prompts.ts`、`resource-migration.ts`、`resource.ts`、`active-tasks-loader.ts`、`todo-stale-checker.ts`、`types/index.ts`（Todo 注释）、本文件 |
| 2026-04-01 | 移除「项目收件箱」：`projects/inboxes/`、`/api/data/inbox`、`readInbox`/`writeInbox`、`InboxItem`/`ProjectInbox`、孤儿组件 `project-inbox.tsx`；遗留文件可手动删 | `file-store.ts`、`data.ts`、`types/index.ts`、`messages`、`agents/page.tsx`、`data-storage.md`、`data-spec/projects/README.md`、`data-spec/README.md`、`design/agents-workspace.md`、`builtin-prompts.ts`、本文件 |
| 2026-04-01 | 区分会话类型：`Session` 重命名为 **LegacyTaskWorkerSession**；**Agent Chat** 权威类型为 **AgentChatSession** / **SessionMeta**（后已移除 `Session`/`SessionsData` 类型别名） | `types/index.ts`、`types/agent-chat.ts`、`types/flow-context.ts`、`docs/types/flow-task-context.md`、`docs/ai-task-workflow.md`、本文件 |
| 2026-04-01 | **通用语言落盘**：`docs/领域与数据.md` §0 会话↔实现映射；`MEMORY.md` 数据存储条；移除 `Session`/`SessionsData` 导出别名 | `领域与数据.md`、`MEMORY.md`、`types/index.ts`、`types/agent-chat.ts`、`flow-task-context.md`、`ai-task-workflow.md`、本文件 |
| 2026-04-02 | **Resource / 提示词归属**：④ Resource 改为「上下文来源」开放集合；`prompts/` 为按 scope 分桶存储（非独立实体）；scope 级指令归入 §2；`data-storage` 树注释 | `docs/领域与数据.md`、`docs/data-storage.md`、`MEMORY.md`、本文件 |
| 2026-04-02 | **§1 系统核心循环**：五关注面流水线图 + 环节表 + Scope 贯穿说明，再接原五关注面详细表（路线图 A2） | `docs/领域与数据.md`、本文件 |
| 2026-04-02 | **Hono 启动**：`startServer` 在 `ensureDataDirV2Migrated` 后调用 `schedulerManager.init()` 与 `eventTriggerManager.init()`，进程重启后恢复 cron 与 GitHub 轮询（路线图 C1） | `src/server/index.ts`、`MEMORY.md`、`docs/roadmap.md`、本文件 |
| 2026-04-02 | **Execution Event + Run 落盘**：`ExecutionEvent` JSONL（`sessions/events/`）+ `ExecutionRun` JSON（`sessions/runs/`）；Turn 结束后归约写入；API 四端点；路线图 A5/B1–B4 完成 | `types/execution.ts`、`lib/execution-event-store.ts`、`lib/file-store.ts`、`agent-chat-manager.ts`、`agent-chat-session-store.ts`、`routes/agent-chat.ts`、`docs/领域与数据.md` §3、`docs/data-storage.md`、`MEMORY.md`、`docs/roadmap.md`、本文件 |
| 2026-04-03 | Agents 工作区：**已打开会话标签**与 **`lastFocusByAgent`**（切回某 Agent 时恢复上次会话/概览/设置）按 `projectKey` 持久化到 `config/agents-workspace-ui.json`；API `GET/PUT /api/data/agents-workspace-ui`；前端 `localStorage` 回退 | `file-store.ts`、`agents-workspace-ui-shared.ts`、`agents-workspace-ui-store.ts`、`routes/data.ts`、`flows/agents/page.tsx`、`docs/data-storage.md`、`MEMORY.md`、本文件 |
| 2026-04-03 | Agents 工作区 UI API：**服务端清洗**（`agents-workspace-ui-sanitize.ts`）对齐注册表与会话索引；**projectKey** 校验格式与项目存在；非法 `projectKey` 400、未知/已归档项目 404 | `agents-workspace-ui-sanitize.ts`、`routes/data.ts`、`MEMORY.md`、本文件 |
| 2026-04-03 | 内置提示词：行为准则（PP 自身 bug 归代码侧、禁止假读盘）+ **与当前栈对齐**（Vite+Hono+Electron、4000/4500、Bun、\`projects/index.json\`、\`agents-workspace-ui.json\`；去 Next.js/单 4000/npm 过时表述） | `builtin-prompts.ts`、本文件 |
| 2026-04-03 | **Agent 磁盘工作区约定**并入 **全局约束**（\`PROMPT_GLOBAL\` / \`global.md\`），不再在 \`buildResourcePrompt\` 单独硬编码注入；\`agent-data-info-loader\` 指向全局约束一节 | `builtin-prompts.ts`、`agent-chat-manager.ts`、`agent-data-info-loader.ts`、`MEMORY.md`、本文件 |
| 2026-04-05 | **删除 SimpleAnthropicRunner**：527438b 引入的裸 Messages Runner 意外成为 MiniMax/DeepSeek/Kimi 等的默认路径（无 tool_use），导致第三方供应商工具调用全部失效。恢复为全量走 ClaudeAgentRunner | `agent-runner.ts`、`chat-notification-banners.tsx`、`docs/agent-chat-architecture.md`、`MEMORY.md`、本文件 |
| 2026-04-05 | **Agent 运行预设**：`config/agent-presets.json` + `ProjectEntry.defaultPresetId`；API `GET/POST/PATCH/DELETE /api/data/agent-presets`；独立页 `/workspace/presets`（侧栏图标）；项目设置链至预设页；新建 Agent 可合并项目默认预设 | `types/index.ts`、`file-store.ts`、`agent-presets-store.ts`、`routes/data.ts`、`agent-form.tsx`、`components/agent-presets/*`、`project-settings.tsx`、`flows/agents/page.tsx`、`flows/presets/page.tsx`、`workspace-shell.tsx`、`App.tsx`、`messages/zh.json` & `en.json`、`data-storage.md`、`builtin-prompts.ts`、本文件 |
| 2026-04-05 | **社区市场 P0**：LobeHub 类「发现 → 安装」调研与 OKR 文档；`GET /api/community/catalog` + 种子目录；`/workspace/community` + 侧栏入口；一键写入运行预设 | `docs/community-marketplace-lobechat-okr.md`、`src/data/community-catalog-seed.json`、`server/routes/community.ts`、`server/index.ts`、`components/community/*`、`flows/community/page.tsx`、`App.tsx`、`workspace-sidebar-rail.tsx`、`messages/zh.json` & `en.json`、本文件 |
| 2026-04-06 | **Google 账号与云同步**：用户**按类选择**云端管理范围；**推荐最小云子集**仅为 **AI 供应商凭据**（与 `unified-credential-store` 对齐），会话/项目/文档等默认不上云 | `docs/design/google-account-cloud-sync-scope.md`、`docs/design/README.md`、`MEMORY.md`、本文件 |
| 2026-04-06 | **PR #39 纳入设计参考**：Google OAuth + 本机 `accounts/<sub>/` 数据根、`file-store` AsyncLocalStorage、设置页登录与 `apiFetch` credentials；与「凭据可选上云」正交，见 `google-account-cloud-sync-scope.md` §「参考实现：PR #39」 | `docs/design/google-account-cloud-sync-scope.md`、本文件 |
| 2026-04-07 | **Hono API 懒挂载**：`src/server/lazy-route.ts` + `index.ts` 对 `/api/*` 子树首包 `import()`（`tsx` 开发态冷启动更快） | `src/server/lazy-route.ts`、`src/server/index.ts`、`MEMORY.md`、本文件 |
| 2026-04-07 | **社区市场 UI 对标 LobeHub canary**：左侧商店导航（发现/助手/Skills/MCP/模型/服务商）、顶栏搜索（URL `q`）、助手页分类侧栏+排序+卡片网格、`/workspace/community/agent/:identifier` 详情 + `GET /api/community/item/:id`；非助手 Tab 占位；种子条目扩展 `category/author/updatedAt` 等元数据 | `components/community-store/*`、`flows/community/layout.tsx` 与子路由、`App.tsx` 嵌套 `community/*`、`community-catalog-seed.json`、`routes/community.ts`、`messages/zh.json` & `en.json`、`docs/community-marketplace-lobechat-okr.md`、本文件 |
| 2026-04-07 | **社区商店 Skills + MCP 实装**：`community-skills-seed.json` + `GET/POST /api/community/skills/*`（安装调用 `writeSkillFile`）；`community-mcp-seed.json` + `GET/POST /api/community/mcp/*` 与 `config/mcp-market.json`；`BaseChatManager` 合并市场 MCP 与 `.mcp.json`；发现页与 `/workspace/community/skill|mcp` 列表/详情/安装 | `mcp-market-store.ts`、`base-chat-manager.ts`、`routes/community.ts`、`community-skill-*`、`community-mcp-*`、`data-storage.md`、本文件 |
| 2026-04-08 | **Cursor 外部 MCP**：`.cursor/mcp.json` 改为 `node` + `tsx/dist/cli.mjs` + `TSX_TSCONFIG_PATH`；文档 `docs/cursor-mcp-project-pilot.md`（根目录布局与 `develop-static/` 嵌套、禁止 `npm run` 污染 stdout） | `.cursor/mcp.json`、`docs/cursor-mcp-project-pilot.md`、`docs/README.md`、`mcp-server/index.ts` 头注释、`MEMORY.md`、本文件 |
| 2026-04-08 | **Skills 与 AgentSkills/OpenClaw 对齐**：绑定 `type: skill` 时注入完整 `SKILL.md` 正文（非仅摘要）+ `scripts|references|assets` 清单与小文本内联；支持 `disable-model-invocation`；提示词树 Skill 块估算/预览与注入一致 | `skill-loader.ts`、`skill-store.ts`、`routes/prompts.ts`、`types/resource.ts`、`data-storage.md`、`领域与数据.md`、`MEMORY.md`、本文件 |
| 2026-04-08 | **Skill 包三目录贯通导入/统计**：列表与详情带 `bundle` 汇总；`POST /api/skills/import-zip`；社区目录 `bundleFiles`；`skill-zip-import.ts`、`parseSkillBundleRelativePath` | `routes/skills.ts`、`routes/community.ts`、`community-catalog.ts`、`mcp-server/index.ts`、`skill-zip-import.ts`、`skill-store.ts`、`data-storage.md`、`MEMORY.md`、本文件 |

（后续变更请继续追加表格行，勿删历史。）
