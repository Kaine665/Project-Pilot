# 产品定位与系统设计

> 最后更新：2026-04-10
> 状态：已确认方向，待实现

## 确认的设计稿

### Dashboard（3 个）
| 名称 | 链接 | 说明 |
|------|------|------|
| 板块马赛克（纯技术） | https://p.superdesign.dev/draft/0c5d1a40-eb6e-46f2-be90-92fa331475e8 | 最初确认的技术板块地图 |
| 六维度全览（默认态） | https://p.superdesign.dev/draft/16602eaa-0237-424d-a1b1-f347c8bd4ceb | 六大维度 3x2 网格，一屏总览 |
| 六维度展开（工程展开态） | https://p.superdesign.dev/draft/f1cbfda1-246f-464f-895e-6c7c0d1bddfb | 点击某维度展开 75%，其他缩到右侧 |

### 功能/知识/其他页面
| 名称 | 链接 | 说明 |
|------|------|------|
| 功能详情页 | https://p.superdesign.dev/draft/077dc34c-3232-40f8-ae12-47cf8f0e97ff | 浅色纸感版 |
| 功能详情页（深色版参考） | https://p.superdesign.dev/draft/9f62cc8a-e3a2-4f95-bf31-6fa3503675d0 | 深色版，功能信息结构参考 |
| 知识管理页（五种性质） | https://p.superdesign.dev/draft/d8fd0db0-d547-4fa1-83cc-6e1e6ccfab0c | PP 假数据，五种知识性质 |
| Agent 团队页 | https://p.superdesign.dev/draft/d549b8ef-156b-4591-a051-368840578b21 | Agent 卡片 + 覆盖矩阵 |
| 项目设置页 | https://p.superdesign.dev/draft/6fe3ef94-b893-4d92-a127-4ea76e4e7243 | 板块管理 + 项目空间 |
| 历史回顾页 | https://p.superdesign.dev/draft/26cd2227-6ee9-4584-aedf-f7056907bc19 | 时间线 + 板块变化 + Agent 贡献 |

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
| ① Memory（项目记忆） | "AI 记得我的项目" | 存储积累的项目理解 | 文档/知识存储有，**缺自动积累** |
| ② Loader（装载引擎） | "不用写背景了" | 开聊前自动注入相关上下文 | ResourceRegistry 已有 ✅ |
| ③ Runtime（执行） | "AI 不犯已知的错" | Agent 带着完整上下文执行任务 | Claude SDK + Codex 已有 ✅ |
| ④ Distiller（沉淀器） | "不用手动记笔记" | 聊完后自动提取知识和任务 | **缺失，最该先做** |
| ⑤ Dashboard（仪表盘） | "一眼看到全局" | 全局视图 + 行动入口 | 设计已确认 |

**建设优先级**：先做 ④ Distiller + ① Memory 自动积累。

---

## 三、六维度项目结构

### 六个固定大维度

项目不只是代码。PP 覆盖项目的所有维度，用六个固定的大板块组织：

| 维度 | 核心问题 | 典型小板块 |
|------|---------|-----------|
| **工程** | 怎么造？ | 前端、后端、数据库、API、测试、安全、性能、架构 |
| **产品** | 造什么？ | 产品策略、用户研究、竞品分析、需求、路线图 |
| **设计** | 什么体验？ | UI 设计、交互设计、品牌视觉、设计规范 |
| **商业** | 怎么赚钱？ | 商业模式、定价、合作、法务、财务 |
| **增长** | 怎么获客？ | 内容创作、SEO、社交媒体、社区、开源推广 |
| **运营** | 怎么运转？ | 部署、监控、客户支持、数据分析、发布管理 |

- 大维度**固定**（不可增删），小板块**灵活**（AI 推荐 + 用户自定义）
- 空的维度折叠成一行提示，不占空间但保持存在感
- 功能可以跨维度：如 `[Dashboard设计]` 横跨产品 + 设计 + 工程

### 板块不限于技术

板块 = 项目的任何维度，不只是代码模块。「产品策略」和「数据存储」是平级的板块，用同样的视觉语言展示进度。

---

## 四、Dashboard 设计

### 设计原则

1. **实用优先**：不是给领导看的报表，是给开发者用的起跳板
2. **纵观全局 = 三种感知融合**：位置感（做到哪了）、地形感（哪里实哪里虚）、动静感（什么在动什么卡了）
3. **每个元素必须改变行为**：看到这个信息后用户会做什么？如果什么都不做，就不该出现
4. **一屏六维度**：六个大板块 3x2 网格占满一屏，不需要滚动

### 交互流程

