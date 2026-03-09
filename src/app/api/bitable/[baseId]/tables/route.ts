import { NextRequest, NextResponse } from 'next/server';
import { createTable } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string }> };

/** POST /api/bitable/{baseId}/tables — 创建新数据表 */
export async function POST(request: NextRequest, { params }: Params) {
  const { baseId } = await params;
  const body = await request.json();
  const { name, description } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const table = await createTable(baseId, {
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : undefined,
  });

  if (!table) {
    return NextResponse.json({ error: 'base not found' }, { status: 404 });
  }

  return NextResponse.json(table, { status: 201 });
}
