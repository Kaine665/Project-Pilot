/**
 * 同一轮里 tool_use 可能从「流式 + 完整助手消息」或 SSE 重放等路径上报多次。
 * 集中做 id 级去重，避免对话里重复卡片与落盘重复块。
 */

import type { ContentBlock } from '@/types';

/** 是否已有相同 tool_use_id（用于累积层 / SSE 客户端跳过重复 start） */
export function hasToolCallWithId(calls: readonly { id: string }[], id: string): boolean {
  return calls.some((t) => t.id === id);
}

/**
 * 去掉 contentBlocks 里重复的 tool_call（按 toolCall.id 保留首次出现）。
 * 用于从磁盘读出历史会话时修复已写入的重复块。
 */
export function dedupeContentBlocksByToolUseId(
  blocks: ContentBlock[] | undefined,
): ContentBlock[] | undefined {
  if (!blocks?.length) return blocks;

  const seen = new Set<string>();
  const out: ContentBlock[] = [];
  let removed = false;

  for (const block of blocks) {
    if (block.type === 'tool_call') {
      const id = block.toolCall.id;
      if (seen.has(id)) {
        removed = true;
        continue;
      }
      seen.add(id);
    }
    out.push(block);
  }

  return removed ? out : blocks;
}
