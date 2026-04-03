import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18next from './i18n/config';
import { ThemeProvider } from '@/components/theme-provider';
import { ProjectProvider } from '@/components/project-context';

const WorkspaceShell = lazy(() => import('./routes/workspace-shell'));
const SettingsPage = lazy(() => import('@/app/[locale]/settings/page'));
const ProjectsPage = lazy(() => import('@/app/[locale]/flows/projects/page'));
const AgentsPage = lazy(() => import('@/app/[locale]/flows/agents/page'));
const ButlerPage = lazy(() => import('@/app/[locale]/flows/butler/page'));
const TodosPage = lazy(() => import('@/app/[locale]/flows/todos/page'));
const DocsPage = lazy(() => import('@/app/[locale]/flows/docs/page'));
const DocsProjectPage = lazy(() => import('@/app/[locale]/flows/docs/[projectKey]/page'));
const ContextPage = lazy(() => import('@/app/[locale]/flows/context/page'));
const KnowledgePage = lazy(() => import('@/app/[locale]/flows/knowledge/page'));
const PromptsPage = lazy(() => import('@/app/[locale]/flows/prompts/page'));
const SkillsPage = lazy(() => import('@/app/[locale]/flows/skills/page'));
const ChatPage = lazy(() => import('@/app/[locale]/flows/chat/page'));
const SchedulesPage = lazy(() => import('@/app/[locale]/flows/schedules/page'));
const TaskTriggersPage = lazy(() => import('@/app/[locale]/flows/task-triggers/page'));
const DimensionsPage = lazy(() => import('@/app/[locale]/flows/dimensions/page'));
const RecycleBinPage = lazy(() => import('@/app/[locale]/flows/recycle-bin/page'));

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function WorkspaceWrapper() {
  return (
    <Suspense fallback={<Loading />}>
      <WorkspaceShell>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </WorkspaceShell>
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workspace" element={<WorkspaceWrapper />}>
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="butler" element={<ButlerPage />} />
          <Route path="todos" element={<TodosPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="docs/:projectKey" element={<DocsProjectPage />} />
          <Route path="context" element={<ContextPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="task-triggers" element={<TaskTriggersPage />} />
          <Route path="dimensions" element={<DimensionsPage />} />
          <Route path="recycle-bin" element={<RecycleBinPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/workspace/projects" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <I18nextProvider i18n={i18next}>
      <BrowserRouter>
        <ThemeProvider>
          <ProjectProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/workspace/projects" replace />} />
              <Route path="/en/*" element={<AppRoutes />} />
              <Route path="/*" element={<AppRoutes />} />
            </Routes>
          </ProjectProvider>
        </ThemeProvider>
      </BrowserRouter>
    </I18nextProvider>
  );
}
