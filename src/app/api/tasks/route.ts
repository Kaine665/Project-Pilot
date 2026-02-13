import { NextRequest, NextResponse } from 'next/server';
import { getTasksPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { Task, TasksData } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };

/**
 * GET /api/tasks
 * Return all tasks.
 */
export async function GET() {
  const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  return NextResponse.json(data);
}

/**
 * POST /api/tasks
 * Create a new task.
 * Body: { title, content?, projectKey }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, content, projectKey } = body;

  if (!title || !projectKey) {
    return NextResponse.json(
      { error: 'title and projectKey are required' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const newTask: Task = {
    id: `task-${Date.now()}`,
    title,
    content: content ?? undefined,
    projectKey,
    status: 'todo',
    createdAt: now,
    updatedAt: now,
  };

  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => ({
    ...data,
    tasks: [...data.tasks, newTask],
  }));

  return NextResponse.json(newTask, { status: 201 });
}
