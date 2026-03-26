import { Hono } from 'hono';
import { schedulerManager } from '@/lib/scheduler-manager';

const app = new Hono();

// ─── GET / — list all schedules ─────────────────────────────────
// DIRECT: replaces sidecarFetch('/schedules')

app.get('/', async (c) => {
  try {
    const schedules = await schedulerManager.listSchedules();
    return c.json({ schedules });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── POST / — create a new schedule ─────────────────────────────
// DIRECT: replaces sidecarFetch('/schedules', POST)

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { targetType, agentId, todoId, cron, message, projectKey, label, enabled } = body as {
    targetType?: 'agent_message' | 'todo' | 'message';
    agentId?: string;
    todoId?: string;
    cron?: string;
    message?: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  };

  if (!cron || typeof cron !== 'string') {
    return c.json({ error: 'cron is required' }, 400);
  }
  const normalizedTargetType = !targetType || targetType === 'message' ? 'agent_message' : targetType;
  if (normalizedTargetType === 'agent_message' && (!agentId || typeof agentId !== 'string')) {
    return c.json({ error: 'agentId is required for agent_message schedules' }, 400);
  }
  if (normalizedTargetType === 'agent_message' && (!message || typeof message !== 'string' || message.length > 10000)) {
    return c.json({ error: 'message is required for agent_message schedules' }, 400);
  }
  if (normalizedTargetType === 'todo' && (!todoId || typeof todoId !== 'string')) {
    return c.json({ error: 'todoId is required for todo schedules' }, 400);
  }
  if (projectKey !== undefined && typeof projectKey !== 'string') {
    return c.json({ error: 'projectKey must be a string' }, 400);
  }

  try {
    const schedule = await schedulerManager.createSchedule({
      targetType: normalizedTargetType,
      agentId,
      todoId,
      cron,
      message,
      projectKey,
      label: label ? String(label).slice(0, 100) : undefined,
      enabled: enabled !== false,
    });
    return c.json({ schedule }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ─── GET /:id — get a single schedule ───────────────────────────
// DIRECT: replaces sidecarFetch('/schedules/:id')

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const schedules = await schedulerManager.listSchedules();
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ schedule });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── PATCH /:id — update a schedule (partial) ───────────────────
// DIRECT: replaces sidecarFetch('/schedules/:id', PATCH)

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { targetType, agentId, todoId, cron, message, label, enabled, projectKey } = body as {
    targetType?: 'agent_message' | 'todo' | 'message';
    agentId?: string;
    todoId?: string;
    cron?: string;
    message?: string;
    label?: string;
    enabled?: boolean;
    projectKey?: string;
  };

  if (message !== undefined && (typeof message !== 'string' || message.length > 10000)) {
    return c.json({ error: 'message must be a string up to 10000 chars' }, 400);
  }

  try {
    const updated = await schedulerManager.updateSchedule(id, {
      ...(targetType !== undefined ? { targetType } : {}),
      ...(agentId !== undefined ? { agentId } : {}),
      ...(todoId !== undefined ? { todoId } : {}),
      ...(cron !== undefined ? { cron } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(label !== undefined ? { label: String(label).slice(0, 100) } : {}),
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(projectKey !== undefined ? { projectKey } : {}),
    });
    if (!updated) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ schedule: updated });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ─── DELETE /:id — delete a schedule ────────────────────────────
// DIRECT: replaces sidecarFetch('/schedules/:id', DELETE)

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const deleted = await schedulerManager.deleteSchedule(id);
    if (!deleted) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── POST /:id/trigger — manually trigger a schedule ────────────
// DIRECT: replaces sidecarFetch('/schedules/:id/trigger', POST)

app.post('/:id/trigger', async (c) => {
  const id = c.req.param('id');
  try {
    const run = await schedulerManager.triggerNow(id);
    return c.json({ run });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('不存在') ? 404 : 400;
    return c.json({ error: msg }, status as 404 | 400);
  }
});

// ─── GET /:id/runs — list execution history for a schedule ──────
// DIRECT: replaces sidecarFetch('/schedules/:id/runs')

app.get('/:id/runs', async (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  try {
    const runs = await schedulerManager.listRuns(id, limit);
    return c.json({ runs });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