```
默认态：六维度 3x2 等分一屏
  ↓ 点击某个维度（如「工程」）
展开态：该维度占 75%，子板块详细展示；其他五个缩到右侧竖条
  ↓ 点击右侧其他维度
切换：新维度展开，原维度缩回
  ↓ 点击面包屑「项目名」
回到：六维度默认态
```

动画：块平滑放大/缩小，像地图缩放。

### 功能详情页

从 Dashboard 的功能标签（如 `[重连]`）点入。展示该功能在各板块的任务分布：
- 顶部：功能名 + 描述 + 涉及板块标签 + 整体进度 + 执行状态
- 中间：子任务按板块分组
- 底部：依赖关系 + 相关知识条目
- 固定底栏：「继续执行」按钮

### 被淘汰的方向

| 方向 | 为什么淘汰 |
|------|-----------|
| 问候语 + 日期 | 不改变行为 |
| 项目理解度 62/100 | 虚荣指标 |
| 知识存量大数字 | 同上 |
| 知识地图/热力图 | 属于知识管理页 |
| 功能视角（独立视图） | 改为板块视角 + 功能详情页的组合 |
| 赛博朋克风格 | 视觉炫酷但不实用 |
| 浅色 Dashboard | 最终选择深色（与确认的板块视角一致） |

---

## 五、知识系统

### 五种知识性质（单选）

| 性质 | 含义 | 判断标准 | AI 注入优先级 |
|------|------|---------|-------------|
| **事实** | 系统现在是什么样 | 描述「是什么」 | 高 — 相关时注入 |
| **决策** | 已选择但未必已落地 | 已确定的选择 | 高 — 相关时注入 |
| **规则** | 必须遵守的约束 | 要求「该怎么做」 | 最高 — 每次注入 |
| **经验** | 实践中学到的 | 讲述「发生过什么」 | 中 — 相关时注入 |
| **备忘** | 给人看的笔记 | 记录「我想记住的」 | 不注入 |

**设计决策**：
- 五种性质互斥：一条知识只属于一种性质
- 板块标签可多选：一条知识可关联多个板块
- 知识系统**只存文本**（Markdown），非文本（图片/视频/PDF）放项目空间的资产区

### 知识 vs 任务

知识和任务是两个独立系统：
- **知识**：持续有效的认知，没有「完成」状态，只有「有效/已过时」
- **任务**：一次性要做的事，有完成状态、优先级、分配、依赖

Distiller 从会话中同时提取两种产物：知识条目 → 知识系统，待办事项 → 任务系统。

### 现有 documents 系统的改造方向

现有 `documents` 存储层基本够用（CRUD、按项目隔离、原子写入），需要补的：
1. **Distiller**：会话后自动提取知识（最优先）
2. **Loader 扩展**：按相关度注入 knowledge 文档（不只是 code-card）
3. **知识性质字段**：`knowledgeType: 'fact' | 'decision' | 'rule' | 'lesson' | 'memo'`
4. **板块关联字段**：`areaIds: string[]`
5. **统一 UI**：合并现有三套 UI 为一套

---

## 六、数据模型

### 大维度（Dimension）— 固定

```typescript
type Dimension = 'engineering' | 'product' | 'design' | 'business' | 'growth' | 'operations'
```

### 板块（Area）— 灵活

```typescript
interface Area {
  id: string
  name: string
  dimension: Dimension    // 属于哪个大维度
  source: 'ai' | 'user' | 'template'
  color: string
  description?: string
  keywords: string[]
}
```

### 功能（Feature）

```typescript
interface Feature {
  id: string
  name: string
  description?: string
  areaIds: string[]       // 跨板块
  color: string           // 标签颜色
}
```

### 任务（Task）

```typescript
interface Task {
  id: string
  name: string
  areaIds: string[]
  autoAreaIds: string[]   // AI 推荐的（待确认）
  featureId?: string
  status: 'todo' | 'in_progress' | 'done' | 'blocked'
  dependencies?: string[]
}
```

### 知识（Knowledge）

```typescript
interface Knowledge {
  id: string
  title: string
  content: string         // Markdown 正文
  type: 'fact' | 'decision' | 'rule' | 'lesson' | 'memo'
  areaIds: string[]
  sourceSessionId?: string
  status: 'pending' | 'confirmed' | 'outdated'
}
```

### 板块初始化流程

```
用户创建项目
  → AI 扫描代码 → 推荐技术板块（归入工程维度）
  → AI 问：「还涉及哪些方面？」
  → 用户选/加非技术板块
  → 或用模板：
     · 个人项目：工程 + 产品
     · SaaS 产品：工程 + 产品 + 设计 + 商业 + 运营
     · 开源项目：工程 + 产品 + 增长
  → 之后随时可增删改板块
```

