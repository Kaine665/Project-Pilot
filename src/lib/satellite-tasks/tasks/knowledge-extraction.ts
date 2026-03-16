/**
 * Knowledge Extraction satellite task.
 *
 * After each conversation turn, judges whether the dialogue contains
 * knowledge worth persisting (e.g. architectural decisions, debugging
 * insights, API discoveries). If so, auto-saves them as draft context
 * entries (same mechanism as the save-knowledge agent action) and emits
 * `knowledge_draft_created` events so the existing UI banner shows.
 *
 * requiresAI = true — uses callLightweightAI() (Haiku) for judgment.
 * priority = 40 — runs after title-generation (10) and health-guard (20).
 */

import { writeFile, mkdir } from 'fs/promises';
import {
  getContextIndexPath,
  getContextFilePath,
  getContextDir,
  modifyJsonFile,
} from '@/lib/file-store';
import type { ContextIndexData, ContextEntry } from '@/types';
import type { SatelliteTask, SatelliteContext, TaskConfigSchema } from '../types';
import { getTaskParams } from '../config';

const LOG = '[Satellite:knowledge-extraction]';

// ── Defaults ──

const DEFAULT_MIN_TURNS = 3;
const DEFAULT_MIN_ASSISTANT_CHARS = 200;
const DEFAULT_MAX_DRAFTS_PER_SESSION = 3;

// ── Result type ──

interface KnowledgeExtractionResult {
  worthy: boolean;
  suggestions: KnowledgeSuggestion[];
}

interface KnowledgeSuggestion {
  label: string;
  description: string;
  content: string;
  format: 'text' | 'markdown' | 'json';
}

// ── Per-session counter (how many drafts already created) ──

const sessionDraftCount = new Map<string, number>();

