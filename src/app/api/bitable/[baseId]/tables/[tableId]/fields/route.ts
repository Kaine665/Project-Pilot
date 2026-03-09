import { NextRequest, NextResponse } from 'next/server';
import { addField } from '@/lib/bitable-store';
import type { BitableFieldType } from '@/types/bitable';

type Params = { params: Promise<{ baseId: string; tableId: string }> };

const VALID_FIELD_TYPES: BitableFieldType[] = [
  'text', 'number', 'select', 'multiSelect', 'checkbox',
  'date', 'url', 'rating', 'progress', 'formula',
  'createdAt', 'updatedAt',
];

/** POST /api/bitable/{baseId}/tables/{tableId}/fields — 添加字段 */
export async function POST(request: NextRequest, { params }: Params) {
  const { baseId, tableId } = await params;
  const body = await request.json();
  const { name, type, config, width, required, description } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!type || !VALID_FIELD_TYPES.includes(type)) {
    return NextResponse.json({ error: `invalid field type, must be one of: ${VALID_FIELD_TYPES.join(', ')}` }, { status: 400 });
  }

  const field = await addField(baseId, tableId, {
    name: name.trim(),
    type,
    config: config ?? undefined,
    width: typeof width === 'number' ? width : undefined,
    required: typeof required === 'boolean' ? required : undefined,
    description: typeof description === 'string' ? description.trim() : undefined,
  });

  if (!field) {
    return NextResponse.json({ error: 'base or table not found' }, { status: 404 });
  }

  return NextResponse.json(field, { status: 201 });
}
