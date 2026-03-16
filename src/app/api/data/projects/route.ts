import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  getFlowsDir,
  getFlowIndexPath,
  getFlowDataPath,
  readJsonFile,
  writeJsonFile,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import type { ProjectEntry, ProjectIndex } from '@/types';

async function readIndex(): Promise<ProjectIndex> {
  await ensureDataDirV2Migrated();
  return readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await writeJsonFile(getFlowIndexPath(), index);
}

export async function GET(request: NextRequest) {
  const index = await readIndex();
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const projects = includeArchived ? index.projects : index.projects.filter(p => !p.archived);
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, name, path: projectPath, ...rest } = body;
  if (!key || !name) {
    return NextResponse.json({ error: 'key and name are required' }, { status: 400 });
  }

  const safe = (key as string).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }

  const index = await readIndex();
  if (index.projects.some(p => p.key === safe)) {
    return NextResponse.json({ error: 'project already exists' }, { status: 409 });
  }

  // Create empty flow data file
  const emptyData = { sections: [] };
  const flowPath = getFlowDataPath(safe);
  await fs.mkdir(getFlowsDir(), { recursive: true });
  await fs.writeFile(flowPath, JSON.stringify(emptyData, null, 2), 'utf-8');

  // Build project entry with all supported fields
  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    key: safe,
    name,
    createdAt: now,
    updatedAt: now,
  };

  // Path (required by UI but optional in type for backward compat)
  if (projectPath) entry.path = projectPath;

  // Optional scalar fields
  if (rest.description) entry.description = rest.description;
  if (rest.location) entry.location = rest.location;
  if (rest.techStack) entry.techStack = rest.techStack;
  if (rest.icon) entry.icon = rest.icon;
  if (rest.color) entry.color = rest.color;
  if (rest.tags && Array.isArray(rest.tags)) entry.tags = rest.tags;

  // Nested objects
  if (rest.repository) entry.repository = rest.repository;
  if (rest.devServer) entry.devServer = rest.devServer;
  if (rest.access) entry.access = rest.access;

  // Update index
  index.projects.push(entry);
  await writeIndex(index);

  return NextResponse.json({ ok: true, key: safe });
}

/**
 * PATCH /api/data/projects
 *
 * Two modes:
 * 1. Update project metadata: { key, ...fields }
 * 2. Reorder projects: { order: string[] }  — array of project keys in desired order
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  // Mode 2: Reorder
  if (Array.isArray(body.order)) {
    const order: string[] = body.order;
    const index = await readIndex();
    const byKey = new Map(index.projects.map(p => [p.key, p]));
    const reordered: ProjectEntry[] = [];
    for (const k of order) {
      const p = byKey.get(k);
      if (p) {
        reordered.push(p);
        byKey.delete(k);
      }
    }
    // Append any projects not in the order array (safety net)
    for (const p of byKey.values()) {
      reordered.push(p);
    }
    index.projects = reordered;
    await writeIndex(index);
    return NextResponse.json({ ok: true });
  }

  // Mode 1: Update metadata
  const { key, ...updates } = body;
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  // Simple scalar fields
  const simpleFields = ['name', 'description', 'location', 'path', 'techStack', 'icon', 'color', 'defaultAgentId'] as const;
  for (const field of simpleFields) {
    if (updates[field] !== undefined) {
      if (updates[field] === '' || updates[field] === null) {
        delete (project as unknown as Record<string, unknown>)[field];
      } else {
        (project as unknown as Record<string, unknown>)[field] = updates[field];
      }
    }
  }

  // Array fields
  if (updates.tags !== undefined) {
    if (Array.isArray(updates.tags) && updates.tags.length > 0) {
      project.tags = updates.tags;
    } else {
      delete project.tags;
    }
  }

  // Nested objects — merge, don't replace entirely
  if (updates.repository !== undefined) {
    if (updates.repository === null) {
      delete project.repository;
    } else {
      project.repository = { ...project.repository, ...updates.repository };
      // Clean up empty string values
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

  // Auto-update timestamp
  project.updatedAt = new Date().toISOString();

  await writeIndex(index);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/data/projects
 * Soft-delete a project (move to recycle bin). Body: { key }
 */
export async function DELETE(request: NextRequest) {
  const { key } = await request.json();
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  project.archived = true;
  project.archivedAt = new Date().toISOString();
  await writeIndex(index);

  return NextResponse.json({ ok: true });
}
