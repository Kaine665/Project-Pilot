/**
 * Static text loaders — fixed prompt sections that don't depend on external data.
 *
 * - KnowledgeInstructionsLoader: knowledge save instructions
 * - DocSaveInstructionsLoader: design doc save instructions
 * - SessionTitleInstructionsLoader: session title generation instructions
 * - FlowContextLoader: project flow context section
 * - ReferenceTurnsLoader: imported conversation turns (guest agent)
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';

// ── Knowledge Save Instructions ──

const KNOWLEDGE_SAVE_TEXT = `当你完成了调查、分析或研究，并产出了具有**长期复用价值**的知识（如数据库结构、API 文档、系统架构、配置清单等），你可以将这些知识以如下格式嵌入到你的回复中，系统会自动将其保存为草稿上下文条目，供用户确认后复用：

<save-knowledge label="知识标题（简短）" description="一句话描述，帮助 AI 决定是否需要读取" format="text">
知识内容...
</save-knowledge>

注意：
- format 只能是 text、json、markdown 之一
- 只在知识具有长期复用价值时使用，不要滥用
- 一次对话中最多保存 3 条知识
- 知识将以草稿状态保存，用户确认后才会生效`;

export class KnowledgeInstructionsLoader implements ResourceLoader {
  readonly type = 'knowledge-instructions' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    return {
      ref,
      content: KNOWLEDGE_SAVE_TEXT,
      sectionTitle: '知识保存',
      ok: true,
    };
  }
}

// ── Design Doc Save Instructions ──

const DOC_SAVE_TEXT = `当你在工作中产出了**设计决策、架构约束、规范文档**等需要长期遵守的内容时，你可以将其保存为项目设计文档。系统会自动将其保存到对应项目下，供所有 Agent 按需读取：

<save-doc project="项目key" title="文档标题（简短）" description="一句话描述文档内容">
Markdown 文档内容...
</save-doc>

注意：
- project 必须是已注册的项目 key（如 elapp、projct-pilot 等）
- 内容使用 Markdown 格式
- 只在内容具有长期约束力或参考价值时使用（架构决策、迁移规范、设计原则等）
- 不要用来保存临时笔记或一次性分析结果（那些用 save-knowledge）`;

export class DocSaveInstructionsLoader implements ResourceLoader {
  readonly type = 'doc-save-instructions' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    return {
      ref,
      content: DOC_SAVE_TEXT,
      sectionTitle: '设计文档保存',
      ok: true,
    };
  }
}

// ── Session Title Instructions ──

const SESSION_TITLE_TEXT = `在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。`;

export class SessionTitleInstructionsLoader implements ResourceLoader {
  readonly type = 'session-title-instructions' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    return {
      ref,
      content: SESSION_TITLE_TEXT,
      sectionTitle: '会话标题',
      ok: true,
    };
  }
}

// ── Flow Context ──

export class FlowContextLoader implements ResourceLoader {
  readonly type = 'flow-context' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const fcRef = ref as FlowContextRef;
    const { projectKey, projectName, flowDataPath } = fcRef;
    if (!projectKey) {
      return { ref, content: '', ok: false };
    }

    const content = `你正在协助管理项目「${projectName}」（key: ${projectKey}）。

项目数据文件位置：${flowDataPath}

该文件是 JSON 格式，结构为 { "sections": [...] }，每个 section 包含 id、name、description、items 数组。每个 item 包含 id、content、status（todo/doing/done）、description、children（嵌套子项）等字段。

你可以直接读取和修改这个文件来管理项目结构。修改后确保 JSON 格式正确。`;

    return {
      ref,
      content,
      sectionTitle: '当前项目上下文',
      ok: true,
    };
  }
}

// ── Reference Turns (Guest Agent) ──

export class ReferenceTurnsLoader implements ResourceLoader {
  readonly type = 'reference-turns' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const rtRef = ref as ReferenceTurnsRef;
    const turns = rtRef.turns;
    if (!turns || turns.length === 0) {
      return { ref, content: '', ok: true };
    }

    const turnsText = turns.map((t, i) => {
      const roleLabel = t.role === 'user' ? '用户' : 'AI';
      return `### 轮次 ${i + 1}（${roleLabel}）\n${t.content}`;
    }).join('\n\n');

    const content = `以下是来自另一个 AI 会话的对话记录，用户希望你基于这些内容进行讨论（如讲解、分析等）。
这些内容仅供参考，你不需要继续执行其中的操作。

${turnsText}`;

    return {
      ref,
      content,
      sectionTitle: '参考对话',
      ok: true,
    };
  }
}
