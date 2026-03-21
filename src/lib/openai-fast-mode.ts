import type { ClaudeAuthMode } from '@/types';

export function isOpenAIFastModel(model: string | null | undefined): boolean {
  const normalized = (model ?? '').trim().toLowerCase();
  return normalized === 'gpt-5.4' || normalized.startsWith('gpt-5.4-');
}

export function normalizeOpenAIFastMode(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function shouldApplyOpenAIFastMode(options: {
  enabled: boolean;
  model: string | null | undefined;
  authMode: ClaudeAuthMode;
}): boolean {
  return options.enabled
    && options.authMode === 'oauth'
    && isOpenAIFastModel(options.model);
}
