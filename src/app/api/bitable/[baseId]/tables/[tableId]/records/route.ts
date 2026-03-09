import { NextRequest, NextResponse } from 'next/server';
import { addRecord, batchDeleteRecords } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string; tableId: string }> };

/** POST /api/bitable/{baseId}/tables/{tableId}/records — 添加记录 */
export async function POST(request: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const body = await request.json();
  const { cells } = body;

  const record = await addRecord(baseId, tableId, cells ?? {});

  if (!record) {
    return NextResponse.json({ error: 'base or table not found' }, { status: 404 });
  }

  return NextResponse.json(record, { status: 201 });
}

/** DELETE /api/bitable/{baseId}/tables/{tableId}/records — 批量删除记录 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const body = await request.json();
  const { recordIds } = body;

  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return NextResponse.json({ error: 'recordIds array is required' }, { status: 400 });
  }

  const count = await batchDeleteRecords(baseId, tableId, recordIds);
  return NextResponse.json({ deleted: count });
}
