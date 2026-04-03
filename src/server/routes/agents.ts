import { Hono } from 'hono';
import type { Agent, AgentCapabilities, OpenAIReasoningEffort } from '@/types';
import type { ResourceRef } from '@/types/resource';
import type { AgentsData } from '@/types';
import {
  archiveAgent,
  createAgent,
  getAgentById,
  getAgentBySlug,
  listAgents,
  updateAgent,
} from '@/lib/agents-store';
import { validatePackage, importAgent } from '@/lib/agent-package';
import { getAgentsPath, readJsonFile, getDataDir, getAgentDataPath, getLegacyAgentDataPath } from '@/lib/file-store';
import { mergeAndRepairAgentsData } from '@/lib/agent-metadata-repair';
import { resolveSystemPrompt } from '@/lib/agent-prompt-store';
import { exportAgent } from '@/lib/agent-package';
import { promises as fs } from 'fs';
import path from 'path';
import { documentTextWriteErrorResponse } from '@/lib/document-text-write-guard';

const app = new Hono();

// ─── Helper functions for /files ────────────────────────────────

interface AgentFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  category: 'prompt' | 'prompt-segment' | 'skill' | 'data';
  exists: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function extractLegacyDataDirName(systemPrompt?: string): string | null {
  if (!systemPrompt) return null;
  const match = systemPrompt.match(/agent-data[\\/]+([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function resolveAgentDataStoreDir(agentId: string): Promise<string> {
  const agent = await getAgentById(agentId, { includeArchived: true, includePrompt: true });
  const legacyDataDirName = extractLegacyDataDirName(agent?.systemPrompt);
  const canonical = getAgentDataPath(agentId);
  const candidates = [
    canonical,
    agent?.slug && agent.slug !== agentId ? getAgentDataPath(agent.slug) : null,
    agent?.slug && agent.slug !== agentId ? getLegacyAgentDataPath(agent.slug) : null,
    legacyDataDirName ? getAgentDataPath(legacyDataDirName) : null,
    legacyDataDirName ? getLegacyAgentDataPath(legacyDataDirName) : null,
    getLegacyAgentDataPath(agentId),
  ].filter((value): value is string => !!value);

  const unique = [...new Set(candidates)];

  for (const candidate of unique) {
    if (await fileExists(candidate)) return candidate;
  }

  return canonical;
}

async function ensureAgentDataStoreDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
  await fs.mkdir(path.join(dirPath, 'data'), { recursive: true });
}

// ─── Helper types/functions for /official ───────────────────────

interface AgentMatchInput {
  id?: string;
  slug?: string;
}

interface OfficialAgentPayload {
  name?: string;
  description?: string;
  systemPrompt?: string;
  icon?: string;
  capabilities?: AgentCapabilities;
  requiredParams?: string[];
  contextIds?: string[];
  defaultResources?: ResourceRef[];
  projectKey?: string;
  triggerHints?: string[];
  defaultProvider?: Agent['defaultProvider'];
  defaultModel?: string;
  defaultOpenAIReasoningEffort?: OpenAIReasoningEffort | null;
  contextStrategy?: 'additive' | 'exclusive';
}

interface OfficialAgentsUpsertRequest {
  action: 'upsert';
  match?: AgentMatchInput;
  createIfMissing?: boolean;
  agent: OfficialAgentPayload;
}

interface OfficialAgentsArchiveRequest {
  action: 'archive';
  match: AgentMatchInput;
}

type OfficialAgentsWriteRequest =
  | OfficialAgentsUpsertRequest
  | OfficialAgentsArchiveRequest;

async function resolveMatch(match?: AgentMatchInput, includePrompt = false): Promise<Agent | undefined> {
  if (!match) return undefined;
  if (match.id) {
    return getAgentById(match.id, { includeArchived: true, includePrompt });
  }
  if (match.slug) {
    return getAgentBySlug(match.slug, { includeArchived: true, includePrompt });
  }
  return undefined;
}

// ─── GET / — list agents ────────────────────────────────────────

app.get('/', async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true';
  const projectKey = c.req.query('projectKey');

  const agents = await listAgents({
    includeArchived,
    includePrompts: true,
    projectKey: projectKey || undefined,
  });

  return c.json({ agents });
});

// ─── POST / — create a new agent ───────────────────────────────

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const agent = await createAgent(body);
    return c.json({ ok: true, agent });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    throw err;
  }
});

