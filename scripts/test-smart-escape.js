// 智能转义：只转义字符串值内部的双引号

const fs = require('fs');
const path = require('path');

const conversationPath = path.join(__dirname, '../data/conversations/task-1771205763787.json');
const conversation = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));

const targetMsg = conversation.messages.find(msg =>
  msg.role === 'assistant' && msg.content.includes('json:understanding')
);

const regex = /```json:understanding\s*\n([\s\S]*?)```/;
const match = targetMsg.content.match(regex);
const originalJSON = match[1];

console.log('=== 原始 JSON ===');
console.log(originalJSON);
console.log('\n');

/**
 * 策略：使用正则表达式找到所有 "key": "value" 模式，
 * 然后只在 value 部分转义双引号
 */
function fixJSON(jsonStr) {
  // 匹配 "key": "value" 模式
  return jsonStr.replace(/"([^"]+)":\s*"([^"]*)"/g, (match, key, value) => {
    // 在 value 中转义双引号
    const fixedValue = value.replace(/"/g, '\\"');
    return `"${key}": "${fixedValue}"`;
  });
}

console.log('=== 修复后的 JSON ===');
const fixed = fixJSON(originalJSON);
console.log(fixed);
console.log('\n');

try {
  const parsed = JSON.parse(fixed);
  console.log('✅ JSON 解析成功！');
  console.log('\n=== 解析结果 ===');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('❌ JSON 解析失败:', err.message);
}
