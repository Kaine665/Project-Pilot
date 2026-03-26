import { Hono } from 'hono';
import {
  getFlowIndexPath,
  readJsonFile,
  writeJsonFile,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import type { ProjectConfig, ProjectEntry, ProjectIndex } from '@/types';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readIndex(): Promise<ProjectIndex> {
  await ensureDataDirV2Migrated();
  return readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
}

function entryToConfig(entry: ProjectEntry): ProjectConfig {
  return {
    name: entry.name,
    path: entry.path || '',
    type: (entry.techStack as ProjectConfig['type']) || 'other',
    ...(entry.description && { description: entry.description }),
    ...(entry.repository?.defaultBranch && { defaultBranch: entry.repository.defaultBranch }),
    ...(entry.devServer?.command && { webCommand: entry.devServer.command }),
    ...(entry.devServer?.url && { webUrl: entry.devServer.url }),
  };
}

function buildLegacyResponse(index: ProjectIndex): Record<string, ProjectConfig> {
  const projects: Record<string, ProjectConfig> = {};
  for (const entry of index.projects) {
    if (!entry.archived) {
      projects[entry.key] = entryToConfig(entry);
    }
  }
  return projects;
}

// ---------------------------------------------------------------------------
// GET / — Return all projects in legacy format
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const index = await readIndex();
  return c.json({ projects: buildLegacyResponse(index) });
});

// ---------------------------------------------------------------------------
// POST / — Add or update a project (legacy format)
// ---------------------------------------------------------------------------

app.post('/', async (c) => {
  const body = await c.req.json();
  const { key, name, path: projectPath, type, description, defaultBranch, webCommand, webUrl } = body;

  if (!key || !name || !projectPath || !type) {
    return c.json({ error: 'key, name, path, and type are required' }, 400);
  }

  const index = await readIndex();
  const existing = index.projects.find(p => p.key === key);

  if (existing) {
    existing.name = name;
    existing.path = projectPath;
    existing.techStack = type;
    if (description !== undefined) existing.description = description || undefined;
    if (defaultBranch !== undefined) {
      existing.repository = { ...existing.repository, defaultBranch: defaultBranch || undefined };
    }
    if (webCommand !== undefined || webUrl !== undefined) {
      existing.devServer = {
        ...existing.devServer,
        ...(webCommand !== undefined && { command: webCommand }),
        ...(webUrl !== undefined && { url: webUrl }),
      };
    }
    existing.updatedAt = new Date().toISOString();
  } else {
    const now = new Date().toISOString();
    const entry: ProjectEntry = {
      key,
      name,
      path: projectPath,
      techStack: type,
      location: 'local',
      createdAt: now,
      updatedAt: now,
      ...(description && { description }),
      ...(defaultBranch && { repository: { defaultBranch } }),
      ...((webCommand || webUrl) && {
        devServer: {
          ...(webCommand && { command: webCommand }),
          ...(webUrl && { url: webUrl }),
        },
      }),
    };
    index.projects.push(entry);
  }

  await writeJsonFile(getFlowIndexPath(), index);
  return c.json({ projects: buildLegacyResponse(index) });
});

// ---------------------------------------------------------------------------
// DELETE / — Remove a project by key (soft delete / archive)
// ---------------------------------------------------------------------------

app.delete('/', async (c) => {
  const body = await c.req.json();
  const { key } = body;

  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  project.archived = true;
  project.archivedAt = new Date().toISOString();
  await writeJsonFile(getFlowIndexPath(), index);

  return c.json({ projects: buildLegacyResponse(index) });
});

export default app;
