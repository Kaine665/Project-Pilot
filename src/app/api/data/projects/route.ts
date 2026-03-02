import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  getFlowsDir,
  getFlowIndexPath,
  getFlowDataPath,
  readJsonFile,
  writeJsonFile,
  ensureFlowsMigrated,
} from '@/lib/file-store';
import type { ProjectEntry, ProjectIndex } from '@/types';

async function readIndex(): Promise<ProjectIndex> {
  await ensureFlowsMigrated();
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
  const { key, name } = await request.json();
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

  // Update index
  index.projects.push({ key: safe, name });
  await writeIndex(index);

  return NextResponse.json({ ok: true, key: safe });
}

/**
 * PATCH /api/data/projects
 *
 * Two modes:
 * 1. Update project metadata: { key, name?, description? }
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
  const { key, name, description } = body;
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description || undefined;
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
