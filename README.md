# ProjectPilot

> Not another AI chatbox. A work system for humans and Agents to move tasks forward together.

<p align="center">
  <img src="docs/images/projectpilot-chat-workspace.png" alt="ProjectPilot chat workspace" width="1200" />
</p>

<p align="center">
  <img src="docs/images/projectpilot-prompts-overview.png" alt="ProjectPilot prompts overview" width="49%" />
  <img src="docs/images/projectpilot-todo-board.png" alt="ProjectPilot todo board" width="49%" />
</p>

[中文](#中文) | [English](#english)

---

## 中文

### ProjectPilot 是什么

ProjectPilot 不是一个单纯的聊天助手，也不只是一个项目管理工具。

它的定位是：

> **一个面向人和 Agent 协作的任务推进系统。**

今天的大多数 AI 产品擅长回答问题、生成内容、完成一次性操作，但真实工作并不是一次问答。

真实工作是持续的：

- 要发现问题
- 要拆解任务
- 要调度不同 Agent
- 要沉淀上下文和文档
- 要跨会话持续推进
- 要知道谁在做、做到哪、为什么卡住

ProjectPilot 要解决的就是这层问题：  
**把“会聊天的 AI”变成“能协作、能执行、能追踪、能交付的工作力量”。**

### 一句话理解

- 对用户：**不只是陪你聊天，而是陪你把事做完。**
- 对团队：**让人和多个 Agent 在同一套工作系统里协作。**
- 对产品：**以 Task 为主轴，以 Project 为工作域，以 Context / Docs / Resources 为底座。**

### 核心能力

- **多 Agent 协作**
  - 支持自定义 Agent、Guest Agent、Butler、任务执行型 Agent
- **任务推进**
  - 支持待办、任务拆解、任务状态流转、持续跟踪
- **会话驱动执行**
  - 不只是记录聊天，而是把会话变成实际工作入口
- **上下文系统**
  - 为 Agent 注入用户信息、项目上下文、资源、知识卡片
- **知识与文档沉淀**
  - 自动提取知识草稿、设计文档、执行产物
- **Claude Code 集成**
  - 直接驱动 Claude Code / CLI 执行复杂任务
- **项目级工作视图**
  - 支持从 Flow、Project、Todo、Session 等不同视角观察工作

### 它适合什么场景

1. **软件开发**
   - 让 Agent 参与编码、修复、重构、文档和排查
2. **长期复杂任务**
   - 不是一次性问答，而是需要跨多轮持续推进的事情
3. **多 Agent 分工**
   - 不同 Agent 分别负责分析、执行、审查、整理
4. **知识型工作**
   - 研究、写作、设计、产品规划、问题诊断

### 为什么不是普通聊天产品

普通聊天产品解决的是：

- “问一个问题，拿一个回答”

ProjectPilot 解决的是：

- “一件事怎么被持续推进，直到真正完成”

所以它关心的不是单条消息本身，而是这些东西如何连起来：

- `Project`
- `Task`
- `Session`
- `Context`
- `Resource`
- `Document`
- `Agent`

### 快速开始

#### 环境要求

- Node.js 18+
- Git
- Claude Code CLI

#### 安装

```bash
git clone https://github.com/Kaine665/Project-Pilot.git
cd Project-Pilot
npm install
npm install -g @anthropic-ai/claude-code
npm run dev
```

打开 `http://localhost:4000`

#### 数据目录

- **与 `file-store` 对齐的仓库内索引**：[`docs/data-storage.md`](docs/data-storage.md)  
- **本机规范与现状**：`~/.project-pilot/README.md`、`数据文件夹现状.md`（不在 Git 内）

**对齐日期**：2026-03-31。

### 文档

- [AI 知识地图与多入口同步](docs/AI_AGENT_KNOWLEDGE_MAP.md)
- [数据目录（与 file-store 对齐）](docs/data-storage.md)
- [Agent Chat Architecture](docs/agent-chat-architecture.md)
- [Context System](docs/context-system.md)
- [Data Storage](docs/data-storage.md)
- [AI Task Workflow](docs/ai-task-workflow.md)
- [Artifact Retry](docs/artifact-retry.md)
- [Frontend Design](docs/frontend-design.md)
- [I18N Guide](docs/I18N_GUIDE.md)

### 技术栈

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 4
- **AI Runtime**: Claude Code CLI / related agent runtime adapters
- **Storage**: File-based JSON persistence
- **I18N**: next-intl

### 贡献

1. Fork 仓库
2. 创建分支 `git checkout -b feature/your-feature`
3. 提交变更
4. 推送分支
5. 发起 PR

更多细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### License

MIT，见 [LICENSE](LICENSE)。

---

## English

### What is ProjectPilot

ProjectPilot is not just an AI assistant, and not just a project management tool.

Its positioning is:

> **A task execution and coordination system for humans and Agents.**

Most AI products today are good at answering questions, generating content, or completing one-off requests.  
Real work is different. Real work is ongoing:

- finding issues
- breaking work into tasks
- coordinating multiple agents
- preserving context and documents
- continuing across sessions
- tracking who is doing what and where things are blocked

ProjectPilot is built for that layer.  
It turns AI from a chat interface into a collaborative work force that can execute, coordinate, and deliver.

### In One Sentence

- For users: **Not just chat with AI. Get work done with AI.**
- For teams: **Coordinate humans and multiple agents in one work system.**
- For the product: **Task-centric, project-scoped, context-backed collaboration.**

### Core Capabilities

- **Multi-agent collaboration**
  - Custom agents, guest agents, butlers, task workers
- **Task progression**
  - Todo tracking, task decomposition, status transitions, ongoing follow-through
- **Session-driven execution**
  - Sessions are not just transcripts; they are work entry points
- **Context system**
  - Inject user info, project knowledge, resources, and reusable context into agents
- **Knowledge and document capture**
  - Extract knowledge drafts, design docs, and execution artifacts
- **Claude Code integration**
  - Drive complex coding workflows through Claude Code / CLI
- **Project-level work views**
  - Observe work via flows, projects, todos, sessions, and related resources

### Use Cases

1. **Software development**
   - Coding, debugging, refactoring, docs, investigation
2. **Long-running work**
   - Work that spans multiple sessions and iterations
3. **Multi-agent workflows**
   - Analysis, execution, review, coordination
4. **Knowledge work**
   - Research, writing, design, product planning, diagnosis

### Why It Is Not Just Another Chat Product

Typical AI chat products solve:

- “Ask once, get one answer.”

ProjectPilot solves:

- “How does work keep moving until it is actually done?”

That is why its center of gravity is not a single message, but the system around work:

- `Project`
- `Task`
- `Session`
- `Context`
- `Resource`
- `Document`
- `Agent`

### Quick Start

#### Requirements

- Node.js 18+
- Git
- Claude Code CLI

#### Installation

```bash
git clone https://github.com/Kaine665/Project-Pilot.git
cd Project-Pilot
npm install
npm install -g @anthropic-ai/claude-code
npm run dev
```

Open `http://localhost:4000`

#### Data Directory

- **In-repo index aligned with `file-store`**: [`docs/data-storage.md`](docs/data-storage.md)  
- **On your machine**: `~/.project-pilot/README.md` and `数据文件夹现状.md` (not in git)

**Last aligned**: 2026-03-31.

### Documentation

- [AI knowledge map and multi-tool sync](docs/AI_AGENT_KNOWLEDGE_MAP.md)
- [Data directory (aligned with file-store)](docs/data-storage.md)
- [Agent Chat Architecture](docs/agent-chat-architecture.md)
- [Context System](docs/context-system.md)
- [Data Storage](docs/data-storage.md)
- [AI Task Workflow](docs/ai-task-workflow.md)
- [Artifact Retry](docs/artifact-retry.md)
- [Frontend Design](docs/frontend-design.md)
- [I18N Guide](docs/I18N_GUIDE.md)

### Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 4
- **AI Runtime**: Claude Code CLI / agent runtime adapters
- **Storage**: File-based JSON persistence
- **I18N**: next-intl

### Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes
4. Push the branch
5. Open a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### License

MIT. See [LICENSE](LICENSE).
