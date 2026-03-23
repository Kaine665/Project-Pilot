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
    return () => {
      cachePanelState(cacheKey, {
        sessionId: sessionIdRef.current,
        shouldReconnect: isStreamingRef.current,
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
