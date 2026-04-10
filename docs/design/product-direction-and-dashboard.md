# 产品定位与系统设计

> 最后更新：2026-04-10
> 状态：已确认方向，待实现
> 设计稿（已确认）：
> - 板块视角 Dashboard：https://p.superdesign.dev/draft/0c5d1a40-eb6e-46f2-be90-92fa331475e8
> - 功能详情页（浅色纸感版）：https://p.superdesign.dev/draft/077dc34c-3232-40f8-ae12-47cf8f0e97ff

---

## 一、产品定位

**一句话**：让 AI 对你的项目越来越懂，而不是每次都从零开始。

**核心价值**：每天帮开发者省 1-2 小时重复向 AI 解释上下文的时间。

**不是什么**：不是通用 Agent 平台，不是 AI IDE，不是项目管理工具。是一个**记忆驱动的项目推进系统**。

### 竞品关系

不把 Claude / Cursor / Devin 看作纯竞品，而是互补层：

```
用户的项目
  └── ProjectPilot（项目推进、上下文管理、进度追踪）
        ├── 调用 Claude（执行复杂推理）
        ├── 调用 Cursor（执行代码编辑）
        └── 调用其他工具（测试、部署等）
```

PP 的价值不在于自己有最强的 LLM 或最好的代码编辑器，而在于它是把这些能力串成「项目」的中间层。

### 用户痛点（按优先级）

| 痛点 | 描述 | 每天浪费 |
|------|------|---------|
| **A. 每次从头来** | 新会话不知道项目背景，用户花 10 分钟写 prompt | 40-50 分钟 |
| **B. 不知道全貌** | AI 不了解项目约定和历史决策，给出冲突方案 | 20-30 分钟 |
| **C. 搞不清进度** | 没有一个地方看到全局状态 | 10-15 分钟 |
| **D. 分解协调负担** | 拆任务和跨任务上下文传递本身就是负担 | 远期问题 |

---

## 二、系统架构：五模块飞轮

```
① Memory → ② Loader → ③ Runtime → ④ Distiller → 回到 ①
```

| 模块 | 用户感知 | 作用 | PP 现状 |
|------|---------|------|--------|
| ① Memory（项目记忆） | "AI 记得我的项目" | 存储积累的项目理解：决策、约定、踩坑、变更 | 文档/知识存储有，**缺自动积累** |
| ② Loader（装载引擎） | "不用写背景了" | 开聊前自动注入相关上下文 | ResourceRegistry 已有 ✅ |
| ③ Runtime（执行） | "AI 不犯已知的错" | Agent 带着完整上下文执行任务 | Claude SDK + Codex 已有 ✅ |
| ④ Distiller（沉淀器） | "不用手动记笔记" | 聊完后自动提取决策/约定/踩坑/下一步 | **缺失，最该先做** |
| ⑤ Dashboard（仪表盘） | "一眼看到全局" | 全局视图 + 行动入口 | 本轮设计完成 |

**飞轮核心洞察**：执行产生记忆 → 记忆改善理解 → 理解指导下一次执行。每转一圈，AI 对项目就更懂一分。

**建设优先级**：先做 ④ Distiller + ① Memory 自动积累。没有 ④，飞轮转不起来。

---

## 三、Dashboard 设计

### 设计原则

1. **实用优先**：不是给领导看的报表，是给开发者用的起跳板
2. **纵观全局 = 三种感知融合**：位置感（做到哪了）、地形感（哪里实哪里虚）、动静感（什么在动什么卡了）
3. **每个元素必须改变行为**：看到这个信息后用户会做什么？如果什么都不做，就不该出现

### 确认方案：板块视角（唯一视图）

**设计稿**：https://p.superdesign.dev/draft/0c5d1a40-eb6e-46f2-be90-92fa331475e8

马赛克地图 + 跨板块功能标签。核心交互：

```
Dashboard 马赛克地图
  → 看到各板块进度和状态
  → 看到跨板块功能的彩色标签 [重连] [迁移] [安全加固]
  → 点击标签 → 进入功能详情页
  → 功能详情页展示该功能在各板块的任务
  → 点「继续执行」→ 开始干活
  → 点「← 返回项目地图」→ 回到 Dashboard
```

### 确认方案：功能详情页（浅色纸感版）

**设计稿**：https://p.superdesign.dev/draft/077dc34c-3232-40f8-ae12-47cf8f0e97ff

浅色纸感风格。功能信息结构：
- 顶部：功能名 + 描述 + 涉及板块标签 + 整体进度 + 当前执行状态
- 中间：子任务按板块分组（每个板块一个区域，显示该板块内属于此功能的任务）
- 底部：依赖关系 + 相关知识条目（决策/约定/踩坑）
- 固定底栏：「继续执行」按钮

