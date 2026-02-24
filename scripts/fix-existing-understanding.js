// 手动从现有对话记录中提取并保存 understanding

const fs = require('fs');
const path = require('path');

const taskId = 'task-1771205763787';

const conversationPath = path.join(__dirname, '../data/conversations', `${taskId}.json`);
const artifactsPath = path.join(__dirname, '../data/task-artifacts', `${taskId}.json`);

// 读取对话记录
const conversation = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));

// 找到包含 understanding 的消息
const targetMsg = conversation.messages.find(msg =>
  msg.role === 'assistant' && msg.content.includes('json:understanding')
);

if (!targetMsg) {
  console.log('未找到包含 understanding 的消息');
  process.exit(1);
}

// 提取 understanding
const regex = /```json:understanding\s*\n([\s\S]*?)```/;
const match = targetMsg.content.match(regex);

if (!match) {
  console.log('未匹配到 JSON 块');
  process.exit(1);
}

// 使用状态机转义
function escapeInnerQuotes(jsonStr) {
  const result = [];
  let inString = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const prev = i > 0 ? jsonStr[i - 1] : '';

    if (char === '"' && prev !== '\\') {
      if (!inString) {
        inString = true;
        result.push(char);
      } else {
        const nextNonSpace = jsonStr.slice(i + 1).match(/\S/);
        const nextChar = nextNonSpace ? nextNonSpace[0] : '';

        if (nextChar === ':') {
          inString = false;
          result.push(char);
        } else if (nextChar === ',' || nextChar === '}' || nextChar === '') {
          inString = false;
          result.push(char);
        } else {
          result.push('\\' + char);
        }
      }
    } else {
      result.push(char);
    }
  }

  return result.join('');
}

const sanitized = escapeInnerQuotes(match[1]);
const parsed = JSON.parse(sanitized);

const understanding = {
  project: parsed.project,
  action: parsed.action,
  goal: parsed.goal,
  deliverable: parsed.deliverable,
};

console.log('✅ 成功提取 understanding:');
console.log(JSON.stringify(understanding, null, 2));

// 保存到 artifacts 文件
const artifacts = {
  taskId,
  understanding,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2), 'utf-8');

console.log('\n✅ 已保存到:', artifactsPath);
console.log('\n现在刷新浏览器页面，应该能在右侧栏看到任务理解了！');
