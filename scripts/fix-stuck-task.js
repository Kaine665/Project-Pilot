#!/usr/bin/env node
/**
 * 修复因 JSON 解析失败而卡在 understanding 阶段的任务
 *
 * 使用方法：
 * node scripts/fix-stuck-task.js task-1771205763787
 */

const fs = require('fs').promises;
const path = require('path');

const TASK_ID = process.argv[2] || 'task-1771205763787';

/**
 * 转义 JSON 字符串值内部的未转义双引号（修复后的逻辑）
 */
function escapeInnerQuotes(jsonStr) {
  const result = [];
  let inString = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const prev = i > 0 ? jsonStr[i - 1] : '';

    if (char === '"' && prev !== '\\') {
      if (!inString) {
        // 进入字符串
        inString = true;
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
    } else {
      result.push(char);
    }
  }

  return result.join('');
}

/**
 * 提取 understanding（修复后的逻辑）
 */
function extractUnderstandingFromText(text) {
  const regex = /```json:understanding\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    // 预处理：转义字符串值内部的未转义双引号
    const sanitized = escapeInnerQuotes(match[1]);
    const parsed = JSON.parse(sanitized);

    if (parsed.project && parsed.action && parsed.goal && parsed.deliverable) {
      return {
        project: parsed.project,
        action: parsed.action,
        goal: parsed.goal,
        deliverable: parsed.deliverable,
      };
    }
  } catch (err) {
    console.error('JSON 解析失败:', err.message);
    console.error('原始 JSON:', match[1].substring(0, 500));
  }
  return null;
}
const CONVERSATION_PATH = path.join(__dirname, '../data/conversations', `${TASK_ID}.json`);
const TASKS_PATH = path.join(__dirname, '../data/tasks.json');

async function main() {
  console.log(`\n=== 修复任务 ${TASK_ID} ===\n`);

  // 1. 读取对话记录
  const conversation = JSON.parse(await fs.readFile(CONVERSATION_PATH, 'utf-8'));
  console.log(`✓ 对话记录已加载，共 ${conversation.messages.length} 条消息\n`);

  // 2. 找到包含 understanding 的消息
  let understandingMsg = null;
  for (const msg of conversation.messages) {
    if (msg.role === 'assistant' && msg.content.includes('json:understanding')) {
      understandingMsg = msg;
      break;
    }
  }

  if (!understandingMsg) {
    console.log('❌ 未找到包含 understanding 的消息');
    return;
  }

  console.log(`✓ 找到 understanding 消息: ${understandingMsg.id}`);
  console.log(`  时间: ${understandingMsg.timestamp}`);
  console.log(`  内容长度: ${understandingMsg.content.length} 字符\n`);

  // 3. 提取 understanding（使用修复后的逻辑）
  const understanding = extractUnderstandingFromText(understandingMsg.content);

  if (!understanding) {
    console.log('❌ 提取失败（即使使用修复后的逻辑）');
    return;
  }

  console.log('✅ Understanding 提取成功：');
  console.log(JSON.stringify(understanding, null, 2));
  console.log();

  // 4. 更新任务阶段：understanding → planning
  const tasksData = JSON.parse(await fs.readFile(TASKS_PATH, 'utf-8'));
  const task = tasksData.tasks.find(t => t.id === TASK_ID);

  if (!task) {
    console.log('❌ 任务不存在');
    return;
  }

  console.log(`当前任务阶段: ${task.phase || 'undefined'}`);

  task.phase = 'planning';
  task.updatedAt = new Date().toISOString();

  await fs.writeFile(TASKS_PATH, JSON.stringify(tasksData, null, 2), 'utf-8');
  console.log(`✅ 任务阶段已更新: understanding → planning\n`);

  // 5. 确认 artifacts 文件存在
  const artifactsPath = path.join(__dirname, '../data/task-artifacts', `${TASK_ID}.json`);
  try {
    const artifacts = JSON.parse(await fs.readFile(artifactsPath, 'utf-8'));
    if (artifacts.understanding) {
      console.log('✅ Artifacts 文件已存在，包含 understanding');
    } else {
      console.log('⚠️  Artifacts 文件存在，但没有 understanding');
    }
  } catch {
    console.log('⚠️  Artifacts 文件不存在');
  }

  console.log('\n=== 修复完成 ===');
  console.log('现在可以刷新浏览器，任务应该自动进入 planning 阶段');
}

main().catch(console.error);
