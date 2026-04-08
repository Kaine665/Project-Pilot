# 数据目录（与实现对齐）

> **权威分层**  
> - **本机目标结构**：`~/.project-pilot/README.md`  
> - **本机迁移与现实**：`~/.project-pilot/数据文件夹现状.md`  
> - **代码中的路径**：[`src/lib/file-store.ts`](../src/lib/file-store.ts)（`PROJECT_PILOT_DATA_DIR` 未设置时默认 `path.join(os.homedir(), '.project-pilot')`）  
> - **本文**：与当前 `develop-static` 实现一致的目录树与主要 getter 索引，便于人类与 Agent 对齐认知。  
> **对齐日期**：2026-04-08。  
> **给 AI**：多厂商入口（Cursor / Claude / 内置提示词）如何一起更新，见 [`AI_AGENT_KNOWLEDGE_MAP.md`](./AI_AGENT_KNOWLEDGE_MAP.md)。

## 默认数据根

- **Windows**：`%USERPROFILE%\.project-pilot\`
- **macOS / Linux**：`~/.project-pilot/`

**不再**使用 `~/.project-pilot/data/` 作为默认根（历史遗留；若磁盘上仍存在该子目录，仅为旧数据或未清理目录，不是当前默认）。

自定义根：

```bash
export PROJECT_PILOT_DATA_DIR=/path/to/custom-root
```

应用与脚本需在同一进程中、在首次 `import` `file-store` 之前设置该变量（见 `scripts/run-layout-migrations.ts`）。

## 当前目录树（相对 `DATA_DIR`）

与 `ensureDataDirInitialized` 及路径函数一致的一级结构：

```text
{DATA_DIR}/
  config/
    settings.json
    agents-workspace-ui.json       # Agents 工作区已打开会话标签（按 projectKey）
    agent-presets.json             # Agent 运行预设（模型/能力/Skills 等模板）
    dimensions.json
    worktree-ports.json
    models-health.json          # 若已生成
    usage/                      # token 用量等
  projects/
    index.json
  agents/
    registry.json
    definitions/  bindings/  statuses/  teams/
    schedules/  schedule-runs/  catalog/
    schedules.json            # 聚合（若使用）
    schedule-runs.json
    event-triggers.json
    event-trigger-runs.json
    event-trigger-states.json
    workspaces/                 # 每 Agent 工作区文件
    active-tasks.json           # 并行执行看板（多 Agent 运行时登记；非用户 Todo）
  documents/
    index.json
    entries/   content/
  sessions/
    index.json
    adjuncts.json
    messages/                   # *.jsonl
    events/                     # *.jsonl — ExecutionEvent 落盘（每 Turn 归约后追加）
    runs/                       # *.json — ExecutionRun 元数据
    prompt-overrides/
  todos.json                    # 聚合待办（与 todos/entries 并存）
  todos/
    entries/
  prompts/                      # 按 scope 分桶的存储约定，非独立领域实体；归属见「领域与数据.md §2 Scope」
    global.md
    agents/  history/  runtime/  blocks/  projects/
  artifacts/
  skills/                       # 见下文「Skills 磁盘与注入」
    _global/  _projects/  _agents/
    _vendor/
  mcp/                          # 若已使用
  _snapshots/                   # 关键 JSON 写入前滚动备份
