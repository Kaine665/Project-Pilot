# Claude Code 交互能力测试手册

> 目标：逐项验证 Claude Code CLI 的各种交互行为在 Task Agent 中的表现。
> 每项测试记录：原始事件流 → 当前 UI 行为 → 预期行为 → 差距。

## 测试前准备

### 环境要求

```bash
# 确保 Claude CLI 已安装且可用
claude --version

# 确保项目开发服务器运行
npm run dev   # localhost:4000
```

### 测试任务创建

在 ProjectPilot 中创建一个测试任务：
- 标题：`测试 Claude Code 交互能力`
- 关联项目：任意有 git 仓库的项目
- 阶段：根据每项测试手动设置或让流程自然走到

### 日志观察方式

```bash
# 终端 1：观察后端日志（ProcessManager 输出）
# Next.js dev 模式会自动输出到控制台

# 终端 2：直接运行 Claude CLI 对比原始事件流
claude -p --verbose --output-format stream-json
```

---

## 第一组：基础流式事件（已支持，验证稳定性）

### T01：纯文本流式输出

**触发方式**：发送简单提问，不触发工具调用。

```
用户消息：你好，简单介绍一下你自己。
```

**预期事件流**：
```
system.init → session_id
assistant → (空 content)
content_block_start → type: text
content_block_delta → text_delta (多个)
content_block_stop
result → done
```

**验证点**：
- [ ] 文本逐字流式出现（不是一次性显示整段）
- [ ] 光标闪烁效果正常
- [ ] 最终文本 Markdown 正确渲染
- [ ] session_id 正确捕获到 conversation 文件中

---

### T02：单工具调用 + 结果

**触发方式**：在 Phase 3+（有工具权限）发送需要读文件的请求。

```
用户消息：读一下 package.json 的 name 字段
```

**预期事件流**：
```
content_block_start → type: text (可能有前导文本)
content_block_delta → text_delta
content_block_stop
content_block_start → type: tool_use, name: Read
content_block_delta → input_json_delta (多个)
content_block_stop → (tool_use_start 事件触发)
user → tool_result (Read 的输出)
content_block_start → type: text (AI 对结果的解释)
...
result → done
```

**验证点**：
- [ ] 工具调用卡片正确出现，显示 "Read" 图标
- [ ] 工具状态从 spinning → completed/failed
- [ ] 工具 input 正确显示（文件路径）
- [ ] 工具 output 可展开查看
- [ ] 前后文本块正确排列，不混乱

---

### T03：多工具链式调用

**触发方式**：发送需要多步工具调用的请求。

```
用户消息：看看 src 目录结构，然后读一下 src/types/index.ts 的前 10 行
```

**预期事件流**：
```
text → tool_use(Glob/Bash) → tool_result → text → tool_use(Read) → tool_result → text → done
```

**验证点**：
- [ ] 多个工具卡片按顺序出现
- [ ] 每个工具卡片有独立的 expand/collapse
- [ ] 工具之间的文本块正确分隔
- [ ] contentBlocks 数组顺序：text → tool_call → text → tool_call → text

---

### T04：工具调用失败

**触发方式**：请求读取不存在的文件。

```
用户消息：读一下 /nonexistent/file.txt
```

**验证点**：
- [ ] 工具卡片显示红色 X（failed 状态）
- [ ] `is_error: true` 正确解析
- [ ] AI 后续文本能引用错误信息继续回答

---

## 第二组：AskUserQuestion（最大缺口）

### T05：AskUserQuestion 基础行为

**背景**：`AskUserQuestion` 是 Claude Code 的内置工具，允许 AI 暂停执行向用户提问。

**直接 CLI 测试**（先在 CLI 验证原始事件格式）：

```bash
# 终端中直接运行
echo "帮我重构一个函数，但先问我想用什么方式" | claude -p --verbose --output-format stream-json
```

**预期事件流**：
```jsonl
{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"xxx","name":"AskUserQuestion"}}
{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"..."}}
{"type":"content_block_stop","index":0}
```

AskUserQuestion 的 input JSON 结构：
```json
{
  "questions": [
    {
      "question": "你希望用哪种方式重构？",
      "header": "重构方式",
      "options": [
        { "label": "提取函数", "description": "将重复逻辑提取为独立函数" },
        { "label": "使用策略模式", "description": "用策略模式替代 if/else 链" }
      ],
      "multiSelect": false
    }
  ]
}
```

**验证点**：
- [ ] 记录完整的 input JSON 结构（字段名、嵌套格式）
- [ ] 在 `--dangerously-skip-permissions` 模式下，AI 调用此工具后是否暂停等待？还是跳过？
- [ ] 用户回答后的 tool_result 格式是什么？
- [ ] AI 能否根据用户选择继续执行？

