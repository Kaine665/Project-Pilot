'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { TopNav } from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2, Brain, Wrench, Palette, Database, Eye, Settings } from 'lucide-react';
import { getProviderPreset } from '@/lib/provider-registry';
import { useTheme } from '@/components/theme-provider';
import {
  SettingsAISection,
  SettingsClaudeSection,
  SettingsAppearanceSection,
  SettingsDataSection,
  SettingsPrivacySection,
} from '@/components/settings-sections';
import type { ProviderId, ClaudeAuthMode, EffortLevel } from '@/types';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tActions = useTranslations('actions');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  // Form state
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [authMode, setAuthMode] = useState<ClaudeAuthMode>('api_key');
  const [providerApiKeys, setProviderApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [providerModels, setProviderModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [providerModelLibrary, setProviderModelLibrary] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [model, setModel] = useState('claude-sonnet-4-5-20250929');
  const [customModel, setCustomModel] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high');
  const [maxTurns, setMaxTurns] = useState(0);
  const [defaultExposePromptPath, setDefaultExposePromptPath] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');

  // Privacy state
  const [telemetry, setTelemetry] = useState(false);

  // UI state
  const [activeSection, setActiveSection] = useState('ai');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [oauthStatus, setOauthStatus] = useState<'unknown' | 'checking' | 'authenticated' | 'not_authenticated'>('unknown');
  const [oauthLoginUrl, setOauthLoginUrl] = useState('');
  const [oauthLoginCode, setOauthLoginCode] = useState('');
  const [oauthCodeInput, setOauthCodeInput] = useState('');
  const [oauthCodeSubmitting, setOauthCodeSubmitting] = useState(false);
  const [oauthProcessAlive, setOauthProcessAlive] = useState(false);
  const [oauthFlowMessage, setOauthFlowMessage] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Data management state
  const [dataDir, setDataDir] = useState('');
  const [diskUsage, setDiskUsage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preset = useMemo(() => getProviderPreset(provider), [provider]);
  const apiKey = providerApiKeys[provider] || '';

  const setCurrentProviderApiKey = useCallback((value: string) => {
    setProviderApiKeys((prev) => ({ ...prev, [provider]: value }));
  }, [provider]);

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
  ) => {
    const p = getProviderPreset(providerId);
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
  }, []);

  const modelSelectOptions = useMemo(() => {
    const options = preset.models.map((m) => ({ value: m.id, label: m.label }));
    const presetIds = new Set(options.map((o) => o.value));
    const extra = (providerModelLibrary[provider] || [])
      .map((id) => id.trim())
      .filter((id) => id && !presetIds.has(id))
      .map((id) => ({ value: id, label: id }));
    options.push(...extra);
    options.push({ value: '__custom__', label: t('customModel') });
    return options;
  }, [preset, providerModelLibrary, provider, t]);

  const isPresetModel = useMemo(
    () => modelSelectOptions.some((o) => o.value === model && o.value !== '__custom__'),
    [modelSelectOptions, model],
  );

  // Load settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        const loadedProvider = (data.claude.provider || 'anthropic') as ProviderId;
        setProvider(loadedProvider);
        setAuthMode(data.claude.authMode);
        setSkipPermissions(data.claude.skipPermissions !== false);
        setEffortLevel(data.claude.effortLevel || 'high');
        setMaxTurns(data.claude.maxTurns || 0);
        setDefaultExposePromptPath(data.claude.defaultExposePromptPath !== false);
        setBaseUrl(data.claude.baseUrl || '');
        setTelemetry(data.general?.telemetry || false);

        const incomingKeys = (data.claude.providerApiKeys && typeof data.claude.providerApiKeys === 'object')
          ? { ...data.claude.providerApiKeys as Partial<Record<ProviderId, string>> }
          : {};
        if (!incomingKeys[loadedProvider] && data.claude.apiKey) {
          incomingKeys[loadedProvider] = data.claude.apiKey;
        }
        setProviderApiKeys(incomingKeys);

        const incomingModels = (data.claude.providerModels && typeof data.claude.providerModels === 'object')
          ? { ...data.claude.providerModels as Partial<Record<ProviderId, string>> }
          : {};
        if (!incomingModels[loadedProvider] && data.claude.model) {
          incomingModels[loadedProvider] = data.claude.model;
        }
        setProviderModels(incomingModels);

        const incomingLibrary = (data.claude.providerModelLibrary && typeof data.claude.providerModelLibrary === 'object')
          ? { ...data.claude.providerModelLibrary as Partial<Record<ProviderId, string[]>> }
          : {};
        setProviderModelLibrary(incomingLibrary);
        applyProviderModelState(loadedProvider, incomingModels[loadedProvider], incomingLibrary);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, [applyProviderModelState]);

  // Load data info
  const fetchDataInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/data-info');
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
    if (activeSection === 'data') fetchDataInfo();
  }, [activeSection, fetchDataInfo]);
  useEffect(() => {
    setTestState('idle');
    setTestMessage('');
  }, [provider, authMode, model, customModel, baseUrl, apiKey]);
  useEffect(() => {
    setOauthStatus('unknown');
    setOauthLoginUrl('');
    setOauthLoginCode('');
    setOauthCodeInput('');
    setOauthCodeSubmitting(false);
    setOauthProcessAlive(false);
    setOauthFlowMessage('');
    setLoginPending(false);
  }, [provider, authMode]);

  const navItems = useMemo(() => [
    { id: 'ai', icon: Brain, label: t('aiConfig') },
    { id: 'claude', icon: Wrench, label: t('claudeCodeConfig') },
    { id: 'appearance', icon: Palette, label: t('appearance') },
    { id: 'data', icon: Database, label: t('dataManagement') },
    { id: 'privacy', icon: Eye, label: t('privacy') },
  ], [t]);

  const handleProviderChange = (newProvider: ProviderId) => {
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
    const p = getProviderPreset(newProvider);
    applyProviderModelState(newProvider, providerModels[newProvider], providerModelLibrary);
    if (!p.supportsOAuth) {
      setAuthMode('api_key');
    }
    setBaseUrl('');
  };

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

    const presetForProvider = getProviderPreset(providerId);
    const presetIds = new Set(presetForProvider.models.map((m) => m.id));
    if (presetIds.has(trimmed)) {
      return providerModelLibrary;
    }

    const current = providerModelLibrary[providerId] || [];
    if (current.includes(trimmed)) {
      return providerModelLibrary;
    }

    return {
      ...providerModelLibrary,
      [providerId]: [...current, trimmed],
    };
  }, [providerModelLibrary]);

  const persistModelConfigs = useCallback(async (
    nextProviderModels: Partial<Record<ProviderId, string>>,
    nextModelLibrary: Partial<Record<ProviderId, string[]>>,
    effectiveModel: string,
  ) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claude: {
          provider,
          providerModels: nextProviderModels,
          providerModelLibrary: nextModelLibrary,
          model: effectiveModel,
        },
      }),
    });
    if (!res.ok) {
      throw new Error('Failed to persist model settings');
    }
  }, [provider]);

  const handleTestConnection = async () => {
    const effectiveModel = (model === '__custom__' ? customModel : model).trim();
    if (!effectiveModel) {
      setTestState('failed');
      setTestMessage(t('modelRequired'));
      return;
    }

    setTestState('testing');
    setTestMessage('');

    try {
      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          authMode,
          apiKey,
          model: effectiveModel,
          baseUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestState('failed');
        setTestMessage(typeof data.error === 'string' ? data.error : t('testFailed'));
        return;
      }

      const nextProviderModels: Partial<Record<ProviderId, string>> = {
        ...providerModels,
        [provider]: effectiveModel,
      };
      const nextModelLibrary = addModelToLibrary(provider, effectiveModel);

      setProviderModels(nextProviderModels);
      setProviderModelLibrary(nextModelLibrary);
      await persistModelConfigs(nextProviderModels, nextModelLibrary, effectiveModel);

      setTestState('success');
      setTestMessage(`${t('testSuccess')} · ${t('saved')}`);
    } catch (err) {
      setTestState('failed');
      setTestMessage(err instanceof Error ? err.message : t('testFailed'));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    const effectiveModel = (model === '__custom__' ? customModel : model).trim();
    const nextProviderModels: Partial<Record<ProviderId, string>> = { ...providerModels };
    if (effectiveModel) {
      nextProviderModels[provider] = effectiveModel;
    } else {
      delete nextProviderModels[provider];
    }
    const nextModelLibrary = addModelToLibrary(provider, effectiveModel);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claude: {
            provider, authMode, apiKey, providerApiKeys,
            providerModels: nextProviderModels,
            providerModelLibrary: nextModelLibrary,
            model: effectiveModel,
            skipPermissions, effortLevel, maxTurns, defaultExposePromptPath, baseUrl,
          },
          general: { telemetry },
        }),
      });
      if (res.ok) {
        setProviderModels(nextProviderModels);
        setProviderModelLibrary(nextModelLibrary);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
        fetchSettings();
      } else {
        setSaveStatus('failed');
      }
    } catch {
      setSaveStatus('failed');
    } finally {
      setSaving(false);
    }
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pollOAuthState = useCallback(async (rounds = 60, intervalMs = 1500) => {
    for (let i = 0; i < rounds; i++) {
      let processAliveSnapshot = false;
      try {
        const [urlRes, statusRes] = await Promise.all([
          fetch(`/api/settings/auth-url?provider=${provider}`),
          fetch(`/api/settings/auth-status?provider=${provider}`),
        ]);

        if (urlRes.ok) {
          const urlData = await urlRes.json();
          if (typeof urlData?.loginUrl === 'string') {
            setOauthLoginUrl(urlData.loginUrl);
          }
          if (typeof urlData?.loginCode === 'string') {
            setOauthLoginCode(urlData.loginCode);
          }
          processAliveSnapshot = !!urlData?.processAlive;
          setOauthProcessAlive(processAliveSnapshot);
        }

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData?.authenticated) {
            setOauthStatus('authenticated');
            setOauthFlowMessage(t('oauthFlowCompleted'));
            setLoginPending(false);
            setOauthProcessAlive(false);
            return true;
          }
        }
      } catch (err) {
        console.error('OAuth polling failed:', err);
      }

      if (!processAliveSnapshot && i >= 3) {
        break;
      }
      await sleep(intervalMs);
    }

    setOauthStatus('not_authenticated');
    setOauthFlowMessage(t('oauthFlowNotFinished'));
    setLoginPending(false);
    setOauthProcessAlive(false);
    return false;
  }, [provider, t]);

  const checkOAuthStatus = useCallback(async () => {
    setOauthStatus('checking');
    try {
      const res = await fetch(`/api/settings/auth-status?provider=${provider}`);
      const data = await res.json();
      const authenticated = !!data?.authenticated;
      setOauthStatus(authenticated ? 'authenticated' : 'not_authenticated');
      setOauthFlowMessage(authenticated ? t('oauthFlowCompleted') : t('oauthFlowNotAuthenticated'));
      if (authenticated) {
        setLoginPending(false);
        setOauthProcessAlive(false);
      }
    } catch {
      setOauthStatus('not_authenticated');
      setOauthFlowMessage(t('oauthFlowCheckFailed'));
    }
  }, [provider, t]);

  const submitOAuthCode = useCallback(async () => {
    const code = oauthCodeInput.trim();
    if (!code) return;

    setOauthCodeSubmitting(true);
    setOauthFlowMessage(t('oauthCodeSubmittingHint'));
    try {
      const res = await fetch('/api/settings/auth-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : t('oauthCodeSubmitFailed');
        setOauthFlowMessage(msg);
        return;
      }

      setOauthCodeInput('');
      setOauthFlowMessage(t('oauthCodeSubmitted'));
      setLoginPending(true);
      setOauthProcessAlive(true);
      void pollOAuthState(40, 1200);
    } catch (err) {
      console.error('Submit OAuth code failed:', err);
      setOauthFlowMessage(t('oauthCodeSubmitFailed'));
    } finally {
      setOauthCodeSubmitting(false);
    }
  }, [oauthCodeInput, pollOAuthState, t]);

  const triggerOAuthLogin = useCallback(async () => {
    if (loginPending) return;

    setLoginPending(true);
    setOauthStatus('checking');
    setOauthLoginUrl('');
    setOauthLoginCode('');
    setOauthCodeInput('');
    setOauthFlowMessage(t('oauthFlowStarting'));
    setOauthProcessAlive(false);

    let popup: Window | null = null;
    let startedPolling = false;
    try {
      // Open a controllable tab synchronously first, then navigate it after URL is ready.
      popup = window.open('about:blank', '_blank');
    } catch {
      popup = null;
    }

    const openOrNavigate = (url: string): boolean => {
      try {
        if (popup && !popup.closed) {
          popup.location.replace(url);
          return true;
        }
      } catch {
        // fallback below
      }
      const newPopup = window.open(url, '_blank');
      if (newPopup) {
        popup = newPopup;
        return true;
      }
      return false;
    };

    const tryOpenLoginUrl = (url: unknown): boolean => {
      if (typeof url !== 'string' || !url.startsWith('http')) return false;
      return openOrNavigate(url);
    };

    try {
      const loginRes = await fetch('/api/settings/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        setOauthStatus('not_authenticated');
        setOauthFlowMessage(typeof loginData?.error === 'string' ? loginData.error : t('oauthFlowStartFailed'));
        if (popup && !popup.closed) popup.close();
        return;
      }

      if (loginData?.alreadyAuthenticated) {
        setOauthStatus('authenticated');
        setOauthFlowMessage(t('oauthFlowCompleted'));
        if (popup && !popup.closed) popup.close();
        return;
      }

      if (typeof loginData?.loginUrl === 'string' && loginData.loginUrl.startsWith('http')) {
        setOauthLoginUrl(loginData.loginUrl);
      }
      if (typeof loginData?.loginCode === 'string') {
        setOauthLoginCode(loginData.loginCode);
      }

      let opened = tryOpenLoginUrl(loginData?.loginUrl);

      if (!opened) {
        for (let i = 0; i < 15; i++) {
          await sleep(800);
          const pollRes = await fetch(`/api/settings/auth-url?provider=${provider}`);
          const pollData = await pollRes.json();

          if (typeof pollData?.loginUrl === 'string' && pollData.loginUrl.startsWith('http')) {
            setOauthLoginUrl(pollData.loginUrl);
          }
          if (typeof pollData?.loginCode === 'string' && pollData.loginCode) {
            setOauthLoginCode(pollData.loginCode);
          }
          setOauthProcessAlive(!!pollData?.processAlive);

          opened = tryOpenLoginUrl(pollData?.loginUrl);
          if (opened || !pollData?.processAlive) break;
        }
      }

      if (!opened && provider === 'openai') {
        opened = openOrNavigate('https://auth.openai.com/codex/device');
      }

      if (!opened && popup && !popup.closed) {
        popup.close();
      }
      if (!opened) {
        const manualUrl = provider === 'openai'
          ? 'https://auth.openai.com/codex/device'
          : 'https://claude.ai/login';
        setOauthFlowMessage(`${t('oauthOpenManually')}: ${manualUrl}`);
      } else {
        setOauthFlowMessage(t('oauthFlowWaiting'));
      }

      setOauthProcessAlive(true);
      startedPolling = true;
      void pollOAuthState();
    } catch (err) {
      console.error('Failed to trigger login:', err);
      setOauthStatus('not_authenticated');
      setOauthFlowMessage(t('oauthFlowStartFailed'));
      if (popup && !popup.closed) popup.close();
    } finally {
      if (!startedPolling) {
        setLoginPending(false);
        setOauthProcessAlive(false);
      }
    }
  }, [loginPending, pollOAuthState, provider, t]);

  const switchLocale = (newLocale: string) => {
    router.push(pathname, { locale: newLocale });
  };

  const handleExport = async () => {
    setExporting(true);
    setDataStatus(null);
    try {
      const res = await fetch('/api/settings/export');
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
      const res = await fetch('/api/settings/import', {
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
      const res = await fetch('/api/settings/clear', {
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
            {activeSection === 'ai' && (
              <SettingsAISection
                t={t} tActions={tActions} btnActive={btnActive} btnInactive={btnInactive}
                provider={provider} authMode={authMode} apiKey={apiKey}
                model={model} customModel={customModel} baseUrl={baseUrl}
                oauthStatus={oauthStatus}
                oauthLoginUrl={oauthLoginUrl}
                oauthLoginCode={oauthLoginCode}
                oauthCodeInput={oauthCodeInput}
                oauthCodeSubmitting={oauthCodeSubmitting}
                oauthProcessAlive={oauthProcessAlive}
                oauthFlowMessage={oauthFlowMessage}
                loginPending={loginPending}
                testState={testState} testMessage={testMessage}
                preset={preset} isPresetModel={isPresetModel} modelSelectOptions={modelSelectOptions}
                onProviderChange={handleProviderChange} onAuthModeChange={setAuthMode}
                onApiKeyChange={setCurrentProviderApiKey} onModelChange={handleModelChange}
                onCustomModelChange={handleCustomModelChange} onBaseUrlChange={setBaseUrl}
                onOauthCodeInputChange={setOauthCodeInput}
                onSubmitOAuthCode={submitOAuthCode}
                onCheckOAuthStatus={checkOAuthStatus} onTriggerOAuthLogin={triggerOAuthLogin}
                onTestConnection={handleTestConnection}
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

            {/* ── Save Button (for AI/Claude/Privacy sections) ── */}
            {(activeSection === 'ai' || activeSection === 'claude' || activeSection === 'privacy') && (
              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {tActions('save')}
                </Button>
                {saveStatus === 'saved' && (
                  <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    {t('saved')}
                  </span>
                )}
                {saveStatus === 'failed' && (
                  <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                    <X className="h-4 w-4" />
                    {t('saveFailed')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
