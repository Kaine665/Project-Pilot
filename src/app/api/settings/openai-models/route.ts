import { NextResponse } from 'next/server';
import { listOpenAIModels } from '@/lib/codex-model-catalog';

/**
 * GET /api/settings/openai-models
 * Returns the OpenAI model catalog (live from Codex CLI, cached 60s).
 */
export async function GET() {
  try {
    const catalog = await listOpenAIModels();
    return NextResponse.json(catalog);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list OpenAI models' },
      { status: 500 },
    );
  }
}
