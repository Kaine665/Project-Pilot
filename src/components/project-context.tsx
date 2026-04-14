'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from '@/client/i18n/routing';
import type { ProjectEntry } from '@/types';

export type { ProjectEntry };

interface ProjectContextValue {
  projects: ProjectEntry[];
  activeKey: string | null;
  initialized: boolean;
  setActiveKey: (key: string) => void;
  fetchProjects: () => Promise<ProjectEntry[]>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** 上次在顶栏/工作区选中的项目 key，Electron 重启后无 ?project= 时仍可恢复 */
const LAST_ACTIVE_PROJECT_STORAGE_KEY = 'pp.lastActiveProjectKey';

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [activeKeyRaw, setActiveKeyRaw] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const internalKeyChangeRef = useRef(false);
  const initializedRef = useRef(false);
  const pathname = usePathname();

  const setActiveKey = useCallback((key: string) => {
    internalKeyChangeRef.current = true;
    setActiveKeyRaw(key);
    // Sync to URL without triggering Next.js navigation
    const url = new URL(window.location.href);
    if (key) {
      url.searchParams.set('project', key);
    } else {
      url.searchParams.delete('project');
    }
    window.history.replaceState({}, '', url.toString());
    // Reset flag via microtask — replaceState doesn't trigger popstate,
    // so the flag would stay true forever otherwise
    queueMicrotask(() => { internalKeyChangeRef.current = false; });
  }, []);

  const fetchProjects = useCallback(async () => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch('/api/data/projects', { signal: ctrl.signal });
      const data = await res.json();
      const list: ProjectEntry[] = data.projects ?? [];
      setProjects(list);
      return list;
    } catch {
      return [];
    } finally {
      window.clearTimeout(t);
    }
  }, []);

  // 将当前选中项目写入 localStorage，供下次启动恢复（与 URL ?project= 互补）
  useEffect(() => {
    if (!initialized) return;
    try {
      if (activeKeyRaw) {
        localStorage.setItem(LAST_ACTIVE_PROJECT_STORAGE_KEY, activeKeyRaw);
      } else {
        localStorage.removeItem(LAST_ACTIVE_PROJECT_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [activeKeyRaw, initialized]);

  // Initial load: fetch projects and set active key from URL → 上次持久化 → 第一项
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    void fetchProjects()
      .then((list) => {
        if (list.length > 0) {
          const urlParams = new URLSearchParams(window.location.search);
          const projectParam = urlParams.get('project');
          let stored: string | null = null;
          try {
            stored = localStorage.getItem(LAST_ACTIVE_PROJECT_STORAGE_KEY);
          } catch {
            /* ignore */
          }

          if (projectParam && list.some(p => p.key === projectParam)) {
            setActiveKey(projectParam);
          } else if (stored && list.some(p => p.key === stored)) {
            setActiveKey(stored);
          } else {
            setActiveKey(list[0].key);
          }
        }
      })
      .finally(() => {
        setInitialized(true);
      });
  }, [fetchProjects, setActiveKey]);

  // Listen for external URL changes (e.g. browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const projectParam = urlParams.get('project');
      if (projectParam && projects.some(p => p.key === projectParam)) {
        // Always sync from URL on popstate — the URL is the source of truth here
        setActiveKeyRaw(projectParam);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [projects]);

  // Re-sync ?project= to URL after client-side navigation (router.push strips query params).
  // Use rAF to ensure Next.js has finished updating the URL before we patch it.
  useEffect(() => {
    if (!activeKeyRaw) return;
    const rafId = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('project');
      if (current !== activeKeyRaw) {
        url.searchParams.set('project', activeKeyRaw);
        window.history.replaceState({}, '', url.toString());
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [pathname, activeKeyRaw]);

  return (
    <ProjectContext.Provider value={{ projects, activeKey: activeKeyRaw, initialized, setActiveKey, fetchProjects }}>
      {children}
    </ProjectContext.Provider>
  );
}
