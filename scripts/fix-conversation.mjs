import fs from 'fs';
import path from 'path';

const filePath = path.join(
  process.cwd(),
  'data/conversations/task-feedback-history.json',
);

const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

// IDs of duplicate user messages to remove
// msg-1770992280735: 2nd "实现查看历史反馈记录功能" (user repeated input)
// msg-1770994623462: 4th "实现查看历史反馈记录功能" (user repeated input)
// msg-1771026541959: 5th "实现查看历史反馈记录功能" (user repeated input)
const duplicateUserMsgIds = new Set([
  'msg-1770992280735',
  'msg-1770994623462',
  'msg-1771026541959',
]);

// The assistant message that responded to the 2nd duplicate needs cleanup
// msg-1770992342277: had 3 identical failed AskUserQuestion calls
const askUserCleanupMsgId = 'msg-1770992342277';

const cleaned = [];

for (const msg of data.messages) {
  // Skip duplicate user messages
  if (duplicateUserMsgIds.has(msg.id)) {
    console.log(`Removed duplicate user message: ${msg.id} "${msg.content.slice(0, 40)}"`);
    continue;
  }

  // Clean up assistant messages
  if (msg.role === 'assistant') {
    // 1. Remove redundant top-level toolCalls (contentBlocks has the full ordered data)
    if (msg.toolCalls && msg.contentBlocks) {
      delete msg.toolCalls;
    }

    // 2. For the AskUserQuestion spam message, deduplicate failed calls
    if (msg.id === askUserCleanupMsgId && msg.contentBlocks) {
      const seen = new Set();
      msg.contentBlocks = msg.contentBlocks.filter(block => {
        if (block.type === 'tool_call' && block.toolCall?.toolName === 'AskUserQuestion') {
          const key = block.toolCall.input;
          if (seen.has(key)) {
            console.log(`Removed duplicate AskUserQuestion call in ${msg.id}`);
            return false;
          }
          seen.add(key);
        }
        return true;
      });

      // Also fix the content summary to remove reference to "重新发送"
      msg.content = msg.content.replace(
        '看起来你重新发送了同样的任务指令。基于之前的分析，这个功能已经有了基本实现，但我发现了一些需要修复/完善的地方。\n\n让我直接确认我的理解：\n\n',
        '',
      );
    }

    // 3. For messages responding to duplicates, clean their content
    if (msg.id === 'msg-1770995498978' && msg.content) {
      msg.content = msg.content.replace(
        '用户再次发送了任务指令，但我们之前的对话已经进行到了"开模拟器运行"这一步。让我先检查一下当前的状态，看看 Android 模拟器能否启动。\n\n',
        '',
      );
    }
    if (msg.id === 'msg-1771027346127' && msg.content) {
      msg.content = msg.content.replace(
        '看起来你再次发送了任务指令。我们之前的进展是：\n\n1. **Bug 已修复** — `fetchFeedback` 已加上 `user_id` 过滤\n2. **模拟器已启动** — 应用已安装并运行，但遇到了系统弹窗问题\n\n让我继续之前的工作 — 关掉模拟器弹窗，导航到反馈历史页面并截图。',
        '继续之前的工作 — 关掉模拟器弹窗，导航到反馈历史页面并截图。',
      );
    }

    // 4. Truncate base64 image data in contentBlocks tool outputs (keep first 100 chars)
    if (msg.contentBlocks) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'tool_call' && block.toolCall?.output) {
          block.toolCall.output = truncateBase64(block.toolCall.output);
        }
      }
    }
  }

  cleaned.push(msg);
}

function truncateBase64(output) {
  // Match base64 image data patterns and truncate them
  return output.replace(
    /("data":"[A-Za-z0-9+/=]{200,}")/g,
    (match) => {
      const prefix = match.slice(0, 50);
      return `${prefix}...[truncated]"`;
    },
  );
}

data.messages = cleaned;

// Write back
fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

const newSize = fs.statSync(filePath).size;
console.log(`\nDone. New file size: ${(newSize / 1024).toFixed(1)} KB`);
console.log(`Messages: ${data.messages.length}`);
