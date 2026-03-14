import { NextRequest, NextResponse } from 'next/server';
import '@/lib/satellite-tasks'; // side-effect: registers all tasks
import { satelliteRegistry, getSatelliteTaskConfig, setTaskEnabled } from '@/lib/satellite-tasks';
import { getRunStats } from '@/lib/satellite-tasks/run-store';
import { getTaskParams, setTaskParams } from '@/lib/satellite-tasks/config';

/**
 * GET /api/satellite-tasks
 *
 * Returns all registered satellite tasks with their enabled/disabled state,
 * config schema, current params, and execution statistics.
 */
export async function GET() {
  const tasks = satelliteRegistry.getAllSorted();
  const config = await getSatelliteTaskConfig();

  const items = await Promise.all(
    tasks.map(async (task) => {
      const [stats, params] = await Promise.all([
        getRunStats(task.id),
        getTaskParams(task.id),
      ]);
      const configSchema = task.getConfigSchema?.() ?? null;
      return {
        id: task.id,
        description: task.description,
        priority: task.priority,
        requiresAI: task.requiresAI,
        enabled: config.enabledMap[task.id] !== false, // default: enabled
        configSchema,
        params,
        stats,
      };
    }),
  );

  return NextResponse.json({ tasks: items });
}

/**
 * PUT /api/satellite-tasks
 *
 * Toggle enabled/disabled for a specific task.
 * Body: { id: string, enabled: boolean }
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, enabled } = body as { id?: string; enabled?: boolean };

  if (!id || typeof enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Missing required fields: id (string), enabled (boolean)' },
      { status: 400 },
    );
  }

  // Verify task exists
  const task = satelliteRegistry.get(id);
  if (!task) {
    return NextResponse.json(
      { error: `Unknown satellite task: ${id}` },
      { status: 404 },
    );
  }

  await setTaskEnabled(id, enabled);

  return NextResponse.json({ id, enabled });
}

/**
 * PATCH /api/satellite-tasks
 *
 * Update configurable parameters for a specific task.
 * Body: { id: string, params: Record<string, unknown> }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, params } = body as { id?: string; params?: Record<string, unknown> };

  if (!id || !params || typeof params !== 'object') {
    return NextResponse.json(
      { error: 'Missing required fields: id (string), params (object)' },
      { status: 400 },
    );
  }

  const task = satelliteRegistry.get(id);
  if (!task) {
    return NextResponse.json(
      { error: `Unknown satellite task: ${id}` },
      { status: 404 },
    );
  }

  if (!task.getConfigSchema) {
    return NextResponse.json(
      { error: `Task "${id}" has no configurable parameters` },
      { status: 400 },
    );
  }

  await setTaskParams(id, params);

  return NextResponse.json({ id, params });
}
