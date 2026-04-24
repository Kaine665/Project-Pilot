# MCP 集成模型

ProjectPilot 首先应该让自己可以被其他 AI harness 调用。

主方向是：

```text
Claude Code / Cursor / Codex / 其他 harness
        |
        v
ProjectPilot MCP Server
        |
        v
本地项目上下文
```

## 为什么优先 MCP

Skill 可以教 AI 工具如何行动，但它主要是静态指令。

MCP 让 AI 工具可以调用一个活的系统。

ProjectPilot 需要 live access，因为项目上下文会持续变化：

- 任务会推进
- 决策会积累
- 文件会改变
- 执行会产生新信息
- 记忆需要审核和更新

## 初始 MCP 工具

读取类工具：

- `list_projects`
- `get_project_brief`
- `search_project_context`
- `get_current_tasks`
- `get_relevant_decisions`
- `build_context_pack`

写入类工具：

- `record_run`
- `propose_memory_patch`
- `record_decision`
- `update_task_status`
- `link_artifact`

审核类工具：

- `list_pending_memory_patches`
- `get_memory_patch`
- `approve_memory_patch`
- `reject_memory_patch`

## 工具契约原则

MCP 工具应该小、明确、可审计。

避免模糊操作，例如：

```text
sync_everything
save_context
remember_this
```

优先使用精确操作：

```text
build_context_pack(taskIntent)
propose_memory_patch(runId, patch)
record_decision(projectId, decision)
```

## 互补关系

外部 harness 负责执行。

ProjectPilot 负责项目上下文。

```text
外部 harness：
读文件、改代码、跑命令、和模型对话。

ProjectPilot：
执行前提供上下文，执行后保存经过审核的项目记忆。
```

## 未来方向

当 MCP 读写闭环成立之后，ProjectPilot 可以再增加适配器，主动调用某些有官方 API、CLI 或 app-server 协议的 harness。

这应该是后续层，而不是第一版产品依赖。

