import { NextRequest, NextResponse } from 'next/server';
import { updateTable, deleteTable } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string; tableId: string }> };

/** PATCH /api/bitable/{baseId}/tables/{tableId} — 更新数据表 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const body = await request.json();
  const { name, description } = body;

  const updated = await updateTable(baseId, tableId, {
    name: typeof name === 'string' ? name.trim() : undefined,
    description: typeof description === 'string' ? description.trim() : undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: 'table not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/bitable/{baseId}/tables/{tableId} — 删除数据表 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const success = await deleteTable(baseId, tableId);
  if (!success) {
    return NextResponse.json({ error: 'table not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
