'use client';

import { useCallback, useState } from 'react';

export interface SessionRun {
  runId: string;
  goal?: string;
  status: 'active' | 'completed' | 'failed' | 'shelved';
  startedAt: string;
  completedAt?: string;
  evaluation?: {
    outcome: 'success' | 'failure' | 'partial' | 'shelved';
    text?: string;
  };
}

export function useSessionRuns() {
  const [sessionRuns, setSessionRuns] = useState<SessionRun[]>([]);

  const refreshSessionRuns = useCallback(async (sid: string | null) => {
    if (!sid) {
      setSessionRuns([]);
      return;
    }
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}/runs`, { cache: 'no-store' });
      if (!res.ok) {
        setSessionRuns([]);
        return;
      }
      const data = await res.json();
      setSessionRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      setSessionRuns([]);
    }
  }, []);

  return {
    sessionRuns,
    setSessionRuns,
    refreshSessionRuns,
  };
}

