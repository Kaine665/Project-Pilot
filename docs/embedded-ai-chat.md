# ProjectPilot: 嵌入式 AI 对话系统

> **关联文档**: `docs/ai-task-workflow.md`（AI 会话工作流设计）
> **关联文档**: `docs/frontend-design.md`（前端设计）

## Context

ProjectPilot 最初使用 "spawn CLI + 显示日志" 模式：点击"生成计划"后台启动 `claude -p`，前端通过 SSE 显示 CLI 日志。用户无法与 AI 实时交互，只能看单向输出。

**目标**：将 AI 交互改为前端嵌入式对话，AI 说一句、用户说一句，CLI 完全隐藏。计划、讨论、执行全部通过对话完成。

**状态**：✅ 已实现。所有设计目标均已达成，详见下方实现状态。

> **术语说明**：本文档中部分代码引用仍使用旧 Task 术语（如 `taskId` 参数），数据模型层已迁移为 Session（见 `src/types/index.ts`），API 层和前端组件待逐步迁移。

---

## 架构设计

### 核心思路

```
ChatPanel (前端)  ──启动──►  ProcessManager (后端内存)  ──spawn──►  claude -p
                  ◄──观察──   events[] 缓冲区 + listeners
```

- 每次用户发消息，后端构造 prompt（会话上下文 + 对话历史 + 新消息），spawn `claude -p --output-format stream-json`
- Claude 的 NDJSON 输出在后端解析为 SSE 事件，**缓冲在内存中**
- 前端通过 SSE 订阅事件流，以聊天气泡显示文本，工具调用显示为可折叠卡片
- 对话历史存储在 `data/conversations/{sessionId}.json`

### 进程生命周期原则

**进程生命周期由显式操作控制（启动/停止），不由前端副作用控制（卸载/刷新/切换）。**

前端是"观察窗口"——接上去能看，断开了进程照跑。只有两种操作影响进程：
- **启动**：用户发消息 → POST /api/ai-chat → ProcessManager.start()
- **停止**：用户点 Stop → POST /api/ai-chat/stop → ProcessManager.stop()

以下操作**不影响进程**：
- 切换到其他页面（项目跟踪链路、其他会话等）
- 刷新页面
- 关闭浏览器标签页
- 网络波动断开

#### 情境说明

**情境 1：用户发消息后切走**

```
用户发消息 → 进程启动，开始执行
用户切到链路页面 → 前端组件卸载，SSE 读取断开
                    进程继续跑，事件继续积累到 events[] 缓冲区
用户切回会话页面 → 前端 mount，检测到 status=running
                    订阅 events[]，从头重放已有事件 + 接收新事件
                    用户看到完整的执行过程，没有丢失
```

**情境 2：进程在用户离开期间完成**

```
用户切走时进程正在跑
进程完成 → 对话存盘，artifacts 提取保存
用户切回 → 前端从磁盘加载完整对话历史
            检测到 status=completed，不需要重连 stream
            用户看到完整的对话结果
```

**情境 3：用户主动停止**

```
用户点击 Stop 按钮
  → POST /api/ai-chat/stop
  → 后端发 SIGTERM 给 Claude 进程
  → 进程退出，保存已有内容（标记 interrupted）
  → 前端收到 done 事件，结束流式状态
```

**情境 4：服务器重启（边缘情况）**

```
进程在内存中 → 服务器重启 → 内存丢失
用户消息已存盘（spawn 前保存），assistant 回复丢失
用户切回 → 看到自己最后发的消息没有回复
         可以重新发送消息触发新的进程
```

### 数据流

```
用户输入消息 → POST /api/ai-chat { sessionId, message }
                    ↓
        ProcessManager.start():
          加载对话历史 + 会话上下文
          构造 prompt (系统指令 + 历史 + 新消息)
          保存 user message 到磁盘（确保存活）
          spawn claude -p --output-format stream-json
          通过 stdin 传入 prompt
                    ↓
        返回 { runId }（不返回 stream）
                    ↓
前端连接 → GET /api/ai-chat/stream?taskId=xxx&since=0
                    ↓
        ProcessManager.subscribe():
          重放 events[0..N]（since 之后的所有缓冲事件）
          加入 listeners Set（接收新事件）
                    ↓
        前端实时渲染：文本气泡 + 工具调用卡片
                    ↓
        进程完成后：
          保存 assistant 消息到对话历史
          检测是否包含计划/理解/结果 JSON → 自动提取保存
          发送 done 事件
          5 分钟后清理内存中的 run
```

