import { Hono } from 'hono';
import {
  readProjectIndex,
  writeProjectIndex,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import {
  readAgentsWorkspaceProjectState,
  writeAgentsWorkspaceProjectState,
} from '@/lib/agents-workspace-ui-store';
import { sanitizeAgentsWorkspaceProjectState } from '@/lib/agents-workspace-ui-sanitize';
import type {
  AgentsWorkspaceActivePersist,
  AgentsWorkspacePerAgentFocusPersist,
  AgentsWorkspaceProjectPersist,
} from '@/lib/agents-workspace-ui-shared';
import { isValidProjectKey } from '@/lib/security';
import type { ProjectEntry, ProjectIndex } from '@/types';

const app = new Hono();

// ---------------------------------------------------------------------------
// /api/data/projects
// ---------------------------------------------------------------------------

async function readIndex(): Promise<ProjectIndex> {
  await ensureDataDirV2Migrated();
  return readProjectIndex();
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await writeProjectIndex(index);
}

app.get('/projects', async (c) => {
  const index = await readIndex();
  const includeArchived = c.req.query('includeArchived') === 'true';
  const projects = includeArchived
    ? index.projects
    : index.projects.filter((p) => !p.archived);
  return c.json({ projects });
});

app.post('/projects', async (c) => {
  const body = await c.req.json();
  const { key, name, path: projectPath, ...rest } = body;
  if (!key || !name) {
    return c.json({ error: 'key and name are required' }, 400);
  }

  const safe = (key as string).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) {
    return c.json({ error: 'invalid key' }, 400);
  }

  const index = await readIndex();
  if (index.projects.some((p) => p.key === safe)) {
    return c.json({ error: 'project already exists' }, 409);
  }

  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    key: safe,
    name,
    createdAt: now,
    updatedAt: now,
  };

  if (projectPath) entry.path = projectPath;
  if (rest.description) entry.description = rest.description;
  if (rest.location) entry.location = rest.location;
  if (rest.techStack) entry.techStack = rest.techStack;
  if (rest.icon) entry.icon = rest.icon;
  if (rest.color) entry.color = rest.color;
  if (rest.tags && Array.isArray(rest.tags)) entry.tags = rest.tags;
  if (rest.repository) entry.repository = rest.repository;
  if (rest.devServer) entry.devServer = rest.devServer;
  if (rest.access) entry.access = rest.access;

  index.projects.push(entry);
  await writeIndex(index);

  return c.json({ ok: true, key: safe });
});

app.patch('/projects', async (c) => {
  const body = await c.req.json();

  // Mode 2: Reorder
  if (Array.isArray(body.order)) {
    const order: string[] = body.order;
    const index = await readIndex();
    const byKey = new Map(index.projects.map((p) => [p.key, p]));
    const reordered: ProjectEntry[] = [];
    for (const k of order) {
      const p = byKey.get(k);
      if (p) {
        reordered.push(p);
        byKey.delete(k);
      }
    }
    for (const p of byKey.values()) {
      reordered.push(p);
    }
    index.projects = reordered;
    await writeIndex(index);
    return c.json({ ok: true });
  }

  // Mode 1: Update metadata
  const { key, ...updates } = body;
  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const index = await readIndex();
  const project = index.projects.find((p) => p.key === key);
  if (!project) {
    return c.json({ error: 'project not found' }, 404);
  }

  const simpleFields = [
    'name', 'description', 'location', 'path', 'techStack', 'icon', 'color', 'defaultAgentId',
  ] as const;
  for (const field of simpleFields) {
    if (updates[field] !== undefined) {
      if (updates[field] === '' || updates[field] === null) {
        delete (project as unknown as Record<string, unknown>)[field];
      } else {
        (project as unknown as Record<string, unknown>)[field] = updates[field];
      }
    }
  }

  if (updates.tags !== undefined) {
    if (Array.isArray(updates.tags) && updates.tags.length > 0) {
      project.tags = updates.tags;
    } else {
      delete project.tags;
    }
  }

  if (updates.repository !== undefined) {
    if (updates.repository === null) {
      delete project.repository;
    } else {
      project.repository = { ...project.repository, ...updates.repository };
      for (const [k, v] of Object.entries(project.repository!)) {
        if (v === '' || v === null) delete (project.repository as Record<string, unknown>)[k];
      }
      if (Object.keys(project.repository!).length === 0) delete project.repository;
    }
  }

  if (updates.devServer !== undefined) {
    if (updates.devServer === null) {
      delete project.devServer;
    } else {
      project.devServer = { ...project.devServer, ...updates.devServer };
      for (const [k, v] of Object.entries(project.devServer!)) {
        if (v === '' || v === null) delete (project.devServer as Record<string, unknown>)[k];
      }
      if (Object.keys(project.devServer!).length === 0) delete project.devServer;
    }
  }

  if (updates.access !== undefined) {
    if (updates.access === null) {
      delete project.access;
    } else {
      project.access = { ...project.access, ...updates.access };
      for (const [k, v] of Object.entries(project.access!)) {
        if (v === '' || v === null) delete (project.access as Record<string, unknown>)[k];
      }
      if (Object.keys(project.access!).length === 0) delete project.access;
    }
  }

  project.updatedAt = new Date().toISOString();
  await writeIndex(index);

  return c.json({ ok: true });
});

