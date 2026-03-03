import { NextResponse } from 'next/server';
import { listOpenAIModels } from '@/lib/codex-model-catalog';

/**
 * GET /api/settings/openai-models
 * 动态读取 Codex 可用模型与推理档位。
 */
export async function GET() {
  try {
    const { models, fetchedAt, source } = await listOpenAIModels();
    return NextResponse.json({
      ok: true,
      models,
      fetchedAt,
      source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: message || 'Failed to load OpenAI models',
      },
      { status: 500 },
    );
  }
}
