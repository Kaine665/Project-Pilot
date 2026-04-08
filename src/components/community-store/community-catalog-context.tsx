'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommunityCatalogResponse } from '@/types/community-catalog';

type CommunityCatalogContextValue = {
  catalog: CommunityCatalogResponse | null;
  loadError: string | null;
  refetch: () => void;
};

const CommunityCatalogContext = createContext<CommunityCatalogContextValue | null>(null);

export function CommunityCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CommunityCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchTick, setFetchTick] = useState(0);

  const refetch = useCallback(() => {
    setFetchTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/community/catalog', { cache: 'no-store' });
        const data = (await res.json()) as CommunityCatalogResponse & { error?: string };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setCatalog(data);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setCatalog(null);
          setLoadError(e instanceof Error ? e.message : 'load_error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTick]);

  const value = useMemo(
    () => ({
      catalog,
      loadError,
      refetch,
    }),
    [catalog, loadError, refetch],
  );

  return <CommunityCatalogContext.Provider value={value}>{children}</CommunityCatalogContext.Provider>;
}

export function useCommunityCatalog() {
  const ctx = useContext(CommunityCatalogContext);
  if (!ctx) {
    throw new Error('useCommunityCatalog must be used within CommunityCatalogProvider');
  }
  return ctx;
}
