import { NextRequest, NextResponse } from 'next/server';
import { queryUsageRecords, getUsageSummary, getSessionUsage } from '@/lib/usage-store';

/**
 * GET /api/usage
 *
 * Query modes:
 *   ?mode=summary           → aggregated summary (by agent, project, date)
 *   ?mode=summary&rebuild=1 → force rebuild summary cache
 *   ?mode=records            → raw records with optional filters
 *   ?mode=session&sessionId= → usage for a specific session
 *
 * Filters (mode=records):
 *   ?agentId=...
 *   ?projectKey=...
 *   ?sessionId=...
 *   ?since=2026-03-01
 *   ?until=2026-03-31
 *   ?limit=100
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const mode = sp.get('mode') || 'summary';

    if (mode === 'summary') {
      const rebuild = sp.get('rebuild') === '1' || sp.get('rebuild') === 'true';
      const summary = await getUsageSummary(rebuild);
      return NextResponse.json(summary);
    }

    if (mode === 'session') {
      const sessionId = sp.get('sessionId');
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      }
      const usage = await getSessionUsage(sessionId);
      if (!usage) {
        return NextResponse.json({ inputTokens: 0, outputTokens: 0 });
      }
      return NextResponse.json(usage);
    }

    // mode === 'records'
    const limit = parseInt(sp.get('limit') || '500', 10);
    const records = await queryUsageRecords({
      agentId: sp.get('agentId') || undefined,
      projectKey: sp.get('projectKey') || undefined,
      sessionId: sp.get('sessionId') || undefined,
      since: sp.get('since') || undefined,
      until: sp.get('until') || undefined,
    });

    // Return most recent first, with limit
    const sorted = records.sort((a, b) => b.ts.localeCompare(a.ts));
    const limited = sorted.slice(0, Math.min(limit, 2000));

    return NextResponse.json({
      total: records.length,
      returned: limited.length,
      records: limited,
    });
  } catch (err) {
    console.error('[api/usage] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
