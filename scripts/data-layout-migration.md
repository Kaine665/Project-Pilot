# 数据目录布局 — 检查脚本与人工验收

面向 **ProjectPilot 数据根**（默认 `%USERPROFILE%\.project-pilot`，可通过 `PROJECT_PILOT_DATA_DIR` 或脚本参数覆盖）。

## 当前脚本做什么

`npx tsx scripts/run-layout-migrations.ts` 会：

1. 设置 `PROJECT_PILOT_DATA_DIR` 后动态加载 `file-store`。
2. 调用 **`ensureDataDirV2Migrated()`**（当前实现等价于：确保目录存在 + **`ensureProjectsMigrated()`**，合并 `projects/index.json` 与旧 `workflows/legacy-board/_index.json`（或 `workflows/flows/_index.json`）、根级 `projects.json` 等）。
3. 运行 **`verifyLayout()`**：检查遗留 `chat/`、会话索引与 `messages/*.jsonl` 一致性等。

**不再**在运行时自动执行：usage 迁入 config、worktree-ports 从 workflows 迁入、chat→sessions、todos 从 tasks、V2 扁平文件复制、知识树迁入 documents 等（相关一次性逻辑已从应用运行时移除）。若磁盘上仍有这些遗留路径，需**手工**或使用自建脚本搬迁。

## 验收标准（与 `verifyLayout` 一致）

### 必须满足（失败则 `exit 1`）

1. 若存在 `chat/` 目录，则必须为空（会话应已在 `sessions/`）。
2. 若 `sessions/messages/` 下存在 `.jsonl`，则必须存在可读的 `sessions/index.json`。

### 警告（不阻断）

3. 根下 `usage/` 仍有数据文件（应在 `config/usage/`）。
4. 仍存在 `workflows/worktree-ports.json`（应在 `config/worktree-ports.json`）。
5. 仍存在 `tasks/todos.json`（应在根 `todos.json` 及/或 `todos/entries/`）。
6. 仍存在非空 `storage/artifacts` 或 `storage/skills`。

### 人工建议

7. 启动应用：Agents、待办、文档、会话各读一次无报错。
8. 自定义 `PROJECT_PILOT_DATA_DIR` 时，脚本参数或环境变量与应用一致。

## 执行方式

```bash
# 在仓库根目录
npx tsx scripts/run-layout-migrations.ts
# 或指定目录：
npx tsx scripts/run-layout-migrations.ts "D:\path\to\.project-pilot"
```

与实现对齐的目录说明见 **[`docs/data-storage.md`](../docs/data-storage.md)**。