---

## 七、Agent 团队

Agent 不是群聊，不是多 Agent 对话，是**专家池**：
- 每个 Agent 有不同的擅长领域（关联板块）
- 多个 Agent 可同时跑（各自独立会话）
- Agent 之间不直接对话，通过**知识库间接协作**
- 用户是调度者

---

## 八、项目空间

每个项目有独立的存储空间：

```
projects/<projectKey>/
  ├── knowledge/     # 知识（纯文本，飞轮用）
  ├── assets/        # 资产（设计稿/截图/视频/PDF，人看的）
  ├── tasks/         # 任务
  ├── areas/         # 板块配置
  ├── features/      # 功能定义
  ├── sessions/      # 会话历史
  └── meta.json      # 项目元数据
```

知识 = AI 的记忆，只放文本。资产 = 人的参考，放任意格式。知识条目可以用 Markdown 链接引用资产。

---

## 九、完整页面地图

```
ProjectPilot
│
├── Dashboard（六维度地图）              ← 设计已确认
│   ├── 默认态：3x2 网格全览
│   ├── 展开态：选中维度 75% + 其他缩右侧
│   └── 功能详情页（点击功能标签进入）    ← 设计已确认
│
├── Agent 会话（干活的地方）             ← 已有
│   └── Distiller（后台自动沉淀）        ← 待实现
│
├── 知识管理                            ← 设计已出
│   ├── 待确认区（Distiller 产出的）
│   ├── 按性质浏览（事实/决策/规则/经验/备忘）
│   ├── 按板块浏览
│   └── 搜索
│
├── Agent 团队                          ← 设计已出
│   ├── Agent 卡片 + 状态
│   ├── 擅长领域（关联板块）
│   └── 覆盖度矩阵
│
├── 项目设置                            ← 设计已出
│   ├── 项目信息
│   ├── 板块管理（增删改排序）
│   ├── 项目空间（资产管理）
│   └── 危险操作
│
└── 历史回顾                            ← 设计已出
    ├── 时间段选择
    ├── 每日活动可视化
    ├── 板块变化表
    ├── Agent 贡献
    └── 事件时间线
```

---

## 十、探索过程中产出的设计稿索引

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
| I | Agent 团队(深色) | https://p.superdesign.dev/draft/71c6ec1d-be6a-4be5-94fd-1144fc07e07e | Agent 卡片+覆盖矩阵 |
| J | 覆盖度 | https://p.superdesign.dev/draft/4f9575b0-7c33-433a-873c-c6f6160b2453 | Agent×项目交叉 |
| K | 活力脉搏 | https://p.superdesign.dev/draft/fa36ed70-8e0c-432c-a60a-be943097af06 | 时间轴心跳 |
| L | 板块视角(标签版) | https://p.superdesign.dev/draft/0c5d1a40-eb6e-46f2-be90-92fa331475e8 | 已确认 → 演进为六维度版 |
| M | 功能视角列表 | https://p.superdesign.dev/draft/929a58ae-7c11-4665-bb84-68ed774cc516 | 改为功能详情页 |
| M2 | 功能压缩行 | https://p.superdesign.dev/draft/d62b0121-70f9-4c3d-9af5-c45fca617415 | 手风琴展开 |
| M3 | 功能左右分栏 | https://p.superdesign.dev/draft/47cf4ffe-c96c-434e-934a-f063612ab022 | 邮件客户端式 |
| N | 功能详情深色安静版 | https://p.superdesign.dev/draft/70a53a16-7084-49ce-954f-c2a3374d6275 | 深色去炫酷 |
| O | Dashboard 浅色网格 | https://p.superdesign.dev/draft/3e92dbdd-5421-422c-9c78-81d393c961e1 | 浅色4列网格 |
| P | 知识页浅色顶部Tab | https://p.superdesign.dev/draft/b59a1918-7511-456c-83f9-df1892dbc796 | 去侧边栏 |
| Q | Dashboard v2 浅色乱 | https://p.superdesign.dev/draft/d623aef4-6c6e-43d4-8f55-66bf65d6c1f9 | 太乱淘汰 |
| R | 知识页v2含非技术 | https://p.superdesign.dev/draft/df33bc1d-38b1-4364-98f9-972d26d7812a | 侧边栏太小 |
| S | 六块浅色默认态 | https://p.superdesign.dev/draft/52532408-ce44-4b09-be15-c213330f3620 | 浅色太丑 |
| T | 六块浅色展开态 | https://p.superdesign.dev/draft/ad24f7d8-82f5-42b1-b9f3-b9f976a44ed9 | 浅色太丑 |
