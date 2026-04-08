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
const PresetsPage = lazy(() => import('@/app/[locale]/flows/presets/page'));
const CommunityLayout = lazy(() => import('@/app/[locale]/flows/community/layout'));
const CommunityHomePage = lazy(() => import('@/app/[locale]/flows/community/page'));
const CommunityAgentListPage = lazy(() => import('@/app/[locale]/flows/community/agent/page'));
const CommunityAgentDetailPage = lazy(() => import('@/app/[locale]/flows/community/agent/[identifier]/page'));
const CommunitySkillListPage = lazy(() => import('@/app/[locale]/flows/community/skill/page'));
const CommunitySkillDetailPage = lazy(() => import('@/app/[locale]/flows/community/skill/[identifier]/page'));
const CommunityMcpListPage = lazy(() => import('@/app/[locale]/flows/community/mcp/page'));
const CommunityMcpDetailPage = lazy(() => import('@/app/[locale]/flows/community/mcp/[identifier]/page'));
const CommunityModelTabPage = lazy(() => import('@/app/[locale]/flows/community/model/page'));
const CommunityProviderTabPage = lazy(() => import('@/app/[locale]/flows/community/provider/page'));
const McpPage = lazy(() => import('@/app/[locale]/flows/mcp/page'));
const ChatPage = lazy(() => import('@/app/[locale]/flows/chat/page'));
const SchedulesPage = lazy(() => import('@/app/[locale]/flows/schedules/page'));
const TaskTriggersPage = lazy(() => import('@/app/[locale]/flows/task-triggers/page'));
const DimensionsPage = lazy(() => import('@/app/[locale]/flows/dimensions/page'));
const RecycleBinPage = lazy(() => import('@/app/[locale]/flows/recycle-bin/page'));
const OAuthGoogleCallback = lazy(() => import('./routes/oauth-google-callback'));
const OAuthGoogleBrowserSync = lazy(() => import('./routes/oauth-google-browser-sync'));

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
        <Route path="settings" element={<Navigate to="/workspace/settings" replace />} />
        <Route path="workspace" element={<WorkspaceWrapper />}>
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="settings" element={<SettingsPage />} />
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
          <Route path="presets" element={<PresetsPage />} />
          <Route path="community" element={<CommunityLayout />}>
            <Route index element={<CommunityHomePage />} />
            <Route path="agent/:identifier" element={<CommunityAgentDetailPage />} />
            <Route path="agent" element={<CommunityAgentListPage />} />
            <Route path="skill/:identifier" element={<CommunitySkillDetailPage />} />
            <Route path="skill" element={<CommunitySkillListPage />} />
            <Route path="mcp/:identifier" element={<CommunityMcpDetailPage />} />
            <Route path="mcp" element={<CommunityMcpListPage />} />
            <Route path="model" element={<CommunityModelTabPage />} />
            <Route path="provider" element={<CommunityProviderTabPage />} />
          </Route>
          <Route path="mcp" element={<McpPage />} />
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
              <Route path="/oauth/google/callback" element={<Suspense fallback={<Loading />}><OAuthGoogleCallback /></Suspense>} />
              <Route path="/oauth/google/browser-sync" element={<Suspense fallback={<Loading />}><OAuthGoogleBrowserSync /></Suspense>} />
              <Route path="/en/*" element={<AppRoutes />} />
              <Route path="/*" element={<AppRoutes />} />
            </Routes>
          </ProjectProvider>
        </ThemeProvider>
      </BrowserRouter>
    </I18nextProvider>
  );
}
