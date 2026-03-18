/**
 * Module-level cache for AgentChatPanel state.
 *
 * When a panel unmounts due to SPA route navigation (not page close),
 * its state is cached here. On remount, the panel can instantly restore
 * the cached state (no flash) and then reconnect the SSE stream.
 *
 * Cache entries are keyed by a composite of agentId + projectKey + initialSessionId.
 * Entries auto-expire after 5 minutes (stale data is worse than a re-fetch).
 */

import type { ChatMessage, ContentBlock } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import type { SessionListItem } from './types';
import type { SessionNavLink } from '@/components/agent-session-utils';

export interface CachedPanelState {
  // Chat state
  messages: ChatMessage[];
  isStreaming: boolean;

  // Session state
  sessionId: string | null;
  sessionTitle: string;
  sessionList: SessionListItem[];
  sessionConfig: SessionConfig;
  parentSession: SessionNavLink | null;
  childSessions: SessionNavLink[];

  // Metadata
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CachedPanelState>();

/**
 * Build a cache key from panel props.
 * Same agent + same project + same initialSessionId = same cache slot.
 */
export function buildCacheKey(
  agentId: string,
  projectKey?: string | null,
  initialSessionId?: string | null,
): string {
  return `${agentId}::${projectKey ?? ''}::${initialSessionId ?? ''}`;
}

/**
 * Save panel state on unmount.
 */
export function cachePanelState(key: string, state: CachedPanelState): void {
  cache.set(key, { ...state, cachedAt: Date.now() });
}

/**
 * Retrieve cached state. Returns null if not found or expired.
 * Consumes the entry (one-shot restore).
 */
export function popCachedState(key: string): CachedPanelState | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    return null; // expired
  }
  return entry;
}

/**
 * Clear all cached state (e.g. on logout).
 */
export function clearAllCache(): void {
  cache.clear();
}
