'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { OrchestratorSSEEvent, OrchestratorPhase } from '@/types/orchestrator';

interface UseOrchestratorStreamResult {
  events: OrchestratorSSEEvent[];
  phase: OrchestratorPhase;
  isConnected: boolean;
}

/**
 * 连接编排 SSE 流，实时接收事件。
 * orchId 为 null 时不连接。
 */
export function useOrchestratorStream(orchId: string | null): UseOrchestratorStreamResult {
  const [events, setEvents] = useState<OrchestratorSSEEvent[]>([]);
  const [phase, setPhase] = useState<OrchestratorPhase>('pending');
  const [isConnected, setIsConnected] = useState(false);
  const idxRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!orchId) {
      cleanup();
      setEvents([]);
      setPhase('pending');
      idxRef.current = 0;
      return;
    }

    // 重新连接时重置状态
    setEvents([]);
    setPhase('pending');
    idxRef.current = 0;

    const url = `/api/orchestrator/stream?orchId=${encodeURIComponent(orchId)}&since=0`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as OrchestratorSSEEvent & { _idx?: number };
        const idx = (data as { _idx?: number })._idx;
        if (typeof idx === 'number' && idx >= 0) {
          idxRef.current = idx + 1;
        }

        setEvents(prev => [...prev, data]);

        if (data.type === 'orch_phase_changed') {
          setPhase(data.phase);
        }
        if (data.type === 'orch_done') {
          es.close();
          esRef.current = null;
          setIsConnected(false);
        }
      } catch {
        // 忽略解析错误
      }
    };

    es.onerror = () => {
      // EventSource 会自动重连，这里只标记断开
      setIsConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [orchId, cleanup]);

  return { events, phase, isConnected };
}