---

## 实现状态

所有清单项目均已实现。以下是各模块的实现现状和与原始设计的差异。

---

### Phase 1: 数据层 ✅

#### 1.1 类型定义 (`src/types/index.ts`) ✅

与设计基本一致，增加了以下类型：

- `ContentBlock` — 文本和工具调用的交错内容块（设计中没有，实现时发现需要保持顺序）
  ```typescript
  export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_call'; toolCall: ChatToolCall };
  ```
- `ChatMessage.contentBlocks?: ContentBlock[]` — 保存文本与工具调用的原始交错顺序
- 完整的 `AIPlan`、`AIPlanStep`、`AIPlanQuestion`、`AIExecution`、`AIExecutionRecord` 类型

#### 1.2 文件存储 (`src/lib/file-store.ts`) ✅

实现了所有路径辅助函数：
- `getConversationPath(sessionId)` → `data/conversations/{sessionId}.json`
- `getAiPlansPath()` → `data/ai-plans.json`
- `getArtifactsDir(planId?)` → `data/artifacts/{planId}/`
- `getArtifactSummaryPath(planId)` → `data/artifacts/{planId}/summary.json`
- `getTaskArtifactsPath(sessionId)` → `data/task-artifacts/{sessionId}.json`
- 通用工具：`readJsonFile()`, `writeJsonFile()`, `modifyJsonFile()`

---

### Phase 2: 后端核心 ✅

#### 2.1 Prompt 构造器 (`src/lib/prompt-builder.ts`) ✅

**与设计的差异**：比设计文档更完善。

实际实现包含完整的五阶段工作流指令：
- `PromptContext` 接口：`{ session, project, history, newMessage, flowContext? }`
- `buildSystemInstructions()` — Phase 1-5 完整行为指令（中文）
- `buildTaskContext()` — 结构化四要素信息（项目、做什么、为什么、交付物），支持 FlowTaskContext 增益信息
- `buildPlanFormatInstructions()` — `json:plan` 格式说明
- `buildHistorySection()` — 对话历史，超过 4000 字符的消息自动截断
- 函数重载：支持新的 `PromptContext` 参数和旧的 4 参数调用

#### 2.2 NDJSON 解析器 (`src/lib/claude-stream-parser.ts`) ✅

**与设计的差异**：使用 `--verbose` 模式，事件粒度更细。

设计中预期解析 3 种事件类型，实际使用 `--verbose` 后需要处理 7 种：

| 事件类型 | 处理方式 |
|---------|---------|
| `system` | 跳过 |
| `assistant` | 提取预填内容（通常为空） |
| `content_block_start` | 开始累积 tool_use 输入 |
| `content_block_delta` | 累加 text_delta / input_json_delta |
| `content_block_stop` | 发射完整的 tool_use_start 事件 |
| `user` | 提取 tool_result → tool_use_end |
| `result` | 发射 done |

关键实现：
- `StreamParser` 类：有状态解析器，通过 `toolAccumulators` Map 累积工具输入 JSON
- `LineBuffer` 类：处理 stdout 分片和 `\r\n`（Windows 兼容）
- `parseStreamLine()` 函数：无状态的兼容接口

#### 2.3 计划提取器 (`src/lib/plan-extractor.ts`) ✅

与设计一致：
- 正则匹配 `` ```json:plan `` 代码块
- 验证包含 `steps` 数组
- 自动生成 `planId`（格式：`plan-{taskId}-v{version}-{timestamp}`）
- 自动递增版本号
- 写入 `ai-plans.json`

#### 2.4 进程管理器 (`src/lib/process-manager.ts`) ✅

ProcessManager 单例（globalThis 挂载，HMR 安全），管理 Claude 子进程生命周期：

- `start(taskId, message)` — 加载上下文 → 构造 prompt → spawn claude → 接管 stdout/stderr → 缓冲事件 → 进程退出时提取 artifacts 并存盘
- `subscribe(taskId, since, listener)` — 重放 events[since..] → 加入 listeners → 返回 unsubscribe
- `stop(taskId)` — SIGTERM 进程
- `getStatus(taskId)` — 返回 run 状态和事件计数
- `sweep()` — 每 60s 清理完成超过 5 分钟的 run

#### 2.5 API 端点 ✅

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/ai-chat?taskId=xxx` | 返回对话历史（从磁盘） |
| POST | `/api/ai-chat` | 启动 Claude 进程，返回 `{ runId }`（不返回 stream） |
| DELETE | `/api/ai-chat?taskId=xxx` | 清除对话历史 |
| GET | `/api/ai-chat/stream?taskId=xxx&since=0` | SSE 事件流（重放 + 实时），断开不杀进程 |
| POST | `/api/ai-chat/stop` | 显式停止进程 |
| GET | `/api/ai-chat/status?taskId=xxx` | 查询进程状态（前端 mount 时用于判断是否需要重连） |

