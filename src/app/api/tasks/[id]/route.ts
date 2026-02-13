import { NextRequest, NextResponse } from 'next/server';
import { getTasksPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { Task, TasksData } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };

/**
 * GET /api/tasks/[id]
 * Return a single task by id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  const task = data.tasks.find((t) => t.id === id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json(task);
}

/**
 * PATCH /api/tasks/[id]
 * Update task fields (title, content, status, projectKey, ai_execution).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  let updatedTask: Task | null = null;

  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return data;

    const task = data.tasks[index];
    const now = new Date().toISOString();

    const merged: Task = {
      ...task,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.projectKey !== undefined && { projectKey: body.projectKey }),
      ...(body.ai_execution !== undefined && { ai_execution: body.ai_execution }),
      updatedAt: now,
      ...(body.status === 'done' && !task.completedAt && { completedAt: now }),
    };

    const tasks = [...data.tasks];
    tasks[index] = merged;
    updatedTask = merged;
    return { ...data, tasks };
  });

  if (!updatedTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json(updatedTask);
}

/**
 * DELETE /api/tasks/[id]
 * Remove a task.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let found = false;

  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return data;
    found = true;
    const tasks = data.tasks.filter((t) => t.id !== id);
    return { ...data, tasks };
  });

  if (!found) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
