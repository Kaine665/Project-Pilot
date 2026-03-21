import { useState, useEffect, useRef } from 'react';
import { getProviderPreset, getModelContextWindow } from '@/lib/provider-registry';
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  isOpenAIReasoningEffort,
} from '@/lib/openai-reasoning-effort';
import type { ProviderId, OpenAIReasoningEffort, Agent } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';

type ModelSelectOption = { value: string; label: string };

const INITIAL_PROVIDER: ProviderId = 'anthropic';
const INITIAL_PRESET = getProviderPreset(INITIAL_PROVIDER);
const INITIAL_OPTIONS = INITIAL_PRESET.models.map((m) => ({ value: m.id, label: m.label || m.id }));
const INITIAL_MODEL = INITIAL_OPTIONS[0]?.value || '';

interface CachedSettings {
  provider: ProviderId;
  model: string;
  modelOptions: ModelSelectOption[];
  effort: OpenAIReasoningEffort;
}

export interface UseModelConfigReturn {
  provider: ProviderId;
  model: string;
  options: ModelSelectOption[];
  effort: OpenAIReasoningEffort;
  contextWindow: number;
  promptEstimate: number;
  setProvider: (p: ProviderId) => void;
  setModel: (m: string) => void;
  setOptions: (o: ModelSelectOption[]) => void;
  setEffort: (e: OpenAIReasoningEffort) => void;
  applySessionConfig: (config: SessionConfig) => void;
  resetToAgentDefaults: (agent: Agent) => void;
}

const OPENAI_MODELS_CACHE_TTL = 5 * 60 * 1000;

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

function buildProviderOptions(provider: ProviderId, model: string): ModelSelectOption[] {
  const preset = getProviderPreset(provider);
  const optionMap = new Map<string, string>();
  for (const entry of preset.models) {
    optionMap.set(entry.id, entry.label || entry.id);
  }
  if (model && !optionMap.has(model)) {
    optionMap.set(model, model);
  }
  return Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
}

