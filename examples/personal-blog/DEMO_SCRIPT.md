# Demo 录制脚本 - 中英双语版

## 🌐 两个版本的差异

| 维度 | 🇨🇳 中文版 | 🇺🇸 英文版 |
|------|----------|----------|
| **界面语言** | 中文 | English |
| **时长** | 60-90秒（国内用户更能接受长一点） | 30-60秒（国外要简短有力） |
| **展示重点** | 完整流程展示，强调"AI 真的能干活" | 核心价值展示，强调效率提升 |
| **文案风格** | 详细说明，技术细节 | 简洁直接，问题→解决方案 |
| **发布平台** | B站、抖音、V2EX、掘金 | YouTube、Twitter、Product Hunt、Reddit |

---

## 🇨🇳 中文版录制脚本

### 版本 A：功能演示型（60秒）

**目标用户**：开发者、项目经理、对 AI 工具感兴趣的人

**文案脚本**：

```
[0-5s] 标题屏幕
📱 画面：ProjectPilot Logo + Slogan
💬 文字：「ProjectPilot - 让 AI 不仅规划，还能执行任务」

[5-15s] 痛点场景
📱 画面：传统的项目管理界面（杂乱、任务堆积）
💬 文字：「项目管理工具很多，但 AI 只能聊天，不能干活？」
       「任务规划了，还得自己一个个执行？」

[15-25s] 解决方案 - Flow 可视化
📱 画面：切换到 ProjectPilot，展示 Flow 界面
💬 文字：「ProjectPilot 提供可视化项目管理」
       「Flow → Node → Task 三层结构，清晰直观」
🎯 操作：快速浏览 "个人技术博客开发" Flow

[25-40s] 核心亮点 - AI 执行
📱 画面：点击一个任务 → 展示 AI 对话和产物
💬 文字：「AI 自动理解需求（四要素）」
       「生成详细执行计划」
       「真正动手写代码、配置、执行命令」
🎯 操作：展示 Understanding → Plan → Execution 流程

[40-55s] 结果展示
📱 画面：展示生成的代码、配置文件、执行结果
💬 文字：「查看 AI 生成的代码和结果」
       「五阶段工作流，每一步都可控」
🎯 操作：展示任务完成状态

[55-60s] CTA
📱 画面：项目信息 + GitHub 链接
💬 文字：「⭐ 开源免费，立即体验」
       「github.com/Kaine665/Project-Pilot」
```

### 版本 B：对比展示型（90秒）

**适合**：抖音、B站长视频

```
[0-10s] Hook - 吸引注意
💬 「AI 项目管理，能自动写代码？」
📱 展示项目界面

[10-30s] 传统方式的痛点
💬 「传统项目管理」
📱 展示传统工具：任务列表、看板
💬 「规划 ✅ 执行 ❌」
   「AI 只能聊天，不能干活」

[30-50s] ProjectPilot 的方案
💬 「ProjectPilot：AI 真能干活」
📱 展示创建 Flow → 添加任务
💬 「可视化管理 + AI 自动执行」

[50-75s] 详细演示
📱 展示完整的五阶段流程
💬 「理解 → 规划 → 执行 → 验证 → 总结」
   「代码自动生成，结果实时查看」

[75-90s] 总结 + CTA
💬 「让 AI 成为你的项目助理」
   「开源免费，立即使用」
📱 显示 GitHub 链接和二维码
```

---

## 🇺🇸 英文版录制脚本

### Version A: Problem-Solution (30s)

**Target**: Product Hunt, Twitter, Reddit

**Script**:

```
[0-5s] Hook
📱 Visual: Messy project board
💬 Text: "Managing projects with AI?"
       "AI plans, but YOU execute? 😓"

[5-10s] Solution
📱 Visual: Switch to ProjectPilot
💬 Text: "Meet ProjectPilot"
       "AI doesn't just plan—it EXECUTES"

[10-20s] Core Features
📱 Visual: Flow visualization + AI execution
💬 Text: "✨ Visual task management"
       "🤖 AI understands & plans"
       "⚡ AI writes code & executes"
🎯 Action: Show Understanding → Plan → Code

[20-25s] Result
📱 Visual: Completed task + generated code
💬 Text: "Real code. Real results."

[25-30s] CTA
📱 Visual: GitHub stars animation
💬 Text: "⭐ Star on GitHub"
       "Try it free → github.com/Kaine665/Project-Pilot"
```

