import { NextRequest, NextResponse } from 'next/server';
import { readBase, updateBase, deleteBase } from '@/lib/bitable-store';

type Params = { params: Promise<{ baseId: string }> };

/** GET /api/bitable/{baseId} — 获取 base 完整数据 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { baseId } = await params;
  const base = await readBase(baseId);
  if (!base) {
    return NextResponse.json({ error: 'base not found' }, { status: 404 });
  }
  return NextResponse.json(base);
}

/** PATCH /api/bitable/{baseId} — 更新 base 信息 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { baseId } = await params;
  const body = await request.json();
  const { name, description, icon } = body;

  const updated = await updateBase(baseId, {
    name: typeof name === 'string' ? name.trim() : undefined,
    description: typeof description === 'string' ? description.trim() : undefined,
    icon: typeof icon === 'string' ? icon : undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: 'base not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/bitable/{baseId} — 删除 base */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { baseId } = await params;
  await deleteBase(baseId);
  return NextResponse.json({ success: true });
}
