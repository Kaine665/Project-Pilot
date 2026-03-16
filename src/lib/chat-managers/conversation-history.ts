/**
 * 会话历史格式化工具
 *
 * 当 Claude SDK 的 resume 机制不可用时（session 过期、provider 切换等），
 * 将本地保存的历史消息格式化为文本，注入到 prompt 中，
 * 使 AI 在新的 SDK 会话中仍然知道之前聊过什么。
 */

import type { ChatMessage } from '@/types/agent-chat';
import type { SessionCheckpoint } from '@/types/agent-chat';

/** 历史注入的最大消息条数（避免 prompt 过长） */
const MAX_HISTORY_MESSAGES = 30;

/** 单条消息内容截断长度（字符数） */
const MAX_MESSAGE_CHARS = 2000;

/**
 * 将历史消息格式化为可注入 prompt 的文本块。
 *
 * 策略：
 * 1. 如果有 checkpoint（AI 自己生成的上下文摘要），优先使用
 * 2. 否则取最近 N 条消息，格式化为对话记录
 * 3. 如果历史被截断，开头附加提示
 */
export function formatConversationHistory(
  messages: ChatMessage[],
  checkpoint?: SessionCheckpoint,
): string | null {
  // 没有历史消息，不需要注入
  if (!messages || messages.length === 0) return null;

  const parts: string[] = [];

  // ── 优先使用 checkpoint ──
  if (checkpoint?.rawContent) {
    parts.push('## 会话检查点（上次 AI 自动保存的上下文摘要）\n');
    parts.push(checkpoint.rawContent);

    // checkpoint 之后可能还有新消息，也需要补充
    const checkpointTime = checkpoint.createdAt ? new Date(checkpoint.createdAt).getTime() : 0;
    // 找到 checkpoint 之后的消息（粗略：取最后几条，因为 checkpoint 通常在会话中后期生成）
    // 由于我们没有消息时间戳，用简单策略：如果消息数 > 4，取最后 4 条作为 checkpoint 后的补充
    if (messages.length > 4) {
      const recentMessages = messages.slice(-4);
      const hasNewContent = recentMessages.some(m => m.role === 'user');
      if (hasNewContent) {
        parts.push('\n\n## 检查点之后的最近对话\n');
        parts.push(formatMessages(recentMessages));
      }
    }

    return wrapInSection(parts.join(''));
  }

  // ── 无 checkpoint，使用原始消息历史 ──
  const totalMessages = messages.length;
  const truncated = totalMessages > MAX_HISTORY_MESSAGES;
  const historyMessages = truncated
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : messages;

  if (truncated) {
    parts.push(`> 以下是最近 ${MAX_HISTORY_MESSAGES} 条消息（共 ${totalMessages} 条，较早的已省略）\n\n`);
  }

  parts.push(formatMessages(historyMessages));

  return wrapInSection(parts.join(''));
}

/**
 * 将消息数组格式化为可读的对话记录文本
 */
function formatMessages(messages: ChatMessage[]): string {
  return messages.map((msg, i) => {
    const role = msg.role === 'user' ? '用户' : 'AI';
    let content = msg.content || '';

    // 截断过长内容
    if (content.length > MAX_MESSAGE_CHARS) {
      content = content.slice(0, MAX_MESSAGE_CHARS) + '\n...(内容过长，已截断)';
    }

    // 图片附件提示
    const imageNote = msg.images?.length
      ? ` [附带 ${msg.images.length} 张图片]`
      : '';

    return `**${role}**${imageNote}：\n${content}`;
  }).join('\n\n---\n\n');
}

/**
 * 包装为带标题的注入段落
 */
function wrapInSection(content: string): string {
  return `## 本会话的历史对话记录

> 以下是本会话之前的对话记录。由于技术原因（会话恢复机制不可用），你需要通过阅读这些记录来了解之前的上下文。请在回复时考虑这些历史信息。

${content}`;
}
