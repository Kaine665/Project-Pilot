import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';
import type { EventTrigger } from '@/types/event-trigger';

/**
 * GET /api/event-triggers
 */
export async function GET() {
  try {
    const res = await sidecarFetch('/event-triggers');
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/event-triggers
 */
export async function POST(request: NextRequest) {
  const body = await request.json() as Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>;

  try {
    const res = await sidecarFetch('/event-triggers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
