import { NextRequest, NextResponse } from 'next/server';
import { getProjectsPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { ProjectsData } from '@/types';

const DEFAULT_PROJECTS_DATA: ProjectsData = { projects: {} };

/**
 * GET /api/projects
 * Return all projects.
 */
export async function GET() {
  const data = await readJsonFile<ProjectsData>(getProjectsPath(), DEFAULT_PROJECTS_DATA);
  return NextResponse.json(data);
}

/**
 * POST /api/projects
 * Add or update a project.
 * Body: { key, name, path, type, webCommand?, webUrl? }
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

  const updated = await modifyJsonFile<ProjectsData>(
    getProjectsPath(),
    DEFAULT_PROJECTS_DATA,
    (data) => ({
      ...data,
      projects: {
        ...data.projects,
        [key]: {
          ...data.projects[key],
          name,
          path: projectPath,
          type,
          ...(description !== undefined && { description: description || undefined }),
          ...(defaultBranch !== undefined && { defaultBranch: defaultBranch || undefined }),
          ...(webCommand !== undefined && { webCommand }),
          ...(webUrl !== undefined && { webUrl }),
        },
      },
    }),
  );

  return NextResponse.json(updated);
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

  let found = false;

  const updated = await modifyJsonFile<ProjectsData>(
    getProjectsPath(),
    DEFAULT_PROJECTS_DATA,
    (data) => {
      if (!(key in data.projects)) return data;
      found = true;
      const { [key]: _, ...rest } = data.projects;
      return { ...data, projects: rest };
    },
  );

  if (!found) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(updated);
}
