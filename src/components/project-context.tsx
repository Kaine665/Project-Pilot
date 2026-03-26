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
    try {
      const res = await fetch('/api/data/projects');
      const data = await res.json();
      const list: ProjectEntry[] = data.projects ?? [];
      setProjects(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // Initial load: fetch projects and set active key from URL or first project
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    fetchProjects().then((list) => {
      if (list.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const projectParam = urlParams.get('project');
        if (projectParam && list.some(p => p.key === projectParam)) {
          setActiveKey(projectParam);
        } else {
          setActiveKey(list[0].key);
        }
      }
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
