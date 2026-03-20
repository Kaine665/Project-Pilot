import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';
import type { ChatAction } from './chat-reducer';
import type { SessionAction } from './session-reducer';
import type { SessionListItem } from './types';
import { popCachedState } from './agent-session-cache';

type RuntimeStatusData = {
  status?: string;
  startedAt?: string;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    images?: string[];
    contentBlocks?: ContentBlock[];
  }>;
};

type UseSessionBootstrapParams = {
  agentId: string;
  projectKey?: string | null;
  initialSessionId?: string | null;
  hasProject: boolean;
  cacheKey: string;
  initTokenRef: MutableRefObject<number>;
  streamAbortRef: MutableRefObject<AbortController | null>;
  setShowConfig: Dispatch<SetStateAction<boolean>>;
  setShowFolderExplorer: Dispatch<SetStateAction<boolean>>;
  setShowRuntimePanel: Dispatch<SetStateAction<boolean>>;
  setQueueExpanded: Dispatch<SetStateAction<boolean>>;
  resetState: () => void;
  fetchSessionList: (agentId: string, pk?: string | null) => Promise<SessionListItem[]>;
  setSessionIdSync: (id: string | null) => void;
  loadSessionData: (sid: string, token?: number) => Promise<void>;
  sessionDispatch: Dispatch<SessionAction>;
  markSessionRunning: (targetSessionId: string, startedAt?: string, title?: string) => void;
  chatDispatch: Dispatch<ChatAction>;
  blocksRef: MutableRefObject<ContentBlock[]>;
  fullTextRef: MutableRefObject<string>;
  toolCallsRef: MutableRefObject<ChatToolCall[]>;
  connectToStream: (targetSessionId: string, since: number) => void;
};

export function useSessionBootstrap({
  agentId,
  projectKey,
  initialSessionId,
  hasProject,
  cacheKey,
  initTokenRef,
  streamAbortRef,
  setShowConfig,
  setShowFolderExplorer,
  setShowRuntimePanel,
  setQueueExpanded,
  resetState,
  fetchSessionList,
  setSessionIdSync,
  loadSessionData,
  sessionDispatch,
  markSessionRunning,
  chatDispatch,
  blocksRef,
  fullTextRef,
  toolCallsRef,
  connectToStream,
}: UseSessionBootstrapParams): void {
  useEffect(() => {
    let cancelled = false;
    const token = ++initTokenRef.current;
    const isStale = () => cancelled || initTokenRef.current !== token;

    const cached = popCachedState(cacheKey);
    const cachedSessionId = cached?.sessionId ?? null;
    const cachedWasStreaming = cached?.isStreaming === true;

    if (cached) {
      setShowConfig(cached.showConfig);
      setShowFolderExplorer(cached.showFolderExplorer);
      setShowRuntimePanel(cached.showRuntimePanel);
      setQueueExpanded(cached.queueExpanded);
    }

    resetState();
    if (cached) {
      setQueueExpanded(cached.queueExpanded);
    }

    if (hasProject && !projectKey) return;
    if (!hasProject && initialSessionId === null && !cachedSessionId) return;

    const reconnectRunning = (sid: string, statusData: RuntimeStatusData) => {
      if (Array.isArray(statusData.messages) && statusData.messages.length > 0) {
        const restored: ChatMessage[] = statusData.messages.map((m, i) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
          images: m.images,
          contentBlocks: m.contentBlocks,
          timestamp: '',
        }));
        chatDispatch({ type: 'SET_MESSAGES', messages: restored });
      }
      markSessionRunning(sid, statusData.startedAt);
      chatDispatch({ type: 'SEND_START' });
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      connectToStream(sid, 0);
    };

    (async () => {
      const preferredSessionId = initialSessionId ?? cachedSessionId;

      if (preferredSessionId) {
        fetchSessionList(agentId, projectKey).catch(() => []);
        setSessionIdSync(preferredSessionId);
        const [, statusRes] = await Promise.all([
          loadSessionData(preferredSessionId, token),
          fetch(`/api/agent-chat/status?sessionId=${preferredSessionId}`, { cache: 'no-store' }),
        ]);
        if (isStale()) return;
        try {
          const statusData = (await statusRes.json()) as RuntimeStatusData;
          if (statusData.status === 'running') {
            if (cachedWasStreaming || preferredSessionId === initialSessionId) {
              reconnectRunning(preferredSessionId, statusData);
            } else {
              markSessionRunning(preferredSessionId, statusData.startedAt);
            }
          }
        } catch {
          // Ignore transient bootstrap status failures.
        }
        return;
      }

      const sessions = await fetchSessionList(agentId, projectKey);
      if (isStale() || sessions.length === 0) return;

      const latest = sessions[0];
      setSessionIdSync(latest.id);
      sessionDispatch({ type: 'SET_TITLE', title: latest.title });
      const [, statusRes] = await Promise.all([
        loadSessionData(latest.id, token),
        fetch(`/api/agent-chat/status?sessionId=${latest.id}`, { cache: 'no-store' }),
      ]);
      if (isStale()) return;
      try {
        const statusData = (await statusRes.json()) as RuntimeStatusData;
        if (statusData.status === 'running') {
          reconnectRunning(latest.id, statusData);
          return;
        }
      } catch {
        // Ignore transient bootstrap status failures.
      }

      for (let i = 1; i < sessions.length; i += 1) {
        if (isStale()) return;
        const sid = sessions[i].id;
        const res = await fetch(`/api/agent-chat/status?sessionId=${sid}`, { cache: 'no-store' });
        const data = (await res.json()) as RuntimeStatusData;
        if (!isStale() && data.status === 'running') {
          setSessionIdSync(sid);
          sessionDispatch({ type: 'SET_TITLE', title: sessions[i].title });
          await loadSessionData(sid, token);
          if (isStale()) return;
          reconnectRunning(sid, data);
          break;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (initTokenRef.current === token) {
        initTokenRef.current += 1;
      }
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
  }, [
    agentId,
    blocksRef,
    cacheKey,
    chatDispatch,
    connectToStream,
    fetchSessionList,
    fullTextRef,
    hasProject,
    initTokenRef,
    initialSessionId,
    loadSessionData,
    markSessionRunning,
    projectKey,
    resetState,
    sessionDispatch,
    setQueueExpanded,
    setSessionIdSync,
    setShowConfig,
    setShowFolderExplorer,
    setShowRuntimePanel,
    streamAbortRef,
    toolCallsRef,
  ]);
}
