import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string; tableId: string; recordId: string }> };

/** PATCH /api/bitable/{baseId}/tables/{tableId}/records/{recordId} — 更新记录 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { baseId, tableId, recordId } = await params;
  const body = await request.json();
  const { cells } = body;

  if (!cells || typeof cells !== 'object') {
    return NextResponse.json({ error: 'cells object is required' }, { status: 400 });
  }

  const updated = await updateRecord(baseId, tableId, recordId, cells);

  if (!updated) {
    return NextResponse.json({ error: 'record not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/bitable/{baseId}/tables/{tableId}/records/{recordId} — 删除记录 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { baseId, tableId, recordId } = await params;
  const success = await deleteRecord(baseId, tableId, recordId);
  if (!success) {
    return NextResponse.json({ error: 'record not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
