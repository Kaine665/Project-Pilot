/**
 * save-doc action — AI can save design documents for long-term reference.
 */

import { mkdir, writeFile } from 'fs/promises';
import { assertDocumentTextWritable } from '@/lib/document-text-write-guard';
import { getDocumentContentPath, getDocumentsContentDir } from '@/lib/file-store';
import { readDocsIndexFromDocuments, saveDocsIndexToDocuments } from '@/lib/documents-store';
import type { DocEntry } from '@/types';
import { PROMPT_PRIORITY } from '@/lib/prompt-priorities';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface DocTagData {
  project: string;
  title: string;
  description: string;
  content: string;
}

// ── Action definition ──

const TAG_REGEX = /<save-doc\s+project="([^"]+)"\s+title="([^"]+)"\s+description="([^"]+)">([\s\S]*?)<\/save-doc>/g;

export const saveDocAction: AgentAction<DocTagData> = {
  id: 'save-doc',
  resourceType: 'doc-save-instructions',
  sectionTitle: '设计文档保存',
  priority: PROMPT_PRIORITY.DOC_SAVE_OR_CHECKPOINT,

  instructions: `当你在工作中产出了**设计决策、架构约束、规范文档**等需要长期遵守的内容时，你可以将其保存为项目设计文档。系统会自动将其保存到对应项目下，供所有 Agent 按需读取：

<save-doc project="项目key" title="文档标题（简短）" description="一句话描述文档内容">
Markdown 文档内容...
</save-doc>

注意：
- project 必须是已注册的项目 key（如 elapp、project-pilot 等）
- 内容使用 Markdown 格式
- 只在内容具有长期约束力或参考价值时使用（架构决策、迁移规范、设计原则等）`,

  parse(text: string): DocTagData[] {
    const results: DocTagData[] = [];
    const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        project: match[1].trim(),
        title: match[2].trim(),
        description: match[3].trim(),
        content: match[4].trim(),
      });
    }
    return results;
  },

  strip(text: string): string {
    return text.replace(/<save-doc[\s\S]*?<\/save-doc>/g, '').trim();
  },

  async execute(data: DocTagData, ctx: ActionContext): Promise<void> {
    const now = new Date().toISOString();
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fileName = `${docId}.md`;

    const entry: DocEntry = {
      id: docId,
      title: data.title,
      description: data.description,
      fileName,
      projectKey: data.project,
      documentKind: 'design_doc',
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(getDocumentsContentDir(), { recursive: true });
    assertDocumentTextWritable(data.title);
    if (data.description.trim()) assertDocumentTextWritable(data.description);
    assertDocumentTextWritable(data.content);
    await writeFile(getDocumentContentPath(fileName), data.content, 'utf-8');

    const idx = await readDocsIndexFromDocuments();
    if (!idx.projects[entry.projectKey]) {
      idx.projects[entry.projectKey] = [];
    }
    idx.projects[entry.projectKey].push(entry);
    await saveDocsIndexToDocuments(idx);

    ctx.emit({ type: 'doc_created', docId, title: data.title, projectKey: data.project });
  },
};
