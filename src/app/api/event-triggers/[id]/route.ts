import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';
import type { EventTrigger } from '@/types/event-trigger';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/event-triggers/[id]
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const res = await sidecarFetch(`/event-triggers/${encodeURIComponent(id)}`);
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PATCH /api/event-triggers/[id]
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json() as Partial<Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>>;

  try {
    const res = await sidecarFetch(`/event-triggers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/event-triggers/[id]
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const res = await sidecarFetch(`/event-triggers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
