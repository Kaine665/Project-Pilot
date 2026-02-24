// 测试最终修复后的提取逻辑

const testJSON = `{
  "project": "ELApp",
  "action": "为首页右上角的反馈表单实现截图上传功能，包括图片选择/拍照、压缩（≤2MB）、上传到腾讯云COS、缩略图预览和删除功能",
  "goal": "让用户在反馈流程的"填写内容"环节能够上传最多3张截图，更直观地描述问题",
  "deliverable": "1) 图片选择/拍照组件 2) 图片压缩逻辑 3) 腾讯云COS上传集成 4) 缩略图预览和删除UI 5) 与反馈提交逻辑的整合"
}`;

console.log('=== 原始 JSON（包含中文引号）===');
console.log(testJSON);
console.log('\n');

// 策略：替换中文引号为英文单引号
const sanitized = testJSON
  .replace(/"/g, "'")  // 左引号
  .replace(/"/g, "'"); // 右引号

console.log('=== 预处理后（中文引号 → 英文单引号）===');
console.log(sanitized);
console.log('\n');

try {
  const parsed = JSON.parse(sanitized);
  console.log('✅ JSON 解析成功！');
  console.log('\n=== 解析结果 ===');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('❌ JSON 解析失败:',err.message);
}