app.delete('/projects', async (c) => {
  const { key } = await c.req.json();
  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const index = await readIndex();
  const project = index.projects.find((p) => p.key === key);
  if (!project) {
    return c.json({ error: 'project not found' }, 404);
  }

  project.archived = true;
  project.archivedAt = new Date().toISOString();
  await writeIndex(index);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/data/agents-workspace-ui — Agents 工作区已打开标签（按 projectKey）
// ---------------------------------------------------------------------------

function parseAgentsWorkspacePersist(body: unknown): AgentsWorkspaceProjectPersist | null {
  if (body === null || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.tabs)) return null;
  const tabs: AgentsWorkspaceProjectPersist['tabs'] = [];
  for (const row of o.tabs) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.agentId !== 'string' || !r.agentId.trim()) continue;
    const sessionId = r.sessionId === null || r.sessionId === undefined
      ? null
      : typeof r.sessionId === 'string'
        ? r.sessionId
        : null;
    tabs.push({ agentId: r.agentId.trim(), sessionId });
  }
  let active: AgentsWorkspaceActivePersist | null = null;
  if (o.active !== null && o.active !== undefined && typeof o.active === 'object') {
    const a = o.active as Record<string, unknown>;
    if (a.kind === 'session' && typeof a.agentId === 'string' && a.agentId.trim()) {
      const sid = a.sessionId === null || a.sessionId === undefined
        ? null
        : typeof a.sessionId === 'string'
          ? a.sessionId
          : null;
      active = { kind: 'session', agentId: a.agentId.trim(), sessionId: sid };
    } else if (a.kind === 'agent' && typeof a.agentId === 'string' && a.agentId.trim()) {
      const mode = a.mode === 'settings' ? 'settings' : 'chat';
      active = { kind: 'agent', agentId: a.agentId.trim(), mode };
    }
  }

  let lastFocusByAgent: Record<string, AgentsWorkspacePerAgentFocusPersist> | undefined;
  const lfRaw = o.lastFocusByAgent;
  if (lfRaw !== null && lfRaw !== undefined && typeof lfRaw === 'object' && !Array.isArray(lfRaw)) {
    const lf: Record<string, AgentsWorkspacePerAgentFocusPersist> = {};
    for (const [agentId, v] of Object.entries(lfRaw as Record<string, unknown>)) {
      const aid = agentId.trim();
      if (!aid) continue;
      if (v === null || typeof v !== 'object') continue;
      const fv = v as Record<string, unknown>;
      if (fv.kind === 'session') {
        const sid = fv.sessionId === null || fv.sessionId === undefined
          ? null
          : typeof fv.sessionId === 'string'
            ? fv.sessionId
            : null;
        lf[aid] = { kind: 'session', sessionId: sid };
      } else if (fv.kind === 'agent') {
        const mode = fv.mode === 'settings' ? 'settings' : 'chat';
        lf[aid] = { kind: 'agent', mode };
      }
    }
    if (Object.keys(lf).length > 0) lastFocusByAgent = lf;
  }

  return { tabs, active, lastFocusByAgent };
}

app.get('/agents-workspace-ui', async (c) => {
  await ensureDataDirV2Migrated();
  const q = c.req.query('projectKey');
  if (q !== undefined && q !== '' && !isValidProjectKey(q)) {
    return c.json({ error: 'invalid projectKey' }, 400);
  }
  const projectKey = q === undefined || q === '' ? null : q;
  if (projectKey !== null) {
    const index = await readIndex();
    const p = index.projects.find((x) => x.key === projectKey);
    if (!p || p.archived) {
      return c.json({ error: 'unknown or archived project' }, 404);
    }
  }
  const state = await readAgentsWorkspaceProjectState(projectKey);
  const base: AgentsWorkspaceProjectPersist = state ?? { tabs: [], active: null, lastFocusByAgent: undefined };
  const cleaned = await sanitizeAgentsWorkspaceProjectState(projectKey, base);
  return c.json(cleaned);
});

app.put('/agents-workspace-ui', async (c) => {
  await ensureDataDirV2Migrated();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  if (body === null || typeof body !== 'object') {
    return c.json({ error: 'body required' }, 400);
  }
  const rec = body as Record<string, unknown>;
  const pkRaw = rec.projectKey;
  let projectKey: string | null;
  if (pkRaw === null || pkRaw === undefined || pkRaw === '') {
    projectKey = null;
  } else if (typeof pkRaw === 'string' && isValidProjectKey(pkRaw)) {
    projectKey = pkRaw;
  } else {
    return c.json({ error: 'invalid projectKey' }, 400);
  }

  if (projectKey !== null) {
    const index = await readIndex();
    const p = index.projects.find((x) => x.key === projectKey);
    if (!p || p.archived) {
      return c.json({ error: 'unknown or archived project' }, 404);
    }
  }

  const parsed = parseAgentsWorkspacePersist(body);
  if (!parsed) {
    return c.json({ error: 'invalid tabs' }, 400);
  }

  const cleaned = await sanitizeAgentsWorkspaceProjectState(projectKey, parsed);
  await writeAgentsWorkspaceProjectState(projectKey, cleaned.tabs.length > 0 ? cleaned : null);
  return c.json({ ok: true });
});

export default app;
