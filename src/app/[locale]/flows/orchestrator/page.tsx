'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Play, Users, Zap, Clock, ChevronRight, FolderPlus, Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useProject } from '@/components/project-context';
import { TeamManager } from '@/components/orchestrator/team-manager';
import { OrchMonitor } from '@/components/orchestrator/orch-monitor';
import type { AgentTeam } from '@/types/agent-team';
import type { OrchestratorSession } from '@/types/orchestrator';

export default function OrchestratorPage() {
  const t = useTranslations('orchestrator');
  const { activeKey } = useProject();
  const [activeTab, setActiveTab] = useState<'teams' | 'orchestrate'>('orchestrate');

  // 编排状态
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [launching, setLaunching] = useState(false);
  const [activeOrchId, setActiveOrchId] = useState<string | null>(null);
  const [history, setHistory] = useState<OrchestratorSession[]>([]);
  const [createMode, setCreateMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // 加载 teams
  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-teams');
      const data = await res.json();
      setTeams(data.teams ?? []);
    } catch { setTeams([]); }
  }, []);

  // 加载编排历史
  const fetchHistory = useCallback(async () => {
    if (!activeKey) { setHistory([]); return; }
    try {
      const res = await fetch(`/api/orchestrator?projectKey=${encodeURIComponent(activeKey)}`);
      const data = await res.json();
      setHistory((data.sessions ?? []).sort((a: OrchestratorSession, b: OrchestratorSession) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } catch { setHistory([]); }
  }, [activeKey]);

  useEffect(() => {
    fetchTeams();
    fetchHistory();
  }, [fetchTeams, fetchHistory]);

  // 发起编排
  const handleLaunch = async () => {
    if (!prompt.trim()) return;
    if (!createMode && !activeKey) return;
    if (createMode && !newProjectName.trim()) return;
    setLaunching(true);
    try {
      const payload: Record<string, unknown> = {
        prompt: prompt.trim(),
        ...(selectedTeamId ? { teamId: selectedTeamId } : {}),
      };
      if (createMode) {
        payload.newProject = { name: newProjectName.trim() };
      } else {
        payload.projectKey = activeKey;
      }
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.orchestrationId) {
        setActiveOrchId(data.orchestrationId);
        setPrompt('');
        setNewProjectName('');
        fetchHistory();
      }
    } catch { /* ignore */ } finally {
      setLaunching(false);
    }
  };

  // 当前选中的编排会话
  const activeSession = useMemo(() => {
    if (!activeOrchId) return null;
    return history.find(s => s.id === activeOrchId) ?? null;
  }, [activeOrchId, history]);

  return (
    <div className="flex h-full flex-col">
      {/* Tab 导航 */}
      <div className="flex items-center border-b border-zinc-200 dark:border-zinc-800 px-4">
        <TabButton
          active={activeTab === 'orchestrate'}
          onClick={() => setActiveTab('orchestrate')}
          icon={<Zap className="h-4 w-4" />}
          label={t('orchestrate')}
        />
        <TabButton
          active={activeTab === 'teams'}
          onClick={() => setActiveTab('teams')}
          icon={<Users className="h-4 w-4" />}
          label={t('teams')}
        />
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'teams' ? (
          <TeamManager />
        ) : (
          <div className="flex h-full">
            {/* 左侧：历史记录 + 发起表单 */}
            <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
              {/* 发起表单 */}
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 space-y-3">
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('launchOrch')}</h3>

                {/* 项目模式切换 */}
                <div className="flex rounded-md border border-zinc-300 dark:border-zinc-600 text-xs overflow-hidden">
                  <button
                    onClick={() => setCreateMode(false)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 transition-colors ${
                      !createMode
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Folder className="h-3 w-3" />
                    {t('useExistingProject')}
                  </button>
                  <button
                    onClick={() => setCreateMode(true)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 transition-colors ${
                      createMode
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <FolderPlus className="h-3 w-3" />
                    {t('createNewProject')}
                  </button>
                </div>

                {/* 创建新项目时显示名称输入 */}
                {createMode && (
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder={t('newProjectNamePlaceholder')}
                    className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                  />
                )}

                {/* 未选择已有项目时的提示 */}
                {!createMode && !activeKey && (
                  <p className="text-xs text-amber-500">{t('noProject')}</p>
                )}

                {/* Team 选择 */}
                <select
                  value={selectedTeamId}
                  onChange={e => setSelectedTeamId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                >
                  <option value="">{t('noTeamSelected')}</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>

                {/* Prompt */}
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={t('promptPlaceholder')}
                  rows={4}
                  className="w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm outline-none focus:border-zinc-500 resize-none dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                />

                <button
                  onClick={handleLaunch}
                  disabled={launching || !prompt.trim() || (createMode ? !newProjectName.trim() : !activeKey)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <Play className="h-4 w-4" />
                  {launching ? t('launching') : t('launchOrch')}
                </button>
              </div>

              {/* 历史记录 */}
              <div className="flex-1 overflow-y-auto p-2">
                <p className="px-2 py-1 text-xs font-medium text-zinc-400">{t('history')}</p>
                {history.length === 0 && (
                  <p className="text-xs text-zinc-400 px-2 py-4 text-center">{t('noHistory')}</p>
                )}
                {history.map(session => (
                  <button
                    key={session.id}
                    onClick={() => setActiveOrchId(session.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      activeOrchId === session.id
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <PhaseIcon phase={session.phase} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs">{session.originalPrompt}</p>
                      <p className="text-xs text-zinc-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(session.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-zinc-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* 右侧：监控面板 */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {activeOrchId ? (
                <div className="flex-1 overflow-hidden p-6 pb-0">
                  <OrchMonitor
                    orchId={activeOrchId}
                    onStop={() => fetchHistory()}
                    originalPrompt={activeSession?.originalPrompt}
                    onRelaunch={(p) => { setPrompt(p); setActiveOrchId(null); }}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                  {t('noHistory')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 按钮 ──

const TabButton = memo(function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors ${
        active
          ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
});

// ── 阶段图标 ──

const PhaseIcon = memo(function PhaseIcon({ phase }: { phase: string }) {
  const colorMap: Record<string, string> = {
    completed: 'text-green-500',
    failed: 'text-red-500',
    executing: 'text-blue-500',
    splitting: 'text-amber-500',
    merging: 'text-purple-500',
  };
  const color = colorMap[phase] ?? 'text-zinc-400';
  return <Zap className={`h-4 w-4 shrink-0 ${color}`} />;
});
