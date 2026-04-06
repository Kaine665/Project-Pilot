/**
 * Agent Inbox API routes.
 *
 * GET  /api/agent-inbox/:agentId          — list inbox entries
 * GET  /api/agent-inbox/:agentId/count    — unread count
 * PATCH /api/agent-inbox/:agentId/read    — mark entries as read
 * POST /api/agent-inbox/:agentId/read-all — mark all as read
 */

import { Hono } from 'hono';
import * as inbox from '@/lib/inbox-manager';

const app = new Hono();

/** List inbox entries for an agent */
app.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const unreadOnly = c.req.query('unread') === 'true';
  const entries = await inbox.list(agentId, unreadOnly);
  return c.json({ ok: true, entries });
});

/** Get unread count */
app.get('/:agentId/count', async (c) => {
  const agentId = c.req.param('agentId');
  const count = await inbox.getUnreadCount(agentId);
  return c.json({ ok: true, count });
});

/** Mark specific entries as read */
app.patch('/:agentId/read', async (c) => {
  const agentId = c.req.param('agentId');
  const body = await c.req.json<{ ids: string[] }>();
  await inbox.markRead(agentId, body.ids);
  return c.json({ ok: true });
});

/** Mark all entries as read */
app.post('/:agentId/read-all', async (c) => {
  const agentId = c.req.param('agentId');
  await inbox.markAllRead(agentId);
  return c.json({ ok: true });
});

export default app;
