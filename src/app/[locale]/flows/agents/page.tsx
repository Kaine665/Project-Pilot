'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Trash2, X, ChevronRight, Terminal, FileText, Globe, Users, ShieldOff, Maximize2, Minimize2 } from 'lucide-react';
import type { Agent, AgentCapabilities } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

// ── Capability items config ──

const CAPABILITY_ITEMS: Array<{
  key: keyof AgentCapabilities;
  label: string;
  description: string;
  icon: typeof Terminal;
  danger?: boolean;
}> = [
  { key: 'bash',       label: 'Bash 执行',     description: '命令行执行（含 Git 操作）',    icon: Terminal },
  { key: 'fileAccess', label: '文件读写',       description: 'Read、Write、Edit、Glob、Grep', icon: FileText },
  { key: 'web',        label: 'Web 搜索/抓取',  description: 'WebFetch、WebSearch',          icon: Globe },
  { key: 'subAgent',   label: '子 Agent',       description: 'Task 工具（创建子代理）',       icon: Users },
  { key: 'skipReview', label: '无需审核',       description: '自动批准所有工具调用',           icon: ShieldOff, danger: true },
];

// ── Form types ──

type FormData = {
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  capabilities: AgentCapabilities;
};

const emptyForm: FormData = {
  name: '', description: '', systemPrompt: '', icon: '',
  capabilities: { ...DEFAULT_AGENT_CAPABILITIES },
};

function agentToForm(a: Agent): FormData {
  return {
    name: a.name,
    description: a.description ?? '',
    systemPrompt: a.systemPrompt ?? '',
    icon: a.icon ?? '',
    capabilities: a.capabilities ?? { ...DEFAULT_AGENT_CAPABILITIES },
  };
}

// ── Toggle Switch component ──

function ToggleSwitch({ checked, onChange, danger }: { checked: boolean; onChange: () => void; danger?: boolean }) {
  const activeColor = danger
    ? 'bg-red-500 dark:bg-red-500'
    : 'bg-zinc-900 dark:bg-zinc-100';
  const inactiveColor = 'bg-zinc-200 dark:bg-zinc-700';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        checked ? activeColor : inactiveColor
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Main page ──

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

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

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null;

  const handleSelect = (agent: Agent) => {
    setCreating(false);
    setSelectedId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
  };

  const handleStartCreate = () => {
    setSelectedId(null);
    setCreating(true);
    setForm(emptyForm);
    setExpandedPrompt(false);
  };

  const handleClose = () => {
    setSelectedId(null);
    setCreating(false);
    setForm(emptyForm);
    setExpandedPrompt(false);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
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
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          setCreating(false);
          setSelectedId(data.agent.id);
          setForm(agentToForm(data.agent));
        }
      } else if (selectedId) {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedId,
            name,
            description: form.description.trim() || undefined,
            systemPrompt: form.systemPrompt.trim() || undefined,
            icon: form.icon.trim() || undefined,
            capabilities: form.capabilities,
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
        if (selectedId === id) {
          setSelectedId(null);
          setForm(emptyForm);
        }
      }
    } catch { /* ignore */ }
  };

  const isEditing = creating || selectedId !== null;
  const hasChanges = creating
    ? form.name.trim().length > 0
    : selectedAgent
      ? form.name !== selectedAgent.name
        || form.description !== (selectedAgent.description ?? '')
        || form.systemPrompt !== (selectedAgent.systemPrompt ?? '')
        || form.icon !== (selectedAgent.icon ?? '')
        || JSON.stringify(form.capabilities) !== JSON.stringify(selectedAgent.capabilities ?? DEFAULT_AGENT_CAPABILITIES)
      : false;

  return (
    <div className="flex h-full">
      {/* Left: Agent list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        {/* List header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex flex-1 items-center justify-center gap-2">
            <Bot className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Agents</span>
            <span className="text-sm text-zinc-400">({agents.length})</span>
          </div>
          <button
            onClick={handleStartCreate}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="新建 Agent"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-400">
              暂无 Agent
            </div>
          ) : (
            agents.map(a => (
              <div
                key={a.id}
                onClick={() => handleSelect(a)}
                className={`group flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800/50 ${
                  selectedId === a.id
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <Bot className="h-4 w-4 shrink-0 text-zinc-400" />
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

      {/* Right: Detail / Edit panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {isEditing && expandedPrompt ? (
          /* ── Fullscreen system prompt editor ── */
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
        ) : isEditing ? (
          <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
            {/* Panel header */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {creating ? '新建 Agent' : '编辑 Agent'}
                {selectedAgent?.builtIn && (
                  <span className="ml-2 text-xs font-normal text-blue-500">内置</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {!creating && !selectedAgent?.builtIn && (
                  <button
                    onClick={() => handleDelete(selectedId!)}
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

            {/* Form */}
            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="给 Agent 起个名字"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
              </div>

              {/* Slug (read-only for built-in agents) */}
              {selectedAgent?.builtIn && selectedAgent?.slug && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    标识符
                  </label>
                  <div className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
                    {selectedAgent.slug}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    内置 Agent 的标识符不可修改
                  </p>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  描述
                </label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="简要描述这个 Agent 的用途"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
              </div>

              {/* Icon */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  图标
                </label>
                <input
                  value={form.icon}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                  placeholder="Lucide 图标名称，如 brain、zap、code"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
                <p className="mt-1 text-xs text-zinc-400">
                  可选，留空使用默认机器人图标
                </p>
              </div>

              {/* System Prompt */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    系统提示词
                  </label>
                  <button
                    onClick={() => setExpandedPrompt(true)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="全屏编辑"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={form.systemPrompt}
                  onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                  placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                  rows={8}
                  className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
              </div>

              {/* Capabilities */}
              <div>
                <label className="mb-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  能力配置
                </label>
                <div className="space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  {CAPABILITY_ITEMS.map(({ key, label, description, icon: Icon, danger }) => (
                    <div
                      key={key}
                      className={`flex items-center justify-between rounded-md px-3 py-2.5 transition-colors ${
                        danger && form.capabilities[key]
                          ? 'bg-red-50/50 dark:bg-red-950/20'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`h-4 w-4 ${
                          danger && form.capabilities[key]
                            ? 'text-red-400'
                            : 'text-zinc-400'
                        }`} />
                        <div>
                          <div className={`text-sm font-medium ${
                            danger && form.capabilities[key]
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }`}>
                            {label}
                          </div>
                          <div className="text-xs text-zinc-400">{description}</div>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={form.capabilities[key]}
                        onChange={() => setForm(f => ({
                          ...f,
                          capabilities: { ...f.capabilities, [key]: !f.capabilities[key] },
                        }))}
                        danger={danger}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!form.name.trim() || saving || !hasChanges}
                  className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {saving ? '保存中...' : creating ? '创建' : '保存'}
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <Bot className="mb-3 h-10 w-10" />
            <p className="text-sm">选择一个 Agent 查看详情，或创建新的 Agent</p>
            <button
              onClick={handleStartCreate}
              className="mt-4 flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-4 w-4" />
              新建 Agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