### Version B: Feature Showcase (60s)

**Target**: YouTube demo video

```
[0-5s] Title Screen
💬 "ProjectPilot - AI Project Manager That Actually Codes"

[5-15s] Problem
💬 "Project management tools plan tasks"
   "But you still do all the work"
📱 Show traditional PM tools

[15-30s] Solution - Visual Management
💬 "ProjectPilot: Visual + AI-powered"
📱 Show Flow → Nodes → Tasks hierarchy
🎯 Navigate through "Personal Blog" project

[30-45s] Solution - AI Execution
💬 "AI doesn't just chat—it codes"
📱 Show AI understanding → planning → executing
🎯 Display generated code and results

[45-55s] Benefits
💬 "✅ 5-phase workflow (reliable)"
   "✅ Real-time AI execution"
   "✅ Full transparency & control"

[55-60s] CTA
💬 "Free & Open Source"
   "⭐ Star us on GitHub"
📱 Show link + QR code
```

---

## 🎬 录制前准备

### 切换界面语言

ProjectPilot 支持中英文切换（通过右上角语言切换器）

**中文版录制**：
1. 访问 http://localhost:4000/zh
2. 确认界面为中文
3. 开始录制

**英文版录制**：
1. 访问 http://localhost:4000/en
2. 确认界面为英文
3. 开始录制

### 数据准备

**中文版**：使用中文任务描述
```bash
# 导入中文数据
npm run demo:load
```

**英文版**：需要创建英文版数据
```bash
# 创建英文数据（见下文）
npm run demo:load-en
```

---

## 📦 创建英文版示例数据

我来帮你创建一个英文版的示例数据...

### 英文版项目结构

```
Personal Tech Blog
├── 1. Project Setup
│   ├── Create Next.js project with basic config
│   ├── Configure Tailwind CSS and design system
│   └── Set up project structure and routing
├── 2. Core Features
│   ├── Implement article list page with pagination
│   ├── Implement article detail page with Markdown
│   ├── Add tag system and filtering
│   └── Implement search and recommendations
├── 3. Polish & Optimize
│   ├── Design responsive layout for mobile
│   ├── Add dark mode toggle
│   ├── Optimize SEO with meta tags
│   └── Performance optimization
└── 4. Deploy
    ├── Configure Vercel deployment
    ├── Set up custom domain and SSL
    └── Add Google Analytics
```

---

## 🎯 录制技巧对比

### 中文版特点

**优势**：
- 可以讲得更详细（国内用户更有耐心）
- 强调技术细节和架构设计
- 可以加字幕说明

**注意**：
- 避免过度营销化的话术
- 技术社区喜欢实在的内容
- B站可以做长视频（5-10分钟深度讲解）

**发布渠道**：
1. **B站** - 做 5-10 分钟完整教程
2. **抖音** - 60-90 秒快速展示
3. **V2EX** - 配合静态截图 + 简短 GIF
4. **掘金** - 配合技术文章发布

### 英文版特点

**优势**：
- 短平快，30秒抓住注意力
- 强调问题→解决方案
- 视觉冲击力要强

**注意**：
- 前 3 秒必须吸引人
- 文字要大、要少、要清晰
- 背景音乐要有节奏感

**发布渠道**：
1. **Product Hunt** - 需要精美截图 + 30秒视频
2. **Twitter** - 视频要 < 2分20秒
3. **YouTube** - 可以做长版（5分钟）
4. **Reddit** - r/SideProject, r/opensource

---

## 📅 发布时间表建议

### Week 1: 基础版本
- [ ] 中文 60秒 GIF
- [ ] 英文 30秒 GIF
- [ ] 添加到 README

### Week 2: 扩展版本
- [ ] 中文 B站完整教程（5-10分钟）
- [ ] 英文 YouTube 演示（3-5分钟）

### Week 3: 社区发布
- [ ] V2EX（中文 + GIF）
- [ ] Product Hunt（英文 + 视频）
- [ ] Twitter/微博（GIF + 文案）

