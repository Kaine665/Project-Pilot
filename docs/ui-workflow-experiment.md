# UI 工作流程对比实验（Agents 页）

本文约定：**如何用 git worktree 并行保留多套「流程终点」实现**，以及如何记录实验与评估结果。  
**截图即证据**：最终 UI 的静态截图是核心评估物之一（与量表、笔记并列）。

---

## 1. 实验预设

| 项 | 内容 |
|----|------|
| **研究问题** | 在相同功能与布局前提下，不同「设计工作流程」导致的 **Agents 工作区** 观感与可读性差异，是否值得固定某一种流程。 |
| **控制变量** | 路由与功能：`/[locale]/flows/agents`；视口：建议固定 1440×900；数据：同一 `~/.project-pilot/data`（或同一套 demo 数据）。 |
| **自变量** | 分支 / worktree 所代表的 **流程叙事** 及其 **终点 token**（本实验用 CSS 变量落在页面根容器上，仅影响 Agents 子树继承的语义色）。 |
| **因变量** | 截图；可选：评审量表得分；可选：WCAG 对比度抽检（浏览器插件 / axe）。 |
| **样本量** | 本预设含 **对照 + 2 条流程**；扩展时可增加 `exp/ui-workflow-c-*` worktree。 |

### 1.1 对照（Baseline）

- **分支**：`develop-static`（主工作区 `develop-static/`，无 `exp-ui-wf*` 类名）。
- **叙事**：当前产品默认实现，不作为某条「实验流程」的变体。

### 1.2 流程 A（技能先行 → token）

- **分支**：`exp/ui-workflow-a-agents`
- **Worktree 路径**：`../exp-ui-workflow-a-agents`（相对仓库内 `develop-static` 的同级目录）
- **叙事**：先检索设计技能（如 ui-ux-pro-max `--design-system`），将推荐色板收敛为 **primary / accent / muted** 等 token，再实现。
- **代码标记**：根容器 `exp-ui-wfa`，样式见该分支 `workflow-experiment-a.css`。

### 1.3 流程 B（工程直出 → 工具型 token）

- **分支**：`exp/ui-workflow-b-agents`
- **Worktree 路径**：`../exp-ui-workflow-b-agents`
- **叙事**：少依赖外部技能检索，以 **高密度工具界面** 为目标，直接微调 shadcn 语义变量（低圆角、冷色主色）。
- **代码标记**：根容器 `exp-ui-wfb`，样式见该分支 `workflow-experiment-b.css`。

---

## 2. Worktree 操作（已创建时如何同步 / 清理）

在 **`develop-static` 目录** 下：

```bash
# 列出 worktree
git worktree list

# 若尚未创建（仅需执行一次时）
git worktree add -b exp/ui-workflow-a-agents ../exp-ui-workflow-a-agents develop-static
git worktree add -b exp/ui-workflow-b-agents ../exp-ui-workflow-b-agents develop-static
```

**结束实验后移除**（先合并或丢弃分支上的改动，再执行）：

```bash
git worktree remove ../exp-ui-workflow-a-agents
git worktree remove ../exp-ui-workflow-b-agents
git branch -D exp/ui-workflow-a-agents
git branch -D exp/ui-workflow-b-agents
```

---

## 3. 截图协议（可复现）

1. 同一时间只在一个 worktree 里 `npm run dev`（默认端口 **4000**）；换分支对比时 **停掉上一进程** 再起，避免端口冲突。
2. 浏览器打开：`http://127.0.0.1:4000/zh/flows/agents`（或你的默认 locale）。
3. 建议输出目录：`develop-static/tmp/ui-workflow-experiment/`；命名：`baseline.png`、`workflow-a.png`、`workflow-b.png`。

自动化（依赖已安装的 Playwright）：

```bash
cd develop-static
# 先在某一 worktree 启动 dev，再执行（设置端口与标签）
node tmp/ui-workflow-experiment-capture.mjs 4000 baseline
```

换到另一 worktree、重启 dev 后改最后一个参数为 `workflow-a` / `workflow-b` 再跑。

---

## 4. 评估标准

### 4.1 截图作为「硬标准」

- **一致性**：同视口、同页面深度（例如都停在列表未展开会话，或都展开同一状态），否则对比无效。
- **归档**：每张图对应 **分支名 + commit SHA + 日期**，写在实验笔记或 `manifest.json`。
- **用途**：适合快速淘汰「明显不协调」的终点；不适合单独证明可用性（需配合任务测试）。

### 4.2 建议量表（1–5 分，可打印成表）

| 维度 | 低分含义 | 高分含义 |
|------|----------|----------|
| **品牌/气质契合** | 与产品定位冲突 | 与「协作型工具」定位一致 |
| **层级可读** | 主次不清、扫视困难 | 标题/列表/主操作一眼可分 |
| **密度舒适度** | 过挤或过空 | 信息量能支撑长时间使用 |
| **组件一致性** | 同一页多种「方言」 | 圆角、边框、主色用法统一 |
| **可访问性直觉** | 疑似禁用/对比不足 | 主按钮状态清晰、灰度层次够用 |

### 4.3 通过 / 不通过门槛（示例，可按团队改）

- **P0**：无横向溢出、无控制台 error（与 UI 流程无关的 API 错误单独记）。
- **P1**：主 CTA 与次要操作可区分（量表「可访问性直觉」≥3）。
- **P2**：至少 2 名评审在「层级可读」上 ≥4，或截图评审会记录采纳理由。

### 4.4 实验记录模板（可复制）

```
日期：
对照 commit：
流程 A commit：
流程 B commit：
截图路径：
评审人：
量表均分 / 备注：
结论（保留 A / B / baseline / 继续迭代）：
```

---

## 5. 与「训练模型」类比的边界

- Worktree 实现的是 **离散可部署的终点**，不是对每一次人类决策的完整仿真。
- 流程内部的「每一步多种设计」应 **拆成更多分支或更多次 commit**，再各截一屏，避免组合爆炸时一次性做完。

---

## 6. 相关文档

- [git-worktree.md](./git-worktree.md) — 仓库内 worktree 通用约定