// ─── PATCH / — update an existing agent ─────────────────────────

app.patch('/', async (c) => {
  try {
    const body = await c.req.json();
    const { id } = body;
    if (!id) {
      return c.json({ error: 'id is required' }, 400);
    }

    if (body.slug !== undefined || body.builtIn !== undefined) {
      return c.json({ error: 'Cannot modify slug or builtIn fields' }, 403);
    }

    const agent = await updateAgent(id, body);
    if (!agent) {
      return c.json({ error: 'agent not found' }, 404);
    }

    return c.json({ ok: true, agent });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json(enc.body, enc.status);
    throw err;
  }
});

// ─── DELETE / — soft-delete an agent ────────────────────────────

app.delete('/', async (c) => {
  const { id } = await c.req.json();
  if (!id) {
    return c.json({ error: 'id is required' }, 400);
  }

  const existing = await listAgents({ includeArchived: true, includePrompts: false });
  const agent = existing.find((item) => item.id === id);
  if (!agent) {
    return c.json({ error: 'agent not found' }, 404);
  }
  if (agent.builtIn) {
    return c.json({ error: 'Cannot delete a built-in agent' }, 403);
  }

  await archiveAgent(id);
  return c.json({ ok: true });
});

// ─── GET /official — machine-oriented official agents API ───────

app.get('/official', async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true';
  const includePrompt = c.req.query('includePrompt') === 'true';
  const projectKey = c.req.query('projectKey') || undefined;
  const id = c.req.query('id') || undefined;
  const slug = c.req.query('slug') || undefined;

  if (id || slug) {
    const agent = id
      ? await getAgentById(id, { includeArchived, includePrompt })
      : await getAgentBySlug(slug!, { includeArchived, includePrompt });

    if (!agent) {
      return c.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } },
        404,
      );
    }

    return c.json({ ok: true, agent });
  }

  const agents = await listAgents({ includeArchived, includePrompts: includePrompt, projectKey });
  return c.json({ ok: true, agents });
});

// ─── POST /official — official write API ────────────────────────

app.post('/official', async (c) => {
  try {
  const body = await c.req.json() as OfficialAgentsWriteRequest;

  if (body.action === 'upsert') {
    if (!body.agent) {
      return c.json(
        { ok: false, error: { code: 'INVALID_REQUEST', message: 'agent payload is required' } },
        400,
      );
    }

    const matched = await resolveMatch(body.match, true);
    if (matched) {
      const agent = await updateAgent(matched.id, body.agent);
      return c.json({
        ok: true,
        action: 'upsert',
        created: false,
        updated: true,
        matchedBy: body.match?.id ? 'id' : body.match?.slug ? 'slug' : 'id',
        agent,
      });
    }

    if (body.createIfMissing === false) {
      return c.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'No matching agent to update' } },
        404,
      );
    }

    if (!body.agent.name?.trim()) {
      return c.json(
        { ok: false, error: { code: 'INVALID_REQUEST', message: 'agent.name is required when creating a new agent' } },
        400,
      );
    }

    const agent = await createAgent({
      ...body.agent,
      name: body.agent.name,
    });

    return c.json({
      ok: true,
      action: 'upsert',
      created: true,
      updated: false,
      agent,
    });
  }

  if (body.action === 'archive') {
    const matched = await resolveMatch(body.match, false);
    if (!matched) {
      return c.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } },
        404,
      );
    }
    if (matched.builtIn) {
      return c.json(
        { ok: false, error: { code: 'BUILTIN_AGENT', message: 'Built-in agents cannot be archived' } },
        403,
      );
    }

    const agent = await archiveAgent(matched.id);
    return c.json({ ok: true, action: 'archive', agent });
  }

  return c.json(
    { ok: false, error: { code: 'INVALID_ACTION', message: 'Supported actions: upsert, archive' } },
    400,
  );
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json({ ok: false, error: { code: enc.body.code as string, message: String(enc.body.error), issues: enc.body.issues } }, enc.status);
    throw err;
  }
});

