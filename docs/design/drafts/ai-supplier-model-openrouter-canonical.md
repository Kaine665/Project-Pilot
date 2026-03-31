# 草案：AI 供应商 × 模型（OpenRouter 标准名）

**状态**：设计草案，未实现。  
**日期**：2026-03-30  

---

## 1. 目标

- 用户最常接触的是 **模型列表**（扁平、统一名称）；**供应商**仅为配置接入。
- **标准模型标识**统一采用 **OpenRouter 风格** 的 canonical id（如 `anthropic/claude-sonnet-4-6`、`openai/gpt-4o`）。各供应商在运行时把该 id **适配**为自家 API 所需的 `model` 字符串。
- **多供应商**可提供同一 canonical 模型时，**自动择一**：在「已启用且可用（含额度/健康）」的集合中按规则选一条，不比较质量。
- **前端模型列表不分组**；后端可保留公司/标签用于映射与同步，**不强制展示给用户**。
- **分类**：创造模型的公司为 **原厂**；**云托管**（Azure OpenAI、AWS Bedrock 等）算 **聚合**，只向用户暴露「母公司品牌」作为认知辅助时可单独说明，配置形态仍归聚合。

---

## 2. 术语

| 术语 | 含义 |
|------|------|
| **公司（母公司）** | 产出模型权重的品牌（Anthropic、OpenAI、DeepSeek、Google…）。用于内部元数据、映射文档与客服表述，**不必**单独占设置页一级。 |
| **供应商（Supplier）** | 一条可调用的接入：endpoint、协议、鉴权、开关。分 **原厂直连** 与 **聚合商**（含云托管聚合）。 |
| **物理模型 ID** | 该供应商 API 里实际传的 `model` 字符串。 |
| **标准模型 ID（canonical）** | OpenRouter 命名体系下的全局统一 id；产品内模型列表、默认模型、持久化均以它为主键（除非未映射的兜底）。 |
| **默认模型** | 用户选中的 canonical id；调用时由解析器绑定到某条供应商 + 物理 id。 |

---

## 3. 供应商类型

```ts
type SupplierKind = 'oem' | 'aggregate';
// oem: 原厂直连（官方 API、DashScope 等「单一品牌线路」按产品定义可归 oem）
// aggregate: 多品牌网关 + 云托管（OpenRouter、硅基、火山方舟、Azure OpenAI、Bedrock…）
```

**规则（本草案）**

- Azure OpenAI、AWS Bedrock → `aggregate`（云托管）。
- 官方 `api.openai.com`、`api.anthropic.com`、DeepSeek 官方等 → `oem`。

---

## 4. 数据模型（草案级 TypeScript）

### 4.1 供应商配置

```ts
type SupplierId = string; // uuid 或 slug

interface SupplierConfig {
  id: SupplierId;
  /** 展示名，如「OpenRouter」「Anthropic 官方」 */
  displayName: string;
  kind: SupplierKind;
  enabled: boolean;
  /** openai-compatible | anthropic-compatible | vendor-specific */
  apiProfile: string;
  baseUrl: string;
  /** 鉴据：API Key / OAuth 引用 / IAM 等，按 profile 扩展 */
  credentials: Record<string, unknown>;
  /** 可选：仅 aggregate 需要 */
  extraFields?: Record<string, string>;
  /** 上次成功同步 models 的时间 */
  lastModelsSyncedAt?: string;
}
```

### 4.2 标准名与映射

```ts
/** 主键：OpenRouter 风格，如 anthropic/claude-sonnet-4-6 */
type CanonicalModelId = string;

/**
 * 每个供应商一张表：canonical -> 调用时物理 model id
 * 未配置的 canonical 在该供应商上视为「不可用」
 */
type SupplierModelMap = Record<CanonicalModelId, string>;

/** 内置映射包（版本化 JSON），随应用更新；用户不可改 canonical 字符串规范 */
interface CanonicalRegistryEntry {
  canonicalId: CanonicalModelId;
  /** 可选：内部排序、能力标签，前端列表可不展示分组 */
  vendorLabel?: string;
  displayName: string;
  contextWindow?: number;
}
```

### 4.3 聚合后的模型目录（后端视图）

```ts
interface ResolvedModelRow {
  canonicalId: CanonicalModelId;
  displayName: string;
  /** 可提供该 canonical 且 enabled 的供应商 id 列表（同步后计算） */
  supplierIds: SupplierId[];
}
```

### 4.4 默认模型（持久化）

```ts
interface DefaultModelSelection {
  canonicalId: CanonicalModelId;
}
```

（不强制存「首选供应商」；由解析器自动选。）

---

## 5. 同步与发现

