# Brainstorm / 轻量 PRD → Paper → frontend-design 联合工作流

> **目的**：避免「直接高保真蛮干」——先对齐**要做什么、给谁用、信息怎么排**，再在画布上**验证布局与节奏**，最后按 **`frontend-design` skill** 落代码并截图验收。  
> **适用**：新页面、多 Tab/多路由壳、信息密度高的工作台；小改样式可只走 Phase ④ 的局部检测。

---

## 总骨架：Plan → Execute → Verify（闭环）

每一轮交付（无论整段 Phase 还是单步改 UI）都走 **计划 → 执行 → 验证**；**验证未通过不得宣称完成**，也**不在未验证的代码上继续堆新需求**。

| 环节 | 做什么 | 产出 / 纪律 |
|------|--------|-------------|
| **Plan** | 写清本迭代范围与**可验证的完成定义（DoD）** | 3～7 条检查项（例：「壳内触发页无统计卡」「三 Tab 截图各 1 张」「`bun run build:client` 通过」）；发现与 PRD/IA 冲突时先改文档再动手 |
| **Execute** | 只做 Plan 内事项 | 中途若要加 scope → **先改 Plan / DoD**，再写代码 |
| **Verify** | 对照 DoD **逐条勾选** | 前端：截图、关键路径手点、仓库约定下的 **build / tsc**；缺口记**一句话**再进入下一轮 |
| **Loop** | Verify 失败 | **修订 Plan**（纠偏范围或验收标准）或 **修 Execute 结果** → 再 Verify，直到 DoD 全绿 |

**与下方 Phase 的对应关系（可嵌套小循环）**：

- Phase ①②：主要是 **Plan**（PRD + Layer 1）；闸门即 **Verify**「是否够格进下一阶段」。
- Phase ③：每一步可 **小 PEV**——Plan（本步画哪块）、Execute（Paper）、Verify（截图 Checklist）。
- Phase ④：Plan（对照 IA/Paper 列改动文件与 DoD）、Execute（实现）、Verify（截图 + build 等）。

**可靠性的底线**：没有书面 DoD 或等价清单的「做完了」不算完成；DoD 里应至少有一条 **客观可观测**项（截图、命令退出码、具体 URL 行为）。

---

## 三支柱各自解决什么

| 支柱 | 典型载体 | 解决什么问题 | 不负责什么 |
|------|----------|--------------|------------|
| **Brainstorm + 轻量 PRD** | 对话、`ce-brainstorm` 类 skill、或一页纸大纲 | 目标用户、成功标准、范围边界、**内容优先级**、空状态/异常 | 像素级视觉、具体 CSS |
| **Paper** | Paper MCP、画布 artboard | **版式与视线动线**、区块比例、垂直栏对齐、多状态并列对比 | 业务规则细节、实现与 API |
| **`frontend-design` skill** | `skills/frontend-design/SKILL.md` | 在**尊重现有设计系统**前提下，把已定 IA/版式**落成代码**；排版/色/动效/文案底线；**截图验证** | 替你决定「产品上要不要这个功能」（需 Phase ①） |

三者顺序固定：**先想清楚 → 再在纸上排布 → 再写代码**。颠倒顺序就容易变成「一比一好看化」而结构仍乱；**PEV 闭环**保证每一小段「想清楚 / 落地 / 证明」可重复、可追责。

---

## 何时启用全流程 vs 裁剪


| 情况                  | 建议                                    |
| ------------------- | ------------------------------------- |
| 新路由、多屏一致壳、列表+详情+空状态 | **全流程**                               |
| 已有清晰 IA，只换视觉主题      | Phase ② 缩成「改 thesis」+ Phase ④         |
| 单组件、行为不变            | **仅** `frontend-design` Module C + 截图 |
| 需求本身含糊              | **必须先** Brainstorm；不要开 Paper          |


---

## 分阶段工作流（含闸门）

### Phase ① 对齐（Brainstorm → 轻量 PRD）

**输入**：痛点、干系人、是否多页面/多 Tab。  
**产出**（建议结构化记在 issue/文档/对话置顶）：

1. **一句话目标**：例如「任务壳下三子页：用户 10 秒内找到该做的事」。
2. **每页 / 每 Tab 的**：
  - 主任务（Primary job）
  - 次要任务（Secondary，可折叠或次屏）
  - **空状态**文案与引导
3. **跨页一致规则**：共用顶栏？主按钮全局位置？宽度策略（全宽 vs 单栏）是否一致？
4. **明确非目标**（本期不做）：避免做着做着 scope 膨胀。

**闸门**：未写出「主任务 + 空状态」不得进入 Phase ②。

---

### Phase ② 信息架构与 Layer 1（写在进 Paper 之前）

