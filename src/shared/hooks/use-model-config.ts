import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getModelContextWindow, getProviderPreset } from '@/lib/provider-registry';
import { normalizeOpenAIFastMode } from '@/lib/openai-fast-mode';
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  isOpenAIReasoningEffort,
} from '@/lib/openai-reasoning-effort';
import type { ProviderId, OpenAIReasoningEffort, Agent } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import type { AggregateLiveModelItem } from '@/lib/aggregate-models-live';
import {
  compositeKeyForAggregateItem,
  modelSelectOptionsFromAggregate,
  parseAggregateCompositeKey,
} from '@/lib/aggregate-model-key';
import { PROVIDER_LABELS } from '@/components/agent-chat/types';
import { useAvailableModels } from '@/hooks/use-available-models';

type ModelSelectOption = { value: string; label: string };

/** 聊天栏未选模型时为空字符串；仅聚合列表中已配置凭据的供应商可选中 */
type SelectedProvider = ProviderId | '';

function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id] || id;
}

/** 父组件可传入的全局推理相关缓存（减少重复读 settings） */
export interface CachedModelSettings {
  effort: OpenAIReasoningEffort;
  fastMode: boolean;
}

export interface UseModelConfigReturn {
  provider: SelectedProvider;
  model: string;
  /** 与 options[].value 对齐，供 ChatInput modelValue */
  compositeValue: string;
  /** 下拉用复合 value，与 ChatInput modelValue 一致 */
  options: ModelSelectOption[];
  effort: OpenAIReasoningEffort;
  fastMode: boolean;
  contextWindow: number;
  promptEstimate: number;
  /**
   * 传入复合 key（providerId\\u001emodelId），同时更新 provider + model
   */
  setModel: (compositeOrLegacy: string) => void;
  setEffort: (e: OpenAIReasoningEffort) => void;
  setFastMode: (enabled: boolean) => void;
  applySessionConfig: (config: SessionConfig) => void;
  resetToAgentDefaults: (nextAgent: Agent) => void;
}

function resolveOpenAIDefaultEffort(
  defaultOpenAIReasoningEffort: OpenAIReasoningEffort | undefined,
  provider: ProviderId,
  globalEffort: OpenAIReasoningEffort,
): OpenAIReasoningEffort {
  if (provider === 'openai' && defaultOpenAIReasoningEffort) {
    return defaultOpenAIReasoningEffort;
  }
  return globalEffort;
}

function pickPairFromItems(
  items: AggregateLiveModelItem[],
  agent: Agent,
  globalProvider: ProviderId,
  globalModel: string,
): { providerId: ProviderId; modelId: string } {
  const inList = (pid: ProviderId, mid: string) =>
    items.some((it) => it.providerId === pid && it.value === mid);

  if (agent.defaultProvider && agent.defaultModel && inList(agent.defaultProvider, agent.defaultModel)) {
    return { providerId: agent.defaultProvider, modelId: agent.defaultModel };
  }
  if (globalModel && inList(globalProvider, globalModel)) {
    return { providerId: globalProvider, modelId: globalModel };
  }
  // 不再选用「不在聚合列表中」的 Agent 默认（例如未配置 API Key 的 Anthropic）
  const first = items[0];
  return { providerId: first.providerId, modelId: first.value };
}

