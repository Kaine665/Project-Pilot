import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  createDialogue,
  listDialogues,
  runDialogue,
  getDialogue,
  deleteDialogue,
  stopDialogue,
  dialogueEvents,
  type DialogueSSEEvent,
} from '@/lib/dialogue-manager';
import type { DialogueTerminationMode } from '@/types';

const app = new Hono();

// ─── GET / — list all dialogues (lightweight index, no messages) ──

app.get('/', async (c) => {
  try {
    const dialogues = await listDialogues();
    return c.json({ dialogues });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── POST / — create and start a dialogue ────────────────────────

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, agentA, agentB, maxRounds, terminationMode, projectKey } = body as {
      title: string;
      description?: string;
      agentA: { id: string; name: string };
      agentB: { id: string; name: string };
      maxRounds?: number;
      terminationMode?: DialogueTerminationMode;
      projectKey?: string;
    };

    if (!title || typeof title !== 'string' || title.length > 500) {
      return c.json({ error: 'title is required (max 500 chars)' }, 400);
    }
    if (!agentA?.id || !agentA?.name || !agentB?.id || !agentB?.name) {
      return c.json({ error: 'agentA and agentB with id and name are required' }, 400);
    }
    if (maxRounds !== undefined && (typeof maxRounds !== 'number' || maxRounds < 1 || maxRounds > 50)) {
      return c.json({ error: 'maxRounds must be 1-50' }, 400);
    }

    const dialogue = await createDialogue({
      title,
      description,
      agentA,
      agentB,
      maxRounds,
      terminationMode,
      projectKey,
    });

    runDialogue(dialogue.id).catch(err => {
      console.error(`[dialogue] runDialogue failed for ${dialogue.id}:`, err);
    });

    return c.json(dialogue, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── GET /:id — get dialogue details (with messages) ─────────────

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const dialogue = await getDialogue(id);
    if (!dialogue) {
      return c.json({ error: 'Dialogue not found' }, 404);
    }
    return c.json(dialogue);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── DELETE /:id — delete a dialogue ─────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const ok = await deleteDialogue(id);
    if (!ok) {
      return c.json({ error: 'Dialogue not found' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── GET /:id/stream — SSE for real-time dialogue progress ───────

app.get('/:id/stream', (c) => {
  const id = c.req.param('id');

  return streamSSE(c, async (stream) => {
    const eventName = `dialogue:${id}`;

    const listener = async (event: DialogueSSEEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.data),
      });

      if (event.type === 'done') {
        stream.close();
      }
    };

    dialogueEvents.on(eventName, listener);

    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ data: '', event: 'heartbeat' });
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    stream.onAbort(() => {
      dialogueEvents.off(eventName, listener);
      clearInterval(heartbeat);
    });

    await stream.sleep(Infinity);
  });
});

// ─── POST /:id/stop — manually stop a running dialogue ──────────

app.post('/:id/stop', async (c) => {
  const id = c.req.param('id');
  try {
    const ok = await stopDialogue(id);
    if (!ok) {
      return c.json({ error: 'Dialogue not found or not running' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
