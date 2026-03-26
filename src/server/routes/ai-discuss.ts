import { Hono } from 'hono';
import { exec } from 'child_process';
import { getAppWorkingDir } from '@/lib/app-paths';

const app = new Hono();

// ─── POST / — start a discussion session for a plan ─────────────

app.post('/', async (c) => {
  const body = await c.req.json();
  const { taskId, planId } = body;

  if (!taskId || !planId) {
    return c.json({ error: 'taskId and planId are required' }, 400);
  }

  const cmd = `node scripts/agents/discussor.js ${taskId} ${planId}`;
  exec(cmd, { cwd: getAppWorkingDir() });

  return c.json({ success: true });
});

export default app;
