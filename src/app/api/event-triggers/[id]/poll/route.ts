import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/event-triggers/[id]/poll
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const res = await sidecarFetch(`/event-triggers/${encodeURIComponent(id)}/poll`, {
      method: 'POST',
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
