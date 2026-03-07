'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Bot, Plus, Trash2, X, ChevronRight, Minimize2,
  Settings, MessageSquare, Archive, ArchiveRestore,
  Download, Upload, FileDown,
} from 'lucide-react';
import type { Agent } from '@/types';
import { AgentChatPanel } from '@/components/agent-chat-panel';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import { AgentIcon, SettingsForm, type FormData, emptyForm, agentToForm } from '@/components/agent-form';
import { type AllSessionItem, type OpenedSession, groupSessionsByDay, syncUrlParams } from '@/components/agent-session-utils';

// ── Main page ──

export default function AgentsPage() {
  // ── Core data ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allSessions, setAllSessions] = useState<AllSessionItem[]>([]);

  // ── Sidebar tab ──
  const [sidebarTab, setSidebarTab] = useState<'conversations' | 'agents'>('conversations');

  // ── Active panel ──
  const [activePanel, setActivePanel] = useState<
    | { type: 'session'; key: number }
    | { type: 'agent'; agentId: string; mode: 'chat' | 'settings' }
    | null
  >(null);

  // ── Multi-instance session panels (切换不销毁) ──
  const [openedSessions, setOpenedSessions] = useState<OpenedSession[]>([]);
  const nextKeyRef = useRef(1);

  // ── Agent create/edit ──
  const [creating, setCreating] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  // ── New session agent picker ──
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);

  // ── Fetch agents ──
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Restore selection from URL params after agents load
  useEffect(() => {
    if (agents.length === 0) return;
    const url = new URL(window.location.href);
    const agentParam = url.searchParams.get('agent');
    const sessionParam = url.searchParams.get('session');
    if (agentParam) {
      const agent = agents.find(a => a.id === agentParam);
      if (agent) {
        setSelectedAgentId(agent.id);
        setForm(agentToForm(agent));
        if (sessionParam) {
          // Open the session panel for this session
          const key = nextKeyRef.current++;
          setOpenedSessions(prev => [...prev, { sessionId: sessionParam, agentId: agent.id, key }]);
          setActivePanel({ type: 'session', key });
        } else {
          setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
        }
      } else {
        // Agent from URL no longer exists — clear
        syncUrlParams({ agent: null, session: null });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]); // Only run when agents list first loads

  // Refresh agent list when window regains focus
  useEffect(() => {
    const handleFocus = () => fetchAgents();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchAgents]);

  // ── Fetch all sessions (cross-agent) ──
  const fetchAllSessions = useCallback(async () => {
    try {
      const [sessRes, agentsRes] = await Promise.all([
        fetch('/api/agent-chat/sessions', { cache: 'no-store' }),
        fetch('/api/agents'),
      ]);
      const sessData = await sessRes.json();
      const agentsData = await agentsRes.json();
      const agentMap = new Map<string, Agent>();
      for (const a of (agentsData.agents ?? []) as Agent[]) {
        agentMap.set(a.id, a);
      }
      const sessions: AllSessionItem[] = (sessData.sessions ?? []).map((s: { id: string; title: string; updatedAt: string; agentId: string; unreadCount?: number; archived?: boolean }) => {
        const agent = agentMap.get(s.agentId);
        return {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          agentId: s.agentId,
          agentName: agent?.name ?? '未知 Agent',
          agentIcon: agent?.icon,
          unreadCount: s.unreadCount,
          archived: s.archived,
        };
      });
      // Merge: keep optimistically-inserted local sessions that backend doesn't know about yet
      setAllSessions(prev => {
        const remoteIds = new Set(sessions.map((s: AllSessionItem) => s.id));
        const localOnly = prev.filter(s => !remoteIds.has(s.id));
        return [...localOnly, ...sessions];
      });
      // Also update agents cache
      setAgents(agentsData.agents ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAllSessions(); }, [fetchAllSessions]);

  // ── Grouped sessions for display ──
  const groupedSessions = useMemo(() => groupSessionsByDay(allSessions), [allSessions]);

  // ── Close agent picker when clicking outside ──
  useEffect(() => {
    if (!showAgentPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAgentPicker]);

  // ── Handlers: Conversations tab ──

  const handleSessionClick = (session: AllSessionItem) => {
    // Mark as read (fire-and-forget + clear local state immediately)
    if (session.unreadCount) {
      setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, unreadCount: 0 } : s));
      fetch(`/api/agent-chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }

    // Check if already opened
    const existing = openedSessions.find(
      o => o.sessionId === session.id && o.agentId === session.agentId,
    );
    if (existing) {
      setActivePanel({ type: 'session', key: existing.key });
      syncUrlParams({ agent: session.agentId, session: session.id });
      return;
    }
    // Open new instance
    const key = nextKeyRef.current++;
    setOpenedSessions(prev => [...prev, { sessionId: session.id, agentId: session.agentId, key }]);
    setActivePanel({ type: 'session', key });
    syncUrlParams({ agent: session.agentId, session: session.id });
  };

  const handleNewSession = (agent: Agent) => {
    const key = nextKeyRef.current++;
    setOpenedSessions(prev => [...prev, { sessionId: null, agentId: agent.id, key }]);
    setActivePanel({ type: 'session', key });
    setShowAgentPicker(false);
    syncUrlParams({ agent: agent.id, session: null });
  };

  const handleArchiveToggle = (session: AllSessionItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const newArchived = !session.archived;
    // Optimistic update
    setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: newArchived } : s));
    fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: newArchived ? 'archive' : 'unarchive' }),
    }).then(res => {
      if (!res.ok) {
        console.error(`Archive toggle failed: ${res.status}`);
        // Rollback on failure
        setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: !newArchived } : s));
      }
    }).catch(() => {
      // Rollback on network error
      setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: !newArchived } : s));
    });
  };

  // ── Handlers: Agents tab ──

  const handleAgentClick = (agent: Agent) => {
    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
    syncUrlParams({ agent: agent.id, session: null });
  };

  // Alias for handleAgentClick used by handleClone
  const handleSelect = handleAgentClick;

  const handleStartCreate = () => {
    setSelectedAgentId(null);
    setCreating(true);
    setForm(emptyForm);
    setExpandedPrompt(false);
    setActivePanel(null);
  };

  // B1: Clone an agent — copy all config with "(副本)" suffix
  const handleClone = async (source: Agent) => {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} (副本)`,
          description: source.description,
          systemPrompt: source.systemPrompt,
          icon: source.icon,
          capabilities: source.capabilities,
          requiredParams: source.requiredParams,
          contextIds: source.contextIds,
          defaultResources: source.defaultResources,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAgents();
        handleSelect(data.agent);
      }
    } catch { /* ignore */ }
  };

  const handleClose = () => {
    setSelectedAgentId(null);
    setCreating(false);
    setForm(emptyForm);
    setExpandedPrompt(false);
    if (activePanel?.type === 'agent') {
      setActivePanel(null);
    }
    syncUrlParams({ agent: null, session: null });
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    const parsedParams = form.requiredParamsText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    try {
      if (creating) {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: form.description.trim() || undefined,
            systemPrompt: form.systemPrompt.trim() || undefined,
            icon: form.icon.trim() || undefined,
            capabilities: form.capabilities,
            requiredParams: parsedParams.length > 0 ? parsedParams : undefined,
            contextIds: form.contextIds.length > 0 ? form.contextIds : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          setCreating(false);
          setSelectedAgentId(data.agent.id);
          setForm(agentToForm(data.agent));
          setActivePanel({ type: 'agent', agentId: data.agent.id, mode: 'chat' });
          syncUrlParams({ agent: data.agent.id, session: null });
        }
      } else if (selectedAgentId) {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedAgentId,
            name,
            description: form.description.trim() || undefined,
            systemPrompt: form.systemPrompt.trim() || undefined,
            icon: form.icon.trim() || undefined,
            capabilities: form.capabilities,
            requiredParams: parsedParams.length > 0 ? parsedParams : [],
            contextIds: form.contextIds,
          }),
        });
        if (res.ok) await fetchAgents();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!confirm(`确定要将 Agent「${agent?.name ?? id}」移到回收站吗？`)) return;
    try {
      const res = await fetch('/api/agents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchAgents();
        if (selectedAgentId === id) {
          setSelectedAgentId(null);
          setForm(emptyForm);
          setActivePanel(null);
          syncUrlParams({ agent: null, session: null });
        }
      }
    } catch { /* ignore */ }
  };

  // ── Export / Import ──

  const handleExport = async (agent: Agent) => {
    try {
      const res = await fetch(`/api/agents/export/${agent.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const safeName = agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.ppagent`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ppagent';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const pkg = JSON.parse(text);
        const res = await fetch('/api/agents/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pkg),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          handleSelect(data.agent);
          const msg = data.contextsImported > 0
            ? `已导入 Agent「${data.agent.name}」及 ${data.contextsImported} 个上下文`
            : `已导入 Agent「${data.agent.name}」`;
          alert(msg);
        } else {
          const err = await res.json();
          alert(`导入失败: ${err.error}`);
        }
      } catch {
        alert('导入失败: 文件格式无效');
      }
    };
    input.click();
  };

  // ── Derived state ──
  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? null;
  const agentViewMode = activePanel?.type === 'agent' ? activePanel.mode : 'chat';

  const hasChanges = creating
    ? form.name.trim().length > 0
    : selectedAgent
      ? form.name !== selectedAgent.name
        || form.description !== (selectedAgent.description ?? '')
        || form.systemPrompt !== (selectedAgent.systemPrompt ?? '')
        || form.icon !== (selectedAgent.icon ?? '')
        || JSON.stringify(form.capabilities) !== JSON.stringify(selectedAgent.capabilities ?? DEFAULT_AGENT_CAPABILITIES)
        || form.requiredParamsText !== (selectedAgent.requiredParams ?? []).join('\n')
        || JSON.stringify([...form.contextIds].sort()) !== JSON.stringify([...(selectedAgent.contextIds ?? [])].sort())
      : false;

  // ── Active session info (for header display) ──
  const activeOpened = activePanel?.type === 'session'
    ? openedSessions.find(o => o.key === activePanel.key)
    : null;
  const activeSessionAgent = activeOpened
    ? agents.find(a => a.id === activeOpened.agentId) ?? null
    : null;
  const activeSessionInfo = activeOpened?.sessionId
    ? allSessions.find(s => s.id === activeOpened.sessionId)
    : null;

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        {/* ── Tab switcher ── */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setSidebarTab('conversations')}
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'conversations'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            对话
          </button>
          <button
            onClick={() => setSidebarTab('agents')}
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'agents'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Agents
          </button>
        </div>

        {/* ── Tab content ── */}
        {sidebarTab === 'conversations' ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* New session button */}
            <div className="relative flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-400">
                {allSessions.length > 0 && `${allSessions.length} 个对话`}
              </div>
              <button
                onClick={() => setShowAgentPicker(v => !v)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="新建对话"
              >
                <Plus className="h-4 w-4" />
              </button>
              {/* Agent picker dropdown */}
              {showAgentPicker && (
                <div
                  ref={agentPickerRef}
                  className="absolute right-2 top-full z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    选择 Agent 开始对话
                  </div>
                  {agents.map(a => (
                    <button
                      key={a.id}
                      onClick={() => handleNewSession(a)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors dark:hover:bg-zinc-800"
                    >
                      <AgentIcon iconKey={a.icon} className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="truncate text-zinc-900 dark:text-zinc-100">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Session list */}
            <div className="flex-1 overflow-y-auto">
              {allSessions.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-zinc-400">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                  <p>暂无对话</p>
                  <p className="mt-1">点击右上角 + 开始新对话</p>
                </div>
              ) : (
                groupedSessions.map(group => (
                  <div key={group.label}>
                    <div className="sticky top-0 bg-zinc-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                      {group.label}
                    </div>
                    {group.items.map(s => {
                      const isActive = activePanel?.type === 'session'
                        && openedSessions.find(o => o.key === activePanel.key)?.sessionId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSessionClick(s)}
                          className={`group/session flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                            isActive
                              ? 'bg-zinc-100 dark:bg-zinc-800'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                          } ${s.archived ? 'opacity-45' : ''}`}
                        >
                          <AgentIcon iconKey={s.agentIcon} className={`h-4 w-4 shrink-0 ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400'}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-sm font-medium ${s.archived ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                              {s.title}
                            </div>
                            <div className={`truncate ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400'}`} style={{ fontSize: 13 }}>
                              {s.agentName}
                            </div>
                          </div>
                          {!isActive && !!s.unreadCount && s.unreadCount > 0 && !s.archived && (
                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                              {s.unreadCount > 99 ? '99+' : s.unreadCount}
                            </span>
                          )}
                          <button
                            onClick={(e) => handleArchiveToggle(s, e)}
                            className="shrink-0 rounded-md p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-500 group-hover/session:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-400"
                            title={s.archived ? '取消归档' : '归档'}
                          >
                            {s.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* ── Agents tab ── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-400">
                {agents.length > 0 && `${agents.length} 个 Agent`}
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleImport}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="导入 .ppagent"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <button
                  onClick={handleStartCreate}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="新建 Agent"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {agents.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-400">
                  暂无 Agent
                </div>
              ) : (
                agents.map(a => (
                  <div
                    key={a.id}
                    onClick={() => handleAgentClick(a)}
                    className={`group flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800/50 ${
                      activePanel?.type === 'agent' && activePanel.agentId === a.id
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <AgentIcon iconKey={a.icon} className="h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="truncate">{a.name}</span>
                        {a.builtIn && (
                          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            内置
                          </span>
                        )}
                      </div>
                      {a.description && (
                        <div className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                          {a.description}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {creating ? (
          /* ── Creating new agent ── */
          expandedPrompt ? (
            <div className="flex flex-1 flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  系统提示词 — {form.name || '未命名'}
                </label>
                <button
                  onClick={() => setExpandedPrompt(false)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="收起"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                autoFocus
                value={form.systemPrompt}
                onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                className="flex-1 w-full resize-none rounded-md border border-zinc-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
              />
            </div>
          ) : (
            <SettingsForm
              creating
              form={form}
              setForm={setForm}
              selectedAgent={null}
              hasChanges={hasChanges}
              saving={saving}
              onSave={handleSave}
              onClose={handleClose}
              onDelete={handleDelete}
              selectedId={selectedAgentId}
              onExpandPrompt={() => setExpandedPrompt(true)}
            />
          )
        ) : activePanel?.type === 'agent' && selectedAgent ? (
          /* ── Agent detail (chat / settings) ── */
          expandedPrompt && agentViewMode === 'settings' ? (
            <div className="flex flex-1 flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  系统提示词 — {form.name || '未命名'}
                </label>
                <button
                  onClick={() => setExpandedPrompt(false)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="收起"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                autoFocus
                value={form.systemPrompt}
                onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                className="flex-1 w-full resize-none rounded-md border border-zinc-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
              />
            </div>
          ) : (
            <>
              {/* Agent panel header */}
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <div className="flex items-center gap-2 min-w-0">
                  <AgentIcon iconKey={selectedAgent.icon} className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900 truncate dark:text-zinc-100">{selectedAgent.name}</span>
                  {selectedAgent.builtIn && (
                    <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                      内置
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (activePanel?.type === 'agent') {
                        const newMode = activePanel.mode === 'chat' ? 'settings' : 'chat';
                        setActivePanel({ ...activePanel, mode: newMode });
                        setExpandedPrompt(false);
                      }
                    }}
                    className={`rounded-md p-1.5 transition-colors ${
                      agentViewMode === 'settings'
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                    }`}
                    title={agentViewMode === 'chat' ? '设置' : '聊天'}
                  >
                    {agentViewMode === 'chat' ? <Settings className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleExport(selectedAgent)}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="导出 .ppagent"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {!selectedAgent.builtIn && (
                    <button
                      onClick={() => handleDelete(selectedAgentId!)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-900/20"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={handleClose}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {agentViewMode === 'chat' ? (
                <div className="flex-1 overflow-hidden">
                  <AgentChatPanel
                    key={`agent-${selectedAgent.id}`}
                    agent={selectedAgent}
                    initialSessionId={null}
                    onSessionChange={(newSession) => {
                      if (newSession && selectedAgent) {
                        setAllSessions(prev => {
                          if (prev.some(s => s.id === newSession.id)) return prev;
                          return [{
                            id: newSession.id,
                            title: newSession.title,
                            updatedAt: newSession.updatedAt,
                            agentId: selectedAgent.id,
                            agentName: selectedAgent.name,
                            agentIcon: selectedAgent.icon,
                          }, ...prev];
                        });
                      }
                      fetchAllSessions();
                    }}
                  />
                </div>
              ) : (
                <SettingsForm
                  creating={false}
                  form={form}
                  setForm={setForm}
                  selectedAgent={selectedAgent}
                  hasChanges={hasChanges}
                  saving={saving}
                  onSave={handleSave}
                  onClose={handleClose}
                  onDelete={handleDelete}
                  selectedId={selectedAgentId}
                  onExpandPrompt={() => setExpandedPrompt(true)}
                />
              )}
            </>
          )
        ) : activePanel?.type === 'session' ? (
          /* ── Session chat panels (multi-instance, CSS visibility toggle) ── */
          <>
            {/* Session header */}
            {activeSessionAgent && (
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <div className="flex items-center gap-2 min-w-0">
                  <AgentIcon iconKey={activeSessionAgent.icon} className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900 truncate dark:text-zinc-100">
                    {activeSessionInfo?.title ?? '新会话'}
                  </span>
                  <span className="text-xs text-zinc-400 shrink-0">
                    — {activeSessionAgent.name}
                  </span>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('toggle-session-compress'));
                    }}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 transition-colors dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                    title="压缩会话历史"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      // Dispatch a custom event that AgentChatPanel listens for
                      window.dispatchEvent(new CustomEvent('toggle-session-config'));
                    }}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="会话配置"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            {/* Render all opened sessions, toggle visibility */}
            <div className="flex-1 overflow-hidden relative">
              {openedSessions.map(os => {
                const agent = agents.find(a => a.id === os.agentId);
                if (!agent) return null;
                const isVisible = activePanel.key === os.key;
                return (
                  <div
                    key={os.key}
                    className={`absolute inset-0 ${isVisible ? 'flex flex-col' : 'hidden'}`}
                  >
                    <AgentChatPanel
                      agent={agent}
                      initialSessionId={os.sessionId}
                      onSessionChange={(newSession) => {
                        // Update the opened session's sessionId if it was null (new session)
                        if (newSession && os.sessionId === null) {
                          setOpenedSessions(prev =>
                            prev.map(p => p.key === os.key ? { ...p, sessionId: newSession.id } : p),
                          );
                          syncUrlParams({ session: newSession.id });
                        }
                        // Optimistically insert new session into sidebar list
                        if (newSession) {
                          setAllSessions(prev => {
                            if (prev.some(s => s.id === newSession.id)) return prev;
                            return [{
                              id: newSession.id,
                              title: newSession.title,
                              updatedAt: newSession.updatedAt,
                              agentId: os.agentId,
                              agentName: agent.name,
                              agentIcon: agent.icon,
                            }, ...prev];
                          });
                        }
                        // Mark as read if user is actively viewing this session
                        const sid = newSession?.id ?? os.sessionId;
                        if (sid) {
                          fetch(`/api/agent-chat/sessions/${sid}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'markAsRead' }),
                          }).catch(() => {});
                        }
                        fetchAllSessions();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <MessageSquare className="mb-3 h-10 w-10" />
            <p className="text-sm">选择一个对话，或开始新的对话</p>
            <button
              onClick={() => { setSidebarTab('conversations'); setShowAgentPicker(true); }}
              className="mt-4 flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-4 w-4" />
              新建对话
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
