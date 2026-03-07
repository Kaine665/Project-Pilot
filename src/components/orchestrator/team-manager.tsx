'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Users, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Agent } from '@/types';
import type { AgentTeam, TeamMember, ConflictPolicy } from '@/types/agent-team';

// ── TeamManager 主组件 ──

export function TeamManager() {
  const t = useTranslations('orchestrator');
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false); // true = 创建或编辑模式

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-teams');
      const data = await res.json();
      setTeams(data.teams ?? []);
    } catch {
      setTeams([]);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents((data.agents ?? []).filter((a: Agent) => !a.archived));
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
    fetchAgents();
  }, [fetchTeams, fetchAgents]);

  const selectedTeam = teams.find(t => t.id === selectedTeamId) ?? null;

  const handleCreate = () => {
    setSelectedTeamId(null);
    setEditing(true);
  };

  const handleSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    setEditing(true);
  };

  const handleDelete = async (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    if (!confirm(t('confirmDeleteTeam', { name: team.name }))) return;
    try {
      await fetch('/api/agent-teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: teamId }),
      });
      setSelectedTeamId(null);
      setEditing(false);
      fetchTeams();
    } catch { /* ignore */ }
  };

  const handleSaved = () => {
    fetchTeams();
    setEditing(false);
  };

  return (
    <div className="flex h-full">
      {/* 左侧列表 */}
      <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
          <button
            onClick={handleCreate}
            className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Plus className="h-4 w-4" />
            {t('newTeam')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {teams.length === 0 && (
            <p className="text-xs text-zinc-400 px-2 py-4 text-center">{t('noTeams')}</p>
          )}
          {teams.map(team => (
            <button
              key={team.id}
              onClick={() => handleSelect(team.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                selectedTeamId === team.id
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-left">{team.name}</span>
              <span className="text-xs text-zinc-400">{team.members.length}</span>
              <ChevronRight className="h-3 w-3 text-zinc-400" />
            </button>
          ))}
        </div>
      </div>

      {/* 右侧表单 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <TeamForm
            team={selectedTeam}
            agents={agents}
            onSaved={handleSaved}
            onDelete={selectedTeam ? () => handleDelete(selectedTeam.id) : undefined}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            {t('noTeams')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TeamForm 表单 ──

interface TeamFormProps {
  team: AgentTeam | null; // null = 创建
  agents: Agent[];
  onSaved: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}

function TeamForm({ team, agents, onSaved, onDelete, onCancel }: TeamFormProps) {
  const t = useTranslations('orchestrator');
  const tActions = useTranslations('actions');
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [members, setMembers] = useState<TeamMember[]>(team?.members ?? []);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictPolicy['strategy']>(
    team?.conflictPolicy?.strategy ?? 'ai-resolve'
  );
  const [resolverAgentId, setResolverAgentId] = useState(team?.conflictPolicy?.resolverAgentId ?? '');
  const [saving, setSaving] = useState(false);

  // 当 team 变化时重置表单
  useEffect(() => {
    setName(team?.name ?? '');
    setDescription(team?.description ?? '');
    setMembers(team?.members ?? []);
    setConflictStrategy(team?.conflictPolicy?.strategy ?? 'ai-resolve');
    setResolverAgentId(team?.conflictPolicy?.resolverAgentId ?? '');
  }, [team]);

  const handleAddMember = () => {
    setMembers(prev => [...prev, { agentId: '', role: '', responsibilities: '' }]);
  };

  const handleRemoveMember = (idx: number) => {
    setMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMemberChange = (idx: number, field: keyof TeamMember, value: string) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const handleSave = async () => {
    if (!name.trim() || members.length === 0) return;

    // 过滤掉没有选 agent 的成员
    const validMembers = members.filter(m => m.agentId);
    if (validMembers.length === 0) return;

    setSaving(true);
    try {
      const conflictPolicy: ConflictPolicy = {
        strategy: conflictStrategy,
        ...(conflictStrategy === 'ai-resolve' && resolverAgentId ? { resolverAgentId } : {}),
      };

      if (team) {
        // 更新
        await fetch('/api/agent-teams', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: team.id,
            name: name.trim(),
            description: description.trim() || undefined,
            members: validMembers,
            conflictPolicy,
          }),
        });
      } else {
        // 创建
        await fetch('/api/agent-teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            members: validMembers,
            conflictPolicy,
          }),
        });
      }
      onSaved();
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const getAgentName = (agentId: string) => {
    return agents.find(a => a.id === agentId)?.name ?? agentId;
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{team ? t('editTeam') : t('newTeam')}</h2>
        <div className="flex gap-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {tActions('cancel')}
          </button>
        </div>
      </div>

      {/* 名称 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('teamName')}</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('teamNamePlaceholder')}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
        />
      </div>

      {/* 描述 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('description')}</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('descriptionPlaceholder')}
          rows={2}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 resize-none dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
        />
      </div>

      {/* 成员 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('members')}</label>
          <button
            onClick={handleAddMember}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <Plus className="h-3 w-3" />
            {t('addMember')}
          </button>
        </div>

        {members.map((member, idx) => (
          <div key={idx} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
            <div className="flex items-center gap-2">
              {/* Agent 选择 */}
              <select
                value={member.agentId}
                onChange={e => handleMemberChange(idx, 'agentId', e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              >
                <option value="">{t('selectAgent')}</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <button
                onClick={() => handleRemoveMember(idx)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={member.role}
                onChange={e => handleMemberChange(idx, 'role', e.target.value)}
                placeholder={t('rolePlaceholder')}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
              <input
                value={member.responsibilities}
                onChange={e => handleMemberChange(idx, 'responsibilities', e.target.value)}
                placeholder={t('responsibilitiesPlaceholder')}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            {member.agentId && (
              <p className="text-xs text-zinc-400">Agent: {getAgentName(member.agentId)}</p>
            )}
          </div>
        ))}

        {members.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-4">
            {t('addMember')}
          </p>
        )}
      </div>

      {/* 冲突策略 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('conflictPolicy')}</label>
        <select
          value={conflictStrategy}
          onChange={e => setConflictStrategy(e.target.value as ConflictPolicy['strategy'])}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="ai-resolve">{t('conflictAiResolve')}</option>
          <option value="fail">{t('conflictFail')}</option>
          <option value="manual">{t('conflictManual')}</option>
        </select>

        {conflictStrategy === 'ai-resolve' && (
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">{t('resolver')}</label>
            <select
              value={resolverAgentId}
              onChange={e => setResolverAgentId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            >
              <option value="">—</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        disabled={saving || !name.trim() || members.filter(m => m.agentId).length === 0}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {saving ? '...' : tActions('save')}
      </button>
    </div>
  );
}