export const knowledgeExtractionTask: SatelliteTask<KnowledgeExtractionResult> = {
  id: 'knowledge-extraction',
  description: '判断对话中是否有值得存储的经验/知识，自动生成草稿',
  priority: 40,
  requiresAI: true,

  getConfigSchema(): TaskConfigSchema {
    return {
      minTurns: {
        type: 'number',
        title: '最低触发轮次',
        description: '至少多少轮 Assistant 回复后才开始检测',
        default: DEFAULT_MIN_TURNS,
        minimum: 1,
        maximum: 20,
      },
      minAssistantChars: {
        type: 'number',
        title: '最低回复字数',
        description: '本轮 Assistant 回复至少多少字才触发检测',
        default: DEFAULT_MIN_ASSISTANT_CHARS,
        minimum: 50,
        maximum: 2000,
      },
      maxDraftsPerSession: {
        type: 'number',
        title: '每会话最大草稿数',
        description: '单个会话最多自动创建几条知识草稿',
        default: DEFAULT_MAX_DRAFTS_PER_SESSION,
        minimum: 1,
        maximum: 10,
      },
    };
  },

  shouldRun(ctx: SatelliteContext): boolean {
    // Only on successful runs
    if (ctx.runStatus !== 'completed') return false;

    // Wait until enough turns
    if (ctx.assistantTurnCount < _minTurnsCache) return false;

    // Need substantial content this turn
    if (ctx.assistantText.length < _minAssistantCharsCache) return false;

    // Don't exceed per-session limit
    const count = sessionDraftCount.get(ctx.sessionId) ?? 0;
    if (count >= _maxDraftsCache) return false;

    // Only check on certain turns to avoid excessive AI calls:
    // at minTurns, then every 3 turns after that
    const t = ctx.assistantTurnCount;
    if (t !== _minTurnsCache && (t - _minTurnsCache) % 3 !== 0) return false;

    return true;
  },

  buildPrompt(ctx: SatelliteContext): string {
    // Send last N messages (up to 6) for context, truncated
    const recentMessages = ctx.messages.slice(-6).map(m => {
      const truncated = m.content.length > 800
        ? m.content.slice(0, 800) + '...(truncated)'
        : m.content;
      return `[${m.role}]: ${truncated}`;
    }).join('\n\n');

    return `你是一个知识提取判断器。分析以下对话片段，判断其中是否包含值得长期保存的知识。

值得保存的知识类型：
- 技术发现（API 行为、库的隐藏特性、兼容性问题）
- 架构决策（为什么选择某方案、权衡分析）
- 调试经验（问题根因、排查路径、解决方案）
- 配置清单（环境搭建步骤、部署参数）
- 最佳实践（代码模式、性能优化技巧）

不值得保存的：
- 一次性操作（创建了某个文件、运行了某个命令）
- 简单问答（翻译、写作、闲聊）
- 已经在项目文档中有记录的内容
- 过于具体的临时数据（某次测试的输出）

对话内容：
---
${recentMessages}
---

请严格输出一行 JSON（不要输出其他内容）：
- 如果没有值得保存的知识：{"worthy":false,"suggestions":[]}
- 如果有（最多 2 条）：{"worthy":true,"suggestions":[{"label":"简短标题","description":"一句话描述用途","content":"提炼后的知识内容（100-500字，markdown格式）","format":"markdown"}]}`;
  },

  parseResult(raw: string): KnowledgeExtractionResult {
    try {
      // Find the outermost JSON object
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return { worthy: false, suggestions: [] };
      }

      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (!parsed.worthy || !Array.isArray(parsed.suggestions)) {
        return { worthy: false, suggestions: [] };
      }

      const suggestions: KnowledgeSuggestion[] = parsed.suggestions
        .filter((s: Record<string, unknown>) =>
          typeof s.label === 'string' &&
          typeof s.description === 'string' &&
          typeof s.content === 'string',
        )
        .slice(0, 2)
        .map((s: Record<string, unknown>) => ({
          label: String(s.label).slice(0, 100),
          description: String(s.description).slice(0, 200),
          content: String(s.content).slice(0, 2000),
          format: (['text', 'markdown', 'json'].includes(String(s.format))
            ? s.format
            : 'markdown') as KnowledgeSuggestion['format'],
        }));

      return { worthy: suggestions.length > 0, suggestions };
    } catch {
      return { worthy: false, suggestions: [] };
    }
  },

  async execute(result: KnowledgeExtractionResult, ctx: SatelliteContext): Promise<void> {
    if (!result.worthy || result.suggestions.length === 0) return;

    console.log(`${LOG} Found ${result.suggestions.length} knowledge suggestion(s)`);

    const extMap: Record<string, string> = { json: 'json', markdown: 'md', text: 'txt' };
    const now = new Date().toISOString();

    for (const suggestion of result.suggestions) {
      try {
        const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const fileName = `knowledge-${id}.${extMap[suggestion.format] ?? 'md'}`;

        const entry: ContextEntry = {
          id,
          label: suggestion.label,
          description: suggestion.description,
          fileName,
          format: suggestion.format,
          ...(ctx.projectKey ? { projectKey: ctx.projectKey } : {}),
          status: 'draft',
          sourceAgentSessionId: ctx.sessionId,
          producedAt: now,
          createdAt: now,
          updatedAt: now,
        };

        // Write content file
        const contextDir = getContextDir();
        await mkdir(contextDir, { recursive: true });
        await writeFile(getContextFilePath(fileName), suggestion.content, 'utf-8');

        // Append to index
        await modifyJsonFile<ContextIndexData>(
          getContextIndexPath(),
          { entries: [] },
          (d) => { d.entries.push(entry); return d; },
        );

        // Emit event so frontend shows the existing "知识草稿" banner
        ctx.emit({ type: 'knowledge_draft_created', entryId: id, label: suggestion.label });

        console.log(`${LOG} Saved draft: "${suggestion.label}" (${id})`);
      } catch (err) {
        console.error(`${LOG} Failed to save draft "${suggestion.label}":`, err);
      }
    }

    // Update session counter
    const prev = sessionDraftCount.get(ctx.sessionId) ?? 0;
    sessionDraftCount.set(ctx.sessionId, prev + result.suggestions.length);
  },
};

// ── Config cache (shouldRun is sync, config is async) ──

let _minTurnsCache = DEFAULT_MIN_TURNS;
let _minAssistantCharsCache = DEFAULT_MIN_ASSISTANT_CHARS;
let _maxDraftsCache = DEFAULT_MAX_DRAFTS_PER_SESSION;
let _lastCacheRefresh = 0;
const CACHE_TTL_MS = 30_000;

/** Refresh config cache. Called by scheduler before shouldRun. */
export async function refreshKnowledgeExtractionCache(): Promise<void> {
  const now = Date.now();
  if (now - _lastCacheRefresh < CACHE_TTL_MS) return;
  _lastCacheRefresh = now;
  try {
    const params = await getTaskParams('knowledge-extraction');
    if (typeof params.minTurns === 'number') {
      _minTurnsCache = Math.max(1, Math.min(20, params.minTurns));
    }
    if (typeof params.minAssistantChars === 'number') {
      _minAssistantCharsCache = Math.max(50, Math.min(2000, params.minAssistantChars));
    }
    if (typeof params.maxDraftsPerSession === 'number') {
      _maxDraftsCache = Math.max(1, Math.min(10, params.maxDraftsPerSession));
    }
  } catch {
    // Keep existing cache
  }
}
