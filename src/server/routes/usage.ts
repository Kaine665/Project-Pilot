import { Hono } from 'hono';
import { queryUsageRecords, getUsageSummary, getSessionUsage } from '@/lib/usage-store';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const mode = c.req.query('mode') || 'summary';

    if (mode === 'summary') {
      const rebuild = c.req.query('rebuild') === '1' || c.req.query('rebuild') === 'true';
      const summary = await getUsageSummary(rebuild);
      return c.json(summary);
    }

    if (mode === 'session') {
      const sessionId = c.req.query('sessionId');
      if (!sessionId) {
        return c.json({ error: 'sessionId required' }, 400);
      }
      const usage = await getSessionUsage(sessionId);
      if (!usage) {
        return c.json({ inputTokens: 0, outputTokens: 0 });
      }
      return c.json(usage);
    }

    // mode === 'records'
    const limit = parseInt(c.req.query('limit') || '500', 10);
    const records = await queryUsageRecords({
      agentId: c.req.query('agentId') || undefined,
      projectKey: c.req.query('projectKey') || undefined,
      sessionId: c.req.query('sessionId') || undefined,
      since: c.req.query('since') || undefined,
      until: c.req.query('until') || undefined,
    });

    const sorted = records.sort((a, b) => b.ts.localeCompare(a.ts));
    const limited = sorted.slice(0, Math.min(limit, 2000));

    return c.json({
      total: records.length,
      returned: limited.length,
      records: limited,
    });
  } catch (err) {
    console.error('[api/usage] Error:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
});

export default app;
