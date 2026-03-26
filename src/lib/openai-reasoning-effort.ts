import type { OpenAIReasoningEffort } from '@/types';

export const OPENAI_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly OpenAIReasoningEffort[];

export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAIReasoningEffort = 'xhigh';

export function isOpenAIReasoningEffort(value: unknown): value is OpenAIReasoningEffort {
  return typeof value === 'string'
    && OPENAI_REASONING_EFFORTS.includes(value as OpenAIReasoningEffort);
}

export function normalizeOpenAIReasoningEffort(
  value: unknown,
): OpenAIReasoningEffort | undefined {
  return isOpenAIReasoningEffort(value) ? value : undefined;
}
