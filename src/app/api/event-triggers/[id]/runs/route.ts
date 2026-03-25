import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/event-triggers/[id]/runs
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const limit = req.nextUrl.searchParams.get('limit') ?? '20';
  try {
    const res = await sidecarFetch(
      `/event-triggers/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(limit)}`,
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
