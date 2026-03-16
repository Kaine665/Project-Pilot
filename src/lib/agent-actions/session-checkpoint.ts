/**
 * session-checkpoint action — AI saves work context before context window fills up.
 *
 * Trigger strategy: auto (AI self-detects when context is full / milestone reached)
 * Injection method: resume button in the chat notification area
 */

import type { AgentAction, ActionContext } from './types';
import type { SessionCheckpoint } from '@/types/agent-chat';

// ── Parsed tag data ──

interface CheckpointTagData {
  content: string;
}

// ── Helpers ──

/** Extract a section from markdown content by heading name. */
function extractSection(text: string, heading: string): string {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

/** Extract bullet list items from a section. */
function extractBullets(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

/** Extract numbered list items from a section. */
function extractNumbered(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

// ── Action definition ──

export const sessionCheckpointAction: AgentAction<CheckpointTagData> = {
  id: 'session-checkpoint',
  resourceType: 'checkpoint-instructions',
  sectionTitle: '会话检查点',
  priority: 85,

  instructions: `## 会话检查点（自动触发）

当以下任一条件满足时，**主动**在回复末尾生成检查点标签，无需用户要求：

1. 你感到输出内容开始被截断，或工具调用返回的内容不完整
2. 会话消息轮数已超过 25 轮（约 50 条消息）
3. 完成了一个阶段性工作，接下来还有较多后续步骤
4. 你收到系统提示上下文即将用尽的警告

**格式：**

<save-checkpoint>
## 当前工作
（1-3 句话描述正在做什么，让接续者秒懂状态）

## 关键信息
- 文件/路径：（已修改或正在分析的关键文件）
- 已发现：（重要的发现、约束、依赖等）
- 环境：（分支、worktree、端口等，如有）

## 当前进度
（已完成哪几步，卡在哪里，或已到哪个阶段）

## 下一步
1. 接下来要做的第一件事
2. 之后的步骤
</save-checkpoint>

**注意：**
- 检查点生成后，前端会显示「续接」按钮，用户点击后将把检查点内容注入新会话
- 生成检查点不影响当前会话的继续，只是额外保存工作快照
- 内容务必具体（文件路径、函数名、行号等），让接续者不需要重新调查`,

  parse(text: string): CheckpointTagData[] {
    const match = text.match(/<save-checkpoint>([\s\S]*?)<\/save-checkpoint>/);
    if (!match) return [];
    return [{ content: match[1].trim() }];
  },

  strip(text: string): string {
    return text.replace(/<save-checkpoint>[\s\S]*?<\/save-checkpoint>\s*/g, '');
  },

  async execute(data: CheckpointTagData, ctx: ActionContext): Promise<void> {
    const workingSection = extractSection(data.content, '当前工作');
    const keyInfoSection = extractSection(data.content, '关键信息');
    const progressSection = extractSection(data.content, '当前进度');
    const nextStepsSection = extractSection(data.content, '下一步');

    const checkpoint: SessionCheckpoint = {
      createdAt: new Date().toISOString(),
      workingSummary: workingSection || data.content.split('\n')[0] || '',
      keyFacts: extractBullets(keyInfoSection),
      inProgressState: progressSection || undefined,
      nextSteps: extractNumbered(nextStepsSection),
      rawContent: data.content,
    };

    ctx.setCheckpoint(checkpoint);
    ctx.emit({ type: 'checkpoint_saved', checkpoint });
  },
};
