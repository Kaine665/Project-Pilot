import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/schedules/[id]/runs
 * 查询某条调度规则的执行历史。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const limit = req.nextUrl.searchParams.get('limit') ?? '20';
  try {
    const res = await sidecarFetch(
      `/schedules/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(limit)}`,
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
