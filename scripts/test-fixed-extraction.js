// 测试修复后的提取逻辑

const fs = require('fs');
const path = require('path');

const conversationPath = path.join(__dirname, '../data/conversations/task-1771205763787.json');
const conversation = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));

function extractUnderstandingFromText(text) {
  const regex = /```json:understanding\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    // 预处理：将中文全角引号替换为转义的英文引号，避免 JSON 解析错误
    const sanitized = match[1]
      .replace(/"/g, '\\"')  // 左引号
      .replace(/"/g, '\\"'); // 右引号

    console.log('\n=== 预处理后的 JSON ===');
    console.log(sanitized);
    console.log('\n=== 开始解析 ===');

    const parsed = JSON.parse(sanitized);

    console.log('✅ JSON 解析成功！');
    console.log('解析结果:', JSON.stringify(parsed, null, 2));

    if (parsed.project && parsed.action && parsed.goal && parsed.deliverable) {
      console.log('✅ 所有字段验证通过');
      return {
        project: parsed.project,
        action: parsed.action,
        goal: parsed.goal,
        deliverable: parsed.deliverable,
      };
    }
  } catch (err) {
    console.error('❌ JSON 解析错误:', err.message);
    console.error('原始 JSON:', match[1]);
  }
  return null;
}

// 找到包含 understanding 的消息
const targetMsg = conversation.messages.find(msg =>
  msg.role === 'assistant' && msg.content.includes('json:understanding')
);

if (targetMsg) {
  console.log('找到包含 understanding 的消息:', targetMsg.id);
  console.log('时间:', targetMsg.timestamp);
  console.log('\n开始提取...\n');

  const result = extractUnderstandingFromText(targetMsg.content);

  if (result) {
    console.log('\n\n=== 最终提取结果 ===');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n\n=== 提取失败 ===');
  }
} else {
  console.log('未找到包含 understanding 的消息');
}
