import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const FLOWS_DIR = path.join(process.cwd(), 'src/data/flows');
const INDEX_PATH = path.join(FLOWS_DIR, '_index.json');

interface ProjectEntry {
  key: string;
  name: string;
}

interface ProjectIndex {
  projects: ProjectEntry[];
}

async function readIndex(): Promise<ProjectIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
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
  await fs.writeFile(
    path.join(FLOWS_DIR, `${safe}.json`),
    JSON.stringify(emptyData, null, 2),
    'utf-8',
  );

  // Update index
  index.projects.push({ key: safe, name });
  await writeIndex(index);

  return NextResponse.json({ ok: true, key: safe });
}
