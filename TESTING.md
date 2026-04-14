# 测试格式化文本渲染

## 测试步骤

1. **确保开发服务器在运行**
   ```bash
   npm run dev
   ```

2. **打开浏览器并清除缓存**
   - Chrome: Ctrl+Shift+Delete → 清除缓存
   - 或者使用无痕模式: Ctrl+Shift+N

3. **访问测试任务**
   - 打开 http://localhost:4287/tasks/task-1771205763787
   - 这是"截图/附件上传"任务

4. **查看计划列表**
   - 应该能看到一个名为"计划 v1"的卡片
   - 状态显示为"待审批"

5. **点击展开按钮**（卡片右上角的箭头）
   - 应该能看到：
     - ✅ 加粗的文字（如 **FeedbackScreen.tsx**）显示为深色字体
     - ✅ 代码片段（如 `release.ts`）有灰色背景
     - ✅ 数字列表自动缩进，带编号
     - ✅ 无序列表带项目符号 •
     - ✅ 多行文本正确分段
     - ✅ "预期结果"和"风险评估"独立展示

## 如果还是没有变化

1. **检查浏览器控制台**
   - F12 打开开发者工具
   - 查看 Console 标签是否有错误

2. **强制刷新**
   - Ctrl+Shift+R (Windows)
   - 或 Ctrl+F5

3. **检查文件是否保存**
   ```bash
   # 检查 FormattedText 组件
   cat src/components/formatted-text.tsx | head -5

   # 应该看到第一行是: import React from 'react';
   ```

4. **重启开发服务器**
   - Ctrl+C 停止
   - npm run dev 重新启动

## 测试数据位置

测试计划数据已添加到：
- 文件：`data/ai-plans.json`
- plan_id：`plan-test-formatted-text`
- 关联任务：`task-1771205763787`（截图/附件上传）

## 预期效果截图

展开后应该看到类似这样的效果：

```
任务分析：
1. 反馈表单位于 FeedbackScreen.tsx (行172跳转到该页面)
   ^^^^^^^^加粗^^^^^^^^^
2. 腾讯云 COS 配置已存在于 release.ts 中，使用 cos-nodejs-sdk-v5
                        ^^^代码背景^^^         ^^^^^^加粗^^^^^^
3. 但 cos-nodejs-sdk-v5 是 Node.js SDK，不能在 React Native 中使用

需要使用 React Native 兼容的方式上传到腾讯云 COS。
```

步骤详情：
```
#1 创建 git 分支
从 main 分支拉出临时分支：
• 分支名：task/feedback-image-upload
       ^^^代码背景^^^
• 基于最新的 main 分支
         ^^^加粗^^
• 确保工作目录干净
```
