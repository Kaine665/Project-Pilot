// 测试 understanding 提取逻辑

const testText = `好的！任务理解已确认。现在输出正式的任务理解：

\`\`\`json:understanding
{
  "project": "ELApp",
  "action": "为首页右上角的反馈表单实现截图上传功能，包括图片选择/拍照、压缩（≤2MB）、上传到腾讯云COS、缩略图预览和删除功能",
  "goal": "让用户在反馈流程的\\"填写内容\\"环节能够上传最多3张截图，更直观地描述问题",
  "deliverable": "1) 图片选择/拍照组件 2) 图片压缩逻辑 3) 腾讯云COS上传集成 4) 缩略图预览和删除UI 5) 与反馈提交逻辑的整合"
}
\`\`\`

---

✅ **Phase 1-2 完成**，进入 **Phase 3 - 制定计划**阶段。

现在我将制定执行计划。请稍候...`;

function extractUnderstandingFromText(text) {
  console.log('\n=== 开始测试提取逻辑 ===\n');
  console.log('输入文本长度:', text.length);

  const regex = /```json:understanding\s*\n([\s\S]*?)```/;
  console.log('使用正则:', regex);

  const match = text.match(regex);
  console.log('\n正则匹配结果:', match ? '成功' : '失败');

  if (!match) {
    console.log('\n❌ 正则匹配失败！');
    return null;
  }

  console.log('\n捕获的 JSON 字符串:');
  console.log('---');
  console.log(match[1]);
  console.log('---');

  try {
    const parsed = JSON.parse(match[1]);
    console.log('\n✅ JSON 解析成功！');
    console.log('解析结果:', JSON.stringify(parsed, null, 2));

    if (parsed.project && parsed.action && parsed.goal && parsed.deliverable) {
      console.log('\n✅ 所有必需字段都存在');
      return {
        project: parsed.project,
        action: parsed.action,
        goal: parsed.goal,
        deliverable: parsed.deliverable,
      };
    } else {
      console.log('\n❌ 缺少必需字段');
      console.log('project:', !!parsed.project);
      console.log('action:', !!parsed.action);
      console.log('goal:', !!parsed.goal);
      console.log('deliverable:', !!parsed.deliverable);
    }
  } catch (err) {
    console.log('\n❌ JSON 解析失败！');
    console.log('错误:', err.message);
  }

  return null;
}

const result = extractUnderstandingFromText(testText);
console.log('\n\n=== 最终结果 ===');
console.log(result);
