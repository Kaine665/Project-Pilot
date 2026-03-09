import { NextRequest, NextResponse } from 'next/server';
import { readBitableIndex, createBase } from '@/lib/bitable-store';

/** GET /api/bitable — 获取所有 base 列表 */
export async function GET() {
  const index = await readBitableIndex();
  return NextResponse.json(index);
}

/** POST /api/bitable — 创建新 base */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, icon, projectKey } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name too long' }, { status: 400 });
  }

  const base = await createBase({
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : undefined,
    icon: typeof icon === 'string' ? icon : undefined,
    projectKey: typeof projectKey === 'string' ? projectKey : undefined,
  });

  return NextResponse.json(base, { status: 201 });
}
