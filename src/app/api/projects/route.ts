/**
 * @deprecated 旧版项目 API — 代理到新系统 /api/data/projects
 *
 * 保留此端点是为了兼容旧版调用方（orchestrator、ProjectRegistry 等）。
 * 内部改为读写 flows/_index.json，不再操作 projects.json。
 *
 * GET 返回格式保持 { projects: Record<key, ProjectConfig> } 以兼容旧调用方。
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getFlowIndexPath,
  readJsonFile,
  writeJsonFile,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import type { ProjectConfig, ProjectEntry, ProjectIndex } from '@/types';

async function readIndex(): Promise<ProjectIndex> {
  await ensureDataDirV2Migrated();
  return readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
}

/** 将 ProjectEntry 转换为旧版 ProjectConfig 格式 */
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

/**
 * GET /api/projects
 * Return all projects in legacy format { projects: Record<key, ProjectConfig> }
 */
export async function GET() {
  const index = await readIndex();
  const projects: Record<string, ProjectConfig> = {};
  for (const entry of index.projects) {
    if (!entry.archived) {
      projects[entry.key] = entryToConfig(entry);
    }
  }
  return NextResponse.json({ projects });
}

/**
 * POST /api/projects
 * Add or update a project (legacy format).
 * Body: { key, name, path, type, description?, defaultBranch?, webCommand?, webUrl? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, name, path: projectPath, type, description, defaultBranch, webCommand, webUrl } = body;

  if (!key || !name || !projectPath || !type) {
    return NextResponse.json(
      { error: 'key, name, path, and type are required' },
      { status: 400 },
    );
  }

  const index = await readIndex();
  const existing = index.projects.find(p => p.key === key);

  if (existing) {
    // Update existing
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
    // Create new
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

  // Return in legacy format
  const projects: Record<string, ProjectConfig> = {};
  for (const entry of index.projects) {
    if (!entry.archived) {
      projects[entry.key] = entryToConfig(entry);
    }
  }
  return NextResponse.json({ projects });
}

/**
 * DELETE /api/projects
 * Remove a project by key.
 * Body: { key }
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { key } = body;

  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const index = await readIndex();
  const project = index.projects.find(p => p.key === key);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Soft delete (archive)
  project.archived = true;
  project.archivedAt = new Date().toISOString();
  await writeJsonFile(getFlowIndexPath(), index);

  // Return in legacy format
  const projects: Record<string, ProjectConfig> = {};
  for (const entry of index.projects) {
    if (!entry.archived) {
      projects[entry.key] = entryToConfig(entry);
    }
  }
  return NextResponse.json({ projects });
}
