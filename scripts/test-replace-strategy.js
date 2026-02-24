// 测试不同的替换策略

const testJSON = `{
  "project": "ELApp",
  "action": "为首页右上角的反馈表单实现截图上传功能，包括图片选择/拍照、压缩（≤2MB）、上传到腾讯云COS、缩略图预览和删除功能",
  "goal": "让用户在反馈流程的"填写内容"环节能够上传最多3张截图，更直观地描述问题",
  "deliverable": "1) 图片选择/拍照组件 2) 图片压缩逻辑 3) 腾讯云COS上传集成 4) 缩略图预览和删除UI 5) 与反馈提交逻辑的整合"
}`;

console.log('=== 策略1: 替换为空格 ===\n');
try {
  const s1 = testJSON
    .replace(/"/g, ' ')  // 左引号 → 空格
    .replace(/"/g, ' '); // 右引号 → 空格
  const parsed = JSON.parse(s1);
  console.log('✅ 成功！');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('❌ 失败:', err.message);
}

console.log('\n=== 策略2: 替换为【】 ===\n');
try {
  const s2 = testJSON
    .replace(/"/g, '【')  // 左引号 → 【
    .replace(/"/g, '】'); // 右引号 → 】
  const parsed = JSON.parse(s2);
  console.log('✅ 成功！');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('❌ 失败:', err.message);
}

console.log('\n=== 策略3: 移除（替换为空字符串）===\n');
try {
  const s3 = testJSON
    .replace(/"/g, '')  // 左引号 → 空
    .replace(/"/g, ''); // 右引号 → 空
  const parsed = JSON.parse(s3);
  console.log('✅ 成功！');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('❌ 失败:', err.message);
}
