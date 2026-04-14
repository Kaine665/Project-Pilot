# ProjectPilot — Architecture Migration Branch

## 这是什么

这是 ProjectPilot 的**架构迁移分支** (`arch/vite-hono-migration-260325`)。

从 Next.js 全栈架构迁移到：

- **前端**：React + Vite (SPA) + React Router v7 + react-i18next
- **后端**：Hono (Node.js/Bun) — 统一后端，吸收了原 Sidecar 进程
- **桌面**：Electron (简化为 2 进程：Main + Hono Backend)

## 产品定位与系统架构

> 详细文档：`[docs/design/product-direction-and-dashboard.md](docs/design/product-direction-and-dashboard.md)`

**一句话定位**：Builder 的 AI 工作台 — 让 AI 对你的项目越来越懂，而不是每次从零开始；覆盖 Builder 多维度工作（不止代码）。

### 五模块飞轮

```
① Memory → ② Loader → ③ Runtime → ④ Distiller → ⑤ Dashboard → 回到 ①
```


| 模块          | 作用                     | 现状                      |
| ----------- | ---------------------- | ----------------------- |
| ① Memory    | 存储积累的项目理解（决策/约定/踩坑/变更） | 文档/知识存储有，缺自动积累          |
| ② Loader    | 开聊前自动注入相关上下文           | ResourceRegistry 已有 ✅   |
| ③ Runtime   | Agent 带着完整上下文执行        | Claude SDK + Codex 已有 ✅ |
| ④ Distiller | 聊完后自动提取决策/约定/踩坑        | **缺失，最该先做**             |
| ⑤ Dashboard | 全局视图 + 行动入口            | 设计已确认，待实现               |


### 核心数据概念

- **六大维度（固定）**：工程 / 产品 / 设计 / 商业 / 增长 / 运营 — 覆盖项目的所有方面，不只是代码
- **板块（Area）**：维度下的灵活分区（如工程下有数据存储、Agent 系统），AI 推荐 + 用户确认
- **功能（Feature）**：跨板块的用户可感知能力（如「Agent 会话重连」横跨工程 + 设计）
- **任务（Task）**：可关联 0~N 个板块，支持 AI 自动打标签 + 用户确认
- **知识（Knowledge）**：五种性质 — 事实 / 决策 / 规则 / 经验 / 备忘。知识系统只存文本，非文本放项目空间资产区

### Dashboard 设计

- **六大维度 3x2 网格一屏展示**：工程/产品/设计/商业/增长/运营
- **交互**：默认六块等分 → 点击某块展开 75%，其他缩到右侧 → 面包屑回全览
- **跨维度功能**通过彩色标签体现，点击进入功能详情页
- 视觉风格：深色（与确认的板块视角一致）

## 技术栈

- **前端**: React 19 + Vite 8 + TypeScript (strict) + Tailwind CSS 4 + shadcn/ui (Radix)
- **后端**: Hono 4 + @hono/node-server
- **国际化**: react-i18next (中/英)
- **状态管理**: Zustand
- **路由**: React Router v7 (SPA)
- **AI**: Claude Agent SDK, OpenAI Codex SDK, MCP SDK
- **桌面**: Electron 40
- **包管理**: Bun (运行时 + 包管理器)
- **开发端口**: 前端 4000, 后端 4500

## 文档驱动开发（必须遵循）

本项目采用**文档优先**工作方式。对任何非琐碎改动（不仅仅是修错字、调间距），**必须**按以下顺序操作：

### 改动前

1. **确定涉及的能力域**（见下方域索引表）。
2. **先读该域的 as-is**（`docs/as-is/`）了解当前行为与入口，**再读 design**（`docs/design/`）了解原则与目标态。
3. 若存在 `active` 状态的 **contract**（`docs/contracts/`），以契约为准确定范围与验收标准。
4. **之后**再酌情读代码。

### 改动后

1. 若行为发生变化，**必须更新**对应 **as-is** 文档（刷新 `last_reviewed` 日期）。
2. 若改变了长期方向或做了重大技术取舍，**补充 design** 或新建 **ADR**（`docs/design/decisions/`）。

### 域索引


| 能力域                     | as-is                            | design                                           |
| ----------------------- | -------------------------------- | ------------------------------------------------ |
| Agents 工作区（布局/侧栏/会话）    | `docs/as-is/agents-workspace.md` | `docs/design/agents-workspace.md`                |
| 产品定位 / 系统架构 / Dashboard | —                                | `docs/design/product-direction-and-dashboard.md` |