在打开 Paper 前，用 **`frontend-design` 的 Layer 1** 写三句话（可贴在 PRD 后面）：

1. **Visual thesis**（一句）：在**已有** Tailwind/shadcn 前提下，描述气质（如「冷静工具台、少卡片、强标题层级」）。
2. **Content plan**：每页**从上到下**的区块顺序（只写名字，不写样式）。
3. **Interaction plan**：2～3 条具体交互（如「Tab 与 URL 同步」「列表行悬停露出次要操作」）。

**闸门**：Content plan 不能只写「一个列表」，要写到**一级区块**（工具条 / 主列表 / 侧栏 / 说明条等）。

---

### Phase ③ Paper（画布）

**前置**：桌面 Paper 已打开文件，MCP 可用。

1. **先线框后上色**（可同一文件多 artboard）：灰底区块 + 占位文案，对齐 **垂直栏**（Paper 规范：重复行用固定槽宽）。
2. **一屏一画板或一状态一画板**：例如「待办-看板」「触发-有规则」「定时-两条计划」；避免所有状态挤一帧。
3. **自检**：每 2～3 次结构改动 **截图**，对照 Paper Review Checkpoints（间距、层级、对比、对齐、裁切）。
4. **与 Phase ① 对照**：主任务是否在首屏可见？次要信息是否喧宾夺主？

**闸门**：未通过「扫描标题能否理解页面」不得进入 Phase ④。

---

### Phase ④ 实现（frontend-design）

1. **Layer 0**：扫 `tailwind.config`、`components/ui`、现有页面模式 → 判定 *Existing / Partial system*。
2. **严格 Module B（应用壳）或 Module C（增量）**：继承圆角、间距、色板；**不**在任务页单独发明第二套组件语言。
3. **实现顺序**：布局容器 → 区块标题与层级 → 列表/卡片 → 动效（2～3 处 intentional motion）。
4. **Visual verification**：按 skill 的工具优先级（项目已有 E2E > Browser MCP > 自述）；**至少一轮截图**对照 Phase ② 的 thesis。

**闸门**：无截图或未说明「为何跳过」不得宣称完成。

---

### Phase ⑤ 回顾（可选但推荐）

- PRD 里哪些假设被推翻？（记一行到设计文档或 ADR）
- 下一迭代是否只需改 Paper 或只改代码？

---

## 在 Cursor 里怎么用（给人类/Agent 的提示模板）

**开题**（触发 Phase ①②）：

> 按仓库 `docs/design/brainstorm-paper-frontend-design-workflow.md` 执行。先 Brainstorm 产出轻量 PRD（主任务/空状态/跨页规则），再写 frontend-design Layer 1 三句话。**不要**先写具体组件代码。

**进 Paper**：

> PRD 与 Layer 1 已就绪。用 Paper MCP：先线框 artboard，再细化；每 2～3 步截图评审。

**写代码**：

> 对照已定 Paper 与 `frontend-design`：Layer 0 检测设计系统，Module B/C，实现后浏览器截图验收。

**带 PEV 闭环的开题**（推荐）：

> 按 `docs/design/brainstorm-paper-frontend-design-workflow.md`：**先写本轮 DoD 清单**（可验证条目），再 Execute，最后 **逐条 Verify** 并贴截图或命令结果；未全绿不收尾。

---

## 与「任务」三子页的映射（示例）

完整 Phase ①② 成稿见 **[tasks-hub-information-architecture.md](./tasks-hub-information-architecture.md)**（随改版更新）。


| Phase | 任务域具体要交代的事                                                                                   |
| ----- | -------------------------------------------------------------------------------------------- |
| ①     | 三子页各自 **主操作**（新建待办 / 新建规则 / 新建计划）；**无数据**时首屏长什么样；触发/定时 **不做**汇总统计块（见 IA 文档定案）                         |
| ②     | 待办：视图切换与 Kanban/列表谁占首屏；触发：规则卡片信息优先级；定时：行内操作与展开编辑的边界                                          |
| ③     | 三个 artboard 分别对应 `/todos`、`/triggers`、`/schedules`，**同一套顶栏 Tab 逻辑**，主内容区版式可不同但**密度与按钮位**尽量同构 |
| ④     | `layout.tsx` + 各 panel 继承 shadcn/zinc，避免第三套主色                                                |


---

## 维护

- 本工作流是**过程规范**，不替代具体页面的 as-is/design 正文；页面级细节仍写在对应 `docs/as-is/`、`docs/design/*.md`。
- 若引入新的官方 skill（如上游更新 `frontend-design`），同步 `skills/frontend-design/SKILL.md` 后，**无需改本文件流程**，除非 Layer 命名变更。

`last_reviewed`: 2026-04-09

（2026-04-09：增补 **Plan → Execute → Verify** 总骨架与 Cursor 提示模板。）