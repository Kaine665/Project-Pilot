import { NextRequest, NextResponse } from 'next/server';
import '@/lib/satellite-tasks'; // side-effect: registers all tasks
import { satelliteRegistry, getSatelliteTaskConfig, setTaskEnabled } from '@/lib/satellite-tasks';

/**
 * GET /api/satellite-tasks
 *
 * Returns all registered satellite tasks with their enabled/disabled state.
 */
export async function GET() {
  const tasks = satelliteRegistry.getAllSorted();
  const config = await getSatelliteTaskConfig();

  const items = tasks.map(task => ({
    id: task.id,
    description: task.description,
    priority: task.priority,
    requiresAI: task.requiresAI,
    enabled: config.enabledMap[task.id] !== false, // default: enabled
  }));

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
