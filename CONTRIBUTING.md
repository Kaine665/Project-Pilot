# 参与贡献 · Contributing to ProjectPilot

[中文](#中文) | [English](#english)

---

## 中文

感谢你愿意为 ProjectPilot 贡献力量。

### 行为准则

参与本项目即表示你同意遵守社区行为准则（Code of Conduct）。

### 分支模型（统一约定）

我们使用 **`main` / `next` / `feature/*` / `hotfix/*`**，目标是：**语义清晰、可回滚、可追溯**。请勿使用语义模糊的长期分支名（如 `test`、`develop`）作为集成线。

| 分支 | 用途 |
|------|------|
| **`main`** | 稳定、可发布；与 release / tag 对齐 |
| **`next`** | 日常集成与当前迭代 |
| **`feature/<简述>`** | 从 `next` 拉出，PR **合并回 `next`** |
| **`hotfix/<简述>`** | 从 `main` 拉出，PR **合并回 `main`**，且同一修复需再进入 **`next`** |

**日常开发（与远端一致）**

1. 更新集成线：`git fetch origin && git checkout next && git pull origin next`
2. 开功能分支：`git checkout -b feature/your-topic`
3. 推送并开 PR：**base 选 `next`**（见下方「合并请求」）
4. Hotfix：**base 选 `main`**，合并后由维护者将修复同步到 `next`

维护者配置 GitHub 分支保护、防止绕过规则：**[`docs/github-branch-policy.md`](docs/github-branch-policy.md)**。

### Issue、PR 与 Push 分别做什么

- **Issue**：要不要做、做什么、有没有争议——**需要留记录或先讨论对齐时**再用。
- **PR**：**任何要进入 `next` / `main` 的改动**（含修改 `CONTRIBUTING`、`.github` 模板、`docs/` 等），都通过 PR 留下 **diff 与评审记录**，再合并进保护分支。
- **Push**：只是把本地提交推到远端上的 **`feature/xxx`（或 `hotfix/xxx`）**；**真正进入主线**依赖 **PR 合并**。Push 不是与 Issue、PR 并列的「第三种提交方式」，而是 **把分支同步到远程** 以便开 PR 的那一步。

### 文档与模板本身如何修改

`CONTRIBUTING.md`、`docs/github-branch-policy.md`、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/` 等与贡献流程相关的文件，**与业务代码一样受分支与 PR 约束**，不因由谁起草（例如协作工具生成）而例外。

| 情况 | 建议做法 |
|------|----------|
| **笔误、链接错误、与当前实现明显不一致** | 从 `next` 拉 `feature/...`，改完后 **PR → `next`**；**不必**先开 Issue。 |
| **要改「大家以后怎么协作」**（分支策略、是否必须 review、保护规则含义等） | 先 **Issue（或团队讨论并留 Issue 记录）** 对齐方向，再 **PR** 改文档，避免合入后仍有争议。 |
| **单人维护、改动小** | 仍建议走 **PR → `next`** 保留历史；若仓库策略允许自批自合，可 **0 个额外审批**，环节不增等待。 |

若改动触及 **多入口文档同步**（例如数据路径、架构摘要），请按 **[`docs/AI_AGENT_KNOWLEDGE_MAP.md`](docs/AI_AGENT_KNOWLEDGE_MAP.md)** 中的检查清单一并更新相关文件，并在该文件文末 **变更记录** 登记。

### 报告缺陷

提交前请先搜索已有 Issue，避免重复。新建缺陷报告时请尽量包含：

- **清晰标题**
- **复现步骤**
- **具体示例或数据**
- **实际表现与预期表现**
- **截图**（如适用）
- **环境**：操作系统、Node / Bun 版本等

### 功能建议

通过 GitHub Issue 跟踪。请说明：

- **清晰标题**
- **需求描述**
- **为何有用**
- **使用场景示例**

### 合并请求（Pull Request）

1. Fork 仓库（或直接克隆有写权限的上游），从 **`next`** 创建分支：`git checkout next && git pull && git checkout -b feature/...`
2. 打开 PR 时：**绝大多数情况 base 为 `next`**；仅稳定线紧急修复时 base 为 **`main`**（`hotfix/*`）
3. 若改动需要测试，请补充测试
4. 确保本地测试通过
5. 确保通过 Lint
6. 提交信息遵循下文 **Conventional Commits** 约定

#### 提交信息约定

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

常用 `type`：

- `feat`：新功能
- `fix`：缺陷修复
- `docs`：仅文档
- `style`：格式等不改变语义的调整
- `refactor`：重构
- `perf`：性能
- `test`：测试
- `chore`：构建或辅助工具

示例：

```
feat(flow): add drag-and-drop for flow nodes

- Implement drag-and-drop for flow nodes
- Add visual feedback during drag
- Update documentation

Closes #123
```

### 开发环境

在 **`develop-static/`** 目录下（本仓库主应用）：

```bash
git clone https://github.com/YOUR_ORG/project-pilot.git
cd project-pilot/develop-static

bun install

# 同时启动 Vite 前端 + Hono 后端
bun run dev

bun run lint
# bun test   # 视测试落地情况使用
```

桌面端开发可参考：`bun run electron:dev`（详见 [`CLAUDE.md`](CLAUDE.md)）。

### 项目结构（概要）

当前主栈为 **Vite（前端 SPA）+ Hono（后端）+ Electron（桌面）**，详细目录见 [`CLAUDE.md`](CLAUDE.md)。概要：

```text
src/
├── client/      # Vite / React Router 前端
├── server/      # Hono 路由与中间件
├── components/  # 共享 UI 组件
├── lib/         # 业务逻辑（前后端共享）
├── stores/      # 状态等
└── ...
```

### 编码约定

- 新代码使用 **TypeScript**
- 格式化以项目 Prettier / ESLint 为准
- 命名清晰；复杂逻辑加必要注释
- 相关功能放在相近目录

### 测试

测试策略与命令随仓库演进补充；提交前请按 PR 说明运行已有测试与 Lint。

### 文档

- 行为或用户可见能力变化时更新 **README** 或相关 **`docs/`**
- 公共 API 视情况补充 JSDoc
- 架构或非琐碎行为变化遵循 [`CLAUDE.md`](CLAUDE.md) 中文档驱动流程

### 提问

可开 Issue 并打上 `question` 标签，或联系维护者。

### 致谢

贡献者将在 README 与发行说明中得到致谢。

---

## English

Thank you for contributing to ProjectPilot.

### Code of conduct

By participating, you agree to uphold this community’s Code of Conduct.

### Branching model

We use **`main` / `next` / `feature/*` / `hotfix/*`** for **clear semantics, rollback, and traceability**. Avoid vague long-lived names such as `test` or `develop` for integration work.

| Branch | Purpose |
|--------|---------|
| **`main`** | Stable, releasable; aligned with releases/tags |
| **`next`** | Day-to-day integration and the current iteration |
| **`feature/<short-name>`** | Branch from **`next`**, open PR **into `next`** |
| **`hotfix/<short-name>`** | Branch from **`main`**, PR **into `main`**, then **backport the same fix to `next`** |

**Daily workflow (aligned with remote)**

1. Update integration line: `git fetch origin && git checkout next && git pull origin next`
2. Create a feature branch: `git checkout -b feature/your-topic`
3. Push and open a PR: **base = `next`** (see Pull requests below)
4. Hotfix: **base = `main`**; after merge, maintainers sync the fix into **`next`**

GitHub branch protection and bypass prevention for maintainers: **[`docs/github-branch-policy.md`](docs/github-branch-policy.md)**.

### What Issues, PRs, and pushes are for

- **Issues**: Decide **whether** to do something, **what** it is, and surface **disagreement**—use them when you need a **record** or **discussion before coding**.
- **Pull requests**: **Every change that should land on `next` or `main`** (including `CONTRIBUTING`, `.github` templates, and `docs/`) goes through a PR so there is a **diff and review trail** before merging protected branches.
- **Push**: Pushes your local commits to the remote **`feature/xxx`** (or **`hotfix/xxx`**). **Entering the main lines still happens via PR merge**. A push is not a third “submission type” alongside Issues and PRs—it is the step that **publishes your branch** so you can open a PR.

### How to change docs and templates

Files that define how we contribute—`CONTRIBUTING.md`, `docs/github-branch-policy.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*`, etc.—follow the **same branching and PR rules** as product code, regardless of who drafted them (including tooling).

| Situation | What to do |
|-----------|------------|
| **Typos, broken links, clear mismatch with current behavior** | Branch from `next`, fix on `feature/...`, open **PR → `next`**. No Issue required. |
| **Changing team workflow** (branch policy, review expectations, meaning of protection rules) | Open an **Issue** (or discuss and capture an Issue), align, then **PR** the docs. |
| **Solo maintainer, small edits** | Still prefer **PR → `next`** for history; use **zero required reviewers** if policy allows so you are not blocked. |

If the change touches **multi-entry docs** (data paths, architecture summaries, etc.), follow the checklist in **[`docs/AI_AGENT_KNOWLEDGE_MAP.md`](docs/AI_AGENT_KNOWLEDGE_MAP.md)** and append a row to its **变更记录 / change log**.

### Reporting bugs

Search existing issues first. New reports should include:

- **Clear title**
- **Steps to reproduce**
- **Concrete examples**
- **Observed vs expected behavior**
- **Screenshots** if helpful
- **Environment** (OS, Node/Bun versions, etc.)

### Suggesting enhancements

Use GitHub issues. Include:

- **Clear title**
- **Detailed description**
- **Why it matters**
- **Example use cases**

### Pull requests

1. Fork (or clone a writable upstream), branch from **`next`**: `git checkout next && git pull && git checkout -b feature/...`
2. **Base is usually `next`**; only urgent stable-line fixes use **`main`** (`hotfix/*`)
3. Add tests when behavior warrants them
4. Ensure tests pass locally
5. Ensure lint passes
6. Follow **Conventional Commits** below

#### Commit message convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Common `type` values: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore` (see Chinese section for meanings).

Example:

```
feat(flow): add drag-and-drop for flow nodes

- Implement drag-and-drop for flow nodes
- Add visual feedback during drag
- Update documentation

Closes #123
```

### Development setup

From **`develop-static/`** (main app in this repo):

```bash
git clone https://github.com/YOUR_ORG/project-pilot.git
cd project-pilot/develop-static

bun install
bun run dev
bun run lint
```

Desktop: `bun run electron:dev` (see [`CLAUDE.md`](CLAUDE.md)).

### Project layout (overview)

Stack: **Vite SPA + Hono + Electron**. Details in [`CLAUDE.md`](CLAUDE.md). Rough layout:

```text
src/
├── client/
├── server/
├── components/
├── lib/
├── stores/
└── ...
```

### Coding guidelines

- TypeScript for new code
- Prettier/ESLint as configured
- Descriptive names; comments for non-obvious logic
- Keep related code together

### Testing

Run whatever tests and lint the repo provides before opening a PR; details evolve with the project.

### Documentation

- Update **README** or **`docs/`** when behavior or UX changes
- JSDoc for public APIs where appropriate
- Non-trivial changes follow the doc-driven flow in [`CLAUDE.md`](CLAUDE.md)

### Questions

Open an issue with the `question` label or contact maintainers.

### Recognition

Contributors are credited in the README and release notes.
