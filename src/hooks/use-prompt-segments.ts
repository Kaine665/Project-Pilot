'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptSegment, PromptSegmentScope, SegmentedPromptIndex } from '@/types';

export interface SegmentWithContent extends PromptSegment {
  content: string;
}

interface PromptSegmentsState {
  segments: SegmentWithContent[];
  isSegmented: boolean;
  loading: boolean;
  error: string | null;
}

function buildQueryString(scope: PromptSegmentScope): string {
  const params = new URLSearchParams();
  params.set('scope', scope.type);
  if (scope.type === 'project') params.set('projectKey', scope.projectKey);
  if (scope.type === 'agent') params.set('agentId', scope.agentId);
  if (scope.type === 'runtime') {
    params.set('agentId', scope.agentId);
    params.set('sessionId', scope.sessionId);
  }
  return params.toString();
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '请求失败');
  }
  return data;
}

export function usePromptSegments(scope: PromptSegmentScope | null) {
  const [state, setState] = useState<PromptSegmentsState>({
    segments: [],
    isSegmented: false,
    loading: false,
    error: null,
  });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const fetchSegments = useCallback(async () => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await readJson(await fetch(`/api/prompt-segments?${qs}`, { cache: 'no-store' }));
      // Only update if scope hasn't changed during fetch
      if (scopeRef.current === scope) {
        setState({
          segments: data.segments ?? [],
          isSegmented: data.isSegmented ?? false,
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      if (scopeRef.current === scope) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : '加载失败',
        }));
      }
    }
  }, [scope]);

  useEffect(() => {
    fetchSegments();
  }, [fetchSegments]);

  const initSegmented = useCallback(async () => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'init' }),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const createSegment = useCallback(async (
    segment: PromptSegment,
    content: string,
  ) => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment, content }),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const updateSegmentMeta = useCallback(async (
    segmentId: string,
    patch: Partial<Pick<PromptSegment, 'title' | 'description' | 'enabled'>>,
  ) => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments/${encodeURIComponent(segmentId)}?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const updateSegmentContent = useCallback(async (
    segmentId: string,
    content: string,
  ) => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments/${encodeURIComponent(segmentId)}?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const deleteSegment = useCallback(async (segmentId: string) => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments/${encodeURIComponent(segmentId)}?${qs}`, {
      method: 'DELETE',
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const toggleSegment = useCallback(async (segmentId: string, enabled: boolean) => {
    return updateSegmentMeta(segmentId, { enabled });
  }, [updateSegmentMeta]);

  const reorderSegments = useCallback(async (orderedIds: string[]) => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder', orderedIds }),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  const flattenSegments = useCallback(async () => {
    if (!scope) return;
    const qs = buildQueryString(scope);
    await readJson(await fetch(`/api/prompt-segments?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'flatten' }),
    }));
    await fetchSegments();
  }, [scope, fetchSegments]);

  return {
    ...state,
    refetch: fetchSegments,
    initSegmented,
    createSegment,
    updateSegmentMeta,
    updateSegmentContent,
    deleteSegment,
    toggleSegment,
    reorderSegments,
    flattenSegments,
  };
}