**在 Task Agent 中测试**：

```
用户消息：帮我在项目中添加一个新功能，但我还不确定具体实现方式，请先问我。
```

**当前预期行为**：
- AI 调用 AskUserQuestion → 显示为普通工具卡片（toolName="AskUserQuestion"）
- 用户无法交互回答
- AI 可能收到空的 tool_result 或自动跳过

**需要记录**：
- [ ] AskUserQuestion 在你的 UI 中长什么样？截图
- [ ] tool_result 里实际返回了什么内容？
- [ ] AI 后续行为是否合理？

---

### T06：AskUserQuestion 在 -p 模式下的行为

**关键问题**：`claude -p`（管道模式）+ `--dangerously-skip-permissions` 下，AskUserQuestion 是否被自动回答/跳过？

```bash
# 测试1: 有权限跳过
echo "你需要先问我一个问题再开始工作" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions

# 测试2: 无权限跳过
echo "你需要先问我一个问题再开始工作" | claude -p --verbose --output-format stream-json
```

**需要记录**：
- [ ] 两种模式下事件流的差异
- [ ] AskUserQuestion 被调用时，进程是否 hang 住等待 stdin？
- [ ] 如果进程 hang 住，通过 stdin 写入回答是否能继续？
- [ ] 如果自动跳过，tool_result 的内容是什么？

---

## 第三组：权限请求（Permission Prompts）

### T07：无 --dangerously-skip-permissions 时的权限事件

**背景**：正常模式下 Claude Code 每个工具调用都需要用户审批。你的 Phase 1-2（understanding）没有 `--dangerously-skip-permissions`。

**测试方式**：在 Phase 1-2 的任务中，发送需要工具调用的消息（理论上不应该有工具调用，但如果触发了呢？）。

```bash
# 先直接 CLI 测试，看权限请求在 stream-json 中的事件格式
echo "请读取 package.json 文件" | claude -p --verbose --output-format stream-json
# （不加 --dangerously-skip-permissions）
```

**需要记录**：
- [ ] 权限请求在 stream-json 中是什么格式的事件？
  - 是否有独立的 event type（如 `permission_request`）？
  - 还是 Claude 直接不调用工具？
  - 还是进程 hang 住等待 stdin 输入 "yes"？
- [ ] 如果 hang 住，stdin 写入 "yes"/"no" 是否有效？

---

### T08：权限请求的事件流格式

**预期可能的格式**（需实际验证）：

可能性 A：独立事件类型
```jsonl
{"type":"permission_request","tool":"Bash","command":"npm test","id":"xxx"}
```

可能性 B：通过 content_block 表达
```jsonl
{"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash",...}}
// 然后进程暂停，等待 stdin 输入
```

可能性 C：在 -p 模式下 Claude 自动不调用需要权限的工具
```
// AI 直接输出文本说"我没有权限执行这个操作"
```

**验证方式**：逐一测试以上可能性，记录实际行为。

---

## 第四组：TodoWrite 任务列表

### T09：TodoWrite 工具调用

**触发方式**：给 AI 一个复杂任务，它通常会创建任务列表。

```
用户消息：帮我给这个项目添加单元测试，需要测试至少3个模块。先制定计划。
```

**预期事件流**：
```
text_delta (AI 说"让我先规划...")
tool_use_start: TodoWrite
  input: { "todos": [
    { "content": "分析项目结构", "status": "in_progress", "activeForm": "分析项目结构中" },
    { "content": "为模块A添加测试", "status": "pending", "activeForm": "为模块A添加测试" },
    ...
  ]}
tool_use_end: (TodoWrite result)
text_delta (继续执行)
```

**验证点**：
- [ ] TodoWrite 的 input JSON 格式记录（todos 数组结构）
- [ ] 当前 UI 中 TodoWrite 工具调用是否可见？
- [ ] 工具 input 中的任务列表是否可读？
- [ ] AI 在过程中是否多次调用 TodoWrite 更新进度？
- [ ] 每次 TodoWrite 调用的 todos 数组是完整替换还是增量？

---

### T10：TodoWrite 多次更新

**触发方式**：发送需要多步执行的任务，观察 TodoWrite 的更新频率。

```
用户消息：请阅读 src/lib/ 下的所有文件，为每个文件写一句功能描述。
```

**需要记录**：
- [ ] TodoWrite 被调用了几次？
- [ ] 每次调用时 todos 数组的完整内容（是全量替换）
- [ ] status 字段变化路径：pending → in_progress → completed
- [ ] 有没有任务被从列表中移除的情况？

---

## 第五组：子代理（Task/Subagent）

