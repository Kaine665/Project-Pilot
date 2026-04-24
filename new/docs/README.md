# ProjectPilot 新设计

这个目录是 ProjectPilot 新定位的干净设计空间。

## 产品定位

ProjectPilot 是一个本地优先的项目上下文服务器。

它通过 MCP 给 Claude Code、Cursor、Codex 等外部 AI 工具提供项目上下文。它的核心不是再做一个 agent，而是管理 AI 工具开工前应该知道什么、收工后项目应该记住什么。

## 产品形态

ProjectPilot 不是聊天应用、IDE、任务管理器，也不是通用 agent 平台。

它是一个带有人类审核控制台的上下文服务器：

- AI 工具通过 MCP 调用 ProjectPilot。
- ProjectPilot 返回和当前任务相关的项目上下文。
- AI 工具在自己的 harness 里执行任务。
- AI 工具把执行结果回报给 ProjectPilot。
- ProjectPilot 提出项目记忆更新。
- 用户审核、修改、接受或拒绝这些更新。

## 核心闭环

```text
AI 工具请求上下文
        |
        v
ProjectPilot 生成 ContextPack
        |
        v
AI 工具执行任务
        |
        v
AI 工具回报执行结果
        |
        v
ProjectPilot 生成 MemoryPatch
        |
        v
用户审核 MemoryPatch
        |
        v
项目上下文被更新
```

## 设计文档

- [产品定位](./产品定位.md)
- [内部架构](./内部架构.md)
- [核心使用流程](./核心使用流程.md)
- [MCP 集成模型](./MCP集成模型.md)
- [竞品调研](./竞品调研.md)
- [上下文地图形态探索](./上下文地图形态探索.md)
- [项目认知系统架构图](./项目认知系统架构图.md)

## UI 草图

- [UI 假设草图](./UI假设草图.md)