### Week 4: 深度内容
- [ ] 技术博客（配合视频）
- [ ] Reddit 发布
- [ ] Hacker News（如果反响好）

---

## 🎨 文案模板

### 中文版社交媒体文案

**V2EX 标题**：
```
[Show] ProjectPilot - 一个让 AI 真正执行任务的项目管理工具
```

**V2EX 正文**：
```
大家好，分享一个我最近开发的开源项目。

很多 AI 项目管理工具只能聊天规划，但 ProjectPilot 不一样——它真的能执行任务。

核心特性：
- 可视化 Flow 管理（三层结构）
- AI 五阶段工作流（理解→规划→执行→验证→总结）
- 代码级状态控制（不依赖 AI 判断，更可靠）
- 实时查看 AI 执行过程

技术栈：Next.js 15 + Claude Code CLI + TypeScript

[Demo GIF]

开源地址：github.com/Kaine665/Project-Pilot
欢迎 Star 和反馈！
```

**微博/小红书**：
```
发现一个宝藏开源项目！🎉

ProjectPilot - AI 项目管理工具
不只是聊天规划，真的能自动写代码！

✨ 可视化任务管理
🤖 AI 自动理解需求
⚡ AI 生成代码并执行
🔍 实时查看执行过程

最爱的是五阶段工作流，每一步都可控可查！

#开源项目 #AI工具 #程序员 #项目管理

[视频/GIF]
```

### 英文版社交媒体文案

**Product Hunt**：
```
Title: ProjectPilot - AI project manager that actually codes

Tagline: Stop planning, start building. Let AI execute your tasks.

Description:
ProjectPilot is an AI-powered project management tool that doesn't just plan—it executes.

🎯 What makes it different?
- Visual Flow management (Flows → Nodes → Tasks)
- AI 5-phase workflow (Understand → Plan → Execute → Verify → Summarize)
- Code-based state control (reliable, not AI-decided)
- Real-time execution transparency

🛠️ Built with Next.js 15 + Claude Code + TypeScript

Perfect for:
- Developers who want AI to actually code
- Teams managing complex projects
- Anyone tired of AI that only talks

⭐ Free & open source
🔗 GitHub: github.com/Kaine665/Project-Pilot
```

**Twitter**：
```
🚀 Just launched ProjectPilot - an AI project manager that ACTUALLY codes

Most AI tools just chat.
ProjectPilot executes. ⚡

✅ Visual task management
✅ AI understands & plans
✅ AI writes real code
✅ Full transparency

Try it free → [link]

[GIF/Video]

#AI #OpenSource #ProjectManagement #Productivity
```

**Reddit (r/SideProject)**：
```
Title: I built an AI project manager that actually writes code

Hey everyone! I'm excited to share ProjectPilot, an open-source tool I've been working on.

**The Problem:**
AI project management tools are great at planning, but you still have to do all the execution yourself. I wanted something where AI doesn't just suggest—it actually does the work.

**The Solution:**
ProjectPilot combines visual project management with AI execution:
- Visual Flow system (3-tier: Flows → Nodes → Tasks)
- AI 5-phase workflow (Understanding → Planning → Executing → Verifying → Summarizing)
- Real code generation and execution
- Full transparency into what AI is doing

**Tech Stack:**
Next.js 15, TypeScript, Claude Code CLI, Tailwind CSS v4

**What's unique:**
Code-based state control—the state machine is controlled by code, not AI decisions, making it much more reliable.

[Demo GIF]

Would love your feedback! ⭐ Star if you find it useful.

GitHub: github.com/Kaine665/Project-Pilot
```

---

## 💡 最后建议

1. **先录中文版** - 你更熟悉，表达更自然
2. **中文版做长一点** - B站可以做详细教程
3. **英文版要简短** - Product Hunt 用户没耐心看长视频
4. **准备多个时长** - 30s/60s/5min 不同版本
5. **文案很重要** - 比视频本身更重要！

需要我帮你：
1. 创建英文版的示例数据吗？
2. 准备具体的发布文案模板吗？
3. 设计更详细的录制分镜脚本吗？
