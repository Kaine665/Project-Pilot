# 任务如何省 Token

## 问题

ProjectPilot 中每个 task 的 Claude 进程（`claude -p`）都从零开始认识代码库——读目录结构、读关键文件、理解架构。如果 3 个兄弟任务都在同一个模块里工作，这个"认识代码库"的过程重复了 3 遍，token 全花在了重复的探索上。

这是当前架构的固有问题：每个 task 是一个独立的 Claude 进程，进程之间不共享上下文（即使用 `--resume`，也只在同一个 task 的对话链内有效）。

## 核心思路

省 token 的本质就一个：**把重复的调查结果缓存下来，后续任务直接注入，不用再调查。**

以下按实施难度从低到高排列。

---

## 方案一：用好 CLAUDE.md（零成本）

Claude Code 原生支持——项目根目录放一个 `CLAUDE.md`，每次 Claude 启动都会自动读取。把项目架构、关键约定、文件职责写在里面，等于免费给每个 agent 注入了共享知识。

```markdown
# 项目架构

## 目录结构
- src/api/ — API 路由层，每个文件对应一个资源
- src/components/ — React 组件，UI 层
- src/lib/ — 核心逻辑（process-manager、prompt-builder、file-store...）
- src/types/ — 类型定义（index.ts 主类型、flow.ts 流程类型）

## 关键模式
- 数据存储：JSON 文件，通过 lib/file-store.ts 统一读写
- AI 进程：通过 lib/process-manager.ts 管理 claude -p 子进程
- 前后端通信：SSE 流式事件（api/ai-chat/stream）
- 国际化：next-intl，支持 zh/en

## 技术栈
- Next.js 16 + React 19 + TypeScript 5
- Tailwind CSS 4（OKLch 色彩系统）
- Radix UI 组件库
```

**优点**：不需要改任何代码，现在就能做。Claude 不用花 token 去 `ls src/` 然后逐个文件 `Read` 来搞清楚项目结构。

**局限**：静态的，需要人工维护。项目结构变了要同步更新。

---

## 方案二：项目级上下文文档注入 prompt（低成本）

在 `buildPrompt` 中注入一份项目结构摘要。ProjectPilot 的 prompt 构建流程已经注入了 task 信息、project 信息、flowContext，加一个 `projectSummary` 字段即可。

与 CLAUDE.md 的区别：
- CLAUDE.md 是 Claude Code CLI 自动读取的，内容固定
- projectSummary 是 ProjectPilot 主动注入的，可以动态生成、按需裁剪

比如可以根据 task 所属的 Section 或涉及的模块，只注入相关模块的摘要，而不是整个项目的。这样 token 更省，上下文更精准。

**实现思路**：
1. 项目注册时，生成或手写一份项目摘要，存在 project 配置中
2. `buildPrompt` 读取摘要，注入 prompt 的系统上下文部分
3. 每个 task agent 启动时就已经"知道"项目结构，跳过探索阶段

---

## 方案三：模块级缓存（中等成本）

粒度更细——按模块缓存代码库认知。

当 Task A 在 Understanding 阶段分析了 `src/api/` 目录的现状（文件列表、关键函数、数据流），把分析结果存下来。Task B 如果也涉及 `src/api/`，启动时直接注入 A 的分析结果，跳过重复探索。

这跟"已完成任务的 TaskResult 注入后续任务上下文"是同一个思路，只是范围更大——不只是注入执行结果，还注入过程中对代码库的认知。

**实现思路**：
1. 在 Understanding 阶段的 prompt 中，要求 AI 额外输出一个 `codebase_snapshot` 结构化摘要
2. 存储在 task artifacts 中，按模块路径索引
3. 后续兄弟任务启动时，检查是否有已缓存的相关模块摘要
4. 有则注入 prompt，无则让 AI 自行探索（并缓存供后续使用）

**局限**：缓存有时效性。如果 Task A 改了代码，Task A 的缓存对 Task B 可能已经过时。需要设计缓存失效策略（比如 task 完成后标记其 affected_files 相关的缓存为 stale）。

---

## 优先级

| 方案 | 投入 | 效果 | 建议 |
|---|---|---|---|
| CLAUDE.md | 零 | 减少基础探索的 token | 现在就做 |
| 项目级摘要注入 prompt | 低 | 动态裁剪，更精准 | 下一步做 |
| 模块级缓存 | 中 | 最大化 token 节省 | 需求明确后再做 |

**推荐的第一步**：写一份 CLAUDE.md。这是零成本的改进，每个 agent 启动时都能受益。
