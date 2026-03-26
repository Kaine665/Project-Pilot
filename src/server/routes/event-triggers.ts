import { Hono } from 'hono';
import { eventTriggerManager } from '@/lib/event-trigger-manager';
import type { EventTrigger } from '@/types/event-trigger';

const app = new Hono();

// ─── GET / — list all event triggers ────────────────────────────
// DIRECT: replaces sidecarFetch('/event-triggers')

app.get('/', async (c) => {
  try {
    const triggers = await eventTriggerManager.listTriggers();
    return c.json({ triggers });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── POST / — create a new event trigger ────────────────────────
// DIRECT: replaces sidecarFetch('/event-triggers', POST)

app.post('/', async (c) => {
  const body = await c.req.json() as Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>;

  try {
    const trigger = await eventTriggerManager.createTrigger(body);
    return c.json({ trigger }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ─── GET /:id — get a single event trigger ──────────────────────
// DIRECT: replaces sidecarFetch('/event-triggers/:id')

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const triggers = await eventTriggerManager.listTriggers();
    const trigger = triggers.find((item) => item.id === id);
    if (!trigger) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ trigger });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── PATCH /:id — update an event trigger (partial) ─────────────
// DIRECT: replaces sidecarFetch('/event-triggers/:id', PATCH)

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as Partial<Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>>;

  try {
    const trigger = await eventTriggerManager.updateTrigger(id, body);
    if (!trigger) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ trigger });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ─── DELETE /:id — delete an event trigger ──────────────────────
// DIRECT: replaces sidecarFetch('/event-triggers/:id', DELETE)

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const deleted = await eventTriggerManager.deleteTrigger(id);
    if (!deleted) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── POST /:id/poll — manually poll an event trigger ────────────
// DIRECT: replaces sidecarFetch('/event-triggers/:id/poll', POST)

app.post('/:id/poll', async (c) => {
  const id = c.req.param('id');
  try {
    const runs = await eventTriggerManager.pollNow(id);
    return c.json({ runs });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('not found') ? 404 : 400;
    return c.json({ error: msg }, status as 404 | 400);
  }
});

// ─── GET /:id/runs — list execution history for a trigger ───────
// DIRECT: replaces sidecarFetch('/event-triggers/:id/runs')

app.get('/:id/runs', async (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  try {
    const runs = await eventTriggerManager.listRuns(id, limit);
    return c.json({ runs });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