export function useModelConfig(
  agent: Agent,
  projectKey: string | null | undefined,
  cachedSettings?: CachedSettings,
): UseModelConfigReturn {
  const [provider, setProvider] = useState<ProviderId>(INITIAL_PROVIDER);
  const [model, setModel] = useState(INITIAL_MODEL);
  const [options, setOptions] = useState<ModelSelectOption[]>(INITIAL_OPTIONS);
  const [effort, setEffort] = useState<OpenAIReasoningEffort>(DEFAULT_OPENAI_REASONING_EFFORT);
  const [globalEffort, setGlobalEffort] = useState<OpenAIReasoningEffort>(
    cachedSettings?.effort ?? DEFAULT_OPENAI_REASONING_EFFORT,
  );
  const [contextWindow, setContextWindow] = useState(getModelContextWindow(INITIAL_MODEL));
  const [promptEstimate, setPromptEstimate] = useState(0);
  const agentDefaultProvider = agent.defaultProvider;
  const agentDefaultModel = agent.defaultModel;
  const agentDefaultOpenAIReasoningEffort = agent.defaultOpenAIReasoningEffort;

  const openaiModelsCacheRef = useRef<{ options: ModelSelectOption[]; cachedAt: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyLoadedSettings = (loaded: CachedSettings) => {
      const loadedProvider = loaded.provider;
      const loadedModel = loaded.model;
      const loadedOptions = loaded.modelOptions;
      const loadedEffort = loaded.effort;
      const effectiveProvider = agentDefaultProvider ?? loadedProvider;

      setGlobalEffort(loadedEffort);

      if (agentDefaultProvider) {
        const agentOptions = buildProviderOptions(agentDefaultProvider, agentDefaultModel || '');
        const agentModel = agentDefaultModel || agentOptions[0]?.value || loadedModel;
        setProvider(agentDefaultProvider);
        setOptions(agentOptions.length > 0 ? agentOptions : loadedOptions);
        setModel(agentModel);
      } else {
        setProvider(loadedProvider);
        setOptions(loadedOptions);
        setModel(loadedModel);
      }

      setEffort(resolveOpenAIDefaultEffort(agentDefaultOpenAIReasoningEffort, effectiveProvider, loadedEffort));
    };

    if (cachedSettings) {
      applyLoadedSettings(cachedSettings);
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
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
          if (id && !optionMap.has(id)) {
            optionMap.set(id, id);
          }
        }
        const fallbackModel = resolveConfiguredModel(loadedProvider);
        if (fallbackModel && !optionMap.has(fallbackModel)) {
          optionMap.set(fallbackModel, fallbackModel);
        }
        const modelOptions = Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
        const selectedModel = modelOptions.some((entry) => entry.value === fallbackModel)
          ? fallbackModel
          : (modelOptions[0]?.value || '');
        const savedEffort = isOpenAIReasoningEffort(claude.openaiReasoningEffort)
          ? claude.openaiReasoningEffort
          : DEFAULT_OPENAI_REASONING_EFFORT;

        applyLoadedSettings({
          provider: loadedProvider,
          model: selectedModel,
          modelOptions,
          effort: savedEffort,
        });
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [
    agentDefaultProvider,
    agentDefaultModel,
    agentDefaultOpenAIReasoningEffort,
    cachedSettings,
  ]);

  useEffect(() => {
    let cancelled = false;
    const staticOptions = buildProviderOptions(provider, model);

    if (provider === 'openai') {
      setOptions(staticOptions);
      if (!staticOptions.some((entry) => entry.value === model)) {
        setModel(staticOptions[0]?.value || '');
      }

      const cache = openaiModelsCacheRef.current;
      if (cache && Date.now() - cache.cachedAt < OPENAI_MODELS_CACHE_TTL) {
        setOptions(cache.options);
        return () => { cancelled = true; };
      }

      (async () => {
        try {
          const res = await fetch('/api/settings/openai-models', { cache: 'no-store' });
          const data = await res.json();
          if (cancelled) return;
          if (res.ok && data?.ok && Array.isArray(data.models)) {
            const merged = [...staticOptions];
            const knownIds = new Set(merged.map((entry) => entry.value));
            for (const row of data.models) {
              if (row && typeof row === 'object' && typeof row.id === 'string') {
                const id = row.id.trim();
                if (id && !knownIds.has(id)) {
                  merged.push({
                    value: id,
                    label: typeof row.displayName === 'string' ? row.displayName : id,
                  });
                  knownIds.add(id);
                }
              }
            }
            if (!cancelled) {
              openaiModelsCacheRef.current = { options: merged, cachedAt: Date.now() };
              setOptions(merged);
            }
          }
        } catch {
          // ignore
        }
      })();
    } else if (staticOptions.length > 0) {
      setOptions(staticOptions);
      if (!model) {
        setModel(staticOptions[0].value);
      }
    }

    return () => { cancelled = true; };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setContextWindow(getModelContextWindow(model));
  }, [model]);

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

  const applySessionConfig = (config: SessionConfig) => {
    const nextProvider = config.provider ?? agentDefaultProvider ?? provider;
    const defaultEffort = agentDefaultOpenAIReasoningEffort;
    if (config.provider) {
      setProvider(config.provider);
    }

    const cfgOptions = buildProviderOptions(nextProvider, config.model || '');
    if (cfgOptions.length > 0) {
      setOptions(cfgOptions);
    }
    if (config.model) {
      setModel(config.model);
    }
    if (nextProvider === 'openai') {
      setEffort(config.openaiReasoningEffort ?? resolveOpenAIDefaultEffort(defaultEffort, nextProvider, globalEffort));
    }
  };

  const resetToAgentDefaults = (nextAgent: Agent) => {
    if (!nextAgent.defaultProvider) return;
    setProvider(nextAgent.defaultProvider);
    const agentOptions = buildProviderOptions(nextAgent.defaultProvider, nextAgent.defaultModel || '');
    if (agentOptions.length > 0) {
      setOptions(agentOptions);
    }
    if (nextAgent.defaultModel) {
      setModel(nextAgent.defaultModel);
    } else if (agentOptions.length > 0) {
      setModel(agentOptions[0].value);
    }
    if (nextAgent.defaultProvider === 'openai') {
      setEffort(resolveOpenAIDefaultEffort(
        nextAgent.defaultOpenAIReasoningEffort,
        nextAgent.defaultProvider,
        globalEffort,
      ));
    }
  };

  return {
    provider,
    model,
    options,
    effort,
    contextWindow,
    promptEstimate,
    setProvider,
    setModel,
    setOptions,
    setEffort,
    applySessionConfig,
    resetToAgentDefaults,
  };
}
