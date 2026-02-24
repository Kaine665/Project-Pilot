# Bug修复报告：计划格式错误

## 问题现象

用户在前端看到"计划格式错误"的错误提示，而不是正常渲染的执行计划。

## 根本原因

### 1. AI 输出的 JSON 格式错误

AI 在生成 ````json:plan` 代码块时，在字符串值中使用了**未转义的 ASCII 双引号**。

**错误示例**（第 64 行）：
```json
{
  "description": "创建 src/components/molecules/ImageUploader.tsx：
- Props: onImagesChange(urls: string[])
- 功能：
  1. 显示"添加图片"按钮（最多3张时隐藏）
  2. 点击弹出选项：拍照 / 从相册选择
  ..."
}
```

**问题位置**：
```
1. 显示"添加图片"按钮
       ↑     ↑
   未转义的双引号导致 JSON 解析器认为字符串在这里结束
```

### 2. JSON.parse 解析失败

前端组件 `PlanRenderer` (src/components/plan-renderer.tsx:32) 尝试解析 JSON 时抛出异常：

```
Expected ',' or '}' after property value in JSON at position 3203 (line 64 column 127)
```

解析器认为字符串在"显示"后的双引号处结束，但接下来是"添加图片"而不是逗号或右括号，因此报错。

### 3. 错误处理显示

```typescript
try {
  plan = JSON.parse(planJson);
} catch (e) {
  return (
    <div className="...">
      计划格式错误  // 用户看到这个
    </div>
  );
}
```

## 引号配对分析

第 64 行的 6 个双引号：

| # | 位置 | 类型 | 上下文 | 状态 |
|---|------|------|--------|------|
| 1 | 6 | 普通 | `"description"` | ✅ 字段名开始 |
| 2 | 18 | 普通 | `description": "创建...` | ✅ 字段名结束 |
| 3 | 21 | 普通 | `": "创建 src/...` | ✅ 值开始 |
| 4 | 125 | **未转义** | `显示"添加图片` | ❌ **解析器误认为值结束** |
| 5 | 130 | **未转义** | `添加图片"按钮` | ❌ 解析器困惑 |
| 6 | 266 | 普通 | `进度条",` | ✅ 值结束 |

解析器的理解：
- 字符串 1：`"description"` (6→18) ✅
- 字符串 2：`"创建...显示"` (21→125) ❌ 提前结束
- 期望：`,` 或 `}`
- 实际：`添加图片` → 💥 语法错误！

## 解决方案

### ✅ 已修复：更新 AI Prompt

修改文件：`src/lib/prompt-builder.ts`

**添加了 JSON 格式规则说明**：

```typescript
**重要：JSON 格式规则**
- 字符串值中的双引号必须转义：使用 \\" 而不是 "
- 示例错误：\`"description": "显示"添加图片"按钮"\` ❌
- 示例正确：\`"description": "显示\\"添加图片\\"按钮"\` ✅
- 或使用中文引号：\`"description": "显示「添加图片」按钮"\` ✅
```

### 推荐做法

1. **使用中文引号**（最简单）：
   ```json
   "description": "创建「ImageUploader」组件"
   ```

2. **转义 ASCII 双引号**：
   ```json
   "description": "创建\\"ImageUploader\\"组件"
   ```

3. **避免使用引号**：
   ```json
   "description": "创建 ImageUploader 组件"
   ```

## 预防措施

### 1. 前端：添加更详细的错误提示

修改 `src/components/plan-renderer.tsx`，显示具体的解析错误：

```tsx
try {
  plan = JSON.parse(planJson);
} catch (e) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
      <div className="text-sm font-semibold text-red-700 dark:text-red-400">
        计划格式错误
      </div>
      <div className="mt-1 text-xs text-red-600 dark:text-red-500">
        {e.message}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-red-600 dark:text-red-500">
          查看原始 JSON
        </summary>
        <pre className="mt-2 overflow-auto rounded bg-red-100 p-2 text-xs dark:bg-red-900/40">
          {planJson.substring(0, 500)}...
        </pre>
      </details>
    </div>
  );
}
```

### 2. 后端：添加 JSON 验证

在保存计划之前验证 JSON 格式：

```typescript
// src/lib/plan-extractor.ts
export function validatePlanJson(jsonString: string): { valid: boolean; error?: string } {
  try {
    const plan = JSON.parse(jsonString);

    // 验证必需字段
    if (!plan.analysis || !Array.isArray(plan.steps)) {
      return { valid: false, error: '缺少必需字段 (analysis 或 steps)' };
    }

    // 验证 steps 格式
    for (const step of plan.steps) {
      if (!step.id || !step.type || !step.action) {
        return { valid: false, error: `步骤 ${step.id || '?'} 缺少必需字段` };
      }
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
```

### 3. 测试用例

添加 JSON 转义测试：

```typescript
// tests/plan-parser.test.ts
describe('Plan JSON Parser', () => {
  it('应该正确处理包含双引号的描述', () => {
    const planJson = `{
      "analysis": "测试分析",
      "steps": [{
        "id": 1,
        "type": "auto",
        "action": "创建组件",
        "description": "创建\\"ImageUploader\\"组件",
        "status": "pending",
        "risk_level": "low"
      }]
    }`;

    const plan = JSON.parse(planJson);
    expect(plan.steps[0].description).toBe('创建"ImageUploader"组件');
  });
});
```

## 影响范围

- **用户体验**：用户看到"计划格式错误"而不是具体计划
- **功能**：计划生成功能完全不可用
- **数据**：已保存的错误格式计划无法被渲染

## 测试验证

修复后需要测试：

1. ✅ AI 生成的新计划 JSON 格式正确
2. ✅ 包含引号的描述能够正确解析
3. ✅ 前端 PlanRenderer 能够正常渲染
4. ✅ 错误情况下显示详细错误信息

## 相关文件

- `src/lib/prompt-builder.ts` - AI prompt 定义（已修复）
- `src/components/plan-renderer.tsx` - 计划渲染组件
- `src/components/formatted-text.tsx` - 文本格式化组件
- `data/conversations/task-1771205763787.json` - 包含错误计划的对话记录

## 总结

问题的根源是 AI 在生成 JSON 时没有正确转义字符串值中的双引号。修复方法是在 AI 的 system prompt 中明确说明 JSON 格式规则，并提供正确和错误的示例。

**修复时间**：2026-02-16
**状态**：✅ 已修复 prompt，等待验证
