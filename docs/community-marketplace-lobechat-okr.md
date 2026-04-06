# LobeHub / LobeChat「社区市场」调研与 ProjectPilot 复刻 OKR

## 一、源码与产品侧结论（调研摘要）

### 1.1 产品形态（以 [LobeHub 社区](https://app.lobehub.com/community) / Discover 为参照）

- **发现页（Discover）**：分类浏览助手（Assistants）、插件（Plugins）、模型、MCP 等；列表 + 详情 + 一键「使用 / 安装」。
- **供给来源去中心化**：核心条目**不硬编码在主应用仓库**，而是由**独立 Git 仓库 + PR 贡献**维护；应用侧通过 **Market SDK / CDN 索引**拉取元数据。
- **典型公开仓库**
  - [lobehub/lobe-chat-agents](https://github.com/lobehub/lobe-chat-agents)：社区助手索引与提交规范（`agent-template.json` / `agent-template-full.json`，合并后进 `src/` 等）。
  - [lobehub/lobe-chat-plugins](https://github.com/lobehub/lobe-chat-plugins)：插件市场同类模式。
- **主应用依赖**：`lobe-chat`（现 `@lobehub/lobehub` monorepo）依赖 **`@lobehub/market-sdk`**（见 npm / `lobehub-market` 仓库）与 **`@lobehub/market-types`**，负责与远端市场 API/索引交互；UI 为 Next.js + 大量业务包，**不适合整仓搬运**，应对齐**数据契约 + 交互闭环**。

### 1.2 架构模式（可对齐复刻的「骨架」）

| 层次 | LobeHub 做法 | ProjectPilot 对齐思路 |
|------|----------------|------------------------|
| 目录 | 远端 JSON 索引 + 条目文件 | `GET /api/community/catalog` + 可选远端 URL；本地 `community-catalog-seed.json` 兜底 |
| 详情 | identifier → 拉取完整 manifest | 条目内嵌 `systemPrompt` + `capabilities` 等（MVP）；后续拆 `GET /item/:id` |
| 安装 | 写入用户/会话侧配置（DB 或本地） | **映射为 `AgentPreset`**，`POST /api/data/agent-presets`（与现有「运行预设」一致） |
| 贡献 | GitHub PR + Review | 后续：独立 `project-pilot-community` 仓库或站内提交 + 审核队列 |

### 1.3 「完整复刻」的边界说明

LobeHub 市场包含 **助手 / 插件 / 模型 / MCP / 多语言 SEO / 账号体系** 等；在 ProjectPilot 内**逐像素 + 全品类**复刻需多季度。本 OKR 将「完整复刻」拆解为**可验收的阶段性能力**，每一阶段对齐上表骨架的一层。

---

## 二、总目标（Objective）

**O1**：在 ProjectPilot 内提供与 LobeHub 社区**同构**的「发现 → 详情 → 安装到本地工作流」体验，并以**可扩展目录**支撑后续与官方市场索引对齐。

---

## 三、关键结果（Key Results）

### KR1 — 目录与数据契约（对齐 Market 索引思想）

- **指标**：存在稳定 JSON Schema（文档化）+ 服务端 `GET /api/community/catalog` 返回 `{ version, source, items[], fetchedAt }`。
- **验收**：无网络时仍能加载**内置种子目录**；条目含 `id、title、description、tags、systemPrompt、capabilities(可选)`。

### KR2 — 发现 UI（对齐 Discover 列表心智）

- **指标**：独立路由 `/workspace/community`；搜索 + 标签筛选 + 卡片列表；移动端可用。
- **验收**：从侧栏可进入；空搜与无结果态有文案。

### KR3 — 安装闭环（对齐「一键使用」）

- **指标**：单条「添加到我的预设」成功率 ≥ 99%（有效条目）；写入后可在 `/workspace/presets` 看到。
- **验收**：重复点击不产生重复预设**或**有幂等策略（MVP：允许重复，名称带「（社区）」后缀区分）。

### KR4 — 与 Lobe 生态可选互通（进阶）

- **指标**：支持配置**远端 catalog URL**（或同步任务）拉取兼容子集字段；失败回退种子数据。
- **验收**：文档写明字段映射（Lobe agent template → PP `AgentPreset`）。

### KR5 — 供给与运营（对齐 PR 贡献流）

- **指标**：对外说明如何贡献条目（PR 模板或独立仓库 README）；可选 CI 校验 JSON。
- **验收**：至少 1 次「外部贡献」演练记录在 CONTRIBUTING 或本文附录。

---

## 四、执行阶段（与 KR 对应）

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 本文档 + 种子 `community-catalog-seed.json` + `GET /api/community/catalog` + `/workspace/community` + 导入预设 | **已落地（代码库）** |
| **P1** | 远端 URL 拉取、缓存、Schema 校验（zod）、详情页路由 | 待办 |
| **P2** | 插件/MCP 等第二品类（独立 catalog 类型枚举） | 待办 |
| **P3** | 独立社区仓库 + PR 流程 + 与 CI 发布索引 | 待办 |

---

## 五、成功定义（本轮「任务成功」）

- 用户可在应用内打开**社区市场**页，浏览内置条目，并**一键生成本地运行预设**；API 与数据格式在本文有据可查，后续可接 Lobe 或自研索引而**无需改 UI 主流程**。

---

## 六、参考链接

- [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat)（现 monorepo `@lobehub/lobehub`）
- [lobehub/lobe-chat-agents](https://github.com/lobehub/lobe-chat-agents)
- [@lobehub/market-sdk](https://www.npmjs.com/package/@lobehub/market-sdk)