- **周期**：默认 **每 24h** 对已 `enabled` 的供应商拉取模型列表（如 `GET /v1/models` 或各协议等价物）。
- **手动**：设置页提供「刷新模型列表」。
- **流程**：
  1. 拉取物理 id 列表；
  2. 用 **内置映射**（物理 id + 供应商类型 → canonical）尽量映射到 OpenRouter 标准名；
  3. 无法映射的：可 **丢弃** 或 **以物理 id 为 canonical 兜底**（产品决策：建议兜底展示 `raw:supplierId:physicalId` 或仅展示物理 id 并标「未标准化」）。

---

## 6. 运行时解析（自动选供应商）

输入：`canonicalId`，全局 `SupplierConfig[]`，映射表，各供应商健康/额度标记。

1. 求集合 \(S\) = `{ s | s.enabled ∧ canonicalId 在 s 的映射中存在 ∧ s 健康且有额度 }`。
2. 若 \(S\) 为空 → 报错或降级提示用户开启供应商 / 检查映射。
3. **择一规则**（确定性，避免抖动）：
   - 将 \(S\) 按固定顺序排序，例如：`kind === 'oem'` 优先于 `aggregate`，同 kind 内按 `displayName` 或 `id` 字典序；
   - 取第一个。
4. 得到物理 `model` = `map[s][canonicalId]`，用 `s` 的 baseUrl + credentials 发请求。

> 「有额度」若短期无法对接真实计费 API，可用 **占位**：健康检查通过即视为可用；后续再接用量 API。

---

## 7. UI（单入口 + 右侧标题行切换）

### 7.0 导航（避免侧栏两个入口混淆）

- **左侧设置侧栏只保留一个入口**，例如 **「模型与供应商」**（或「AI 接入」等统一名称）。
- **不在侧栏拆「模型」「供应商」两项**。
- **右侧主内容区顶栏（标题行）** 提供 **分段控件 / Tab 切换**：**模型** | **供应商**，与主标题同一行排布（例如左侧标题 + 右侧 `模型`/`供应商` 两段按钮，或标题下方一条紧凑 segment）。
- 切换仅替换 **标题行以下的内容区**；TopNav 与左侧设置导航 **不变**。

### 7.1 供应商子视图（「供应商」选中时）

- 分区：**原厂** | **聚合商**（中文标题）。
- 每供应商一块：**开关**、主密钥输入、说明文案；聚合/云托管展示额外字段（Base URL、Deployment、Region 等），参考常见 IDE「API Keys」长表单布局。
- 底部：**添加自定义供应商**（可选二期）。

### 7.2 模型子视图（「模型」选中时）

- **单一扁平列表**，无分组；可选 **搜索** 过滤 `displayName` / `canonicalId`。
- 每行：标准展示名（可与 OpenRouter 展示对齐）+ 小图标；当前 **默认模型** 行有星标/高亮。
- **刷新** 触发同步（可 debounce）。
- 点击行 → 设为默认模型（仅写 `canonicalId`）。

---

## 8. 与现有 develop-static 的关系（仅说明）

- 当前是 **单 ProviderId + 单模型**；本草案是 **多供应商 + canonical 模型 + 映射表** 的演进方向。
- 迁移可阶段化：先并行写新结构，再切运行时解析。

---

## 9. 开放细节（实现阶段再定）

- OpenRouter 官方模型目录是否 **离线打包** 或 **定期拉取** 作为 canonical 母本。
- 未映射模型的兜底展示文案与是否允许用户「强制使用物理 id」。
- OAuth 供应商（如 OpenAI Codex）与 Key 线路并存时的 `enabled` 语义。

---

## 10. Superdesign 稿（仅设计，未改代码）

**项目**：[develop-static AI supplier model v1](https://app.superdesign.dev/teams/b30159c0-63e0-465f-ac9f-9e3f38c45ee7/projects/e0129b90-19ad-494a-b140-1f61fbbb9e09)

### 推荐：单入口 + 右侧标题行切换（与 §7 一致）

| 状态 | 预览 |
|------|------|
| 侧栏仅「模型与供应商」；标题行 **模型 \| 供应商**，**模型** 选中 + 扁平列表 | [打开预览](https://p.superdesign.dev/draft/dd5840f9-c77b-4ea9-9d31-b928a23f518e) |
| 同上壳，**供应商** 选中 + 原厂/聚合表单 | [打开预览](https://p.superdesign.dev/draft/e1146a9d-7884-4623-becc-fdfc37d8150e) |

### 早期稿（侧栏两项拆分，已弃用交互）

| 页面 | 预览 |
|------|------|
| AI 供应商（侧栏独立入口） | [打开预览](https://p.superdesign.dev/draft/9bf28dd8-8a5b-4830-b8db-155bce41d6f1) |
| AI 模型（侧栏独立入口） | [打开预览](https://p.superdesign.dev/draft/9ea881a1-97dd-4219-9258-d80e79e7e08b) |

设计说明见 `develop-static/.superdesign/design-brief-ai-two-pages.md`；统一标题切换提示词见 `prompt-ai-unified-header.txt`、`prompt-ai-unified-supplier-tab.txt`。
