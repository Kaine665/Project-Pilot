/**
 * /api/prompt-segments — Segmented prompt management
 *
 * Query params (all endpoints):
 *   scope=global | scope=project&projectKey=xxx
 *
 * GET  — List segments (returns { segments, isSegmented })
 * POST — Create a new segment (body: { id, title, description?, content, enabled? })
 * PUT  — Bulk operations:
 *        - { action: 'init' } — Initialize segmented mode (migrate from single .md)
 *        - { action: 'reorder', orderedIds: string[] } — Reorder segments
 *        - { action: 'flatten' } — Exit segmented mode (merge back to single .md)
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PromptSegmentScope, PromptSegment } from '@/types';
import {
  readSegmentIndex,
  readSegmentContent,
  isSegmented,
  createSegment,
  initSegmented,
  reorderSegments,
  flattenSegments,
} from '@/lib/segmented-prompt-store';
import { readFile, writeFile, mkdir } from 'fs/promises';
import {
  getGlobalPromptPath,
  getProjectPromptPath,
  getPromptsDir,
  getProjectPromptsDir,
} from '@/lib/file-store';

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

/** Read single .md file content for the scope (for init migration) */
async function readSingleFileContent(scope: PromptSegmentScope): Promise<string> {
  try {
    const filePath = scope.type === 'global'
      ? getGlobalPromptPath()
      : getProjectPromptPath(scope.projectKey);
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Write single .md file content for the scope (for flatten) */
async function writeSingleFileContent(scope: PromptSegmentScope, content: string): Promise<void> {
  if (scope.type === 'global') {
    await mkdir(getPromptsDir(), { recursive: true });
    await writeFile(getGlobalPromptPath(), content, 'utf-8');
  } else {
    await mkdir(getProjectPromptsDir(), { recursive: true });
    await writeFile(getProjectPromptPath(scope.projectKey), content, 'utf-8');
  }
}

export async function GET(req: NextRequest) {
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope. Use scope=global or scope=project&projectKey=xxx' }, { status: 400 });
  }

  try {
    const segmented = await isSegmented(scope);
    if (!segmented) {
      return NextResponse.json({ segments: [], isSegmented: false });
    }

    const index = await readSegmentIndex(scope);

    // Attach content to each segment for the frontend
    const segmentsWithContent = await Promise.all(
      index.segments.map(async (seg) => ({
        ...seg,
        content: await readSegmentContent(scope, seg.id),
      })),
    );

    return NextResponse.json({ segments: segmentsWithContent, isSegmented: true });
  } catch (err) {
    console.error('[prompt-segments] GET error:', err);
    return NextResponse.json({ error: 'Failed to read segments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  try {
    const body = await req.json() as {
      id?: string;
      title?: string;
      description?: string;
      content?: string;
      enabled?: boolean;
    };

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const segment: PromptSegment = {
      id: body.id,
      title: body.title,
      description: body.description,
      enabled: body.enabled ?? true,
    };

    const index = await createSegment(scope, segment, body.content ?? '');
    return NextResponse.json({ ok: true, segments: index.segments });
  } catch (err) {
    console.error('[prompt-segments] POST error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to create segment';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const scope = parseScope(req);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  try {
    const body = await req.json() as {
      action: 'init' | 'reorder' | 'flatten';
      orderedIds?: string[];
    };

    switch (body.action) {
      case 'init': {
        const existing = await readSingleFileContent(scope);
        const index = await initSegmented(scope, existing);
        return NextResponse.json({ ok: true, segments: index.segments });
      }

      case 'reorder': {
        if (!Array.isArray(body.orderedIds)) {
          return NextResponse.json({ error: 'orderedIds must be an array' }, { status: 400 });
        }
        const index = await reorderSegments(scope, body.orderedIds);
        return NextResponse.json({ ok: true, segments: index.segments });
      }

      case 'flatten': {
        const content = await flattenSegments(scope);
        await writeSingleFileContent(scope, content);
        return NextResponse.json({ ok: true, content });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[prompt-segments] PUT error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to process action';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
