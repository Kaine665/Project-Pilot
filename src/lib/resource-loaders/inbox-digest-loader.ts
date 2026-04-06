/**
 * InboxDigestLoader — injects unread inbox entries into the agent prompt.
 *
 * When an agent session starts, this loader reads the agent's unread inbox
 * and renders a "what changed since your last session" section.
 * After injection, entries are marked as read.
 *
 * ref.id is always '_inbox'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { list, markAllRead, type InboxEntry } from '@/lib/inbox-manager';

const TYPE_LABELS: Record<string, string> = {
  doc_updated: '📄 文档更新',
  todo_changed: '✅ 待办变化',
  memory_written: '🧠 共享记忆',
  prompt_updated: '📝 提示词更新',
  session_completed: '💬 会话完成',
};

export class InboxDigestLoader implements ResourceLoader {
  readonly type = 'inbox-digest' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    if (!ctx.agentId) {
      return { ref, content: '', ok: true };
    }

    const entries = await list(ctx.agentId, true);

    if (entries.length === 0) {
      return { ref, content: '', ok: true };
    }

    const lines = entries.map((e: InboxEntry) => {
      const label = TYPE_LABELS[e.type] || e.type;
      const time = formatTime(e.createdAt);
      const from = e.fromAgentId ? ` (来自 ${e.fromAgentId})` : '';
      return `- [${time}] ${label}: ${e.summary}${from}`;
    });

    const md = `自上次会话以来，你关注的资源发生了以下变化（共 ${entries.length} 条）：

${lines.join('\n')}

请根据这些变化判断是否需要采取行动。如果某些变化与你当前的工作相关，可以主动处理。`;

    // Mark as read after injection
    await markAllRead(ctx.agentId);

    return {
      ref,
      content: md,
      sectionTitle: '📬 收件箱 — 最近变化',
      ok: true,
    };
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${min}`;
  } catch {
    return iso;
  }
}
