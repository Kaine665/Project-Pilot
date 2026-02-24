// 从实际的对话记录中提取 understanding

const fs = require('fs');
const path = require('path');

const conversationPath = path.join(__dirname, '../data/conversations/task-1771205763787.json');
const conversation = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));

console.log('=== 对话记录分析 ===\n');
console.log(`总共 ${conversation.messages.length} 条消息\n`);

function extractUnderstandingFromText(text) {
  const regex = /```json:understanding\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.project && parsed.action && parsed.goal && parsed.deliverable) {
      return {
        project: parsed.project,
        action: parsed.action,
        goal: parsed.goal,
        deliverable: parsed.deliverable,
      };
    }
  } catch (err) {
    console.error('JSON 解析错误:', err.message);
    console.error('JSON 字符串:', match[1]);
  }
  return null;
}

// 检查每条 assistant 消息
conversation.messages.forEach((msg, index) => {
  if (msg.role !== 'assistant') return;

  console.log(`\n--- 消息 #${index + 1} (${msg.id}) ---`);
  console.log(`时间: ${msg.timestamp}`);
  console.log(`内容长度: ${msg.content.length} 字符`);
  console.log(`是否包含 json:understanding: ${msg.content.includes('json:understanding')}`);
  console.log(`是否包含代码块: ${msg.content.includes('```')}`);

  if (msg.content.includes('json:understanding')) {
    console.log('\n尝试提取 understanding...');
    const understanding = extractUnderstandingFromText(msg.content);

    if (understanding) {
      console.log('✅ 提取成功！');
      console.log(JSON.stringify(understanding, null, 2));
    } else {
      console.log('❌ 提取失败');

      // 显示代码块部分
      const codeBlockMatch = msg.content.match(/```json:understanding[\s\S]*?```/);
      if (codeBlockMatch) {
        console.log('\n找到的代码块:');
        console.log(codeBlockMatch[0].substring(0, 500));
      }
    }
  }
});

console.log('\n\n=== 检查 artifacts 文件 ===');
const artifactsPath = path.join(__dirname, '../data/task-artifacts/task-1771205763787.json');
if (fs.existsSync(artifactsPath)) {
  const artifacts = JSON.parse(fs.readFileSync(artifactsPath, 'utf-8'));
  console.log('✅ artifacts 文件存在');
  console.log(JSON.stringify(artifacts, null, 2));
} else {
  console.log('❌ artifacts 文件不存在');
}
