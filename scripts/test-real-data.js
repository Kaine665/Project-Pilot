// 从实际对话记录中测试

const fs = require('fs');
const path = require('path');

const conversationPath = path.join(__dirname, '../data/conversations/task-1771205763787.json');
const conversation = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));

// 找到包含 understanding 的消息
const targetMsg = conversation.messages.find(msg =>
  msg.role === 'assistant' && msg.content.includes('json:understanding')
);

if (!targetMsg) {
  console.log('未找到目标消息');
  process.exit(1);
}

const regex = /```json:understanding\s*\n([\s\S]*?)```/;
const match = targetMsg.content.match(regex);

if (!match) {
  console.log('未匹配到 JSON 块');
  process.exit(1);
}

const originalJSON = match[1];

console.log('=== 原始 JSON ===');
console.log(originalJSON);
console.log('\n');

// 分析字符
console.log('=== 字符分析 ===');
const goalLine = originalJSON.split('\n').find(line => line.includes('goal'));
console.log('goal 行:', goalLine);
console.log('\n字符编码:');
for (let i = 0; i < goalLine.length; i++) {
  const char = goalLine[i];
  const code = char.charCodeAt(0);
  if (code > 127 || char === '"' || char === "'") {
    console.log(`  [${i}] '${char}' = U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
  }
}

console.log('\n\n=== 测试策略 ===\n');

// 策略1: 移除中文引号
console.log('策略1: 移除中文引号（U+201C 和 U+201D）');
try {
  const s1 = originalJSON
    .replace(/\u201C/g, '')  // LEFT DOUBLE QUOTATION MARK
    .replace(/\u201D/g, ''); // RIGHT DOUBLE QUOTATION MARK
  console.log('预处理后:');
  console.log(s1);
  const parsed = JSON.parse(s1);
  console.log('\n✅ 成功！');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('\n❌ 失败:', err.message);
}
