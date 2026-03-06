# ProjectPilot — develop-static worktree

## 这是什么

这是 ProjectPilot 的**稳定运行目录**，用户正在使用此目录的实例（端口 4000）。
HMR 会让任何源码改动立即生效并触发 UI 刷新，**影响用户正在进行的工作**。

## 铁律：不要直接在这里修改源码

如果你需要修改 ProjectPilot 的源代码（`src/` 下的任何文件），**必须**通过 git worktree 隔离开发：

```bash
PROJECT_ROOT="D:/Desktop/ProgrammingProjects/personal-projects/03-In-Development/project-pilot"
FEATURE="<feature-name>-<YYMMDD>"   # 如 chat-fix-260305
BRANCH_NAME="dev/$FEATURE"
DEV_WT="$PROJECT_ROOT/$FEATURE"

# 创建 worktree
cd "$PROJECT_ROOT/develop-static"
git worktree add -b "$BRANCH_NAME" "$DEV_WT" develop-static
cd "$DEV_WT" && npm install

# 在 DEV_WT 中完成所有开发...
# 完成后合并回来
cd "$PROJECT_ROOT/develop-static"
git merge "$BRANCH_NAME" --no-ff -m "feat/fix: 描述"

# 清理
git worktree remove "$DEV_WT"
git branch -d "$BRANCH_NAME"
```

## 允许直接在这里做的事

- 读取文件、搜索代码（研究和分析）
- 修改配置文件（`CLAUDE.md`、`.claude/` 等非源码文件）
- 运行 git 命令（查看 log、status、diff 等）
- 运行类型检查（`npx tsc --noEmit`）

## 技术栈

- Next.js 15 + React 19 + TypeScript (strict) + Tailwind CSS 4 + shadcn/ui (Radix)
- 国际化：next-intl (中/英)
- AI：Claude CLI (`claude` 命令) 通过子进程调用，流式 JSON 输出
- 包管理：npm
- 主实例端口：4000

## 开发命令

```bash
npm run dev          # 开发服务器 (port 4000, Turbopack)
npm run build        # 生产构建（提交前必须通过）
npm run lint         # ESLint 检查
```

## 核心架构约定

### 数据层

- 所有数据存储在 `~/.project-pilot/data/`（纯 JSON 文件，无数据库）
- 数据操作通过 `src/lib/file-store.ts`，使用原子写入（先写 .tmp 再 rename）
- `modifyJsonFile()` 带进程级写入队列（同文件路径串行）
- `agents.json` 和 `agent-chat-sessions.json` 写入前自动快照到 `_snapshots/`
- Agent 的 systemPrompt 存储在 `prompts/{agentId}.md`，**不存入 agents.json**

### 提示词系统

- `src/lib/agent-prompt-store.ts` 管理 prompt 文件的读写删
- `writePromptFile()` 写入前自动快照到 `.history/`（保留 20 份）
- 会话可拥有 runtime 工作副本 `.runtime/{sessionId}.md`，会话删除时清理
- `deletePromptFile()` 同时清理 `.history/` 和 `.runtime/` 目录
- Prompt 路径函数集中在 `file-store.ts`：`getPromptFilePath`、`getPromptHistoryDir`、`getPromptRuntimeDir`、`getPromptRuntimePath`

### Agent 系统

- 内置 Agent 在 `src/lib/default-agents.ts`，运行时合并到 agents.json
- 内置 Agent 不可删除（DELETE 返回 403），slug/builtIn 不可修改
- Agent 通过 `executionMode` 区分：`'task'`（ProcessManager + worktree）vs `'chat'`（AgentChatManager）
- `AgentChatManager` 是进程级单例（dev 环境挂 globalThis 防热重载重建）

### 资源注入层

- `ResourceRef + Loader + Registry` 架构（见 PLAN.md）
- 加新资源类型 = 加 loader 文件 + 注册，不需要改 prompt builder
- 资源按 priority 排序注入 prompt（小值靠前）

### 会话管理

- 会话软删除（archive 标记），非物理删除
- `deleteSession()` 物理删除时需同时清理 runtime prompt 副本
- Session Health Guard：异常结束自动重试一次

## 编码规范

### 错误处理模式

- 文件不存在（ENOENT）→ 静默返回 undefined/空值，不抛异常
- 快照/清理操作 → try/catch 包裹，失败不阻塞主流程
- 数据安全 → `agents.json` 写入有数据丢失防护（数量骤降过半时拒绝写入）

### 路径安全

- 所有用户输入的 ID 做 `replace(/[^a-zA-Z0-9_-]/g, '')` sanitization
- 文件路径使用 `path.join`，不拼接用户输入

### 命名约定

- 文件：kebab-case (`agent-prompt-store.ts`)
- 函数：camelCase (`readPromptFile`)
- 类型/接口：PascalCase (`AgentChatSession`)
- 常量：UPPER_SNAKE_CASE (`MAX_PROMPT_SIZE`)
- 生成 ID：`{前缀}-{timestamp}-{random}`（如 `agent-chat-1709640000-a1b2`）

### 语言

- UI 文案和注释默认中文
- 代码中变量名/函数名用英文
- Commit 消息用英文，遵循 Conventional Commits

## 关键文件索引

| 路径 | 作用 |
|------|------|
| `src/types/index.ts` | Agent, AgentCapabilities 等核心类型 |
| `src/types/agent-chat.ts` | AgentChatSession, SessionConfig |
| `src/types/resource.ts` | ResourceRef, ResolvedResource |
| `src/lib/file-store.ts` | 数据层：路径函数 + 原子读写 + 快照 |
| `src/lib/agent-prompt-store.ts` | Prompt 文件 CRUD + 版本管理 |
| `src/lib/default-agents.ts` | 内置 Agent 定义 |
| `src/lib/chat-managers/agent-chat-manager.ts` | Agent 会话管理器 |
| `src/lib/chat-managers/base-chat-manager.ts` | Claude CLI 子进程基类 |
| `src/lib/resource-registry.ts` | 资源注册表 |
| `src/lib/resource-loaders/` | 各类资源加载器 |
| `src/app/api/agents/route.ts` | Agent CRUD API |
| `src/app/api/agent-chat/` | Agent 会话 API 路由集 |

## 注意事项

- 没有自动化测试（无 .test.ts），提交前靠 `npm run build` 验证
- 不要在 `agents.json` 中写入 `systemPrompt` 字段（写入时已过滤）
- `settings.json` 含 API Key，**绝不读取或泄露**
- Windows 环境开发，路径需兼容（file-store 已有 Windows EPERM 重试）
