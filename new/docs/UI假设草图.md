# UI 假设草图

这些草图由 Superdesign 生成，用来比较 ProjectPilot 作为“项目上下文服务器”时，桌面端主界面可能围绕什么展开。

当前不做最终决策，只用于观察不同产品重心的感觉。

## 假设一：MemoryPatch 审核台

预览：https://p.superdesign.dev/draft/c9842b12-c109-4a7f-8445-940577e1edbb

中心问题：

> 用户每天打开 ProjectPilot，主要是审核 AI 工具收工后提议写回的项目记忆。

这个方向像一个“项目记忆 Inbox”。

主要界面内容：

- 待审核 MemoryPatch 队列
- 每条 patch 的来源工具、关联任务和风险提示
- 建议写入的事实、决策、约束
- 接受、修改、拒绝、合并、固定
- 右侧显示相关 ContextPack、Run 和 MCP 状态

适合验证的问题：

- 用户是否真的愿意每天审核记忆更新？
- MemoryPatch 是否是最强的主界面对象？
- 审核队列会不会让产品看起来太像任务 Inbox？

## 假设二：项目上下文地图

预览：https://p.superdesign.dev/draft/d965f245-95c4-41fe-bdd9-963aab4ceeaa

中心问题：

> 用户每天打开 ProjectPilot，主要是看 AI 当前如何理解这个项目。

这个方向像一个“项目上下文地图”。

主要界面内容：

- Memory、Decision、Task、Constraint、Artifact、Run 的关系
- 哪些上下文被固定
- 哪些上下文过期
- 哪些上下文缺失
- 哪些内容会进入下一次 ContextPack
- 右侧显示选中节点详情和 ContextPack 预览

适合验证的问题：

- 用户是否需要先“看见项目上下文结构”才会信任 PP？
- 上下文地图是否能比普通文档库更清楚？
- 关系图/矩阵是否会过度复杂？

## 假设三：MCP 服务器监控

预览：https://p.superdesign.dev/draft/6c9de576-8854-4d7d-aea2-20cc911770e8

中心问题：

> 用户每天打开 ProjectPilot，主要是看外部 AI harness 如何调用项目上下文。

这个方向像一个“MCP Server 控制台”。

主要界面内容：

- Claude Code、Cursor、Codex 等客户端连接状态
- `build_context_pack`、`search_project_context`、`record_run`、`propose_memory_patch` 调用流
- 每次调用读取了哪些上下文
- 每次调用写回了什么
- 右侧显示 server 状态、端口、数据目录和待审核写回

适合验证的问题：

- 这个方向是否太技术化？
- 它是否更符合“Project Context Server”的产品形态？
- 普通用户是否会因为看见调用过程而更信任系统？

## 暂时观察

三种方向不是互斥的，但主界面只能有一个重心。

可能的组合关系：

```text
审核台 = 每天要处理什么
上下文地图 = 项目现在是什么状态
MCP 监控 = AI 工具刚刚做了什么
```

后续要验证的是：用户第一次打开 ProjectPilot 时，哪一个重心最能让他明白“我为什么需要它”。

