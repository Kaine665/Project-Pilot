/**
 * GET  /api/settings/model-health — 读取最近一次巡检结果
 * POST /api/settings/model-health — 触发一次巡检（可选 provider 过滤）
 *
 * 结果存储在 ~/.project-pilot/data/models-health.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { runHealthCheck, readHealthResults } from '@/lib/model-health-check';
import type { ProviderId } from '@/types';

export async function GET() {
  const data = await readHealthResults();
  if (!data) {
    return NextResponse.json({ ok: true, data: null, message: 'No health check results yet' });
  }

  // Compute summary
  const entries = Object.entries(data.results);
  const summary = {
    total: entries.length,
    ok: entries.filter(([, r]) => r.status === 'ok').length,
    failed: entries.filter(([, r]) => r.status === 'failed').length,
    skipped: entries.filter(([, r]) => r.status === 'skipped').length,
  };

  return NextResponse.json({ ok: true, data, summary });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const providerFilter = body.provider as ProviderId | undefined;

    const result = await runHealthCheck({ providerFilter });

    const entries = Object.entries(result.results);
    const summary = {
      total: entries.length,
      ok: entries.filter(([, r]) => r.status === 'ok').length,
      failed: entries.filter(([, r]) => r.status === 'failed').length,
      skipped: entries.filter(([, r]) => r.status === 'skipped').length,
    };

    return NextResponse.json({ ok: true, data: result, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
