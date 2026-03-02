# ProjectPilot

> AI-powered project management with Claude Code integration

[English](#english) | [中文](#中文)

---

## 中文

### 🎯 这是什么？

ProjectPilot 是一个 AI 辅助的项目管理工具，它将**任务跟踪**和 **AI 执行**深度整合，让 AI 不仅能帮你规划任务，还能真正动手完成它们。

**核心特性：**
- 📊 **Flow 可视化链路** - Flows → Nodes → Tasks 三层树形结构管理项目
- 🤖 **自定义 Agent 系统** - 创建自定义 AI Agent，配置系统提示、权限、资源
- 🏠 **智能管家（Butler）** - 项目级 AI 助手，了解项目全貌，支持侧边栏和全屏模式
- 💬 **嵌入式 AI 对话** - 实时查看 AI 的思考和执行过程，支持多模态（图片）
- 📦 **产物自动提取** - 智能识别并展示 AI 生成的代码、计划、结果
- 🔄 **与 Claude Code 集成** - 直接调用 Claude CLI 执行复杂任务
- 📖 **上下文系统** - 用户预设个人信息、API Key 等，Agent 按需读取
- 📝 **知识草稿 & 设计文档** - 对话中自动提取知识片段和设计文档，持久化保存
- 🔴 **未读消息提示** - Agent 回复后自动标记未读，红色 badge 提醒
- ✅ **待办事项（Todos）** - 管理项目待办，Agent 可读取和操作
- 👥 **Guest Agent（旁听）** - 在其他 Agent 对话中引入"旁听"Agent 提供不同视角

### 🚀 快速开始

#### 前置要求

- Node.js 18+
- Claude Code CLI（需要 Anthropic API key）
- Git

#### 安装

```bash
# 克隆仓库
git clone https://github.com/Kaine665/Project-Pilot.git
cd Project-Pilot

# 安装依赖
npm install

# 配置 Claude CLI（如果还没安装）
npm install -g @anthropic-ai/claude-code

# 启动开发服务器
npm run dev
```

访问 http://localhost:4000

#### 数据存储

ProjectPilot 的数据默认存储在用户目录：
- **Windows**: `C:\Users\<用户名>\.project-pilot\data\`
- **macOS**: `/Users/<用户名>/.project-pilot/data/`
- **Linux**: `/home/<用户名>/.project-pilot/data/`

如需自定义位置，创建 `.env` 文件：
```bash
PROJECT_PILOT_DATA_DIR=/path/to/custom/data
```

从旧版本迁移数据（如果数据在项目 `data/` 目录）：
```bash
npm run migrate:data
```

详见 [数据存储文档](docs/data-storage.md)

### 💡 使用场景

1. **软件开发项目** - 让 AI 帮你写代码、修 bug、重构
2. **学习新技术** - 创建学习流程，让 AI 分阶段教你
3. **文档写作** - AI 理解需求 → 生成大纲 → 撰写内容
4. **问题诊断** - 描述问题 → AI 分析 → 生成解决方案

### 🏗️ 架构亮点

#### 五阶段工作流

```
Phase 1-2: Understanding → AI 理解任务四要素（项目/目标/原因/交付物）
Phase 3:   Planning     → AI 生成执行计划
Phase 4:   Executing    → AI 实际执行（代码、git、命令）
Phase 5:   Summarizing  → AI 总结结果和经验
```

#### Code-based State Control

- **状态在代码侧** - 不依赖 AI 自主判断，更可靠
- **产物驱动转换** - 检测到 `json:understanding` 自动进入 Phase 3
- **3-retry 机制** - 产物格式错误自动重试 3 次，失败后人工介入

### 📚 文档

- [Agent Chat 架构](docs/agent-chat-architecture.md)
- [上下文系统](docs/context-system.md)
- [数据存储](docs/data-storage.md)
- [五阶段工作流设计](docs/ai-task-workflow.md)
- [产物重试机制](docs/artifact-retry.md)
- [前端设计](docs/frontend-design.md)
- [国际化指南](docs/I18N_GUIDE.md)

### 🛠️ 技术栈

- **前端**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 4
- **AI**: Claude API (via Claude Code CLI)
- **存储**: 文件系统（JSON）
- **国际化**: next-intl

### 🤝 贡献指南

我们欢迎所有形式的贡献！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交变更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解更多细节。

### 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

### 🙏 致谢

- [Claude Code](https://github.com/anthropics/claude-code) - 强大的 AI 编程助手
- [Next.js](https://nextjs.org/) - React 框架
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架

---

## English

### 🎯 What is this?

ProjectPilot is an AI-powered project management tool that deeply integrates **task tracking** with **AI execution**, enabling AI not only to plan your tasks but also to actually complete them.

**Key Features:**
- 📊 **Flow Visualization** - Manage projects with Flows → Nodes → Tasks hierarchy
- 🤖 **Custom Agent System** - Create custom AI Agents with system prompts, permissions, and resources
- 🏠 **Smart Butler** - Project-level AI assistant that understands your project, supports sidebar and full-screen modes
- 💬 **Embedded AI Chat** - Real-time view of AI's thinking and execution, with multimodal (image) support
- 📦 **Automatic Artifact Extraction** - Intelligently identify and display AI-generated code, plans, and results
- 🔄 **Claude Code Integration** - Direct integration with Claude CLI for complex tasks
- 📖 **Context System** - User-defined context entries (personal info, API keys, etc.) available to Agents on demand
- 📝 **Knowledge Drafts & Design Docs** - Auto-extract knowledge and design documents from conversations
- 🔴 **Unread Notifications** - Red badge indicators for unread Agent replies
- ✅ **Todos** - Manage project tasks; Agents can read and manipulate todo items
- 👥 **Guest Agent** - Bring in "observer" Agents to provide different perspectives on conversations

### 🚀 Quick Start

#### Prerequisites

- Node.js 18+
- Claude Code CLI (requires Anthropic API key)
- Git

#### Installation

```bash
# Clone the repository
git clone https://github.com/Kaine665/Project-Pilot.git
cd Project-Pilot

# Install dependencies
npm install

# Configure Claude CLI (if not already installed)
npm install -g @anthropic-ai/claude-code

# Start development server
npm run dev
```

Visit http://localhost:4000

#### Data Storage

ProjectPilot data is stored in your user directory by default:
- **Windows**: `C:\Users\<username>\.project-pilot\data\`
- **macOS**: `/Users/<username>/.project-pilot/data/`
- **Linux**: `/home/<username>/.project-pilot/data/`

To customize the location, create a `.env` file:
```bash
PROJECT_PILOT_DATA_DIR=/path/to/custom/data
```

Migrate data from old versions (if data is in project `data/` directory):
```bash
npm run migrate:data
```

See [Data Storage Documentation](docs/data-storage.md) for details.

### 💡 Use Cases

1. **Software Development** - Let AI write code, fix bugs, refactor
2. **Learning New Technologies** - Create learning flows, let AI teach you step-by-step
3. **Documentation Writing** - AI understands requirements → generates outline → writes content
4. **Problem Diagnosis** - Describe issue → AI analyzes → generates solution

### 🏗️ Architecture Highlights

#### 5-Phase Workflow

```
Phase 1-2: Understanding → AI understands 4 elements (project/goal/reason/deliverable)
Phase 3:   Planning     → AI generates execution plan
Phase 4:   Executing    → AI actually executes (code, git, commands)
Phase 5:   Summarizing  → AI summarizes results and learnings
```

#### Code-based State Control

- **State on Code Side** - No reliance on AI autonomous judgment, more reliable
- **Artifact-Driven Transitions** - Auto-advance to Phase 3 upon detecting `json:understanding`
- **3-Retry Mechanism** - Auto-retry 3 times on format errors, manual intervention on failure

### 📚 Documentation

- [Agent Chat Architecture](docs/agent-chat-architecture.md)
- [Context System](docs/context-system.md)
- [Data Storage](docs/data-storage.md)
- [5-Phase Workflow Design](docs/ai-task-workflow.md)
- [Artifact Retry Mechanism](docs/artifact-retry.md)
- [Frontend Design](docs/frontend-design.md)
- [I18N Guide](docs/I18N_GUIDE.md)

### 🛠️ Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 4
- **AI**: Claude API (via Claude Code CLI)
- **Storage**: File System (JSON)
- **I18N**: next-intl

### 🤝 Contributing

We welcome all forms of contributions!

1. Fork this repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Submit Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments

- [Claude Code](https://github.com/anthropics/claude-code) - Powerful AI programming assistant
- [Next.js](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
