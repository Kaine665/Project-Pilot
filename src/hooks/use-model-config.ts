import { useState, useEffect, useRef } from 'react';
import { getProviderPreset, getModelContextWindow } from '@/lib/provider-registry';
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
  /** Apply session config overrides (provider/model) */
  applySessionConfig: (config: SessionConfig) => void;
  /** Reset model to agent defaults */
  resetToAgentDefaults: (agent: Agent) => void;
}

const OPENAI_MODELS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Manages provider/model/effort selection, including:
 * - Loading from global settings or cached values
 * - Updating model options when provider changes (+ OpenAI dynamic fetch)
 * - Tracking contextWindow based on selected model
 * - Fetching prompt estimate based on agent/project
 */
export function useModelConfig(
  agent: Agent,
  projectKey: string | null | undefined,
  cachedSettings?: CachedSettings,
): UseModelConfigReturn {
  const [provider, setProvider] = useState<ProviderId>(INITIAL_PROVIDER);
  const [model, setModel] = useState(INITIAL_MODEL);
  const [options, setOptions] = useState<ModelSelectOption[]>(INITIAL_OPTIONS);
  const [effort, setEffort] = useState<OpenAIReasoningEffort>('xhigh');
  const [contextWindow, setContextWindow] = useState(getModelContextWindow(INITIAL_MODEL));
  const [promptEstimate, setPromptEstimate] = useState(0);

  // OpenAI model list cache (5min TTL)
  const openaiModelsCacheRef = useRef<{ options: ModelSelectOption[]; cachedAt: number } | null>(null);

  // Effect 1: Load provider/model from global settings (skip if cachedSettings provided)
  useEffect(() => {
    if (cachedSettings) {
      setProvider(cachedSettings.provider);
      setModel(cachedSettings.model);
      setOptions(cachedSettings.modelOptions);
      setEffort(cachedSettings.effort);
      return;
    }
    let cancelled = false;
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
        // Build model options for loaded provider
        const preset = getProviderPreset(loadedProvider);
        const optionMap = new Map<string, string>();
        for (const m of preset.models) optionMap.set(m.id, m.label || m.id);
        const libModels = Array.isArray(providerModelLib[loadedProvider]) ? providerModelLib[loadedProvider] : [];
        for (const raw of libModels) {
          const id = typeof raw === 'string' ? raw.trim() : '';
          if (id && !optionMap.has(id)) optionMap.set(id, id);
        }
        const fallbackModel = resolveConfiguredModel(loadedProvider);
        if (fallbackModel && !optionMap.has(fallbackModel)) optionMap.set(fallbackModel, fallbackModel);
        const builtOptions = Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
        const selected = builtOptions.some((o) => o.value === fallbackModel) ? fallbackModel : (builtOptions[0]?.value || '');
        // Apply agent default model (overrides global settings, can be overridden by session config)
        const effectiveProvider = agent.defaultProvider ?? loadedProvider;
        if (agent.defaultProvider) {
          const agentPreset = getProviderPreset(agent.defaultProvider);
          const agentOptionMap = new Map<string, string>();
          for (const m of agentPreset.models) agentOptionMap.set(m.id, m.label || m.id);
          const agentDefaultModel = (agent.defaultModel || resolveConfiguredModel(agent.defaultProvider)).trim();
          if (agentDefaultModel && !agentOptionMap.has(agentDefaultModel)) agentOptionMap.set(agentDefaultModel, agentDefaultModel);
          const agentOptions = Array.from(agentOptionMap.entries()).map(([value, label]) => ({ value, label }));
          const agentSelected = agentOptions.some(o => o.value === agentDefaultModel)
            ? agentDefaultModel
            : agentOptions[0]?.value || '';
          setProvider(effectiveProvider);
          setOptions(agentOptions.length > 0 ? agentOptions : builtOptions);
          setModel(agentSelected || selected);
        } else {
          setProvider(loadedProvider);
          setOptions(builtOptions);
          setModel(selected);
        }
        // Load OpenAI reasoning effort
        const VALID_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
        const savedEffort = claude.openaiReasoningEffort;
        if (typeof savedEffort === 'string' && VALID_EFFORTS.includes(savedEffort as OpenAIReasoningEffort)) {
          setEffort(savedEffort as OpenAIReasoningEffort);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 2: Update model options when provider changes (+ fetch OpenAI catalog)
  useEffect(() => {
    let cancelled = false;
    const preset = getProviderPreset(provider);
    const optionMap = new Map<string, string>();
    for (const m of preset.models) optionMap.set(m.id, m.label || m.id);
    if (model && !optionMap.has(model)) optionMap.set(model, model);
    const staticOptions = Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));

    if (provider === 'openai') {
      setOptions(staticOptions);
      if (!staticOptions.some((o) => o.value === model)) {
        setModel(staticOptions[0]?.value || '');
      }

      // Check cache
      const cache = openaiModelsCacheRef.current;
      if (cache && Date.now() - cache.cachedAt < OPENAI_MODELS_CACHE_TTL) {
        setOptions(cache.options);
        return () => { cancelled = true; };
      }

      // Fetch dynamic model catalog
      (async () => {
        try {
          const res = await fetch('/api/settings/openai-models', { cache: 'no-store' });
          const data = await res.json();
          if (cancelled) return;
          if (res.ok && data?.ok && Array.isArray(data.models)) {
            const merged = [...staticOptions];
            const knownIds = new Set(merged.map((o) => o.value));
            for (const r of data.models) {
              if (r && typeof r === 'object' && typeof r.id === 'string') {
                const id = r.id.trim();
                if (id && !knownIds.has(id)) {
                  merged.push({ value: id, label: typeof r.displayName === 'string' ? r.displayName : id });
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
    } else {
      if (staticOptions.length > 0) {
        setOptions(staticOptions);
        if (!model) {
          setModel(staticOptions[0].value);
        }
      }
    }
    return () => { cancelled = true; };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 3: Update contextWindow when model changes
  useEffect(() => {
    setContextWindow(getModelContextWindow(model));
  }, [model]);

  // Effect 4: Fetch prompt estimate when agent/project changes
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
  }, [agent.id, projectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply session config overrides for provider/model */
  const applySessionConfig = (config: SessionConfig) => {
    if (!config.provider) return;
    setProvider(config.provider);
    const cfgPreset = getProviderPreset(config.provider);
    const cfgOptionMap = new Map<string, string>();
    for (const m of cfgPreset.models) cfgOptionMap.set(m.id, m.label || m.id);
    if (config.model && !cfgOptionMap.has(config.model)) cfgOptionMap.set(config.model, config.model);
    const cfgOptions = Array.from(cfgOptionMap.entries()).map(([value, label]) => ({ value, label }));
    if (cfgOptions.length > 0) setOptions(cfgOptions);
    if (config.model) setModel(config.model);
  };

  /** Reset to agent default provider/model */
  const resetToAgentDefaults = (a: Agent) => {
    if (!a.defaultProvider) return;
    setProvider(a.defaultProvider);
    const agentPreset = getProviderPreset(a.defaultProvider);
    const agentOptionMap = new Map<string, string>();
    for (const m of agentPreset.models) agentOptionMap.set(m.id, m.label || m.id);
    if (a.defaultModel && !agentOptionMap.has(a.defaultModel)) agentOptionMap.set(a.defaultModel, a.defaultModel);
    const agentOptions = Array.from(agentOptionMap.entries()).map(([value, label]) => ({ value, label }));
    if (agentOptions.length > 0) setOptions(agentOptions);
    if (a.defaultModel) {
      setModel(a.defaultModel);
    } else if (agentOptions.length > 0) {
      setModel(agentOptions[0].value);
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
