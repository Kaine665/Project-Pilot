'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AggregateLiveModelItem } from '@/lib/aggregate-models-live';

/** 与后端 GET /aggregate-models 缓存窗口大致对齐，减少多面板重复拉全量模型列表 */
const TTL_MS = 180_000;

type CacheEntry = { items: AggregateLiveModelItem[]; at: number };

let memoryCache: CacheEntry | null = null;
let inflight: Promise<AggregateLiveModelItem[]> | null = null;

async function fetchAggregateItems(): Promise<AggregateLiveModelItem[]> {
  const res = await fetch('/api/settings/aggregate-models', { cache: 'no-store' });
  if (!res.ok) throw new Error(`aggregate-models ${res.status}`);
  const data = (await res.json()) as { ok?: boolean; items?: AggregateLiveModelItem[] };
  if (!data?.ok || !Array.isArray(data.items)) return [];
  return data.items;
}

function readCache(): AggregateLiveModelItem[] | null {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.at > TTL_MS) return null;
  return memoryCache.items;
}

export interface UseAvailableModelsResult {
  items: AggregateLiveModelItem[];
  loading: boolean;
  error: string | undefined;
  /** 跳过 TTL，强制重新拉取 */
  refresh: () => Promise<void>;
}

/**
 * 与设置页同源：仅返回聚合接口判定可用的模型（需已配置凭据等）。
 * 带内存缓存，与后端 aggregate-models 短时缓存配合减轻并发请求。
 */
export function useAvailableModels(): UseAvailableModelsResult {
  const [items, setItems] = useState<AggregateLiveModelItem[]>(() => readCache() ?? []);
  const [loading, setLoading] = useState(() => readCache() === null);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async (force: boolean) => {
    if (!force) {
      const hit = readCache();
      if (hit) {
        setItems(hit);
        setLoading(false);
        setError(undefined);
        return;
      }
    }
    if (!force && inflight) {
      try {
        const shared = await inflight;
        setItems(shared);
        setLoading(false);
        setError(undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'fetch failed');
        setLoading(false);
      }
      return;
    }

    const run = (async () => {
      const data = await fetchAggregateItems();
      memoryCache = { items: data, at: Date.now() };
      return data;
    })();

    inflight = run;
    setLoading(true);
    setError(undefined);
    try {
      const data = await run;
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      inflight = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    memoryCache = null;
    await load(true);
  }, [load]);

  return { items, loading, error, refresh };
}