> 随项目演进补充更多行。未覆盖的域：先检查 `docs/as-is/` 和 `docs/design/` 是否已有对应页面；若无，改动后创建。

### 协作与分支

- 贡献流程与分支约定：`**[CONTRIBUTING.md](./CONTRIBUTING.md)`**（`main` / `next` / `feature/`* / `hotfix/`*）
- 维护者配置 GitHub 分支保护：`**[docs/github-branch-policy.md](docs/github-branch-policy.md)`**

### 参考

- 体系说明：`[docs/documentation-system/README.md](docs/documentation-system/README.md)`
- 契约模板：`[docs/contracts/TEMPLATE.md](docs/contracts/TEMPLATE.md)`
- **多 AI 入口地图与变更检查清单**：`[docs/AI_AGENT_KNOWLEDGE_MAP.md](docs/AI_AGENT_KNOWLEDGE_MAP.md)`（Cursor / Claude / 内置提示词等须交叉感知）

## 开发命令

```bash
bun run dev            # 同时启动 Vite (4000) + Hono (4500)
bun run dev:client     # 仅 Vite 前端
bun run dev:server     # 仅 Hono 后端
bun run build          # 生产构建（Vite + Bun bundle）
bun run electron:dev   # Electron 开发模式
```

## 项目结构

```
src/
├── client/              # 前端 SPA 入口和配置
│   ├── main.tsx         # Vite 入口
│   ├── App.tsx          # React Router 配置
│   ├── i18n/            # i18n 配置 + 兼容层
│   └── routes/          # WorkspaceShell（主壳）等
├── server/              # Hono 后端
│   ├── index.ts         # 服务器入口（注册所有路由）
│   ├── routes/          # 20 个路由模块
│   └── middleware/       # 错误处理等
├── components/          # React 组件（约 79 个文件）
├── hooks/               # React Hooks
├── stores/              # Zustand 状态管理
├── lib/                 # 业务逻辑（约 130 个文件，共享给 server）
├── types/               # TypeScript 类型定义
├── app/[locale]/flows/  # 页面组件（目录名历史遗留；对外路由前缀 `/workspace/*`）
index.html               # SPA 入口 HTML
vite.config.ts           # Vite 配置
```

## 核心架构约定

### 数据层

- **磁盘树目标与现实**：本机 `~/.project-pilot/README.md`、`数据文件夹现状.md`（不在仓库）。  
- **代码当前默认根**：`src/lib/file-store.ts` → 未设置 `PROJECT_PILOT_DATA_DIR` 时为 `**~/.project-pilot`**（不再默认使用 `~/.project-pilot/data/`）。仓库内路径索引：`**[docs/data-storage.md](docs/data-storage.md)`**。与上述目标可能不一致时，以 `**数据文件夹现状.md**` 为准。对齐 2026-03-31。
- 数据操作通过 `src/lib/file-store.ts`，使用原子写入（先写 .tmp 再 rename）
- `modifyJsonFile()` 带进程级写入队列（同文件路径串行）

### 后端架构

- 单一 Hono 进程处理所有 API 请求，不再有 Sidecar
- `AgentChatManager`、`SchedulerManager`、`EventTriggerManager` 直接运行在 Hono 进程内
- 20 个路由模块，覆盖全部 91 个 API 端点
- 错误处理通过 `errorHandler` 中间件统一捕获

### 前端架构

- Vite SPA + React Router v7 客户端路由
- `src/client/i18n/routing.tsx` 提供 `Link`/`useRouter`/`usePathname` 兼容层
- `src/client/i18n/use-translations.ts` 提供 `useTranslations` 兼容层（next-intl → react-i18next）
- 所有组件的 `'use client'` 指令无害保留

### 提示词系统

- `src/lib/agent-prompt-store.ts` 管理 prompt 文件的读写删
- `writePromptFile()` 写入前自动快照到 `.history/`（保留 20 份）
- 会话可拥有 runtime 工作副本 `.runtime/{sessionId}.md`

### Agent 系统

- 内置 Agent 在 `src/lib/default-agents.ts`
- Agent 通过 `executionMode` 区分：`'task'`（ProcessManager + worktree）vs `'chat'`（AgentChatManager）
- `AgentChatManager` 是进程级单例

