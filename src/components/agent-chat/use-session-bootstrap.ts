import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';
import type { ChatAction } from './chat-reducer';
import type { SessionAction } from './session-reducer';
import type { SessionListItem } from './types';
import { popCachedState } from './agent-session-cache';

type RuntimeStatusData = {
  status?: string;
  startedAt?: string;
};

type RuntimeSnapshotData = {
  available?: boolean;
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

export function useSessionBootstrap(params: UseSessionBootstrapParams): void {
  const {
    agentId,
    projectKey,
    initialSessionId,
    hasProject,
    cacheKey,
    initTokenRef,
    streamAbortRef,
  } = params;

  // 始终指向最新回调，避免 connectToStream / loadSessionData / finalizeStream 链因父级 onSessionChange 等每帧变引用导致 effect 死循环
  const paramsRef = useRef(params);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    const {
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
    } = paramsRef.current;

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

    const reconnectRunning = async (sid: string, statusData: RuntimeStatusData) => {
      try {
        const snapshotRes = await fetch(
          `/api/agent-chat/runtime-snapshot?sessionId=${sid}`,
          { cache: 'no-store' },
        );
        const snapshotData = (await snapshotRes.json()) as RuntimeSnapshotData;
        if (isStale()) return;
        if (snapshotData.available && Array.isArray(snapshotData.messages) && snapshotData.messages.length > 0) {
          const restored: ChatMessage[] = snapshotData.messages.map((m, i) => ({
            id: `restored-${i}`,
            role: m.role,
            content: m.content,
            images: m.images,
            contentBlocks: m.contentBlocks,
            timestamp: '',
          }));
          chatDispatch({ type: 'SET_MESSAGES', messages: restored });
        }
      } catch {
        // Ignore transient runtime snapshot failures and reconnect the live stream anyway.
      }

      if (isStale()) return;
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
              await reconnectRunning(preferredSessionId, statusData);
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
          await reconnectRunning(latest.id, statusData);
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
          await reconnectRunning(sid, data);
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
    // 仅依赖「应重新 bootstrap」的结构输入；回调经 paramsRef 取最新，避免 Maximum update depth
  }, [agentId, cacheKey, hasProject, initialSessionId, initTokenRef, projectKey, streamAbortRef]);
}
