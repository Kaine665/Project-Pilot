import { Hono } from 'hono';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import {
  getGlobalPromptPath,
  getPromptsDir,
  getProjectPromptPath,
  getProjectPromptsDir,
  getPromptFilePath,
  getSessionPromptOverridePath,
  getSessionPromptOverrideDir,
  getScopedSkillsDir,
  getSkillFilePath,
  type SkillScope,
} from '@/lib/file-store';
import { estimateTokens } from '@/lib/token-estimate';
import type { PromptSegmentScope, PromptSegment } from '@/types';
import {
  readSegmentIndex,
  readSegmentContent,
  isSegmented,
  createSegment,
  initSegmented,
  reorderSegments,
  flattenSegments,
  updateSegmentMeta,
  updateSegmentContent,
  deleteSegment,
} from '@/lib/segmented-prompt-store';
import { assertDocumentTextWritable, documentTextWriteErrorResponse } from '@/lib/document-text-write-guard';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PromptBlock {
  id: string;
  name: string;
  description: string;
  source: 'global' | 'project' | 'agent' | 'skill' | 'injected';
  tokenEstimate: number;
  enabled: boolean;
  contentPreview: string;
  location?: string;
}

function truncate(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseScopeFromQuery(q: Record<string, string>): PromptSegmentScope | null {
  const scope = q['scope'];
  if (scope === 'global') return { type: 'global' };
  if (scope === 'project') {
    const projectKey = q['projectKey'];
    if (!projectKey) return null;
    return { type: 'project', projectKey };
  }
  if (scope === 'agent') {
    const agentId = q['agentId'];
    if (!agentId) return null;
    return { type: 'agent', agentId };
  }
  if (scope === 'runtime') {
    const agentId = q['agentId'];
    const sessionId = q['sessionId'];
    if (!agentId || !sessionId) return null;
    return { type: 'runtime', agentId, sessionId };
  }
  return null;
}

async function readSingleFileContent(scope: PromptSegmentScope): Promise<string> {
  try {
    let filePath: string;
    switch (scope.type) {
      case 'global':
        filePath = getGlobalPromptPath();
        break;
      case 'project':
        filePath = getProjectPromptPath(scope.projectKey);
        break;
      case 'agent':
        filePath = getPromptFilePath(scope.agentId);
        break;
      case 'runtime':
        filePath = getSessionPromptOverridePath(scope.agentId, scope.sessionId);
        break;
    }
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function writeSingleFileContent(scope: PromptSegmentScope, content: string): Promise<void> {
  assertDocumentTextWritable(content);
  switch (scope.type) {
    case 'global':
      await mkdir(getPromptsDir(), { recursive: true });
      await writeFile(getGlobalPromptPath(), content, 'utf-8');
      break;
    case 'project':
      await mkdir(getProjectPromptsDir(), { recursive: true });
      await writeFile(getProjectPromptPath(scope.projectKey), content, 'utf-8');
      break;
    case 'agent':
      await mkdir(getPromptsDir() + '/agents', { recursive: true });
      await writeFile(getPromptFilePath(scope.agentId), content, 'utf-8');
      break;
    case 'runtime':
      await mkdir(getSessionPromptOverrideDir(scope.agentId), { recursive: true });
      await writeFile(getSessionPromptOverridePath(scope.agentId, scope.sessionId), content, 'utf-8');
      break;
  }
}

// ---------------------------------------------------------------------------
// GET /global-prompt — 读取全局 prompt
// PUT /global-prompt — 写入全局 prompt
// ---------------------------------------------------------------------------

app.get('/global-prompt', async (c) => {
  try {
    const content = await readFile(getGlobalPromptPath(), 'utf-8');
    return c.json({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return c.json({ content: '' });
    }
    console.error('[global-prompt] GET error:', err);
    return c.json({ error: 'Failed to read global prompt' }, 500);
  }
});

app.put('/global-prompt', async (c) => {
  try {
    const { content } = await c.req.json<{ content?: string }>();
    if (typeof content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400);
    }
    await mkdir(getPromptsDir(), { recursive: true });
    await writeSingleFileContent({ type: 'global' }, content);
    return c.json({ ok: true });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[global-prompt] PUT error:', err);
    return c.json({ error: 'Failed to write global prompt' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /project-prompt/:projectKey — 读取项目级 prompt
// PUT /project-prompt/:projectKey — 写入项目级 prompt
// ---------------------------------------------------------------------------

app.get('/project-prompt/:projectKey', async (c) => {
  const projectKey = c.req.param('projectKey');
  try {
    const content = await readFile(getProjectPromptPath(projectKey), 'utf-8');
    return c.json({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return c.json({ content: '' });
    }
    console.error('[project-prompt] GET error:', err);
    return c.json({ error: 'Failed to read project prompt' }, 500);
  }
});

app.put('/project-prompt/:projectKey', async (c) => {
  const projectKey = c.req.param('projectKey');
  try {
    const { content } = await c.req.json<{ content?: string }>();
    if (typeof content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400);
    }
    await mkdir(getProjectPromptsDir(), { recursive: true });
    await writeSingleFileContent({ type: 'project', projectKey }, content);
    return c.json({ ok: true });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[project-prompt] PUT error:', err);
    return c.json({ error: 'Failed to write project prompt' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /prompt-blocks — 返回 Agent 的 prompt 组成 blocks
// ---------------------------------------------------------------------------

app.get('/prompt-blocks', async (c) => {
  const agentId = c.req.query('agentId') ?? undefined;
  const projectKey = c.req.query('projectKey') ?? undefined;

  const blocks: PromptBlock[] = [];

  // 1. Global prompt
  const globalContent = await safeReadFile(getGlobalPromptPath());
  if (globalContent) {
    blocks.push({
      id: 'global',
      name: '全局提示词',
      description: '所有 Agent 共享的基础指令与标准操作规范',
      source: 'global',
      tokenEstimate: estimateTokens(globalContent),
      enabled: true,
      contentPreview: truncate(globalContent),
      location: getGlobalPromptPath(),
    });
  }

  // 2. Project prompts
  try {
    const projDir = getProjectPromptsDir();
    const files = await readdir(projDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const key = file.replace(/\.md$/, '');
      const content = await safeReadFile(getProjectPromptPath(key));
      if (content) {
        blocks.push({
          id: `project-${key}`,
          name: key,
          description: `项目「${key}」级别的提示词`,
          source: 'project',
          tokenEstimate: estimateTokens(content),
          enabled: projectKey ? key === projectKey : true,
          contentPreview: truncate(content),
          location: getProjectPromptPath(key),
        });
      }
    }
  } catch {
    // project-prompts dir may not exist
  }

  // 3. Agent prompts
  if (agentId) {
    const agentContent = await safeReadFile(getPromptFilePath(agentId));
    if (agentContent) {
      blocks.push({
        id: `agent-${agentId}`,
        name: 'Agent 专属提示词',
        description: '此 Agent 的个性化指令与角色定义',
        source: 'agent',
        tokenEstimate: estimateTokens(agentContent),
        enabled: true,
        contentPreview: truncate(agentContent),
        location: getPromptFilePath(agentId),
      });
    }
  }

  // 4. Skills — scan skills directories (global / agent / project scopes)
  const skillScopes: { scope: SkillScope; idPrefix: string; label: string }[] = [
    { scope: { level: 'global' }, idPrefix: 'skill-global', label: '全局 Skill' },
  ];
  if (agentId) {
    skillScopes.push({ scope: { level: 'agent', agentId }, idPrefix: `skill-agent-${agentId}`, label: 'Agent 级别 Skill' });
  }
  if (projectKey) {
    skillScopes.push({ scope: { level: 'project', projectKey }, idPrefix: `skill-project-${projectKey}`, label: `项目 Skill (${projectKey})` });
  }

  for (const { scope, idPrefix, label } of skillScopes) {
    try {
      const scopeDir = getScopedSkillsDir(scope);
      const skillDirs = await readdir(scopeDir);
      for (const skillName of skillDirs) {
        const skillMd = getSkillFilePath(skillName, scope);
        const content = await safeReadFile(skillMd);
        if (content) {
          blocks.push({
            id: `${idPrefix}-${skillName}`,
            name: skillName,
            description: label,
            source: 'skill',
            tokenEstimate: estimateTokens(content),
            enabled: true,
            contentPreview: truncate(content),
            location: skillMd,
          });
        }
      }
    } catch { /* scope dir may not exist */ }
  }

  const totalTokens = blocks.filter(b => b.enabled).reduce((sum, b) => sum + b.tokenEstimate, 0);

  return c.json({ blocks, totalTokens });
});

// ---------------------------------------------------------------------------
// /prompt-segments — Segmented prompt management
// ---------------------------------------------------------------------------

app.get('/prompt-segments', async (c) => {
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope. Use scope=global or scope=project&projectKey=xxx' }, 400);
  }

  try {
    const segmented = await isSegmented(scope);
    if (!segmented) {
      return c.json({ segments: [], isSegmented: false });
    }

    const index = await readSegmentIndex(scope);
    const segmentsWithContent = await Promise.all(
      index.segments.map(async (seg) => ({
        ...seg,
        content: await readSegmentContent(scope, seg.id),
      })),
    );

    return c.json({ segments: segmentsWithContent, isSegmented: true });
  } catch (err) {
    console.error('[prompt-segments] GET error:', err);
    return c.json({ error: 'Failed to read segments' }, 500);
  }
});

app.post('/prompt-segments', async (c) => {
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope' }, 400);
  }

  try {
    const body = await c.req.json<{
      id?: string;
      title?: string;
      description?: string;
      content?: string;
      enabled?: boolean;
    }>();

    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: 'id is required' }, 400);
    }
    if (!body.title || typeof body.title !== 'string') {
      return c.json({ error: 'title is required' }, 400);
    }

    const segment: PromptSegment = {
      id: body.id,
      title: body.title,
      description: body.description,
      enabled: body.enabled ?? true,
    };

    const index = await createSegment(scope, segment, body.content ?? '');
    return c.json({ ok: true, segments: index.segments });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[prompt-segments] POST error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to create segment';
    return c.json({ error: msg }, 500);
  }
});

app.put('/prompt-segments', async (c) => {
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope' }, 400);
  }

  try {
    const body = await c.req.json<{
      action: 'init' | 'reorder' | 'flatten';
      orderedIds?: string[];
    }>();

    switch (body.action) {
      case 'init': {
        const existing = await readSingleFileContent(scope);
        const index = await initSegmented(scope, existing);
        return c.json({ ok: true, segments: index.segments });
      }
      case 'reorder': {
        if (!Array.isArray(body.orderedIds)) {
          return c.json({ error: 'orderedIds must be an array' }, 400);
        }
        const index = await reorderSegments(scope, body.orderedIds);
        return c.json({ ok: true, segments: index.segments });
      }
      case 'flatten': {
        const content = await flattenSegments(scope);
        await writeSingleFileContent(scope, content);
        return c.json({ ok: true, content });
      }
      default:
        return c.json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[prompt-segments] PUT error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to process action';
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// /prompt-segments/:segmentId — Single segment operations
// ---------------------------------------------------------------------------

app.get('/prompt-segments/:segmentId', async (c) => {
  const segmentId = c.req.param('segmentId');
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope' }, 400);
  }

  try {
    const index = await readSegmentIndex(scope);
    const seg = index.segments.find(s => s.id === segmentId);
    if (!seg) {
      return c.json({ error: 'Segment not found' }, 404);
    }
    const content = await readSegmentContent(scope, segmentId);
    return c.json({ ...seg, content });
  } catch (err) {
    console.error('[prompt-segments] GET error:', err);
    return c.json({ error: 'Failed to read segment' }, 500);
  }
});

app.put('/prompt-segments/:segmentId', async (c) => {
  const segmentId = c.req.param('segmentId');
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope' }, 400);
  }

  try {
    const body = await c.req.json<{
      title?: string;
      description?: string;
      enabled?: boolean;
      content?: string;
    }>();

    const hasMeta = body.title !== undefined || body.description !== undefined || body.enabled !== undefined;
    let index;
    if (hasMeta) {
      index = await updateSegmentMeta(scope, segmentId, {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      });
    }

    if (body.content !== undefined) {
      await updateSegmentContent(scope, segmentId, body.content);
    }

    if (!index) {
      index = await readSegmentIndex(scope);
    }

    return c.json({ ok: true, segments: index.segments });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[prompt-segments] PUT error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to update segment';
    return c.json({ error: msg }, 500);
  }
});

app.delete('/prompt-segments/:segmentId', async (c) => {
  const segmentId = c.req.param('segmentId');
  const scope = parseScopeFromQuery(c.req.query() as Record<string, string>);
  if (!scope) {
    return c.json({ error: 'Invalid scope' }, 400);
  }

  try {
    const index = await deleteSegment(scope, segmentId);
    return c.json({ ok: true, segments: index.segments });
  } catch (err) {
    console.error('[prompt-segments] DELETE error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to delete segment';
    return c.json({ error: msg }, 500);
  }
});

export default app;
