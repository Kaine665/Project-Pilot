# Agent 会话区渲染内容分析

> 用于分设计图策略：先分析有哪些内容类型，再为每种内容单独做设计图，避免全部挤在一起。

---

## 一、会话区整体结构

```
┌─────────────────────────────────────────────────────────────┐
│ 消息列表 (scrollRef, space-y-3 overflow-y-auto p-4)          │
│   ├── [1] 压缩提示条 (条件渲染)                               │
│   ├── [2] 通知横幅 (ChatNotificationBanners)                 │
│   ├── [3] 消息气泡 (ChatBubble × N)                          │
│   ├── [4] 流式回复气泡 (streaming)                           │
│   ├── [5] 思考中占位                                          │
│   ├── [6] AI is planning 占位                                │
│   ├── [7] 等待消息队列                                        │
│   └── [8] 错误提示                                            │
├─────────────────────────────────────────────────────────────┤
│ 输入区 (ChatInput)                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、按内容类型拆分（建议分设计图）

### 设计图 A：基础消息气泡
**范围**：用户消息 + AI 纯文本回复
- 用户气泡：右对齐，bg-user (#3b82f6)，User 头像
- AI 气泡：左对齐，bg-zinc-100，Bot 头像
- 气泡内：文本、图片（如有）
- 悬浮操作栏：复制、存知识、删除、分支、重试等

---

### 设计图 B：计划展示
**范围**：Plan 相关 UI
- **计划写入 badge**：AI 写入 `.claude/plans/` 后，气泡内出现「查看计划」按钮（ClipboardList 图标，blue 样式）
- **PlanViewerPanel**：侧边滑出面板（w-[400px]），header + FormattedText 内容区

---

### 设计图 C：AskUserQuestion 选项卡片
**范围**：AI 提问交互
- 渲染位置：气泡**外部**单独一块（突出显示）
- 样式：rounded-lg border-indigo-200 bg-indigo-50/50
- 内容：问题文本、多个可点击选项（单选/多选）、提交按钮（多题时）
- 状态：待回答 / 已回答 / 已完成

---

### 设计图 D：工具调用展示
**范围**：各类 tool call 的展示形式

| 子类型 | 组件 | 说明 |
|--------|------|------|
| 重复性工具组 | ToolExecutionWindow | Read/Grep/Bash/Write/Edit 等，折叠式，显示数量 |
| 单次工具 | ToolCallCard | 非重复性工具的展开卡片 |
| TodoWrite | TodoListCard | 待办列表卡片 |
| Task | SubagentCard | 子 Agent 调用卡片 |
| EnterPlanMode / ExitPlanMode | 内联 compact | 计划模式进出，紧凑展示 |

---

### 设计图 E：流式与状态占位
**范围**：AI 回复过程中的中间状态
- **思考中**：Loader2 + 「思考中...」文本
- **AI is planning**：ClipboardList + 「AI is planning...」蓝色边框条
- **流式回复中**：打字效果的气泡

---

### 设计图 F：等待消息队列 ⭐（本次优化重点）
**范围**：用户在 AI 回复时继续发送，消息进入队列的提示
- 当前：纯文本 `Queued N message(s). They will send automatically after current reply.`
- 目标：badge/chip 形式，与「AI is planning」风格统一，更美观

---

### 设计图 G：通知与提示条
**范围**：会话级提示，非消息内容
- **压缩提示**：Session 过长时，amber 样式，压缩/忽略按钮
- **知识草稿**：Agent 保存知识待确认，amber，可关闭
- **文档已保存**：Agent 保存设计文档，blue，可关闭
- **错误提示**：发送失败等，red 样式

---

### 设计图 H：空状态
**范围**：无消息时的占位
- Bot 图标 + 文案「Send a message to {agent} to start chatting.」

---

## 三、建议设计顺序

1. **设计图 A**：基础气泡（奠定消息区主视觉）
2. **设计图 F**：等待队列（本次优化目标，可单独迭代）
3. **设计图 C**：AskUserQuestion（交互密集，需独立设计）
4. **设计图 B**：计划展示（与 Plan 流程强相关）
5. **设计图 D**：工具调用（种类多，可再分子类型）
6. **设计图 E**：流式与状态占位
7. **设计图 G**：通知与提示条
8. **设计图 H**：空状态

---

## 四、实现时的组合方式

各设计图完成后，在 Modern Minimal Redesign 的主框架下，将对应组件替换为设计稿实现即可。每个设计图对应 1 个或若干组件的 UI，互不干扰。

---

## 五、已生成设计图索引

| 设计图 | 标题 | Draft ID | 预览链接 |
|--------|------|----------|----------|
| A | ProjectPilot - Active Agent Chat Interface | 65dabe4f-7fef-4862-91e7-5ceae74e5348 | [预览](https://p.superdesign.dev/draft/65dabe4f-7fef-4862-91e7-5ceae74e5348) |
| F | Cursor-style Message Queue UI | df0ebc6b-f9e3-4cff-a90d-1bf428ca0501 | [预览](https://p.superdesign.dev/draft/df0ebc6b-f9e3-4cff-a90d-1bf428ca0501) |
| C | ProjectPilot - Interactive Agent Question | dbc2fb7e-6f9b-42ee-98ad-bcb04ef4d762 | [预览](https://p.superdesign.dev/draft/dbc2fb7e-6f9b-42ee-98ad-bcb04ef4d762) |
| B | ProjectPilot - Agent Chat & Plan | 051ff46b-5870-4769-8b87-114e856a93ae | [预览](https://p.superdesign.dev/draft/051ff46b-5870-4769-8b87-114e856a93ae) |
| D | ProjectPilot - Agent Chat with Tool Execution | b00ba3b9-dcea-46dd-a640-82bbcfb5c54f | [预览](https://p.superdesign.dev/draft/b00ba3b9-dcea-46dd-a640-82bbcfb5c54f) |
| E | ProjectPilot - AI Processing States | f85f8c9d-747e-4f84-870b-cbd6ad190fe1 | [预览](https://p.superdesign.dev/draft/f85f8c9d-747e-4f84-870b-cbd6ad190fe1) |
| G | ProjectPilot - Chat with Notifications | 7decc0a7-4826-4513-b379-5f42adb4d6b3 | [预览](https://p.superdesign.dev/draft/7decc0a7-4826-4513-b379-5f42adb4d6b3) |
| H | ProjectPilot Agents - Refined Empty State | 4100bc37-6754-4f31-a56d-824d6ccfe758 | [预览](https://p.superdesign.dev/draft/4100bc37-6754-4f31-a56d-824d6ccfe758) |

项目：https://app.superdesign.dev/teams/b30159c0-63e0-465f-ac9f-9e3f38c45ee7/projects/0665b66c-2d74-4e46-ab7a-f0a6ead507a5
