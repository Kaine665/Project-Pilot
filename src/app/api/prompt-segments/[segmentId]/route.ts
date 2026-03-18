/**
 * /api/prompt-segments/[segmentId] — Single segment operations
 *
 * Query params: scope=global | scope=project&projectKey=xxx
 *
 * GET    — Read segment content
 * PUT    — Update segment meta and/or content
 * DELETE — Delete segment
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PromptSegmentScope } from '@/types';
import {
  readSegmentContent,
  readSegmentIndex,
  updateSegmentMeta,
  updateSegmentContent,
  deleteSegment,
} from '@/lib/segmented-prompt-store';

type Params = { params: Promise<{ segmentId: string }> };

function parseScope(req: NextRequest): PromptSegmentScope | null {
  const { searchParams } = req.nextUrl;
  const scope = searchParams.get('scope');
  if (scope === 'global') return { type: 'global' };
  if (scope === 'project') {
    const projectKey = searchParams.get('projectKey');
    if (!projectKey) return null;
    return { type: 'project', projectKey };
  }
  return null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { segmentId } = await params;
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  try {
    const index = await readSegmentIndex(scope);
    const seg = index.segments.find(s => s.id === segmentId);
    if (!seg) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
    }

    const content = await readSegmentContent(scope, segmentId);
    return NextResponse.json({ ...seg, content });
  } catch (err) {
    console.error('[prompt-segments] GET error:', err);
    return NextResponse.json({ error: 'Failed to read segment' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { segmentId } = await params;
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  try {
    const body = await req.json() as {
      title?: string;
      description?: string;
      enabled?: boolean;
      content?: string;
    };

    // Update meta if any meta fields are provided
    const hasMeta = body.title !== undefined || body.description !== undefined || body.enabled !== undefined;
    let index;
    if (hasMeta) {
      index = await updateSegmentMeta(scope, segmentId, {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      });
    }

    // Update content if provided
    if (body.content !== undefined) {
      await updateSegmentContent(scope, segmentId, body.content);
    }

    if (!index) {
      index = await readSegmentIndex(scope);
    }

    return NextResponse.json({ ok: true, segments: index.segments });
  } catch (err) {
    console.error('[prompt-segments] PUT error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to update segment';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { segmentId } = await params;
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  try {
    const index = await deleteSegment(scope, segmentId);
    return NextResponse.json({ ok: true, segments: index.segments });
  } catch (err) {
    console.error('[prompt-segments] DELETE error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to delete segment';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
