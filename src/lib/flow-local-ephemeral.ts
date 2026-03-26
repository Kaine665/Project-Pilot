'use client';

import type { FlowData } from '@/types/flow';

const PREFIX = 'pp-flow-ephemeral:';

const EMPTY: FlowData = { sections: [] };

export function loadLocalFlowData(projectKey: string): FlowData {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(PREFIX + projectKey);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return EMPTY;
  }
}

export function saveLocalFlowData(projectKey: string, data: FlowData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + projectKey, JSON.stringify(data));
  } catch {
    /* quota */
  }
}