实际 spawn 命令：
```javascript
spawn('claude', ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'], {
  cwd: workingDir,
  shell: true,
  env: { ...process.env, FORCE_COLOR: '0', CLAUDECODE: '' },
})
```

进程完成后自动：
1. 保存 assistant 消息到对话历史
2. 扫描回复中的计划/理解/结果 JSON → 提取保存
3. 向 listeners 发送提取事件和 done 事件

---

### Phase 3: 前端 UI ✅

#### 3.1 工具调用卡片 (`src/components/tool-call-card.tsx`) ✅

与设计一致。使用 `memo` 优化渲染。
- 预置工具图标：Bash(Terminal)、Read(FileText)、Edit/Write(Pencil)、Glob/Grep(FileText)
- 三种状态：running(spinner)、completed(green check)、failed(red X)
- 输入超过 120 字符自动截断显示
- 默认折叠，点击展开显示完整 input/output

#### 3.2 聊天气泡 (`src/components/chat-bubble.tsx`) ✅

与设计一致。使用 `memo` 优化渲染。
- 用户消息：右对齐，蓝色背景
- AI 消息：左对齐，灰色背景
- **ContentBlock 渲染**：支持文本和工具调用的交错显示（保持原始顺序）
- 兼容三种数据源：streamingBlocks（实时流）、contentBlocks（保存的交错顺序）、content+toolCalls（旧格式回退）
- 流式输入时显示光标动画
- 计划提取指示器：绿色提示条

#### 3.3 对话面板 (`src/components/chat-panel.tsx`) ✅

主组件，与设计的 UI 结构一致。

**性能优化**（设计中未提及，实现时添加）：
- `requestAnimationFrame` 节流：流式更新以 ~60fps 刷新而非每个 delta 都触发 setState
- `blocksRef` + `scheduleBlocksFlush()`：在 ref 中累积块数据，rAF 时一次性刷入
- `useMemo` 稳定流式消息对象引用
- 自动滚动也用 rAF 节流

功能：
- `ChatPanelHandle` ref 接口：`sendMessage(text)` 供父组件调用
- mount 时加载历史（GET） + 检查进程状态（GET /status），running 则自动重连 stream
- 发消息：POST /ai-chat 启动进程 → GET /stream 订阅事件
- unmount 时只断开 SSE reader，不停止后端进程
- Stop 按钮：POST /ai-chat/stop 显式终止
- 清除对话按钮（DELETE）
- 输入框自动高度调整，Shift+Enter 换行

---

### Phase 4: 集成 ✅

#### 4.1 task-detail.tsx 改造 ✅

> 注：组件文件名仍为 `task-detail.tsx`，待迁移为 `session-detail.tsx`

- 纯左右布局：左 ChatPanel + 右 ArtifactPanel（侧栏产出物面板）
- "开始执行" 按钮：创建 git 分支 + 通知 AI 分支已就绪
- "合并分支" 按钮：合并到目标分支
- Git 分支状态指示器

#### 4.2 完整流程 ✅

