import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  getFlowsDir,
  getFlowIndexPath,
  getFlowDataPath,
  ensureFlowsMigrated,
} from '@/lib/file-store';

interface ProjectEntry {
  key: string;
  name: string;
}

interface ProjectIndex {
  projects: ProjectEntry[];
}

async function readIndex(): Promise<ProjectIndex> {
  await ensureFlowsMigrated();
  try {
    const raw = await fs.readFile(getFlowIndexPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await fs.mkdir(getFlowsDir(), { recursive: true });
  await fs.writeFile(getFlowIndexPath(), JSON.stringify(index, null, 2), 'utf-8');
}

export async function GET() {
  const index = await readIndex();
  return NextResponse.json(index);
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
 * Rename a project. Body: { key, name }
 */
export async function PATCH(request: NextRequest) {
  const { key, name } = await request.json();
  if (!key || !name) {
    return NextResponse.json({ error: 'key and name are required' }, { status: 400 });
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  project.name = name;
  await writeIndex(index);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/data/projects
 * Remove a project and its flow data. Body: { key }
 */
export async function DELETE(request: NextRequest) {
  const { key } = await request.json();
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const index = await readIndex();
  const idx = index.projects.findIndex(p => p.key === key);
  if (idx === -1) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  // Remove from index
  index.projects.splice(idx, 1);
  await writeIndex(index);

  // Delete flow data file
  const safe = (key as string).replace(/[^a-zA-Z0-9_-]/g, '');
  if (safe) {
    const flowPath = getFlowDataPath(safe);
    await fs.unlink(flowPath).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
