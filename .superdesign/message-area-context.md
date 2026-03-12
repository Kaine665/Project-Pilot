# Agent Chat 消息区设计上下文

## 设计目标

在 **ProjectPilot Agents - Modern Minimal Redesign** 整体结构基础上，**仅替换主面板区域**为完整的消息区（会话区）。不覆盖原设计，创建基于其布局的 branch 变体。

## 消息区结构（需展示的 mock 数据）

### 1. 用户消息气泡
- 左对齐或右对齐（用户通常在右侧）
- 背景：bg-user (#3b82f6) 或 bg-user-subtle
- 示例：「帮我制定一个重构 API 模块的计划」

### 2. AI 回复气泡
- 包含文本、工具调用结果
- 背景：bg-zinc-100 / dark:bg-zinc-800
- 示例：AI 的回复文本 + 下方工具卡片

### 3. Plan 计划展示
- **计划写入 badge**：AI 写入 .claude/plans/ 后，气泡内出现「查看计划」按钮
- 样式：rounded-lg border border-blue-200 bg-blue-50，带 ClipboardList 图标
- 点击可打开 PlanViewerPanel 侧边栏

### 4. AskUserQuestion 选项卡片
- AI 调用 AskUserQuestion 工具时，在气泡**外部**单独渲染
- 样式：rounded-lg border border-indigo-200 bg-indigo-50/50
- 包含：问题文本、多个可点击选项（单选/多选）
- 示例问题：「你希望采用哪种重构策略？」
- 选项：A) 渐进式重构  B) 一次性重写  C) 先写测试再重构

### 5. 等待消息队列（待优化）
- **当前实现**：纯文本 `Queued N message(s). They will send automatically after current reply.`
- **出现时机**：AI 正在流式回复时，用户又发送了新消息，新消息进入队列
- **需 redesign**：做成更美观的 inline 提示，如 badge/chip 形式，与「AI is planning」风格统一

### 6. 其他状态
- **思考中**：Loader2 旋转 + 「思考中...」
- **AI is planning**：rounded-md border border-blue-200 bg-blue-50，ClipboardList 图标
- **流式回复中**：AI 气泡 + 打字效果

## 布局约束

- 主面板：flex-1 overflow-hidden bg-zinc-50/30
- 消息列表：flex-1 space-y-3 overflow-y-auto p-4
- 底部：border-t 的输入区（ChatInput）
- 可选：右侧 PlanViewerPanel 滑出（w-[400px]）

## 设计系统

- 字体：Inter
- 色板：zinc, blue, indigo, amber
- 圆角：rounded-lg, rounded-xl
- 与 Modern Minimal Redesign 的 card、shadow、spacing 保持一致