```

**可选 / 遗留只读路径**（代码仍可能读取，一般不新建）：

- 根级 `projects.json`（扁平项目表，`getProjectsPath()`）
- `workflows/legacy-board/`（`getLegacyBoardDataDir()`；未迁移时可能仍为 `workflows/flows/`，启动时会重命名；合并进 `projects/index.json` 用）
- `DATA_DIR/data/projects/...`（`ensureLegacyDataSubdirProjectsMerged`）
- `projects/inboxes/` 以及 `workflows/legacy-board/`（或旧 `flows/`）下的 `*_inbox.json`：历史「项目收件箱」功能已移除，应用不再读写；若仍存在可手动删除。

## 主要路径 ↔ `file-store` 函数

| 相对路径 | 说明 | 导出函数（节选） |
|----------|------|------------------|
| `config/settings.json` | 用户设置 | `getSettingsPath` |
| `config/agents-workspace-ui.json` | Agents 工作区已打开标签 / 当前面板（按项目 `_global` 或 `projectKey`） | `getAgentsWorkspaceUiPath` |
| `config/agent-presets.json` | Agent 运行预设列表 | `getAgentPresetsPath` |
| `config/mcp-market.json` | 社区商店安装的 MCP 服务（`mcpServers`），与任务工作区 `.mcp.json` 合并后传给 Claude `--mcp-config` | `getMcpMarketPath`（`mcp-market-store.ts`） |
| `config/dimensions.json` | 维度 | `getDimensionsPath` |
| `config/worktree-ports.json` | Worktree 端口 | `getWorktreePortsPath` |
| `.google-oauth/<google-sub>.json` | Google 登录 refresh token（按账号分文件） | `getGoogleOAuthDir` |
| `projects/index.json` | 项目索引 | `getProjectsIndexPath` |
| `agents/registry.json` | Agent 注册表 | `getAgentsPath` |
| `agents/active-tasks.json` | 并行执行看板 | `getActiveTasksPath` |
| `agents/workspaces/<id>/` | Agent 工作区 | `getAgentDataPath` |
| `sessions/index.json` | 会话索引 | `getAgentChatSessionsPath` |
| `sessions/messages/<id>.jsonl` | 会话消息 | `getAgentChatMessagePath` |
| `sessions/events/<id>.jsonl` | 执行事件 | `getSessionEventsPath` |
| `sessions/runs/<id>.json` | 执行尝试 | `getSessionRunsPath` |
| `sessions/adjuncts.json` | 会话附属状态 | `getAgentChatSessionAdjunctsPath` |
| `documents/index.json` | 文档索引 | `getDocumentsIndexPath` |
| `todos.json` + `todos/entries/` | 待办 | `getTodosPath`, `getTodosEntriesDir` |
| `prompts/global.md` | 全局提示词（用户覆盖） | `getGlobalPromptPath` |
| `prompts/builtin/global.md` | 全局提示词内置默认副本（随种子版本升级覆盖，见下） | `getBuiltinGlobalPromptPath` |
| `prompts/builtin/agents/<id>.md` | 内置 Agent 默认提示词副本（同上） | `getBuiltinAgentPromptPath` |
| `prompts/builtin/.applied-builtin-prompts.json` | 已应用的内置种子 `version`（与仓库 `manifest.json` 对照） | `getBuiltinPromptAppliedManifestPath` |
| `prompts/builtin/.backups/pre-upgrade-to-v*/*` | 覆盖前自动备份的旧 `global.md` / `agents/` | `getBuiltinPromptBackupsDir` |
| `prompts/agents/<id>.md` | Agent 提示词（用户正式版，优先于 builtin） | `getPromptFilePath` |

完整列表以 `file-store.ts` 为准。

## Skills 磁盘与注入

与 [AgentSkills](https://agentskills.io/) / [OpenClaw Skills](https://docs.clawdbot.com/skills) 对齐：每个 skill 是一个目录，根文件为 `SKILL.md`，**顶部 YAML frontmatter 至少含 `name` 与 `description`**，其后为给模型阅读的说明正文。

当 Agent 或会话通过 `ResourceRef`（`type: skill`）绑定 skill 时，`SkillResourceLoader` 会把 **frontmatter 外的正文** 注入系统提示词的组装结果；正文前会附带 `### Skill: {name}` 与 `description` 行，便于与目录中 `SKILL.md` 的结构对应。若 frontmatter 含 `disable-model-invocation: true`（OpenClaw 可选键），则**不向模型注入**该 skill（与 OpenClaw「仅用户侧可调」语义一致）。

磁盘布局与历史目录约定见 [`src/lib/skill-store.ts`](../src/lib/skill-store.ts) 文件头注释（`_global` / `_projects` / `_agents`、根下平铺遗留路径等）。

**内置提示词版本**：仓库种子目录 `src/data/defaults/prompts/builtin/manifest.json` 中的 `version` 大于数据目录 `.applied-builtin-prompts.json` 时，服务启动会将种子中的 `global.md` 与 `agents/*.md` **整包覆盖**写入 `prompts/builtin/`（覆盖前把旧文件拷到 `prompts/builtin/.backups/pre-upgrade-to-v{N}-时间戳/`）。若数据目录版本更高（例如降级安装旧应用），则**不覆盖**仅补缺文件。长期定制请优先使用 `prompts/agents/<id>.md`（正式版，优先级高于 builtin）。

## 备份与排查

- 备份整个 **`{DATA_DIR}`**（即默认 `~/.project-pilot/`，不要假设下面还有一层 `data/`）。
- 若读不到数据：检查 `echo $PROJECT_PILOT_DATA_DIR`（或 Windows 环境变量）是否与预期一致。

## 运行时迁移

当前 **`develop-static` 不在启动时执行**旧版「扁平根 → 分域」等一次性迁移；磁盘布局应已通过历史版本或手工整理完成。离线可做布局检查：

```bash
cd develop-static
npx tsx scripts/run-layout-migrations.ts
```

说明与遗留路径验收见 [`scripts/data-layout-migration.md`](../scripts/data-layout-migration.md)。

## 相关文件

- [`src/lib/file-store.ts`](../src/lib/file-store.ts)
- [`scripts/run-layout-migrations.ts`](../scripts/run-layout-migrations.ts)
- [`scripts/migrate-data.js`](../scripts/migrate-data.js) — 从仓库内 `./data/` 拷到默认 `DATA_DIR`（极旧场景）
