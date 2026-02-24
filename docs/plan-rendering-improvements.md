# 执行计划渲染改进

## 改进内容

### 1. 创建了轻量文本格式化组件 `FormattedText`

文件位置：[src/components/formatted-text.tsx](../src/components/formatted-text.tsx)

支持的格式：
- **加粗文本** - 使用 `**text**` 语法
- `代码片段` - 使用 `` `text` `` 语法
- 无序列表 - 使用 `- item` 语法
- 有序列表 - 使用 `1. item` 语法
- 自动换行 - 识别 `\n` 换行符
- 空行间距 - 空行会渲染为间隔

### 2. 改进了 `PlanCard` 组件的渲染

文件位置：[src/components/plan-card.tsx](../src/components/plan-card.tsx)

#### 改进点：

**折叠状态下**：
- `analysis` 字段使用 `FormattedText` 渲染，支持加粗、列表等格式
- 自动截断显示（line-clamp-3），点击展开查看完整内容

**展开状态下**：
- ✅ 显示完整的 `analysis`（任务分析）
- ✅ 步骤的 `description` 使用 `FormattedText` 渲染，支持多行、列表
- ✅ 显示 `expected_results`（预期结果）- 新增
- ✅ 显示 `risks`（风险评估）- 新增
- ✅ 步骤增加"手动"标签，区分自动和手动步骤

### 3. 渲染效果对比

#### 之前：
```
任务分析：
1. 反馈表单位于 FeedbackScreen.tsx (行172跳转到该页面)
2. 腾讯云 COS 配置已存在于 release.ts 中，使用 cos-nodejs-sdk-v5
```
纯文本，没有格式，难以阅读。

#### 现在：
```
任务分析：
1. 反馈表单位于 FeedbackScreen.tsx (行172跳转到该页面)
2. 腾讯云 COS 配置已存在于 release.ts 中，使用 cos-nodejs-sdk-v5
```
- 数字列表自动渲染
- **加粗文字**会高亮显示
- 多行文本正确分段
- 代码片段有背景色

### 4. 展开后显示的新增内容

#### 预期结果
展开计划卡片后，会在步骤列表下方显示"预期结果"部分，格式化渲染用户可以完成的操作列表。

#### 风险评估
在预期结果下方，显示"风险评估"部分，使用列表格式清晰展示各项风险。

## 使用示例

在 AI 返回的计划 JSON 中：

```json
{
  "analysis": "任务分析：\n1. 反馈表单位于 **FeedbackScreen.tsx**\n2. 需要使用 `cos-nodejs-sdk-v5`\n3. 但该 SDK 是 Node.js 环境专用",
  "steps": [
    {
      "id": 1,
      "type": "auto",
      "action": "创建 git 分支",
      "description": "从 main 分支拉出临时分支：\n- 分支名：task/feedback-upload\n- 基于最新的 main 分支"
    }
  ],
  "expected_results": "完成后用户可以：\n1. 在反馈表单中点击**添加图片**按钮\n2. 选择拍照或从相册选择图片（最多3张）\n3. 图片自动压缩到 ≤2MB",
  "risks": "风险评估：\n1. **【中等】**COS REST API 签名计算复杂\n2. **【低】**权限请求可能被用户拒绝"
}
```

会被渲染为：

- 加粗的文字（如 **FeedbackScreen.tsx**）会高亮
- 代码片段（如 `cos-nodejs-sdk-v5`）有背景色
- 列表项自动缩进，带有项目符号
- 多行描述自动分段

## 测试

1. 启动开发服务器：`npm run dev`
2. 访问 http://localhost:4000
3. 打开任意任务，生成执行计划
4. 查看计划卡片的渲染效果

## 注意事项

- 组件**不会渲染大标题**（避免视觉混乱）
- 只处理常用的格式：加粗、代码、列表
- 保持轻量，不依赖第三方 markdown 库
