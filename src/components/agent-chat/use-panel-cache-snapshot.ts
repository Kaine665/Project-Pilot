import { useEffect, type MutableRefObject } from 'react';
import { cachePanelState } from './agent-session-cache';

type UsePanelCacheSnapshotParams = {
  cacheKey: string;
  sessionIdRef: MutableRefObject<string | null>;
  isStreamingRef: MutableRefObject<boolean>;
  showConfig: boolean;
  showFolderExplorer: boolean;
  showRuntimePanel: boolean;
  queueExpanded: boolean;
};

export function usePanelCacheSnapshot({
  cacheKey,
  sessionIdRef,
  isStreamingRef,
  showConfig,
  showFolderExplorer,
  showRuntimePanel,
  queueExpanded,
}: UsePanelCacheSnapshotParams): void {
  useEffect(() => {
    const cachedSessionId = sessionIdRef.current;
    const shouldReconnect = isStreamingRef.current;

    return () => {
      cachePanelState(cacheKey, {
        sessionId: cachedSessionId,
        shouldReconnect,
        showConfig,
        showFolderExplorer,
        showRuntimePanel,
        queueExpanded,
        cachedAt: Date.now(),
      });
    };
  }, [
    cacheKey,
    isStreamingRef,
    queueExpanded,
    sessionIdRef,
    showConfig,
    showFolderExplorer,
    showRuntimePanel,
  ]);
}
