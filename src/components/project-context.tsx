'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from '@/i18n/routing';

export interface ProjectEntry {
  key: string;
  name: string;
  description?: string;
}

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

  // Listen for external URL changes (e.g. popstate)
  useEffect(() => {
    const handlePopState = () => {
      if (internalKeyChangeRef.current) {
        internalKeyChangeRef.current = false;
        return;
      }
      const urlParams = new URLSearchParams(window.location.search);
      const projectParam = urlParams.get('project');
      if (projectParam && projectParam !== activeKeyRaw && projects.some(p => p.key === projectParam)) {
        setActiveKeyRaw(projectParam);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeKeyRaw, projects]);

  // Re-sync ?project= to URL after client-side navigation (router.push strips query params)
  useEffect(() => {
    if (!activeKeyRaw) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('project')) {
      url.searchParams.set('project', activeKeyRaw);
      window.history.replaceState({}, '', url.toString());
    }
  }, [pathname, activeKeyRaw]);

  return (
    <ProjectContext.Provider value={{ projects, activeKey: activeKeyRaw, initialized, setActiveKey, fetchProjects }}>
      {children}
    </ProjectContext.Provider>
  );
}
