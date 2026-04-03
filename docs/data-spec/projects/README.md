# projects 域（项目注册表）

**对齐日期**：2026-03-26。  
**代码入口**：[`src/lib/file-store.ts`](../../../src/lib/file-store.ts)（`getProjectsDomainDir`、`getProjectsIndexPath`、`readProjectIndex`、`writeProjectIndex`、`ensureProjectsMigrated`）。

## 目录位置

在应用的数据根 **`DATA_DIR`** 下。未设置 `PROJECT_PILOT_DATA_DIR` 时，**`DATA_DIR` 为 `~/.project-pilot`**（不再默认使用 `~/.project-pilot/data/`）。`{DATA_DIR}/projects/index.json` 若不存在，**`ensureProjectsMigrated`** 会先写入 **`version: 0` 占位**（不含 `_migrated_to_projects_domain`），再合并 legacy 并落盘为 **`version: 1`**。

```
<DATA_DIR>/projects/
└── index.json          # 项目注册表（唯一真相源）
```

**不再使用**：`workflows/legacy-board/<id>.json`（未迁移前可能为 `workflows/flows/`）作为 per-project 树形看板；其 `_index.json` 仅作一次性迁移来源。  
**旧扁平文件**：`<DATA_DIR>/projects.json` 仅作迁移读取，新数据写入 `projects/index.json`。

**已移除**：原 `projects/inboxes/<id>.json`「项目收件箱」及从 `*_inbox.json` 的迁移逻辑；若磁盘上仍有残留目录或文件，可手动删除（见 [`docs/data-storage.md`](../../data-storage.md)「可选 / 遗留」）。

## `index.json` 磁盘格式（Schema）

顶层对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | `number` | 当前为 **`1`** |
| `projects` | `array` | 项目条目列表 |
| `_migrated_to_projects_domain` | `boolean`（可选） | 迁移完成后由程序写入 **`true`**，用于跳过重复合并 |

### 单条 `projects[]` 对象（磁盘）

- **`id`**（**必填**）：稳定标识，与旧版内存/API 中的 **`key`** 同义；仅允许 `[a-zA-Z0-9_-]`。
- **不写 `key`**：磁盘上只用 `id`。
- **不写 `techStack`**：技术栈等信息若需在 UI 使用，由应用在内存中维护；写入磁盘时会被剥离（见 `projectEntryToDisk`）。

其余字段与类型定义 **`ProjectEntry`** 对齐（除 `key` / `techStack` 的磁盘策略外），常用项包括：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 显示名 |
| `description` | `string` | 可选 |
| `location` | `ProjectLocation` | 可选：`local` / `github` / `gitee` / `cloud-server` / `hybrid` |
| `path` | `string` | 本地路径，可选 |
| `repository` | `object` | 可选：`url`、`defaultBranch`、`provider` |
| `devServer` | `object` | 可选：`command`、`url`、`port` |
| `access` | `object` | 可选：SSH / Token 等 |
| `defaultAgentId` | `string` | 可选 |
| `icon` / `color` / `tags` | 可选 | 展示与分类 |
| `createdAt` / `updatedAt` | `string`（ISO） | 可选 |
| `archived` / `archivedAt` | 可选 | 软删除 / 回收站 |

完整 TypeScript 定义见 [`src/types/index.ts`](../../../src/types/index.ts) 中 **`ProjectEntry`** / **`ProjectIndex`**。

### 运行时（内存 / API）

- `readProjectIndex()` 会把磁盘上的 **`id` 规范为 `ProjectEntry.key`**（并与 `id` 对齐），因此现有前端与路由仍以 **`key`** 指代项目。
- `writeProjectIndex()` 会把每条项目的 **`key` 写成磁盘上的 `id`**，并去掉 **`techStack`**。

### 示例 `index.json`

```json
{
  "version": 1,
  "_migrated_to_projects_domain": true,
  "projects": [
    {
      "id": "my-app",
      "name": "我的应用",
      "path": "D:/code/my-app",
      "location": "local",
      "description": "示例项目",
      "repository": {
        "defaultBranch": "main"
      },
      "devServer": {
        "command": "npm run dev",
        "url": "http://localhost:5173"
      },
      "createdAt": "2026-03-26T00:00:00.000Z",
      "updatedAt": "2026-03-26T00:00:00.000Z"
    }
  ]
}
```

## 迁移与工具

1. **自动**：应用启动链中的 **`ensureDataDirV2Migrated`** → **`ensureProjectsMigrated`**：合并已有 `projects/index.json`、旧 **`workflows/legacy-board/_index.json`**（或尚未重命名时的 **`workflows/flows/_index.json`**）、扁平 **`projects.json`**。
2. **手动脚本**：仓库 [`scripts/migrate-flow-index-to-projects-index.mjs`](../../../scripts/migrate-flow-index-to-projects-index.mjs)  
   - 从备份的 `_index.json` 生成 **`~/.project-pilot/projects/index.json`**（可通过第 3 个参数指定输出目录）。

## API（摘录）

- **`/api/data/projects`**：列表、创建、PATCH、归档等（`src/server/routes/data.ts`）。
- **`/api/projects`**：旧版 `Record<key, ProjectConfig>` 形态，底层仍读写同一 `index.json`（`src/server/routes/projects.ts`）。

## 可复制到本机的 `projects/README.md`

可将下面整段保存为 **`~/.project-pilot/projects/README.md`**（或与你本机 `DATA_DIR` 一致的 `projects/README.md`），便于在资源管理器中对照：

```markdown
# projects 域

本目录由 ProjectPilot 维护。

- **index.json**：项目注册表；每条项目用字段 **id**（即应用内的 project key），不要依赖已废弃的 per-project Flow JSON。

仓库内完整说明见项目源码：develop-static/docs/data-spec/projects/README.md
```

---

**与本机权威文档的关系**：目录级目标树仍以本机 **`~/.project-pilot/README.md`**、**`数据文件夹现状.md`** 为准；本节描述的是 **当前代码实现的 contracts**，便于评审与 PR 对齐。