### T11：Task 工具调用

**触发方式**：给 AI 一个需要分治的复杂任务。

```
用户消息：请同时分析 src/lib/process-manager.ts 和 src/lib/claude-stream-parser.ts 的代码质量。
```

**预期事件流**（如果 AI 使用 Task 工具）：
```
text_delta (AI 说"让我分派子代理...")
tool_use_start: Task
  input: { "subagent_type": "Explore", "prompt": "...", "description": "..." }
tool_use_end: (子代理完成，结果作为 output)
text_delta (AI 汇总结果)
```

**验证点**：
- [ ] Task 工具在你的 UI 中如何显示？
- [ ] 子代理的 output 通常有多长？（可能很长，注意 3000 字符截断）
- [ ] 子代理运行时间通常较长，工具卡片是否长时间显示 "running"？
- [ ] AI 是否会同时发起多个 Task 调用？（并行子代理）

---

### T12：并行 Task 调用

**触发方式**：

```
用户消息：请同时做三件事：1) 检查 package.json 的依赖 2) 分析 tsconfig 配置 3) 看看 tailwind 配置
```

**需要记录**：
- [ ] AI 是否发起了多个 tool_use 块（不同 index）？
- [ ] 多个 content_block_start 是否在同一个 assistant turn 中？
- [ ] 多个 tool_result 的返回顺序？
- [ ] 你的 UI 是否正确并排显示多个 "running" 状态的工具卡片？

---

## 第六组：Plan Mode（计划模式）

### T13：EnterPlanMode / ExitPlanMode

**背景**：Claude Code 有内置的 EnterPlanMode/ExitPlanMode 工具。这和你的 Phase 3 规划阶段不同——它是 Claude 自发的行为。

**触发方式**：

```
用户消息：帮我重构认证系统，这是个大任务，先规划一下。
```

**预期事件流**：
```
tool_use_start: EnterPlanMode  (input: {})
tool_use_end: (可能返回确认信息)
text_delta (AI 输出计划)
// 然后 AI 可能调用 ExitPlanMode
tool_use_start: ExitPlanMode  (input: { allowedPrompts: [...] })
tool_use_end: (需要用户审批)
```

**验证点**：
- [ ] EnterPlanMode 工具在你的 UI 中如何显示？
- [ ] ExitPlanMode 调用后进程是否暂停等待用户审批？
- [ ] 在 `--dangerously-skip-permissions` 下，plan mode 是否被自动跳过？
- [ ] 你的 Phase 3 和 Claude 原生 plan mode 是否会冲突？

---

## 第七组：会话恢复（--resume）

### T14：基础 resume 恢复

**触发方式**：
1. 发送消息，等 AI 回复完成
2. 停止进程（stop）
3. 再发送新消息（应触发 --resume）

**验证点**：
- [ ] resume 后 AI 是否记得上一轮的对话？
- [ ] 第一次 system.init 的 session_id 和 resume 后的 session_id 是否相同？
- [ ] resume 时 prompt 是否只包含新消息（不重复历史）？
- [ ] assistant 事件中是否有预填内容（resumed sessions）？

---

### T15：跨阶段 resume

**触发方式**：
1. 在 Phase 1（understanding）完成，AI 产出 understanding，自动推进到 Phase 3（planning）
2. Phase 3 继续用同一个 --resume session

**验证点**：
- [ ] 阶段推进后，新的 phase transition note 是否正确注入？
- [ ] resume 后 AI 是否知道自己现在有工具权限了？
- [ ] 单一 session 贯穿多阶段是否出现上下文膨胀？

---

## 第八组：边界情况

### T16：用户中断 + 消息排队

**触发方式**：
1. 发送一个会导致长时间执行的消息
2. AI 正在 streaming 时，快速发送新消息

```
消息1：分析 src/ 下所有文件的代码质量
（AI 开始流式输出时）
消息2：等等，先只看 process-manager.ts 就好
```

**验证点**：
- [ ] 消息2 是否进入 `pendingUserMsgRef` 队列？
- [ ] 进程是否被 SIGTERM 终止？
- [ ] 当前流式内容是否正确 finalize 为一条 interrupted 消息？
- [ ] 消息2 是否在 300ms 后自动发送？
- [ ] 新的 AI 回复是否衔接上之前的上下文（via --resume）？

---

### T17：大量工具输出

**触发方式**：

```
用户消息：读取 src/lib/process-manager.ts 的完整内容
```

**验证点**：
- [ ] 工具 output 是否被截断到 3000 字符？
- [ ] 截断后的内容在 UI 中是否有提示？
- [ ] 很长的 tool output 是否导致 UI 卡顿？

---

### T18：Stderr 错误输出

