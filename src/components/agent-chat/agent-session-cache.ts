/**
 * Module-level cache for AgentChatPanel view state.
 *
 * This cache must never become a shadow session store. It only keeps enough
 * panel-local state to survive SPA route changes while the canonical session
 * data is reloaded from the server on remount.
 *
 * Cache entries are keyed by a composite of agentId + projectKey + initialSessionId.
 * Entries auto-expire after 5 minutes (stale data is worse than a re-fetch).
 */

export interface CachedPanelState {
  // Session selection anchor
  sessionId: string | null;
  shouldReconnect: boolean;

  // Pure panel-local view state
  showConfig: boolean;
  showFolderExplorer: boolean;
  showRuntimePanel: boolean;
  queueExpanded: boolean;

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
