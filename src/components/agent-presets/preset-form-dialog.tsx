'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check, Maximize2 } from 'lucide-react';
import type { AgentPreset, AgentCapabilities, OpenAIReasoningEffort, ProviderId, ProjectEntry } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import {
  ToggleSwitch,
  CAPABILITY_ITEMS,
  AGENT_ICON_OPTIONS,
  AgentAvatar,
  buildAgentPresetRequestBody,
  type FormData,
} from '@/components/agent-form';
import { useAvailableModels } from '@/hooks/use-available-models';
import {
  compositeKeyForAggregateItem,
  modelSelectOptionsFromAggregate,
  parseAggregateCompositeKey,
} from '@/lib/aggregate-model-key';
import { PROVIDER_LABELS } from '@/components/agent-chat/types';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/client/i18n/use-translations';

function emptyDraft(): Omit<FormData, 'name' | 'requiredParamsText' | 'contextIds'> & { name: string } {
  return {
    name: '',
    description: '',
    systemPrompt: '',
    icon: '',
    capabilities: { ...DEFAULT_AGENT_CAPABILITIES },
    skillIds: [],
    projectKey: '',
    defaultProvider: '',
    defaultModel: '',
    defaultOpenAIReasoningEffort: '',
    contextStrategy: 'additive',
  };
}

function presetToDraft(p: AgentPreset): ReturnType<typeof emptyDraft> {
  return {
    name: p.name,
    description: p.description ?? '',
    systemPrompt: p.systemPrompt ?? '',
    icon: p.icon ?? '',
    capabilities: { ...DEFAULT_AGENT_CAPABILITIES, ...p.capabilities },
    skillIds: [...(p.skillIds ?? [])],
    projectKey: p.projectKey ?? '',
    defaultProvider: (p.defaultProvider ?? '') as ProviderId | '',
    defaultModel: p.defaultModel ?? '',
    defaultOpenAIReasoningEffort: (p.defaultOpenAIReasoningEffort ?? '') as OpenAIReasoningEffort | '',
    contextStrategy: p.contextStrategy ?? 'additive',
  };
}

function draftToFormData(d: ReturnType<typeof emptyDraft>): FormData {
  return {
    ...d,
    requiredParamsText: '',
    contextIds: [],
  };
}

