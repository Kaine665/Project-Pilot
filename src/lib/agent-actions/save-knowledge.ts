/**
 * save-knowledge action — AI can save long-lived knowledge as draft context entries.
 */

import { writeFile, mkdir } from 'fs/promises';
import {
  getContextIndexPath,
  getContextFilePath,
  getContextDir,
  modifyJsonFile,
} from '@/lib/file-store';
import type { ContextIndexData, ContextEntry } from '@/types';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface KnowledgeTagData {
  label: string;
  description: string;
  format: 'json' | 'markdown' | 'text';
  content: string;
}

// ── Action definition ──

const TAG_REGEX = /<save-knowledge\s+label="([^"]+)"\s+description="([^"]+)"\s+format="(text|json|markdown)">([\s\S]*?)<\/save-knowledge>/g;

export const saveKnowledgeAction: AgentAction<KnowledgeTagData> = {
  id: 'save-knowledge',
  resourceType: 'knowledge-instructions',
  sectionTitle: '知识保存',
  priority: 80,

  instructions: `当你完成了调查、分析或研究，并产出了具有**长期复用价值**的知识（如数据库结构、API 文档、系统架构、配置清单等），你可以将这些知识以如下格式嵌入到你的回复中，系统会自动将其保存为草稿上下文条目，供用户确认后复用：

<save-knowledge label="知识标题（简短）" description="一句话描述，帮助 AI 决定是否需要读取" format="text">
知识内容...
</save-knowledge>

注意：
- format 只能是 text、json、markdown 之一
- 只在知识具有长期复用价值时使用，不要滥用
- 一次对话中最多保存 3 条知识
- 知识将以草稿状态保存，用户确认后才会生效`,

  parse(text: string): KnowledgeTagData[] {
    const results: KnowledgeTagData[] = [];
    const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        label: match[1].trim(),
        description: match[2].trim(),
        format: match[3] as KnowledgeTagData['format'],
        content: match[4].trim(),
      });
    }
    return results;
  },

  strip(text: string): string {
    return text.replace(/<save-knowledge[\s\S]*?<\/save-knowledge>/g, '').trim();
  },

  async execute(data: KnowledgeTagData, ctx: ActionContext): Promise<void> {
    const now = new Date().toISOString();
    const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const extMap: Record<string, string> = { json: 'json', markdown: 'md', text: 'txt' };
    const fileName = `knowledge-${id}.${extMap[data.format]}`;

    const entry: ContextEntry = {
      id,
      label: data.label,
      description: data.description,
      fileName,
      format: data.format,
      status: 'draft',
      sourceAgentSessionId: ctx.sessionId,
      producedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const contextDir = getContextDir();
    await mkdir(contextDir, { recursive: true });
    await writeFile(getContextFilePath(fileName), data.content, 'utf-8');

    await modifyJsonFile<ContextIndexData>(
      getContextIndexPath(),
      { entries: [] },
      (d) => { d.entries.push(entry); return d; },
    );

    ctx.emit({ type: 'knowledge_draft_created', entryId: id, label: data.label });
  },
};