**触发方式**：制造一个会让 Claude CLI 报错的情况。

```bash
# 例如：API key 无效
ANTHROPIC_API_KEY=invalid claude -p --verbose --output-format stream-json
```

**验证点**：
- [ ] stderr 中的错误是否被捕获为 `error` 事件？
- [ ] error 事件是否在 UI 中正确展示？
- [ ] 进程退出码非 0 时，UI 状态是否正确变为 "failed"？

---

## 第九组：MCP 工具

### T19：MCP 工具调用格式

**背景**：如果 Claude CLI 连接了 MCP 服务器，工具名会是 `mcp__serverName__toolName` 格式。

**直接 CLI 测试**（需要先配置 MCP）：

```bash
# 查看已配置的 MCP 服务器
claude mcp list

# 如果有配置，发送会触发 MCP 工具的消息
echo "使用 github 工具查看最近的 PR" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions
```

**验证点**：
- [ ] MCP 工具调用在 stream-json 中的事件格式与内置工具是否相同？
- [ ] toolName 字段值是否为 `mcp__xxx__yyy` 格式？
- [ ] 你的 UI 中对 MCP 工具名是否有合理的展示？（当前可能显示原始长名称）

---

## 测试结果记录模板

每项测试完成后，填写以下信息：

```markdown
### Txx 结果

**日期**：
**阶段**：Phase X
**skip-permissions**：是/否

**原始事件流**：
（粘贴关键的 NDJSON 行）

**当前 UI 行为**：
（截图或描述）

**问题/差距**：
-

**修复优先级**：P0/P1/P2/P3
```

---

## 测试优先级排序

| 优先级 | 测试项 | 原因 |
|--------|--------|------|
| **P0** | T05, T06 | AskUserQuestion 是最大功能缺口 |
| **P0** | T07, T08 | 权限请求格式需要确认，决定架构方向 |
| **P1** | T09, T10 | TodoWrite 实现成本低但用户价值高 |
| **P1** | T01-T04 | 基础行为稳定性验证 |
| **P2** | T11, T12 | 子代理展示优化 |
| **P2** | T13 | Plan Mode 和你的 Phase 系统可能冲突 |
| **P2** | T14, T15 | Resume 稳定性 |
| **P3** | T16-T18 | 边界情况 |
| **P3** | T19 | MCP 工具（未来需求） |

## CLI 快速测试脚本

以下脚本可以在不启动 ProjectPilot 的情况下，直接测试 Claude CLI 的原始行为：

```bash
# === 保存为 test-claude-events.sh ===

# 测试 AskUserQuestion（最重要）
echo "=== Test: AskUserQuestion with skip-permissions ==="
echo "请问我一个关于项目架构的问题，使用 AskUserQuestion 工具" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions 2>stderr-ask-skip.log | tee stdout-ask-skip.log

echo ""
echo "=== Test: AskUserQuestion without skip-permissions ==="
echo "请问我一个关于项目架构的问题，使用 AskUserQuestion 工具" | claude -p --verbose --output-format stream-json 2>stderr-ask-noskip.log | tee stdout-ask-noskip.log

# 测试 TodoWrite
echo ""
echo "=== Test: TodoWrite ==="
echo "制定一个3步计划来重构代码，使用 TodoWrite 跟踪进度" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions 2>stderr-todo.log | tee stdout-todo.log

# 测试 Plan Mode
echo ""
echo "=== Test: Plan Mode ==="
echo "进入计划模式，规划一个大型重构任务" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions 2>stderr-plan.log | tee stdout-plan.log

echo ""
echo "=== Done. Check stdout-*.log and stderr-*.log ==="
```

```powershell
# === PowerShell 版本（Windows） ===

# 测试 AskUserQuestion
Write-Output "请问我一个关于项目架构的问题，使用AskUserQuestion工具" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions 2>stderr-ask-skip.log | Tee-Object -FilePath stdout-ask-skip.log

# 测试 TodoWrite
Write-Output "制定一个3步计划来重构代码，使用TodoWrite跟踪进度" | claude -p --verbose --output-format stream-json --dangerously-skip-permissions 2>stderr-todo.log | Tee-Object -FilePath stdout-todo.log

# 测试无权限模式下的行为
Write-Output "请读取package.json文件" | claude -p --verbose --output-format stream-json 2>stderr-noperm.log | Tee-Object -FilePath stdout-noperm.log
```

> **提示**：运行后检查 `stdout-*.log` 文件，搜索 `AskUserQuestion`、`TodoWrite`、`EnterPlanMode` 等关键字，确认它们在 stream-json 中的完整事件格式。这些原始格式是后续实现前端支持的基础。
