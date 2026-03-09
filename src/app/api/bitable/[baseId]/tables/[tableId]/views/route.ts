import { NextRequest, NextResponse } from 'next/server';
import { addView } from '@/lib/bitable-store';
import type { BitableViewType } from '@/types/bitable';

type Params = { params: Promise<{ baseId: string; tableId: string }> };

const VALID_VIEW_TYPES: BitableViewType[] = ['grid', 'kanban'];

/** POST /api/bitable/{baseId}/tables/{tableId}/views — 添加视图 */
export async function POST(request: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const body = await request.json();
  const { name, type, kanbanFieldId } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!type || !VALID_VIEW_TYPES.includes(type)) {
    return NextResponse.json({ error: `invalid view type, must be one of: ${VALID_VIEW_TYPES.join(', ')}` }, { status: 400 });
  }

  const view = await addView(baseId, tableId, {
    name: name.trim(),
    type,
    kanbanFieldId: typeof kanbanFieldId === 'string' ? kanbanFieldId : undefined,
  });

  if (!view) {
    return NextResponse.json({ error: 'base or table not found' }, { status: 404 });
  }

  return NextResponse.json(view, { status: 201 });
}
