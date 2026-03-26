import { Hono } from 'hono';
import '@/lib/satellite-tasks'; // side-effect: registers all tasks
import { satelliteRegistry, getSatelliteTaskConfig, setTaskEnabled } from '@/lib/satellite-tasks';
import { getRunStats, getRunsByTask, clearRunsByTask } from '@/lib/satellite-tasks/run-store';
import { getTaskParams, setTaskParams } from '@/lib/satellite-tasks/config';

const app = new Hono();

// ─── GET / — list all satellite tasks with state, config, and stats ──

app.get('/', async (c) => {
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
        enabled: config.enabledMap[task.id] !== false,
        configSchema,
        params,
        stats,
      };
    }),
  );

  return c.json({ tasks: items });
});

// ─── PUT / — toggle enabled/disabled for a task ─────────────────

app.put('/', async (c) => {
  const body = await c.req.json();
  const { id, enabled } = body as { id?: string; enabled?: boolean };

  if (!id || typeof enabled !== 'boolean') {
    return c.json(
      { error: 'Missing required fields: id (string), enabled (boolean)' },
      400,
    );
  }

  const task = satelliteRegistry.get(id);
  if (!task) {
    return c.json({ error: `Unknown satellite task: ${id}` }, 404);
  }

  await setTaskEnabled(id, enabled);
  return c.json({ id, enabled });
});

// ─── PATCH / — update configurable parameters for a task ────────

app.patch('/', async (c) => {
  const body = await c.req.json();
  const { id, params } = body as { id?: string; params?: Record<string, unknown> };

  if (!id || !params || typeof params !== 'object') {
    return c.json(
      { error: 'Missing required fields: id (string), params (object)' },
      400,
    );
  }

  const task = satelliteRegistry.get(id);
  if (!task) {
    return c.json({ error: `Unknown satellite task: ${id}` }, 404);
  }

  if (!task.getConfigSchema) {
    return c.json({ error: `Task "${id}" has no configurable parameters` }, 400);
  }

  await setTaskParams(id, params);
  return c.json({ id, params });
});

// ─── GET /runs — paginated execution records for a task ─────────

app.get('/runs', async (c) => {
  const taskId = c.req.query('taskId');

  if (!taskId) {
    return c.json({ error: 'Missing required query parameter: taskId' }, 400);
  }

  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);

  const [{ runs, total }, stats] = await Promise.all([
    getRunsByTask(taskId, limit, offset),
    getRunStats(taskId),
  ]);

  return c.json({ runs, total, stats });
});

// ─── DELETE /runs — clear all execution records for a task ──────

app.delete('/runs', async (c) => {
  const body = await c.req.json();
  const { taskId } = body as { taskId?: string };

  if (!taskId) {
    return c.json({ error: 'Missing required field: taskId' }, 400);
  }

  await clearRunsByTask(taskId);
  return c.json({ ok: true });
});

export default app;
