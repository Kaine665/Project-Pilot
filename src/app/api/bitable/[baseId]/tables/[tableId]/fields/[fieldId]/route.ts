import { NextRequest, NextResponse } from 'next/server';
import { updateField, deleteField } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string; tableId: string; fieldId: string }> };

/** PATCH /api/bitable/{baseId}/tables/{tableId}/fields/{fieldId} — 更新字段 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { baseId, tableId, fieldId } = await params;
  const body = await request.json();
  const { name, config, width, required, description } = body;

  const updated = await updateField(baseId, tableId, fieldId, {
    name: typeof name === 'string' ? name.trim() : undefined,
    config: config ?? undefined,
    width: typeof width === 'number' ? width : undefined,
    required: typeof required === 'boolean' ? required : undefined,
    description: typeof description === 'string' ? description.trim() : undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: 'field not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/bitable/{baseId}/tables/{tableId}/fields/{fieldId} — 删除字段 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { baseId, tableId, fieldId } = await params;
  const success = await deleteField(baseId, tableId, fieldId);
  if (!success) {
    return NextResponse.json({ error: 'field not found or is the last field' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
