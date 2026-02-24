// 使用状态机处理 JSON 中未转义的双引号

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
 * 使用状态机转义字符串值内部的双引号
 */
function escapeInnerQuotes(jsonStr) {
  const result = [];
  let inString = false;
  let stringStart = -1;
  let colonPassed = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const prev = i > 0 ? jsonStr[i - 1] : '';

    if (char === '"' && prev !== '\\') {
      if (!inString) {
        // 进入字符串
        inString = true;
        stringStart = i;
        colonPassed = false;
        result.push(char);
      } else {
        // 可能退出字符串，检查后面是否是冒号或逗号/}
        const nextNonSpace = jsonStr.slice(i + 1).match(/\S/);
        const nextChar = nextNonSpace ? nextNonSpace[0] : '';

        if (nextChar === ':') {
          // 这是属性名的结束引号
          inString = false;
          result.push(char);
        } else if (nextChar === ',' || nextChar === '}' || nextChar === '') {
          // 这是属性值的结束引号
          inString = false;
          result.push(char);
        } else {
          // 这是属性值内部的引号，需要转义
          result.push('\\' + char);
        }
      }
    } else if (char === ':' && !inString) {
      colonPassed = true;
      result.push(char);
    } else {
      result.push(char);
    }
  }

  return result.join('');
}

console.log('=== 修复后的 JSON ===');
const fixed = escapeInnerQuotes(originalJSON);
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
