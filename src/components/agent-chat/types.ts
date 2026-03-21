import type { Agent, ProviderId, OpenAIReasoningEffort, ChatSSEEvent } from '@/types';
import type { DeferredInputBufferItem } from '@/types/agent-chat';

// ── Exported types ──

export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
  unreadCount?: number;
  isRunning?: boolean;
  isAwaiting?: boolean;
  runningStartedAt?: string;
}

export interface AgentChatPanelProps {
  agent: Agent;
  /** undefined = auto-select latest; null = new empty session; string = load specific session */
  initialSessionId?: string | null;
  /** Called when sessions are created or updated (for parent to refresh sidebar) */
  onSessionChange?: (newSession?: SessionListItem) => void;
  /** Display variant: sidebar or full (butler mode). Omit for plain agent chat. */
  variant?: 'sidebar' | 'full';
  /** Project scope (butler mode). When set, flow context is injected. */
  projectKey?: string | null;
  /** Pre-loaded agents list from parent; skips redundant /api/agents fetch */
  cachedAgents?: Agent[];
  /** Pre-loaded settings (provider, model, effort) from parent; skips /api/settings fetch */
  cachedSettings?: {
    provider: ProviderId;
    model: string;
    modelOptions: ModelSelectOption[];
    effort: OpenAIReasoningEffort;
    fastMode: boolean;
  };
}

export type IndexedSSEEvent = ChatSSEEvent & { _idx: number };
export type ModelSelectOption = { value: string; label: string };

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: 'Qwen',
  zhipu: 'GLM',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  custom: 'Custom',
};

// ── Helper functions ──

/** Title is generated asynchronously by session-title-generator.
 * Keep this strip function for backward compatibility with older replies. */
export function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

export function cloneDeferredInputBufferItems(
  items: DeferredInputBufferItem[],
): DeferredInputBufferItem[] {
  return items.map((item) => ({
    text: item.text,
    images: item.images?.length ? [...item.images] : undefined,
  }));
}

export function formatSessionElapsed(startedAt: string | undefined, nowTs: number): string {
  if (!startedAt) return '0s';
  const diffSeconds = Math.max(
    0,
    Math.floor((nowTs - new Date(startedAt).getTime()) / 1000),
  );
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  return `${Math.floor(diffSeconds / 3600)}h`;
}