export function useModelConfig(
  agent: Agent,
  projectKey: string | null | undefined,
  cachedSettings?: CachedModelSettings,
): UseModelConfigReturn {
  const { items: aggregateItems, loading: aggregateLoading } = useAvailableModels();

  const [provider, setProvider] = useState<SelectedProvider>('');
  const [model, setModelState] = useState('');
  const [effort, setEffort] = useState<OpenAIReasoningEffort>(DEFAULT_OPENAI_REASONING_EFFORT);
  const [fastMode, setFastMode] = useState<boolean>(cachedSettings?.fastMode ?? false);
  const [globalEffort, setGlobalEffort] = useState<OpenAIReasoningEffort>(
    cachedSettings?.effort ?? DEFAULT_OPENAI_REASONING_EFFORT,
  );
  const [globalFastMode, setGlobalFastMode] = useState<boolean>(cachedSettings?.fastMode ?? false);
  const [contextWindow, setContextWindow] = useState(() =>
    getModelContextWindow(getProviderPreset('anthropic').models[0]?.id || ''),
  );
  const [promptEstimate, setPromptEstimate] = useState(0);

  const globalDefaultsRef = useRef<{
    provider: ProviderId;
    model: string;
  }>({
    provider: 'anthropic',
    model: getProviderPreset('anthropic').models[0]?.id || '',
  });
  const [globalSettingsLoaded, setGlobalSettingsLoaded] = useState(false);

  const agentDefaultProvider = agent.defaultProvider;
  const agentDefaultModel = agent.defaultModel;
  const agentDefaultOpenAIReasoningEffort = agent.defaultOpenAIReasoningEffort;

  /** 已为当前 agent.id 做过聚合列表上的首次 provider/model 初始化 */
  const seededAgentIdRef = useRef<string | null>(null);

  // 读取全局设置
  useEffect(() => {
    let cancelled = false;

    if (cachedSettings) {
      setGlobalEffort(cachedSettings.effort);
      setGlobalFastMode(cachedSettings.fastMode);
    }

    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        const claude = data?.claude ?? {};
        const loadedProvider = (claude.provider as ProviderId) || 'anthropic';
        const providerModelsMap = (claude.providerModels && typeof claude.providerModels === 'object')
          ? claude.providerModels as Partial<Record<ProviderId, string>>
          : {};
        const providerModelLib = (claude.providerModelLibrary && typeof claude.providerModelLibrary === 'object')
          ? claude.providerModelLibrary as Partial<Record<ProviderId, string[]>>
          : {};

        const resolveConfiguredModel = (providerId: ProviderId): string => {
          const scoped = (providerModelsMap[providerId] || '').trim();
          if (scoped) return scoped;
          if (providerId === loadedProvider) return (claude.model || '').trim();
          return '';
        };

        const preset = getProviderPreset(loadedProvider);
        const optionMap = new Map<string, string>();
        for (const entry of preset.models) {
          optionMap.set(entry.id, entry.label || entry.id);
        }
        const library = Array.isArray(providerModelLib[loadedProvider]) ? providerModelLib[loadedProvider] : [];
        for (const raw of library) {
          const id = typeof raw === 'string' ? raw.trim() : '';
          if (id && !optionMap.has(id)) optionMap.set(id, id);
        }
        const fallbackModel = resolveConfiguredModel(loadedProvider);
        if (fallbackModel && !optionMap.has(fallbackModel)) {
          optionMap.set(fallbackModel, fallbackModel);
        }
        const modelOptions = Array.from(optionMap.entries());
        const selectedModel = modelOptions.some(([id]) => id === fallbackModel)
          ? fallbackModel
          : (modelOptions[0]?.[0] || '');

        if (!cachedSettings) {
          const savedEffort = isOpenAIReasoningEffort(claude.openaiReasoningEffort)
            ? claude.openaiReasoningEffort
            : DEFAULT_OPENAI_REASONING_EFFORT;
          const savedFastMode = normalizeOpenAIFastMode(claude.openaiFastMode) ?? false;
          setGlobalEffort(savedEffort);
          setGlobalFastMode(savedFastMode);
        }

        globalDefaultsRef.current = { provider: loadedProvider, model: selectedModel };
        if (!cancelled) setGlobalSettingsLoaded(true);
      } catch {
        if (!cancelled) setGlobalSettingsLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [cachedSettings]);

  // 切换 Agent 后允许重新 seed
  useEffect(() => {
    seededAgentIdRef.current = null;
  }, [agent.id]);

  // 全局设置就绪且聚合列表拉取完成后初始化（避免先以空列表误判而落到 Anthropic 默认）
  useEffect(() => {
    if (!globalSettingsLoaded) return;
    if (aggregateLoading) return;
    if (seededAgentIdRef.current === agent.id) return;

    const { provider: gp, model: gm } = globalDefaultsRef.current;

    if (aggregateItems.length > 0) {
      const { providerId, modelId } = pickPairFromItems(aggregateItems, agent, gp, gm);
      setProvider(providerId);
      setModelState(modelId);
      setEffort(resolveOpenAIDefaultEffort(
        agentDefaultOpenAIReasoningEffort,
        providerId,
        globalEffort,
      ));
      setFastMode(providerId === 'openai' ? globalFastMode : false);
    } else {
      setProvider('');
      setModelState('');
      setEffort(globalEffort);
      setFastMode(false);
    }
    seededAgentIdRef.current = agent.id;
  }, [
    aggregateItems,
    aggregateLoading,
    agent.id,
    agent.defaultProvider,
    agent.defaultModel,
    globalSettingsLoaded,
    agentDefaultOpenAIReasoningEffort,
    globalEffort,
    globalFastMode,
  ]);

  // 首次进入时聚合尚为空、之后才拉到可用模型：补选列表内第一项（不展示未配置凭据的供应商）
  useEffect(() => {
    if (!globalSettingsLoaded || aggregateLoading) return;
    if (aggregateItems.length === 0) return;
    if (provider || model) return;
    if (seededAgentIdRef.current !== agent.id) return;

    const { provider: gp, model: gm } = globalDefaultsRef.current;
    const { providerId, modelId } = pickPairFromItems(aggregateItems, agent, gp, gm);
    setProvider(providerId);
    setModelState(modelId);
    setEffort(resolveOpenAIDefaultEffort(
      agentDefaultOpenAIReasoningEffort,
      providerId,
      globalEffort,
    ));
    setFastMode(providerId === 'openai' ? globalFastMode : false);
  }, [
    aggregateItems,
    aggregateLoading,
    globalSettingsLoaded,
    provider,
    model,
    agent.id,
    agent.defaultProvider,
    agent.defaultModel,
    agentDefaultOpenAIReasoningEffort,
    globalEffort,
    globalFastMode,
  ]);

  const options = useMemo((): ModelSelectOption[] => {
    const base = modelSelectOptionsFromAggregate(aggregateItems, providerLabel);
    if (provider && model) {
      const cur = compositeKeyForAggregateItem({
        providerId: provider as ProviderId,
        value: model,
        label: model,
      });
      if (!base.some((o) => o.value === cur)) {
        return [
          {
            value: cur,
            label: `${model} · ${providerLabel(provider as ProviderId)}（当前）`,
          },
          ...base,
        ];
      }
    }
    return base;
  }, [aggregateItems, provider, model]);

  const compositeValue = useMemo(() => {
    if (!provider || !model) return '';
    return compositeKeyForAggregateItem({
      providerId: provider as ProviderId,
      value: model,
      label: model,
    });
  }, [provider, model]);

  const setModel = useCallback((compositeOrLegacy: string) => {
    if (!compositeOrLegacy) {
      setProvider('');
      setModelState('');
      setFastMode(false);
      return;
    }
    const parsed = parseAggregateCompositeKey(compositeOrLegacy);
    if (parsed) {
      setProvider(parsed.providerId);
      setModelState(parsed.modelId);
      if (parsed.providerId !== 'openai') {
        setFastMode(false);
      } else {
        setFastMode(globalFastMode);
        setEffort(resolveOpenAIDefaultEffort(
          agentDefaultOpenAIReasoningEffort,
          'openai',
          globalEffort,
        ));
      }
      return;
    }
    if (compositeOrLegacy) {
      setModelState(compositeOrLegacy);
    }
  }, [agentDefaultOpenAIReasoningEffort, globalEffort, globalFastMode]);

  useEffect(() => {
    setContextWindow(getModelContextWindow(model));
  }, [model]);

  useEffect(() => {
    if (provider !== 'openai' && fastMode) {
      setFastMode(false);
    }
  }, [provider, fastMode]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ agentId: agent.id });
    if (projectKey) params.set('projectKey', projectKey);

    (async () => {
      try {
        const res = await fetch(`/api/agent-chat/prompt-info?${params}`, { cache: 'no-store' });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setPromptEstimate(data.estimatedTokens ?? 0);
        }
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [agent.id, projectKey]);

  const applySessionConfig = useCallback((config: SessionConfig) => {
    const nextProvider = (config.provider ?? agentDefaultProvider ?? (provider || undefined)) as ProviderId;
    if (config.provider) {
      setProvider(config.provider);
    }
    if (config.model) {
      setModelState(config.model);
    }

    if (nextProvider === 'openai') {
      setEffort(config.openaiReasoningEffort ?? resolveOpenAIDefaultEffort(
        agentDefaultOpenAIReasoningEffort,
        nextProvider,
        globalEffort,
      ));
      setFastMode(config.openaiFastMode ?? globalFastMode);
    } else {
      setFastMode(false);
    }
  }, [
    agentDefaultOpenAIReasoningEffort,
    agentDefaultProvider,
    globalEffort,
    globalFastMode,
    provider,
  ]);

  const resetToAgentDefaults = useCallback((nextAgent: Agent) => {
    seededAgentIdRef.current = null;
    const { provider: gp, model: gm } = globalDefaultsRef.current;

    let intendedProvider: SelectedProvider = '';

    if (aggregateItems.length > 0) {
      const picked = pickPairFromItems(aggregateItems, nextAgent, gp, gm);
      intendedProvider = picked.providerId;
      setProvider(picked.providerId);
      setModelState(picked.modelId);
    } else {
      setProvider('');
      setModelState('');
    }

    seededAgentIdRef.current = nextAgent.id;

    if (intendedProvider === 'openai') {
      setEffort(resolveOpenAIDefaultEffort(
        nextAgent.defaultOpenAIReasoningEffort,
        'openai',
        globalEffort,
      ));
      setFastMode(globalFastMode);
    } else {
      setFastMode(false);
    }
  }, [aggregateItems, globalEffort, globalFastMode]);

  return {
    provider,
    model,
    compositeValue,
    options,
    effort,
    fastMode,
    contextWindow,
    promptEstimate,
    setModel,
    setEffort,
    setFastMode,
    applySessionConfig,
    resetToAgentDefaults,
  };
}