```
1. 用户在对话框输入（或从链路发起自动携带 FlowTaskContext）
2. AI 分析会话（遵循五阶段流程：四要素 → 缺口检测/追问 → 确认理解）
3. AI 产出 TaskUnderstanding（提取到侧栏"任务理解"卡片）
4. AI 生成计划（包含 ```json:plan 块，提取到侧栏"执行计划"卡片）
5. 用户在对话中讨论修改
6. AI 创建 git 分支 → 开始执行（侧栏显示"执行状态"卡片）
7. 工具调用实时显示为可折叠卡片
8. 完成后 AI 报告结果（侧栏显示"执行结果"卡片）
9. 用户点击 "合并分支" → 合并到目标分支 → 自动删除会话分支
```

---

## 文件清单（实际）

### 新建文件

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/app/api/ai-chat/route.ts` | 对话 API (GET 历史/POST 启动/DELETE 清除) | ✅ |
| `src/app/api/ai-chat/stream/route.ts` | SSE 事件流（重放 + 实时，断开不杀进程） | ✅ |
| `src/app/api/ai-chat/stop/route.ts` | 显式停止进程 | ✅ |
| `src/app/api/ai-chat/status/route.ts` | 查询进程状态 | ✅ |
| `src/app/api/git/route.ts` | Git 分支创建/合并 API (GET/POST) | ✅ |
| `src/lib/process-manager.ts` | ProcessManager 单例（进程生命周期 + 事件缓冲） | ✅ |
| `src/lib/prompt-builder.ts` | 构造含五阶段流程的 prompt | ✅ |
| `src/lib/claude-stream-parser.ts` | 解析 --verbose stream-json 输出 | ✅ |
| `src/lib/plan-extractor.ts` | 从 AI 回复中提取计划 JSON | ✅ |
| `src/components/chat-panel.tsx` | 对话面板（rAF 节流 + 流式渲染） | ✅ |
| `src/components/chat-bubble.tsx` | 消息气泡（ContentBlock 交错显示） | ✅ |
| `src/components/tool-call-card.tsx` | 工具调用可折叠卡片 | ✅ |

### 修改文件

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/types/index.ts` | Session（原 Task）, ChatMessage, ContentBlock, ChatSession, ChatSSEEvent, SessionArtifacts, TaskUnderstanding, ProjectConfig | ✅ |
| `src/lib/file-store.ts` | getConversationPath(), getArtifactSummaryPath() | ✅ |
| `src/components/task-detail.tsx` | ChatPanel + ArtifactPanel 集成, git 按钮, 分支指示器 | ✅ |
| `src/components/project-registry.tsx` | 项目描述和默认分支字段 | ✅ |
| `src/app/api/tasks/route.ts` | 会话创建（API 路径待迁移） | ✅ |
| `src/app/api/tasks/[id]/route.ts` | 会话更新（API 路径待迁移） | ✅ |
| `src/app/api/projects/route.ts` | 接受 description, defaultBranch | ✅ |

### 遗留文件（待清理）

旧的 LogViewer、ai-logs API、agent scripts 仍保留。新系统稳定后可清理：
- `scripts/agents/planner.js` — 旧的独立计划生成脚本
- `scripts/agents/executor.js` — 旧的独立执行脚本
- `scripts/agents/discussor.js` — 旧的讨论脚本
- `src/components/log-viewer.tsx` — 旧的日志查看器（已被 ChatPanel 替代）

---

## 设计 vs 实际差异总结

| 方面 | 设计 | 实际 | 原因 |
|------|------|------|------|
| Claude CLI 参数 | `--output-format stream-json` | `--verbose --output-format stream-json` | `--verbose` 提供细粒度流式事件 |
| 流式事件类型 | 3 种（system/assistant/result） | 7 种（增加 content_block_start/delta/stop、user） | `--verbose` 模式下事件更细 |
| 消息数据模型 | content + toolCalls | 增加 contentBlocks (ContentBlock[]) | 需要保持文本和工具调用的交错顺序 |
| API 方法 | GET + POST | 6 个端点（见 2.5） | 进程生命周期解耦需要 stream/stop/status 端点 |
| 进程生命周期 | POST 返回 SSE stream，进程绑定 HTTP 连接 | ProcessManager 持有进程，POST 返回 JSON，stream 独立订阅 | 切页面/刷新不应杀进程 |
| 前端性能 | 无特别说明 | rAF 节流 + ref 累积 + memo | 流式更新频率高，需要优化 |
| Prompt 内容 | 简单的对话规则 | 完整五阶段工作流指令 + 四要素结构 + FlowTaskContext 支持 | 在 ai-task-workflow 中补充了完整流程 |

---

## 验证方式

1. `npm run dev` 启动 ProjectPilot
2. 选择一个会话，在对话框中输入
3. AI 应流式回复，逐字显示；工具调用显示为可折叠卡片
4. AI 产出 TaskUnderstanding → 侧栏"任务理解"卡片出现
5. AI 产出执行计划（json:plan 块） → 侧栏"执行计划"卡片出现
6. 继续对话讨论计划 → AI 理解上下文（因为 prompt 包含完整历史）
7. AI 创建 git 分支开始执行 → 侧栏"执行状态"卡片出现
8. 完成后 → 侧栏"执行结果"卡片出现，点击"合并分支"合并到目标分支