### 被淘汰的方向（及原因）

| 方向 | 为什么淘汰 |
|------|-----------|
| 问候语 + 日期 | 不改变行为 |
| 项目理解度 62/100 | 虚荣指标，看了不知道做什么 |
| 三环仪表盘 | 同上 |
| 知识存量大数字"47条" | 同上 |
| 知识地图/热力图 | 有价值但属于知识管理页，不是 Dashboard |
| 决策与约定注册表 | 查资料时才需要，属于知识库页面 |
| 功能视角（独立视图） | 改为板块视角 + 功能详情页的组合 |
| 赛博朋克风格 | 视觉炫酷但不实用 |

---

## 四、数据模型

### 板块（Area）

- AI 推荐 + 用户确认 + 模板起步
- 不固定分类，每个项目不一样
- 建议 5-10 个，AI 控制粒度
- 带 keywords，用于自动关联任务

```typescript
interface Area {
  id: string
  name: string           // "数据存储层"
  source: 'ai' | 'user' | 'template'
  color: string
  description?: string
  keywords: string[]     // AI 自动关联任务用
}
```

### 板块初始化流程

```
用户创建/导入项目
  → AI 扫描代码结构和已有任务
  → AI 推荐一组板块划分
  → 同时提供模板：Web全栈 / 纯后端 / AI-ML / 用AI推荐
  → 用户确认/修改/从零建
  → 之后随时可增删改
  → AI 持续建议调整
```

### 功能（Feature）

- 多个任务的聚合，可跨板块
- 在板块视图里通过彩色标签体现
- 点击标签进入功能详情页

### 任务（Task）

- 可关联 0~N 个板块（不是 1:1）
- 双层标签：`areas`（用户确认）+ `autoAreas`（AI 推荐，待确认）
- 可属于某个功能

```typescript
interface Task {
  id: string
  name: string
  areas: string[]        // 用户确认的板块关联
  autoAreas: string[]    // AI 推荐的（灰色显示，待确认）
  featureId?: string     // 所属功能
  status: 'todo' | 'in_progress' | 'done' | 'blocked'
  dependencies?: string[]
}
```

---

## 五、探索过程中产出的设计稿索引

> 以下设计稿已被淘汰，仅供回顾参考。

| 编号 | 方案 | 链接 | 探索的方向 |
|------|------|------|-----------|
| A | 经典双栏 | https://p.superdesign.dev/draft/cdbf08ed-dc5e-44d8-bb8b-4b66f447f28f | 流量视角 |
| B | 指挥中心 | https://p.superdesign.dev/draft/614788dd-c4d7-4774-b242-eb0a1c568a08 | 密集三栏 |
| D | 项目全景 | https://p.superdesign.dev/draft/3372f1a9-2fa5-48ad-a6f5-673d0b28c76e | 存量+理解度环形图 |
| E | 项目地图 | https://p.superdesign.dev/draft/2da62205-0a3d-4fc3-83f7-507e94483219 | 结构理解树 |
| F | 行动优先 | https://p.superdesign.dev/draft/01e0a53c-270b-43c3-bd97-7b091c9c6253 | 极简单栏 |
| G | 全局地形 | https://p.superdesign.dev/draft/7a18cd3b-f6fb-4772-867a-2066fcd98293 | 三层融合地形 |
| H | 工程地图 | https://p.superdesign.dev/draft/7a0d39b2-c20b-4520-bc7e-a425aa225a8c | 纯项目完成度填充 |
| I | Agent 团队 | https://p.superdesign.dev/draft/71c6ec1d-be6a-4be5-94fd-1144fc07e07e | Agent 卡片+覆盖矩阵 |
| J | 覆盖度 | https://p.superdesign.dev/draft/4f9575b0-7c33-433a-873c-c6f6160b2453 | Agent×项目交叉 |
| K | 活力脉搏 | https://p.superdesign.dev/draft/fa36ed70-8e0c-432c-a60a-be943097af06 | 时间轴心跳 |
| M | 功能视角列表 | https://p.superdesign.dev/draft/929a58ae-7c11-4665-bb84-68ed774cc516 | 按功能组织（改为详情页） |
| M2 | 功能压缩行 | https://p.superdesign.dev/draft/d62b0121-70f9-4c3d-9af5-c45fca617415 | 手风琴展开 |
| M3 | 功能左右分栏 | https://p.superdesign.dev/draft/47cf4ffe-c96c-434e-934a-f063612ab022 | 邮件客户端式 |
| N | 功能详情深色安静版 | https://p.superdesign.dev/draft/70a53a16-7084-49ce-954f-c2a3374d6275 | 深色但去炫酷 |