// ─── POST /import — import .ppagent file ────────────────────────

app.post('/import', async (c) => {
  try {
    const body = await c.req.json();

    if (!validatePackage(body)) {
      return c.json({ error: '无效的 .ppagent 文件格式' }, 400);
    }

    const result = await importAgent(body);

    return c.json({
      ok: true,
      agent: result.agent,
      contextsImported: result.contextsImported,
    });
  } catch (err) {
    const enc = documentTextWriteErrorResponse(err);
    if (enc) return c.json({ error: enc.body.error, code: enc.body.code, issues: enc.body.issues }, enc.status);
    console.error('[agents/import] Import failed:', err);
    return c.json(
      { error: '导入失败: ' + (err instanceof Error ? err.message : String(err)) },
      500,
    );
  }
});

// ─── GET /export/:id — export agent as .ppagent ─────────────────

app.get('/export/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'id is required' }, 400);
  }

  const { data } = await mergeAndRepairAgentsData(
    await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] }),
  );

  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return c.json({ error: 'agent not found' }, 404);
  }

  agent.systemPrompt = await resolveSystemPrompt(agent.id, agent.systemPrompt);

  const pkg = await exportAgent(agent);

  const safeName = agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
  const fileName = `${safeName}.ppagent`;
  const asciiName = agent.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.ppagent';

  return new Response(JSON.stringify(pkg, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
});

// ─── GET /files — list agent files/directories ──────────────────

app.get('/files', async (c) => {
  const agentId = c.req.query('agentId');
  if (!agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }

  const dataDir = getDataDir();
  const entries: AgentFileEntry[] = [];

  // 1. Main prompt FILE
  const promptFile = path.join(dataDir, 'prompts', 'agents', `${agentId}.md`);
  const promptExists = await fileExists(promptFile);
  if (promptExists) {
    entries.push({
      name: `${agentId}.md`,
      path: promptFile,
      isDirectory: false,
      category: 'prompt',
      exists: true,
    });
  } else {
    const legacyFile = path.join(dataDir, 'prompts', `${agentId}.md`);
    const legacyExists = await fileExists(legacyFile);
    entries.push({
      name: `${agentId}.md`,
      path: legacyExists ? legacyFile : promptFile,
      isDirectory: false,
      category: 'prompt',
      exists: legacyExists,
    });
  }

  // 2. Prompt segments directory
  const segmentsDir = path.join(dataDir, 'prompts', 'agents', `${agentId}.d`);
  entries.push({
    name: '提示词片段',
    path: segmentsDir,
    isDirectory: true,
    category: 'prompt-segment',
    exists: await fileExists(segmentsDir),
  });

  // 3. Agent-level skills
  const skillsDir = path.join(dataDir, 'skills', '_agents', agentId);
  entries.push({
    name: '技能',
    path: skillsDir,
    isDirectory: true,
    category: 'skill',
    exists: await fileExists(skillsDir),
  });

  // 4. Agent data store
  const dataStoreDir = await resolveAgentDataStoreDir(agentId);
  await ensureAgentDataStoreDir(dataStoreDir);
  entries.push({
    name: '私有工作空间',
    path: dataStoreDir,
    isDirectory: true,
    category: 'data',
    exists: await fileExists(dataStoreDir),
  });

  return c.json(
    { agentId, entries },
    200,
    { 'Cache-Control': 'no-store, max-age=0' },
  );
});

export default app;
