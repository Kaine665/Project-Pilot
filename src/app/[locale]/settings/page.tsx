'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from '@/client/i18n/use-translations';
import { useRouter, usePathname, useSearchParams } from '@/client/i18n/routing';
import { TopNav } from '@/components/top-nav';
import { Loader2, Brain, Wrench, Palette, Database, Eye, Settings, ShieldAlert, Sparkles, Satellite, LogIn } from 'lucide-react';
import { getProviderPreset, PROVIDER_REGISTRY } from '@/lib/provider-registry';
import { providerSupportsOAuthUi } from '@/lib/ai-auth-ui';
import { useTheme } from '@/components/theme-provider';
import { AddCustomProviderDialog } from '@/components/add-custom-provider-dialog';
import {
  SettingsAISection,
  SettingsClaudeSection,
  SettingsAppearanceSection,
  SettingsDataSection,
  SettingsDeveloperSection,
  SettingsPrivacySection,
  SettingsSafetySection,
  SettingsTitleGenerationSection,
} from '@/components/settings-sections';
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  isOpenAIReasoningEffort,
} from '@/lib/openai-reasoning-effort';
import type {
  CustomProviderConfig,
  ProviderId,
  ClaudeAuthMode,
  EffortLevel,
  OpenAIReasoningEffort,
  DangerCategory,
  DangerActionLevel,
  DangerDetectorSettings,
  TitleGenerationChainEntry,
  ProviderCredential,
} from '@/types';
import type { AggregateLiveModelItem, SupplierAvailabilityRow } from '@/lib/aggregate-models-live';
import { apiFetch, apiUrl } from '@/lib/api-base';
import { DEFAULT_DANGER_SETTINGS, DEFAULT_TITLE_GENERATION } from '@/types';
const INITIAL_PROVIDER: ProviderId = 'anthropic';
const INITIAL_MODEL = getProviderPreset(INITIAL_PROVIDER).models[0]?.id ?? '';

