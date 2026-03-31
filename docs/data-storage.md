# 数据目录（与实现对齐）

> **权威分层**  
> - **本机目标结构**：`~/.project-pilot/README.md`  
> - **本机迁移与现实**：`~/.project-pilot/数据文件夹现状.md`  
> - **代码中的路径**：[`src/lib/file-store.ts`](../src/lib/file-store.ts)（`PROJECT_PILOT_DATA_DIR` 未设置时默认 `path.join(os.homedir(), '.project-pilot')`）  
> - **本文**：与当前 `develop-static` 实现一致的目录树与主要 getter 索引，便于人类与 Agent 对齐认知。  
> **对齐日期**：2026-03-31。  
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
    dimensions.json
    worktree-ports.json
    models-health.json          # 若已生成
    usage/                      # token 用量等
  projects/
    index.json
    inboxes/
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
    active-tasks.json           # 共享「正在执行」任务看板（非用户 todo）
  documents/
    index.json
    entries/   content/
  sessions/
    index.json
    adjuncts.json
    messages/                   # *.jsonl
    prompt-overrides/
  todos.json                    # 聚合待办（与 todos/entries 并存）
  todos/
    entries/
  prompts/
    global.md
    agents/  history/  runtime/  blocks/  projects/
  artifacts/
  skills/
    _global/  _projects/  _agents/
    _vendor/
  mcp/                          # 若已使用
  _snapshots/                   # 关键 JSON 写入前滚动备份
```

**可选 / 遗留只读路径**（代码仍可能读取，一般不新建）：

- 根级 `projects.json`（扁平项目表，`getProjectsPath()`）
- `workflows/flows/`（`getLegacyWorkflowsFlowsDir()`，合并进 `projects/index.json` 用）
- `DATA_DIR/data/projects/...`（`ensureLegacyDataSubdirProjectsMerged`）

## 主要路径 ↔ `file-store` 函数

| 相对路径 | 说明 | 导出函数（节选） |
|----------|------|------------------|
| `config/settings.json` | 用户设置 | `getSettingsPath` |
| `config/dimensions.json` | 维度 | `getDimensionsPath` |
| `config/worktree-ports.json` | Worktree 端口 | `getWorktreePortsPath` |
| `projects/index.json` | 项目索引 | `getProjectsIndexPath` |
| `agents/registry.json` | Agent 注册表 | `getAgentsPath` |
| `agents/active-tasks.json` | 并行任务看板 | `getActiveTasksPath` |
| `agents/workspaces/<id>/` | Agent 工作区 | `getAgentDataPath` |
| `sessions/index.json` | 会话索引 | `getAgentChatSessionsPath` |
| `sessions/messages/<id>.jsonl` | 会话消息 | `getAgentChatMessagePath` |
| `sessions/adjuncts.json` | 会话附属状态 | `getAgentChatSessionAdjunctsPath` |
| `documents/index.json` | 文档索引 | `getDocumentsIndexPath` |
| `todos.json` + `todos/entries/` | 待办 | `getTodosPath`, `getTodosEntriesDir` |
| `prompts/global.md` | 全局提示词 | `getGlobalPromptPath` |
| `prompts/agents/<id>.md` | Agent 提示词 | `getPromptFilePath` |

完整列表以 `file-store.ts` 为准。

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
