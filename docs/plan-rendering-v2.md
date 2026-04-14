# 计划渲染改进 v2 - 友好的文本格式

## 问题

之前 AI 在聊天中输出执行计划时，使用的是原始 JSON 格式，对用户不友好：

```json
{
  "analysis": "任务分析：\n1. ...",
  "steps": [...]
}
```

用户很难阅读这种格式。

## 解决方案

创建了 `PlanRenderer` 组件，自动检测并美化渲染计划。

### 1. 新增 PlanRenderer 组件

文件：[src/components/plan-renderer.tsx](../src/components/plan-renderer.tsx)

功能：
- ✅ 解析 JSON 格式的计划数据
- ✅ 渲染为卡片式布局
- ✅ 显示任务分析（📋）
- ✅ 显示执行步骤（🔧），包含：
  - 步骤编号
  - 自动/手动/确认标签
  - 风险等级标签（高/中/低）
  - 格式化的描述文本
- ✅ 显示预期结果（✅）
- ✅ 显示风险评估（⚠️）

### 2. 改进 FormattedText 组件

文件：[src/components/formatted-text.tsx](../src/components/formatted-text.tsx)

新增功能：
- 自动检测 `\`\`\`json:plan` 代码块
- 提取其中的 JSON 数据
- 使用 PlanRenderer 渲染
- 其余内容继续使用 FormattedText 渲染

## 使用效果

### AI 输出（Markdown 格式）

```
现在我为您输出执行计划：

\`\`\`json:plan
{
  "analysis": "任务分析：\n1. 反馈表单位于 **FeedbackScreen.tsx**...",
  "steps": [...],
  "expected_results": "...",
  "risks": "..."
}
\`\`\`

这个计划包含 2 个步骤...
```

### 用户看到的效果

一个美观的卡片，包含：

📋 **任务分析**
- 反馈表单位于 **FeedbackScreen.tsx** (行172跳转到该页面)
- 腾讯云 COS 配置已存在于 `release.ts` 中

🔧 **执行步骤 (2 步)**

**1** 创建 git 分支 ⚡ 自动
   - 分支名：`task/feedback-image-upload`
   - 基于最新的 **main** 分支

**2** 测试完整流程 👤 手动 🔴 高风险
   1. 拍照功能
   2. 相册选择

✅ **预期结果**
1. 在反馈表单中点击**添加图片**按钮
2. 选择拍照或从相册选择图片

⚠️ **风险评估**
1. **【中等】**COS REST API 签名计算复杂

## 测试

1. 访问任务页面：http://localhost:4287/tasks/task-1771205763787
2. 滚动到最新的消息
3. 你应该能看到一个格式化的计划卡片

## 技术细节

### 检测逻辑

```typescript
const planMatch = text.match(/```json:plan\s*\n([\s\S]*?)```/);
```

### 递归渲染

如果文本中包含多个部分：
1. 计划前的文本 → FormattedText
2. 计划 → PlanRenderer
3. 计划后的文本 → FormattedText（递归）

### 样式

- 使用卡片布局（border + background）
- 步骤使用带编号的圆形图标
- 类型标签：⚡ 自动、👤 手动、❓ 确认
- 风险标签：🔴 高风险、🟡 中风险

## 优势

✅ 用户友好 - 不需要理解 JSON 格式
✅ 层次清晰 - 分析、步骤、结果、风险分块展示
✅ 视觉引导 - 图标和颜色标记重点信息
✅ 格式化支持 - 继承 FormattedText 的加粗、代码、列表功能
