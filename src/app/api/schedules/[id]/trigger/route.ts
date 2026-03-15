import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/schedules/[id]/trigger
 * 手动触发一次调度规则。
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const res = await sidecarFetch(`/schedules/${encodeURIComponent(id)}/trigger`, {
      method: 'POST',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
