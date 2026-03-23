import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/todos/[id]/dispatch
 * Dispatch a todo to its assigned agent via the sidecar.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const res = await sidecarFetch(`/todos/${encodeURIComponent(id)}/dispatch`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