export function PresetFormDialog({
  open,
  onOpenChange,
  mode,
  preset,
  projects,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'create' | 'edit';
  preset: AgentPreset | null;
  projects: ProjectEntry[];
  onSaved: () => void;
}) {
  const t = useTranslations('presets');
  const tActions = useTranslations('actions');
  const [draft, setDraft] = useState(emptyDraft());
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);

  const { items: aggregateItems } = useAvailableModels();
  const modelOptions = useMemo(() => {
    const base = modelSelectOptionsFromAggregate(aggregateItems, (id) => PROVIDER_LABELS[id] || id);
    if (draft.defaultProvider && draft.defaultModel) {
      const cur = compositeKeyForAggregateItem({
        providerId: draft.defaultProvider as ProviderId,
        value: draft.defaultModel,
        label: draft.defaultModel,
      });
      if (!base.some((o) => o.value === cur)) {
        return [
          {
            value: cur,
            label: `${draft.defaultModel} · ${PROVIDER_LABELS[draft.defaultProvider as ProviderId] || draft.defaultProvider}（当前）`,
          },
          ...base,
        ];
      }
    }
    return base;
  }, [aggregateItems, draft.defaultProvider, draft.defaultModel]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && preset) {
      setDraft(presetToDraft(preset));
    } else {
      setDraft(emptyDraft());
    }
    setExpandedPrompt(false);
  }, [open, mode, preset]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch('/api/skills');
        const data = await res.json();
        setAvailableSkills(data.skills ?? []);
      } catch {
        setAvailableSkills([]);
      }
    })();
  }, [open]);

  const toggleSkill = useCallback((name: string) => {
    setDraft((d) => ({
      ...d,
      skillIds: d.skillIds.includes(name) ? d.skillIds.filter((s) => s !== name) : [...d.skillIds, name],
    }));
  }, []);

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      const fd = draftToFormData(draft);
      const body = buildAgentPresetRequestBody(fd, name, draft.projectKey.trim() || undefined);
      if (mode === 'create') {
        const res = await fetch('/api/data/agent-presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          onSaved();
          onOpenChange(false);
        }
      } else if (preset) {
        const res = await fetch('/api/data/agent-presets', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: preset.id, ...body }),
        });
        if (res.ok) {
          onSaved();
          onOpenChange(false);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const formBody = (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('fieldName')} <span className="text-red-400">*</span>
        </label>
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldDescription')}</label>
        <input
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
        />
      </div>
      {projects.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldScope')}</label>
          <select
            value={draft.projectKey}
            onChange={(e) => setDraft((d) => ({ ...d, projectKey: e.target.value }))}
            className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">{t('scopeGlobal')}</option>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">{t('scopeHint')}</p>
        </div>
      )}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldVisual')}</label>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {AGENT_ICON_OPTIONS.map(({ key, label }) => {
            const selected = draft.icon === key || (!draft.icon && key === 'bot');
            return (
              <button
                key={key}
                type="button"
                title={label}
                onClick={() => setDraft((d) => ({ ...d, icon: key }))}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] transition-colors',
                  selected
                    ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                    : 'border-zinc-200 dark:border-zinc-700',
                )}
              >
                <AgentAvatar iconKey={key} className="h-8 w-8 rounded-lg" />
              </button>
            );
          })}
        </div>
      </div>
      {!expandedPrompt ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldPromptTemplate')}</label>
            <button
              type="button"
              onClick={() => setExpandedPrompt(true)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title={t('expandPrompt')}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={draft.systemPrompt}
            onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
            rows={4}
            className="w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </div>
      ) : (
        <div className="flex min-h-[200px] flex-col gap-2">
          <div className="flex justify-between">
            <label className="text-sm font-medium">{t('fieldPromptTemplate')}</label>
            <button type="button" onClick={() => setExpandedPrompt(false)} className="text-xs text-zinc-500">
              {t('collapsePrompt')}
            </button>
          </div>
          <textarea
            autoFocus
            value={draft.systemPrompt}
            onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
            className="min-h-[240px] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </div>
      )}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldCapabilities')}</label>
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
          {CAPABILITY_ITEMS.map(({ key, label, description, icon: Icon, danger }) => (
            <div key={key} className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg px-2 py-1">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</div>
                  <div className="text-xs text-zinc-400">{description}</div>
                </div>
              </div>
              <ToggleSwitch
                checked={draft.capabilities[key as keyof AgentCapabilities]}
                onChange={() =>
                  setDraft((d) => ({
                    ...d,
                    capabilities: { ...d.capabilities, [key]: !d.capabilities[key as keyof AgentCapabilities] },
                  }))
                }
                danger={danger}
              />
            </div>
          ))}
        </div>
      </div>
      {availableSkills.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldSkills')}</label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
            {availableSkills.map((skill) => {
              const checked = draft.skillIds.includes(skill.name);
              return (
                <button
                  key={skill.name}
                  type="button"
                  onClick={() => toggleSkill(skill.name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm',
                    checked ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100' : 'border-zinc-300',
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5 text-white dark:text-zinc-900" />}
                  </span>
                  <span className="truncate">{skill.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldModel')}</label>
        <select
          value={
            draft.defaultProvider && draft.defaultModel
              ? compositeKeyForAggregateItem({
                  providerId: draft.defaultProvider as ProviderId,
                  value: draft.defaultModel,
                  label: draft.defaultModel,
                })
              : ''
          }
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              setDraft((d) => ({
                ...d,
                defaultProvider: '',
                defaultModel: '',
                defaultOpenAIReasoningEffort: '',
              }));
              return;
            }
            const parsed = parseAggregateCompositeKey(v);
            if (!parsed) return;
            setDraft((d) => ({
              ...d,
              defaultProvider: parsed.providerId,
              defaultModel: parsed.modelId,
              defaultOpenAIReasoningEffort: parsed.providerId === 'openai' ? d.defaultOpenAIReasoningEffort : '',
            }));
          }}
          className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="">{t('inheritGlobalModel')}</option>
          {modelOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {draft.defaultProvider === 'openai' && (
        <div>
          <label className="mb-2 block text-sm font-medium">OpenAI Reasoning</label>
          <div className="flex flex-wrap gap-1">
            {(['minimal', 'low', 'medium', 'high', 'xhigh'] as OpenAIReasoningEffort[]).map((opt) => {
              const active = draft.defaultOpenAIReasoningEffort === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      defaultOpenAIReasoningEffort: d.defaultOpenAIReasoningEffort === opt ? '' : opt,
                    }))
                  }
                  className={cn(
                    'rounded-lg border px-2 py-1 text-xs',
                    active ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800' : 'border-zinc-200',
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('fieldContextStrategy')}</label>
        <select
          value={draft.contextStrategy}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              contextStrategy: e.target.value === 'exclusive' ? 'exclusive' : 'additive',
            }))
          }
          className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="additive">{t('strategyAdditive')}</option>
          <option value="exclusive">{t('strategyExclusive')}</option>
        </select>
      </div>
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,720px)] w-[min(100vw-1.5rem,560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <Dialog.Title className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {mode === 'create' ? t('dialogCreateTitle') : t('dialogEditTitle')}
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{formBody}</div>
          <div className="flex shrink-0 gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!draft.name.trim() || saving}
              className="min-h-10 flex-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? t('saving') : tActions('save')}
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm dark:border-zinc-700"
              >
                {tActions('cancel')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
