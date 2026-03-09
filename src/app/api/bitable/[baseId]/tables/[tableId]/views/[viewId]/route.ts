import { NextRequest, NextResponse } from 'next/server';
import { updateView, deleteView } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string; tableId: string; viewId: string }> };

/** PATCH /api/bitable/{baseId}/tables/{tableId}/views/{viewId} — 更新视图配置 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { baseId, tableId, viewId } = await params;
  const body = await request.json();
  const { name, filters, sorts, groups, fieldOrder, hiddenFields, kanbanFieldId } = body;

  const updated = await updateView(baseId, tableId, viewId, {
    ...(typeof name === 'string' && { name: name.trim() }),
    ...(Array.isArray(filters) && { filters }),
    ...(Array.isArray(sorts) && { sorts }),
    ...(Array.isArray(groups) && { groups }),
    ...(Array.isArray(fieldOrder) && { fieldOrder }),
    ...(Array.isArray(hiddenFields) && { hiddenFields }),
    ...(typeof kanbanFieldId === 'string' && { kanbanFieldId }),
  });

  if (!updated) {
    return NextResponse.json({ error: 'view not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/bitable/{baseId}/tables/{tableId}/views/{viewId} — 删除视图 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { baseId, tableId, viewId } = await params;
  const success = await deleteView(baseId, tableId, viewId);
  if (!success) {
    return NextResponse.json({ error: 'view not found or is the last view' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
