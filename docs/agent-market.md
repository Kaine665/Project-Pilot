# Agent 平台/市场调研报告

> 调研时间：2026-02-25

## 调研目的

评估市面上 Agent 平台的生态格局，了解各平台的 Agent 导出/导入能力，为 ProjectPilot 的 Agent 导入功能提供决策依据。

---

## 一、市场全景

2025 年被视为"AI Agent 元年"。据 Gartner 预测，至 2026 年超 80% 企业将部署 AI Agent 架构。Agent Store/Marketplace 正在成为新的流量入口和商业生态。

参与者可分为三个梯队：

### 第一梯队：云巨头

| 平台 | 特点 |
|------|------|
| AWS Marketplace - AI Agents | 企业级，与 AWS 生态绑定 |
| Google AI Agent Space | 推 A2A（Agent-to-Agent）协议，强调 Agent 间通信 |
| Microsoft Magentic Marketplace | 基于 AutoGen 框架 |

特征：重基础设施，闭环生态，不提供通用导出格式。

### 第二梯队：开发者平台

| 平台 | 导出格式 | 对接可行性 |
|------|---------|-----------|
| Dify | 自有 DSL 格式，支持 OpenAPI 工具导入 | 中等 — DSL 可解析但包含 workflow DAG，比纯 prompt 复杂 |
| Coze（扣子）| 开源了 Coze Studio，发布为 API 服务 + Token 认证 | 中等 — 可通过 API 调用，但 Agent 配置格式私有 |
| MuleRun | 框架无关（LangChain/n8n/Flowise/ADK），OpenAI 兼容 API | 低 — 是运行时市场，不导出 Agent 配置 |

### 第三梯队：Agent 目录/商店

| 平台 | 模式 |
|------|------|
| AI Agent Store | 目录式，汇总各平台 Agent，链接到原始平台 |
| Kore.ai Marketplace | 200+ 企业模板，闭环在自己平台内 |
| Moveworks Marketplace | IT/HR 领域 Agent，企业 SaaS |

### 国内平台

智谱 AutoGLM、字节豆包、百度文心等都有 Agent 创建功能，但基本没有标准化的导出/共享格式。

---

## 二、各平台 Agent 导出/导入能力详情

### Dify

- **导出格式**：Domain Specific Language (DSL)，包含 workflow 节点图
- **工具导入**：支持 OpenAPI/Swagger 和 OpenAI Plugin 标准
- **API**：所有功能 API-ready，可集成到外部应用
- **Agent 策略**：发布了开放标准，任何开发者可贡献策略插件
- **可移植性**：DSL 可在 Dify 工作区之间导入导出

### Coze（扣子）

- **开源情况**：Coze Studio 已开源
- **API 发布**：Agent 可发布为 API 服务，通过 Personal Access Token 认证
- **插件导入**：可注册外部 API 为插件，在 workflow 中调用
- **配置格式**：私有格式，workflow + plugin 组合
- **模型支持**：openai、ark、deepseek、ollama、qwen

### MuleRun

- **定位**：全球首个 AI Agent 交易市场，上线一个月用户数突破 50 万
- **框架无关**：支持 ADK、LangGraph、n8n、Flowise 等
- **API 兼容**：LLM APIs 均 OpenAI 兼容
- **商业模式**：按调用收费，创作者获 80%+ 收入
- **局限**：是运行时市场——你调用别人的 Agent，不是下载配置到本地

---

## 三、协议与标准

当前没有统一的 Agent 配置格式标准。存在的是 Agent **通信**协议：

| 协议 | 推动者 | 用途 |
|------|--------|------|
| MCP (Model Context Protocol) | Anthropic | 模型与工具之间的上下文协议 |
| A2A (Agent-to-Agent) | Google | Agent 间通信标准 |
| ACP (Agentic Commerce Protocol) | OpenAI + Stripe | Agent 商业交易协议 |
| UCP (Universal Commerce Protocol) | Google 联盟 | 通用商业协议 |

**关键发现**：这些协议解决的是"Agent 如何与外部交互"，不是"Agent 如何定义和移植"。

---

## 四、核心结论

1. **没有通用的 Agent 配置导出标准** — 每个平台格式都不同
2. **大多数平台不支持"下载 Agent 到本地"** — 商业模式是让 Agent 运行在他们的服务器上按调用收费
3. **真正能导出的只有 Dify（DSL）和 Coze Studio（开源）**，但格式都包含平台特有的 workflow/plugin 结构，远比纯 system prompt + capabilities 复杂
4. **行业标准尚未形成** — 目前是各平台各自为政的阶段

---

## 五、对 ProjectPilot 的启示

### 推荐路径

**第一步：定义自己的 `.agent.json` schema，实现导入/导出**

ProjectPilot 的 Agent 定义（name + description + systemPrompt + icon + capabilities）是一个简洁、自包含的格式。先让 Agent 能在 ProjectPilot 实例之间流通。

**第二步：按需写适配器**

如果未来需要对接 Dify 或 Coze，写特定的格式转换器把它们的 DSL/配置转成 ProjectPilot 的 Agent schema。

**第三步：等行业标准再对齐**

Agent 配置标准一旦出现（可能由 OpenAI、Google 或开源社区主导），再跟进对齐。现在过早投入对接特定平台的 ROI 不高。

---

## 参考链接

- [AI Agent Store](https://aiagentstore.ai)
- [Microsoft Magentic Marketplace](https://thenewstack.io/microsoft-launches-magentic-marketplace-for-ai-agents/)
- [Dify Agent 文档](https://docs.dify.ai/en/guides/application-orchestrate/agent)
- [Coze Studio API Reference](https://github.com/coze-dev/coze-studio/wiki/6.-API-Reference)
- [MuleRun](https://mulerun.com/)
- [Kore.ai Marketplace](https://www.kore.ai/ai-marketplace)
- [AWS AI Agents Marketplace](https://aws.amazon.com/about-aws/whats-new/2025/07/ai-agents-tools-aws-marketplace/)
- [知乎 - 2025年AI Agent行业深度](https://zhuanlan.zhihu.com/p/32153171603)
- [量子位 - MuleRun 2.0](https://www.qbitai.com/2025/11/351891.html)
- [Slashdot - Top AI Agent Marketplaces 2026](https://slashdot.org/software/ai-agent-marketplaces/)
