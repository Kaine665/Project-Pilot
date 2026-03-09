/**
 * POST /api/settings/test-title-entry
 *
 * 测试标题生成重试链中的单个条目（provider + model）是否可用。
 * API Key 从已保存的设置中自动读取，无需前端传入。
 */

import { NextRequest, NextResponse } from 'next/server';
import { testTitleChainEntry } from '@/lib/session-title-generator';
import type { TitleGenerationChainEntry } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<TitleGenerationChainEntry>;
    const { provider, model } = body;

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
    }
    if (!model || typeof model !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing model' }, { status: 400 });
    }

    const result = await testTitleChainEntry({ provider, model });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg, latencyMs: 0 });
  }
}
