# ADR-0001: Agent Prompt 回归测试体系（Eval Suite）

- **状态**: Proposed
- **日期**: 2026-04-08

## 背景

修改 Agent 的 system prompt 或 skill 后，无法确认是否引入回归。当前 PP 无自动化测试，prompt 质量零验证。

核心矛盾：prompt 改动的效果是**运行时**的、情境化的，传统 benchmark 不适用。

## 决策

### 分阶段实现 Eval Suite

#### 阶段 1（优先）：开发者自测 Case

- 目录结构：`~/.project-pilot/evals/{agentId}/cases/`
- 每个 case 定义 `{ input, expectedBehaviors, rubric }`
- `expectedBehaviors` 为行为断言（`shouldCallTool`、`shouldContain`、`shouldNotContain`、`shouldDelegateToAgent`）
- 提供 CLI 命令：用新旧 prompt 分别跑同一组 case，输出 A/B 对比报告
- Case 来源：**手动积累**——从真实对话中提取做得好/做得差的场景

#### 阶段 2：自动提取 Case

- 从历史对话记录（`agent-chat-sessions.json`）中，让 Judge Agent 自动提取可复用 eval case
- 好对话 → 正例，差对话 → 反例
- 补充：从 prompt 规则推导测试场景（规则变更 → 针对变化部分生成 case）

#### 阶段 3：用户自动验证

- 用户修改 prompt 后，系统自动跑相关 case 并展示回归报告
- 运行时金丝雀：异步 Judge Agent 评估真实对话质量
- 指标连续低于阈值时，利用已有 `.history/` 自动回退

### 自动生成测试用例的三种方法

1. **历史对话提取**（最实际）：从会话记录中提取核心考验点
2. **Prompt 规则推导**（变更验证）：解析 prompt 的行为规则，为每条生成场景
3. **对抗性生成**（找漏洞）：Red Team Agent 尝试触发 Agent 犯错

## 后果

- 每次 prompt 改动有可量化的回归检查
- Case 库随使用自然增长
- Judge Agent 复用现有 Agent 架构，无额外基础设施成本