/** 根据加载的数据应用模型选择状态，供 fetchSettings 使用，避免闭包依赖 */
function applyProviderModelStateFromData(
  providerId: ProviderId,
  incomingModel: string | undefined,
  libraryMap: Partial<Record<ProviderId, string[]>> | undefined,
  customProviders: CustomProviderConfig[],
  setModel: (m: string) => void,
  setCustomModel: (m: string) => void,
) {
  const p = getProviderPreset(providerId, customProviders);
  const library = (libraryMap?.[providerId] || []).map((m) => m.trim());
  const saved = (incomingModel || '').trim();
  if (saved && (p.models.some((m) => m.id === saved) || library.includes(saved))) {
    setModel(saved);
    setCustomModel('');
    return;
  }
  if (saved) {
    setModel('__custom__');
    setCustomModel(saved);
    return;
  }
  if (p.models.length > 0) {
    setModel(p.models[0].id);
    setCustomModel('');
    return;
  }
  setModel('__custom__');
  setCustomModel('');
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tActions = useTranslations('actions');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();

  // Form state — per-provider maps
  const [provider, setProvider] = useState<ProviderId>(INITIAL_PROVIDER);
  const [authMode, setAuthMode] = useState<ClaudeAuthMode>('api_key');
  const [providerApiKeys, setProviderApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [providerCredentialsForUi, setProviderCredentialsForUi] = useState<
    Partial<Record<ProviderId, Pick<ProviderCredential, 'apiKey' | 'authMode'>>>
  >({});
  const [providerModels, setProviderModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [providerModelLibrary, setProviderModelLibrary] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [model, setModel] = useState(INITIAL_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high');
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<OpenAIReasoningEffort>(DEFAULT_OPENAI_REASONING_EFFORT);
  const [openaiFastMode, setOpenaiFastMode] = useState(false);
  const [openaiOAuthEnabled, setOpenaiOAuthEnabled] = useState(false);
  const [aggregateLiveModels, setAggregateLiveModels] = useState<AggregateLiveModelItem[]>([]);
  const [supplierAvailability, setSupplierAvailability] = useState<SupplierAvailabilityRow[]>([]);
  /** 输入框旁自动探测结果；聚合刷新成功后会清空，再以服务端为准 */
  const [supplierProbeRow, setSupplierProbeRow] = useState<Partial<Record<ProviderId, SupplierAvailabilityRow>>>({});
  const [supplierProbeLoading, setSupplierProbeLoading] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [aggregateLiveStatus, setAggregateLiveStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [aggregateLiveErrorDetail, setAggregateLiveErrorDetail] = useState('');
  const [openaiModels, setOpenaiModels] = useState<Array<{ id: string; displayName: string }>>([]);
  const [openaiModelsLoading, setOpenaiModelsLoading] = useState(false);
  const [maxTurns, setMaxTurns] = useState(0);
  const [defaultExposePromptPath, setDefaultExposePromptPath] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>([]);
  const [providerBaseUrls, setProviderBaseUrls] = useState<Partial<Record<ProviderId, string>>>({});
  const [showAddCustomProvider, setShowAddCustomProvider] = useState(false);

  // Privacy state
  const [telemetry, setTelemetry] = useState(false);
  const [schedulesPageEnabled, setSchedulesPageEnabled] = useState(true);
  const [taskTriggersPageEnabled, setTaskTriggersPageEnabled] = useState(true);

  type GoogleAuthStatus = { configured: boolean; user: { sub: string; email?: string; name?: string; picture?: string } | null };
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus | null>(null);
  const [googleAuthNotice, setGoogleAuthNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Safety detection state
  const [dangerSettings, setDangerSettings] = useState<DangerDetectorSettings>({ ...DEFAULT_DANGER_SETTINGS });

  // Title generation state
  const [titleGenEnabled, setTitleGenEnabled] = useState(true);
  const [titleGenChain, setTitleGenChain] = useState<TitleGenerationChainEntry[]>(
    DEFAULT_TITLE_GENERATION.chain ?? [],
  );

  // UI state
  const [activeSection, setActiveSection] = useState('ai');
  const [loading, setLoading] = useState(true);
  /** 首次从服务端拉取完成后延迟打开，避免用初始 state 误触发一次写入 */
  const [readyForAutosave, setReadyForAutosave] = useState(false);
  const autosaveSeq = useRef(0);
  /** 凭据未变则 autosave 成功后不重复打外部 list 接口 */
  const lastSavedAggregateCredFingerprint = useRef<string | null>(null);
  const providerApiKeysRef = useRef(providerApiKeys);
  providerApiKeysRef.current = providerApiKeys;
  const customProvidersRef = useRef(customProviders);
  customProvidersRef.current = customProviders;
  const providerBaseUrlsRef = useRef(providerBaseUrls);
  providerBaseUrlsRef.current = providerBaseUrls;
  const probeTimersRef = useRef<Partial<Record<ProviderId, ReturnType<typeof setTimeout>>>>({});
  // Data management state
  const [dataDir, setDataDir] = useState('');
  const [diskUsage, setDiskUsage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived: current provider's API key（保存设置时用）
  const apiKey = providerApiKeys[provider] || '';

  const setCurrentProviderModel = useCallback((value: string) => {
    const trimmed = value.trim();
    setProviderModels((prev) => {
      const next = { ...prev };
      if (trimmed) {
        next[provider] = trimmed;
      } else {
        delete next[provider];
      }
      return next;
    });
  }, [provider]);

  const applyProviderModelState = useCallback((
    providerId: ProviderId,
    incomingModel?: string,
    libraryMap?: Partial<Record<ProviderId, string[]>>,
    customProvidersOverride?: CustomProviderConfig[],
  ) => {
    const providers = customProvidersOverride ?? customProviders;
    const p = getProviderPreset(providerId, providers);
    const library = (libraryMap?.[providerId] || []).map((m) => m.trim());
    const saved = (incomingModel || '').trim();
    if (saved && (p.models.some((m) => m.id === saved) || library.includes(saved))) {
      setModel(saved);
      setCustomModel('');
      return;
    }
    if (saved) {
      setModel('__custom__');
      setCustomModel(saved);
      return;
    }
    if (p.models.length > 0) {
      setModel(p.models[0].id);
      setCustomModel('');
      return;
    }
    setModel('__custom__');
    setCustomModel('');
  }, [customProviders]);

  const isPresetModel = useMemo(() => {
    if (model === '__custom__') return false;
    const trimmed = model.trim();
    if (!trimmed) return false;
    const p = getProviderPreset(provider, customProviders);
    if (p.models.some((m) => m.id === trimmed)) return true;
    if ((providerModelLibrary[provider] || []).map((x) => x.trim()).includes(trimmed)) return true;
    if (provider === 'openai' && openaiModels.some((m) => m.id === trimmed)) return true;
    return false;
  }, [provider, customProviders, providerModelLibrary, model, openaiModels]);

  // Load settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(apiUrl('/api/settings'));
      if (res.ok) {
        const data = await res.json();
        const loadedProvider = (data.claude.provider || 'anthropic') as ProviderId;
        const incomingCustomEarly = Array.isArray(data.claude.customProviders)
          ? data.claude.customProviders as CustomProviderConfig[]
          : [];
        const oAuthOn = data.claude.openaiOAuthEnabled === true;
        setOpenaiOAuthEnabled(oAuthOn);
        setProvider(loadedProvider);
        const presetLoaded = getProviderPreset(loadedProvider, incomingCustomEarly);
        const oauthUiAtLoad = providerSupportsOAuthUi(
          { openaiOAuthEnabled: oAuthOn },
          loadedProvider,
          presetLoaded.supportsOAuth,
        );
        const credAuth = data.claude.providerCredentials?.[loadedProvider]?.authMode;
        let nextAuthMode: ClaudeAuthMode = (credAuth ?? data.claude.authMode ?? 'api_key') as ClaudeAuthMode;
        if (!oauthUiAtLoad && nextAuthMode === 'oauth') nextAuthMode = 'api_key';
        setAuthMode(nextAuthMode);
        setSkipPermissions(data.claude.skipPermissions !== false);
        setEffortLevel(data.claude.effortLevel || 'high');
        setOpenaiReasoningEffort(
          isOpenAIReasoningEffort(data.claude.openaiReasoningEffort)
            ? data.claude.openaiReasoningEffort
            : DEFAULT_OPENAI_REASONING_EFFORT
        );
        setOpenaiFastMode(data.claude.openaiFastMode === true);
        setMaxTurns(data.claude.maxTurns || 0);
        setDefaultExposePromptPath(data.claude.defaultExposePromptPath !== false);
        setBaseUrl(data.claude.baseUrl || '');
        setTelemetry(data.general?.telemetry || false);
        setSchedulesPageEnabled(data.developer?.schedulesPageEnabled !== false);
        setTaskTriggersPageEnabled(data.developer?.taskTriggersPageEnabled !== false);
        setDangerSettings({ ...DEFAULT_DANGER_SETTINGS, ...data.dangerDetector });

        // Title generation
        setTitleGenEnabled(data.titleGeneration?.enabled !== false);
        setTitleGenChain(
          Array.isArray(data.titleGeneration?.chain) && data.titleGeneration.chain.length > 0
            ? data.titleGeneration.chain
            : DEFAULT_TITLE_GENERATION.chain ?? [],
        );

        // Per-provider API keys (backward compat: fill from flat apiKey if needed)
        const incomingKeys = (data.claude.providerApiKeys && typeof data.claude.providerApiKeys === 'object')
          ? { ...data.claude.providerApiKeys as Partial<Record<ProviderId, string>> }
          : {};
        // 旧版全局 claude.apiKey 语义上只对应 Anthropic；合并到「当前 provider」会导致
        // 例如当前选 Kimi 时 Anthropic 输入框为空，但服务端 getCredential('anthropic') 仍读到 legacy key，模型列表能出 Claude。
        if (data.claude.apiKey && !incomingKeys['anthropic']) {
          incomingKeys['anthropic'] = data.claude.apiKey;
        }
        // Custom providers: sync apiKeys for display
        const incomingCustom = incomingCustomEarly;
        for (const cp of incomingCustom) {
          if (cp.apiKey && !incomingKeys[cp.id]) {
            incomingKeys[cp.id] = cp.apiKey;
          }
        }
        const pcRaw =
          data.claude.providerCredentials && typeof data.claude.providerCredentials === 'object'
            ? (data.claude.providerCredentials as Partial<Record<ProviderId, ProviderCredential>>)
            : {};
        setProviderCredentialsForUi(pcRaw);
        for (const pid of Object.keys(pcRaw) as ProviderId[]) {
          const cred = pcRaw[pid];
          if (cred?.apiKey && !incomingKeys[pid]) {
            incomingKeys[pid] = cred.apiKey;
          }
        }
        setProviderApiKeys(incomingKeys);
        const incomingBaseUrls =
          data.claude.providerBaseUrls && typeof data.claude.providerBaseUrls === 'object'
            ? { ...(data.claude.providerBaseUrls as Partial<Record<ProviderId, string>>) }
            : {};
        setProviderBaseUrls(incomingBaseUrls);
        setCustomProviders(incomingCustom);
        lastSavedAggregateCredFingerprint.current = JSON.stringify({
          keys: incomingKeys,
          oauth: oAuthOn,
          ollamaBase: (incomingBaseUrls.ollama ?? '').trim(),
          customs: incomingCustom.map((c) => ({
            id: c.id,
            k: (incomingKeys[c.id] ?? c.apiKey ?? '').trim(),
          })),
        });

        // Per-provider models (backward compat: fill from flat model if needed)
        const incomingModels = (data.claude.providerModels && typeof data.claude.providerModels === 'object')
          ? { ...data.claude.providerModels as Partial<Record<ProviderId, string>> }
          : {};
        if (!incomingModels[loadedProvider] && data.claude.model) {
          incomingModels[loadedProvider] = data.claude.model;
        }
        setProviderModels(incomingModels);

        // Per-provider model library
        const incomingLibrary = (data.claude.providerModelLibrary && typeof data.claude.providerModelLibrary === 'object')
          ? { ...data.claude.providerModelLibrary as Partial<Record<ProviderId, string[]>> }
          : {};
        setProviderModelLibrary(incomingLibrary);

        applyProviderModelStateFromData(
          loadedProvider,
          incomingModels[loadedProvider],
          incomingLibrary,
          incomingCustom,
          setModel,
          setCustomModel,
        );
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data info
  const fetchDataInfo = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/settings/data-info'));
      if (res.ok) {
        const data = await res.json();
        setDataDir(data.dataDir);
        setDiskUsage(t('diskUsage', { size: data.diskUsage.total, count: data.diskUsage.files }));
      }
    } catch {
      // ignore
    }
  }, [t]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (!openaiOAuthEnabled && authMode === 'oauth') {
      setAuthMode('api_key');
    }
  }, [openaiOAuthEnabled, authMode]);
  useEffect(() => {
    if (activeSection === 'data') fetchDataInfo();
  }, [activeSection, fetchDataInfo]);

  const refreshAggregateModels = useCallback(async () => {
    setAggregateLiveStatus('loading');
    setAggregateLiveErrorDetail('');
    try {
      const res = await fetch(apiUrl('/api/settings/aggregate-models'), { cache: 'no-store' });
      const text = await res.text();
      let data: {
        ok?: boolean;
        items?: AggregateLiveModelItem[];
        supplierAvailability?: SupplierAvailabilityRow[];
        fatalError?: string;
        error?: string;
      } = {};
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        setAggregateLiveModels([]);
        setSupplierAvailability([]);
        const trimmed = text.trimStart();
        const looksLikeHtml =
          trimmed.startsWith('<!DOCTYPE') || trimmed.toLowerCase().startsWith('<html');
        setAggregateLiveErrorDetail(
          looksLikeHtml
            ? t('aggregateModelsHtmlResponse')
            : text.trim()
              ? `${t('aggregateModelsInvalidJson')}: ${text.slice(0, 240)}`
              : t('aggregateModelsInvalidJson'),
        );
        setAggregateLiveStatus('error');
        return;
      }

      const serverMsg =
        (typeof data.fatalError === 'string' && data.fatalError) ||
        (typeof data.error === 'string' && data.error) ||
        (!res.ok ? `HTTP ${res.status}` : '');

      if (!res.ok || data.ok === false) {
        setAggregateLiveModels([]);
        setSupplierAvailability([]);
        setAggregateLiveErrorDetail(serverMsg || t('aggregateModelsError'));
        setAggregateLiveStatus('error');
        return;
      }

      const items = Array.isArray(data.items) ? data.items : [];
      const avail = Array.isArray(data.supplierAvailability) ? data.supplierAvailability : [];
      setAggregateLiveModels(items);
      setSupplierAvailability(avail);
      setSupplierProbeLoading({});
      setAggregateLiveErrorDetail('');
      setAggregateLiveStatus('success');
    } catch (e) {
      setAggregateLiveModels([]);
      setSupplierAvailability([]);
      setAggregateLiveErrorDetail(e instanceof Error ? e.message : String(e));
      setAggregateLiveStatus('error');
    }
  }, [t]);

  const executeSupplierProbe = useCallback(async (pid: ProviderId) => {
    if (pid === 'ollama') {
      const ob = providerBaseUrlsRef.current.ollama ?? '';
      if (!ob.trim()) {
        setSupplierProbeRow((prev) => ({
          ...prev,
          [pid]: { providerId: pid, status: 'skipped', reasonKey: 'ollama_not_enabled' },
        }));
        setSupplierProbeLoading((prev) => ({ ...prev, [pid]: false }));
        return;
      }
    } else {
      const raw = providerApiKeysRef.current[pid] ?? '';
      const trimmed = raw.trim();
      if (!trimmed) {
        setSupplierProbeRow((prev) => ({
          ...prev,
          [pid]: { providerId: pid, status: 'skipped', reasonKey: 'no_credential' },
        }));
        setSupplierProbeLoading((prev) => ({ ...prev, [pid]: false }));
        return;
      }
    }

    setSupplierProbeLoading((prev) => ({ ...prev, [pid]: true }));
    try {
      const body: { providerId: ProviderId; apiKey?: string; ollamaBaseUrl?: string } = { providerId: pid };
      if (pid === 'ollama') {
        body.ollamaBaseUrl = (providerBaseUrlsRef.current.ollama ?? '').trim();
      } else {
        const raw = providerApiKeysRef.current[pid] ?? '';
        const trimmed = raw.trim();
        if (trimmed.startsWith('••')) {
          /* 掩码占位：不传 apiKey，服务端用已保存密钥 */
        } else {
          body.apiKey = trimmed;
        }
      }
      const res = await fetch(apiUrl('/api/settings/probe-supplier'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; row?: SupplierAvailabilityRow; error?: string };
      if (data.ok && data.row) {
        setSupplierProbeRow((prev) => ({ ...prev, [pid]: data.row as SupplierAvailabilityRow }));
      } else {
        setSupplierProbeRow((prev) => ({
          ...prev,
          [pid]: { providerId: pid, status: 'error', reasonKey: 'generic' },
        }));
      }
    } catch {
      setSupplierProbeRow((prev) => ({
        ...prev,
        [pid]: { providerId: pid, status: 'error', reasonKey: 'generic' },
      }));
    } finally {
      setSupplierProbeLoading((prev) => ({ ...prev, [pid]: false }));
    }
  }, []);

  const scheduleSupplierProbe = useCallback(
    (pid: ProviderId) => {
      const prev = probeTimersRef.current[pid];
      if (prev) clearTimeout(prev);
      probeTimersRef.current[pid] = setTimeout(() => {
        delete probeTimersRef.current[pid];
        void executeSupplierProbe(pid);
      }, 600);
    },
    [executeSupplierProbe],
  );

  /** 进入供应商子页时：仅在尚无聚合数据时跑一轮 */
  const flushAllSupplierProbes = useCallback(() => {
    if (supplierAvailability.length > 0) return;
    for (const p of PROVIDER_REGISTRY) {
      void executeSupplierProbe(p.id as ProviderId);
    }
    for (const c of customProvidersRef.current) {
      void executeSupplierProbe(c.id);
    }
  }, [executeSupplierProbe, supplierAvailability.length]);

  /** 显式「重新检测全部」：清空旧探测 → 聚合 + 逐个探测 */
  const recheckAllSuppliers = useCallback(() => {
    setSupplierProbeRow({});
    setSupplierProbeLoading({});
    void refreshAggregateModels();
    for (const p of PROVIDER_REGISTRY) {
      void executeSupplierProbe(p.id as ProviderId);
    }
    for (const c of customProvidersRef.current) {
      void executeSupplierProbe(c.id);
    }
  }, [refreshAggregateModels, executeSupplierProbe]);

  // 初始加载完成后跑一次聚合；后续仅由 autosave 指纹变化 或 按钮触发
  const initialAggregateRef = useRef(false);
  useEffect(() => {
    if (loading || initialAggregateRef.current) return;
    initialAggregateRef.current = true;
    void refreshAggregateModels();
  }, [loading, refreshAggregateModels]);

  // Fetch OpenAI model catalog when provider is openai
  useEffect(() => {
    if (provider !== 'openai') {
      setOpenaiModelsLoading(false);
      setOpenaiModels([]);
      return;
    }
    let cancelled = false;
    setOpenaiModelsLoading(true);
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/settings/openai-models'), { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data?.ok && Array.isArray(data.models)) {
          const mapped = data.models
            .filter((r: unknown) => r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string')
            .map((r: Record<string, unknown>) => ({
              id: (r.id as string).trim(),
              displayName: typeof r.displayName === 'string' ? r.displayName : (r.id as string).trim(),
            }));
          setOpenaiModels(mapped);
        }
      } catch {
        // ignore — fallback to static preset models
      } finally {
        if (!cancelled) setOpenaiModelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  const refreshGoogleAuth = useCallback(async () => {
    try {
      const res = await apiFetch(apiUrl('/api/auth/google/status'), { cache: 'no-store' });
      const data = (await res.json()) as GoogleAuthStatus;
      if (res.ok && typeof data.configured === 'boolean') {
        setGoogleAuth(data);
      } else {
        setGoogleAuth({ configured: false, user: null });
      }
    } catch {
      setGoogleAuth({ configured: false, user: null });
    }
  }, []);

  useEffect(() => {
    void refreshGoogleAuth();
  }, [refreshGoogleAuth]);

  useEffect(() => {
    const g = searchParams.get('google');
    if (g === 'ok') {
      setGoogleAuthNotice({ type: 'success', message: t('googleLoginOk') });
      void refreshGoogleAuth();
      const next = new URLSearchParams(searchParams);
      next.delete('google');
      next.delete('message');
      setSearchParams(next, { replace: true });
    } else if (g === 'error') {
      const msg = searchParams.get('message')?.trim() || t('googleLoginError');
      setGoogleAuthNotice({ type: 'error', message: msg });
      const next = new URLSearchParams(searchParams);
      next.delete('google');
      next.delete('message');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, t, refreshGoogleAuth]);

  const navItems = useMemo(() => [
    { id: 'account', icon: LogIn, label: t('accountSection') },
    { id: 'ai', icon: Brain, label: t('aiConfig') },
    { id: 'claude', icon: Wrench, label: t('claudeCodeConfig') },
    { id: 'safety', icon: ShieldAlert, label: t('safetyDetection') },
    { id: 'developer', icon: Satellite, label: t('developerTools') },
    { id: 'titleGeneration', icon: Sparkles, label: t('titleGeneration') },
    { id: 'appearance', icon: Palette, label: t('appearance') },
    { id: 'data', icon: Database, label: t('dataManagement') },
    { id: 'privacy', icon: Eye, label: t('privacy') },
  ], [t]);

  const handleProviderChange = (newProvider: ProviderId) => {
    // Save current model to per-provider map before switching
    const currentEffectiveModel = (model === '__custom__' ? customModel : model).trim();
    setProviderModels((prev) => {
      const next = { ...prev };
      if (currentEffectiveModel) {
        next[provider] = currentEffectiveModel;
      } else {
        delete next[provider];
      }
      return next;
    });

    setProvider(newProvider);
    applyProviderModelState(newProvider, providerModels[newProvider], providerModelLibrary);
    const p = getProviderPreset(newProvider, customProviders);
    if (!providerSupportsOAuthUi({ openaiOAuthEnabled }, newProvider, p.supportsOAuth)) {
      setAuthMode('api_key');
    }
    setBaseUrl('');
  };

  const handleModelSelectFromAggregate = (pid: ProviderId, mid: string) => {
    if (pid !== provider) {
      const currentEffectiveModel = (model === '__custom__' ? customModel : model).trim();
      setProviderModels((prev) => {
        const next = { ...prev };
        if (currentEffectiveModel) next[provider] = currentEffectiveModel;
        else delete next[provider];
        return next;
      });
      setProvider(pid);
      const p = getProviderPreset(pid, customProviders);
      if (!providerSupportsOAuthUi({ openaiOAuthEnabled }, pid, p.supportsOAuth)) {
        setAuthMode('api_key');
      }
      setBaseUrl('');
    }
    setModel(mid);
    setCustomModel('');
    setProviderModels((prev) => ({ ...prev, [pid]: mid }));
  };

  const handleProviderApiKeyChange = useCallback((pid: ProviderId, value: string) => {
    setProviderApiKeys((prev) => ({ ...prev, [pid]: value }));
  }, []);

  const handleProviderBaseUrlChange = useCallback((pid: ProviderId, value: string) => {
    setProviderBaseUrls((prev) => ({ ...prev, [pid]: value }));
  }, []);

  const handleModelChange = (nextModel: string) => {
    setModel(nextModel);
    if (nextModel !== '__custom__') {
      setCustomModel('');
      setCurrentProviderModel(nextModel);
    } else if (!customModel.trim()) {
      setCurrentProviderModel('');
    }
  };

  const handleCustomModelChange = (nextCustomModel: string) => {
    setCustomModel(nextCustomModel);
    setCurrentProviderModel(nextCustomModel);
  };

  const addModelToLibrary = useCallback((providerId: ProviderId, modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return providerModelLibrary;
    const presetForProvider = getProviderPreset(providerId, customProviders);
    if (presetForProvider.models.some((m) => m.id === trimmed)) return providerModelLibrary;
    const current = providerModelLibrary[providerId] || [];
    if (current.includes(trimmed)) return providerModelLibrary;
    return { ...providerModelLibrary, [providerId]: [...current, trimmed] };
  }, [providerModelLibrary, customProviders]);

  const handleDangerSettingChange = useCallback((category: DangerCategory, level: DangerActionLevel) => {
    setDangerSettings((prev) => ({ ...prev, [category]: level }));
  }, []);

  const performAutosave = useCallback(async () => {
    const effectiveModel = (model === '__custom__' ? customModel : model).trim();
    const nextProviderModels: Partial<Record<ProviderId, string>> = { ...providerModels };
    if (effectiveModel) {
      nextProviderModels[provider] = effectiveModel;
    } else {
      delete nextProviderModels[provider];
    }
    const nextModelLibrary = addModelToLibrary(provider, effectiveModel);
    const seq = ++autosaveSeq.current;
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claude: {
            provider, authMode, apiKey, providerApiKeys,
            providerModels: nextProviderModels,
            providerModelLibrary: nextModelLibrary,
            customProviders: customProviders.map((cp) => ({
              ...cp,
              apiKey: providerApiKeys[cp.id] ?? cp.apiKey,
            })),
            model: effectiveModel,
            openaiReasoningEffort,
            openaiFastMode,
            openaiOAuthEnabled,
            skipPermissions, effortLevel, maxTurns, defaultExposePromptPath, baseUrl,
            ...(() => {
              const out: Record<string, string | null> = {};
              for (const [k, v] of Object.entries(providerBaseUrls)) {
                if (typeof v !== 'string') continue;
                const t = v.trim();
                out[k] = t === '' ? null : t;
              }
              return Object.keys(out).length > 0 ? { providerBaseUrls: out } : {};
            })(),
          },
          general: { telemetry },
          developer: {
            schedulesPageEnabled,
            taskTriggersPageEnabled,
          },
          dangerDetector: dangerSettings,
          titleGeneration: {
            enabled: titleGenEnabled,
            chain: titleGenChain,
          },
        }),
      });
      if (seq !== autosaveSeq.current) return;
      if (res.ok) {
        setProviderModels(nextProviderModels);
        setProviderModelLibrary(nextModelLibrary);
        const credFp = JSON.stringify({
          keys: providerApiKeys,
          oauth: openaiOAuthEnabled,
          ollamaBase: (providerBaseUrls.ollama ?? '').trim(),
          customs: customProviders.map((c) => ({
            id: c.id,
            k: (providerApiKeys[c.id] ?? c.apiKey ?? '').trim(),
          })),
        });
        if (credFp !== lastSavedAggregateCredFingerprint.current) {
          lastSavedAggregateCredFingerprint.current = credFp;
          void refreshAggregateModels();
        }
      } else {
        console.error('[settings] autosave failed', res.status);
      }
    } catch (e) {
      if (seq === autosaveSeq.current) {
        console.error('[settings] autosave error', e);
      }
    }
  }, [
    addModelToLibrary,
    apiKey,
    authMode,
    baseUrl,
    customModel,
    customProviders,
    dangerSettings,
    effortLevel,
    maxTurns,
    model,
    openaiFastMode,
    openaiOAuthEnabled,
    openaiReasoningEffort,
    provider,
    providerApiKeys,
    providerModelLibrary,
    providerModels,
    schedulesPageEnabled,
    skipPermissions,
    taskTriggersPageEnabled,
    telemetry,
    titleGenChain,
    titleGenEnabled,
    defaultExposePromptPath,
    refreshAggregateModels,
    providerBaseUrls,
  ]);

  useEffect(() => {
    if (loading) {
      setReadyForAutosave(false);
      return;
    }
    const id = setTimeout(() => setReadyForAutosave(true), 400);
    return () => clearTimeout(id);
  }, [loading]);

  useEffect(() => {
    if (!readyForAutosave || loading) return;
    const id = setTimeout(() => {
      void performAutosave();
    }, 550);
    return () => clearTimeout(id);
  }, [readyForAutosave, loading, performAutosave]);

  const handleAddCustomProvider = (cp: CustomProviderConfig) => {
    setCustomProviders((prev) => [...prev, cp]);
    if (cp.apiKey) {
      setProviderApiKeys((prev) => ({ ...prev, [cp.id]: cp.apiKey! }));
    }
    setProvider(cp.id);
    applyProviderModelState(cp.id, cp.modelIds[0]);
    setShowAddCustomProvider(false);
  };

  const handleDeleteCustomProvider = (id: `custom-${string}`) => {
    setCustomProviders((prev) => prev.filter((c) => c.id !== id));
    setProviderApiKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setProviderModels((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (provider === id) {
      setProvider('anthropic');
      applyProviderModelState('anthropic');
    }
  };

  const switchLocale = (newLocale: string) => {
    import('i18next').then((mod) => {
      mod.default.changeLanguage(newLocale);
    }).catch(() => {});
    router.push(pathname);
  };

  const handleExport = async () => {
    setExporting(true);
    setDataStatus(null);
    try {
      const res = await fetch(apiUrl('/api/settings/export'));
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `projectpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDataStatus({ type: 'success', message: t('exportSuccess') });
    } catch {
      setDataStatus({ type: 'error', message: t('saveFailed') });
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm(t('confirmImport'))) {
      e.target.value = '';
      return;
    }

    setImporting(true);
    setDataStatus(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch(apiUrl('/api/settings/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      if (!res.ok) throw new Error('Import failed');
      const result = await res.json();
      setDataStatus({
        type: 'success',
        message: t('importSuccess', { tasks: result.stats.tasks, flows: result.stats.flows }),
      });
      fetchDataInfo();
    } catch {
      setDataStatus({ type: 'error', message: t('importFailed') });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleClear = async (target: 'sessions' | 'flows' | 'all') => {
    setConfirmAction(null);
    setDataStatus(null);
    try {
      const res = await fetch(apiUrl('/api/settings/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) throw new Error('Clear failed');
      setDataStatus({ type: 'success', message: t('clearSuccess') });
      fetchDataInfo();
    } catch {
      setDataStatus({ type: 'error', message: t('clearFailed') });
    }
  };

  const btnActive = 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900';
  const btnInactive = 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';

  if (loading) {
    return (
      <div className="flex h-screen flex-col">
        <TopNav />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <TopNav />
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[1100px] px-6 py-8">
          {/* ── Sidebar ── */}
          <nav className="w-52 shrink-0 pr-8">
            <h1 className="mb-6 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <Settings className="h-5 w-5" />
              {t('title')}
            </h1>
            <ul className="space-y-1">
              {navItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => setActiveSection(item.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                      activeSection === item.id
                        ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* ── Content ── */}
          <div className="flex-1 min-w-0 pl-8 border-l border-zinc-200 dark:border-zinc-800 space-y-6 overflow-y-auto">
            {activeSection === 'account' && (
              <section className="space-y-4">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('googleAccountTitle')}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('googleAccountIntro')}</p>
                {googleAuthNotice && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      googleAuthNotice.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200'
                        : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
                    }`}
                  >
                    {googleAuthNotice.message}
                  </div>
                )}
                {!googleAuth ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('googleAuthLoading')}
                  </div>
                ) : !googleAuth.configured ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">{t('googleAccountNotConfigured')}</p>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="text-sm text-zinc-700 dark:text-zinc-300">
                      {googleAuth.user ? (
                        <span>
                          {t('googleAccountSignedInAs')}
                          {googleAuth.user.email ? ` ${googleAuth.user.email}` : ` (${googleAuth.user.sub})`}
                        </span>
                      ) : (
                        <span>{t('googleAccountGuest')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {googleAuth.user ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiFetch(apiUrl('/api/auth/google/logout'), { method: 'POST' });
                              await refreshGoogleAuth();
                              window.location.reload();
                            } catch {
                              setGoogleAuthNotice({ type: 'error', message: t('googleLoginError') });
                            }
                          }}
                          className={`rounded-lg px-4 py-2 text-sm font-medium ${btnInactive}`}
                        >
                          {t('googleLogout')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = apiUrl('/api/auth/google/login');
                          }}
                          className={`rounded-lg px-4 py-2 text-sm font-medium ${btnActive}`}
                        >
                          {t('googleLogin')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeSection === 'ai' && (
              <SettingsAISection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                provider={provider}
                model={model} customModel={customModel}
                isPresetModel={isPresetModel}
                onModelChange={handleModelChange}
                onCustomModelChange={handleCustomModelChange}
                customProviders={customProviders}
                onAddCustomProvider={() => setShowAddCustomProvider(true)}
                onDeleteCustomProvider={handleDeleteCustomProvider}
                providerApiKeys={providerApiKeys}
                aggregateLiveModels={aggregateLiveModels}
                aggregateLiveStatus={aggregateLiveStatus}
                supplierAvailability={supplierAvailability}
                supplierProbeRow={supplierProbeRow}
                supplierProbeLoading={supplierProbeLoading}
                onScheduleSupplierProbe={scheduleSupplierProbe}
                onSupplierTabProbes={flushAllSupplierProbes}
                aggregateLiveErrorDetail={aggregateLiveErrorDetail}
                onRefreshAggregateLiveModels={recheckAllSuppliers}
                onProviderApiKeyChange={handleProviderApiKeyChange}
                providerBaseUrls={providerBaseUrls}
                onProviderBaseUrlChange={handleProviderBaseUrlChange}
                onModelSelectFromAggregate={handleModelSelectFromAggregate}
              />
            )}

            {activeSection === 'claude' && (
              <SettingsClaudeSection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                skipPermissions={skipPermissions} effortLevel={effortLevel}
                maxTurns={maxTurns} defaultExposePromptPath={defaultExposePromptPath}
                onSkipPermissionsChange={setSkipPermissions} onEffortLevelChange={setEffortLevel}
                onMaxTurnsChange={setMaxTurns} onDefaultExposePromptPathChange={setDefaultExposePromptPath}
              />
            )}

            {activeSection === 'safety' && (
              <SettingsSafetySection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                dangerSettings={dangerSettings}
                onDangerSettingChange={handleDangerSettingChange}
              />
            )}

            {activeSection === 'developer' && (
              <SettingsDeveloperSection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                schedulesPageEnabled={schedulesPageEnabled}
                onSchedulesPageEnabledChange={setSchedulesPageEnabled}
                taskTriggersPageEnabled={taskTriggersPageEnabled}
                onTaskTriggersPageEnabledChange={setTaskTriggersPageEnabled}
              />
            )}

            {activeSection === 'titleGeneration' && (
              <SettingsTitleGenerationSection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                enabled={titleGenEnabled}
                chain={titleGenChain}
                onEnabledChange={setTitleGenEnabled}
                onChainChange={setTitleGenChain}
              />
            )}

            {activeSection === 'appearance' && (
              <SettingsAppearanceSection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                theme={theme} locale={locale}
                onThemeChange={setTheme} onLocaleChange={switchLocale}
              />
            )}

            {activeSection === 'data' && (
              <SettingsDataSection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                dataDir={dataDir} diskUsage={diskUsage}
                exporting={exporting} importing={importing}
                dataStatus={dataStatus} confirmAction={confirmAction} fileInputRef={fileInputRef}
                onExport={handleExport} onImportFile={handleImportFile}
                onClear={handleClear} onSetConfirmAction={setConfirmAction}
              />
            )}

            {activeSection === 'privacy' && (
              <SettingsPrivacySection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                telemetry={telemetry} onTelemetryChange={setTelemetry}
              />
            )}
          </div>
        </div>
      </div>
      {showAddCustomProvider && (
        <AddCustomProviderDialog
          t={t}
          tActions={tActions}
          onClose={() => setShowAddCustomProvider(false)}
          onAdd={handleAddCustomProvider}
        />
      )}
    </div>
  );
}
