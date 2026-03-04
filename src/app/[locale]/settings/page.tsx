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
  const [apiKey, setApiKey] = useState('');
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
  const [loginPending, setLoginPending] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginProcessAlive, setLoginProcessAlive] = useState(false);
  const [loginFlowActive, setLoginFlowActive] = useState(false); // 保持显示，不因进程退出而闪退
  const [oauthCode, setOauthCode] = useState('');
  const [codeSubmitting, setCodeSubmitting] = useState(false);

  // Data management state
  const [dataDir, setDataDir] = useState('');
  const [diskUsage, setDiskUsage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preset = useMemo(() => getProviderPreset(provider), [provider]);

  const isPresetModel = useMemo(
    () => preset.models.some((m) => m.id === model),
    [preset, model],
  );

  const modelSelectOptions = useMemo(() => {
    const options = preset.models.map((m) => ({ value: m.id, label: m.label }));
    options.push({ value: '__custom__', label: t('customModel') });
    return options;
  }, [preset, t]);

  // Load settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setProvider(data.claude.provider || 'anthropic');
        setAuthMode(data.claude.authMode);
        setApiKey(data.claude.apiKey || '');
        setSkipPermissions(data.claude.skipPermissions !== false);
        setEffortLevel(data.claude.effortLevel || 'high');
        setMaxTurns(data.claude.maxTurns || 0);
        setDefaultExposePromptPath(data.claude.defaultExposePromptPath !== false);
        setBaseUrl(data.claude.baseUrl || '');
        setTelemetry(data.general?.telemetry || false);

        const savedModel = data.claude.model || '';
        const p = getProviderPreset(data.claude.provider || 'anthropic');
        if (p.models.some((m: { id: string }) => m.id === savedModel)) {
          setModel(savedModel);
          setCustomModel('');
        } else {
          setModel('__custom__');
          setCustomModel(savedModel);
        }
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

  const navItems = useMemo(() => [
    { id: 'ai', icon: Brain, label: t('aiConfig') },
    { id: 'claude', icon: Wrench, label: t('claudeCodeConfig') },
    { id: 'appearance', icon: Palette, label: t('appearance') },
    { id: 'data', icon: Database, label: t('dataManagement') },
    { id: 'privacy', icon: Eye, label: t('privacy') },
  ], [t]);

  const handleProviderChange = (newProvider: ProviderId) => {
    setProvider(newProvider);
    const p = getProviderPreset(newProvider);
    if (p.models.length > 0) {
      setModel(p.models[0].id);
      setCustomModel('');
    } else {
      setModel('__custom__');
      setCustomModel('');
    }
    if (newProvider !== 'anthropic') {
      setAuthMode('api_key');
    }
    setBaseUrl('');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    const effectiveModel = model === '__custom__' ? customModel : model;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claude: {
            provider, authMode, apiKey, model: effectiveModel,
            skipPermissions, effortLevel, maxTurns, defaultExposePromptPath, baseUrl,
          },
          general: { telemetry },
        }),
      });
      if (res.ok) {
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

  const checkOAuthStatus = async () => {
    setOauthStatus('checking');
    try {
      const res = await fetch('/api/settings/auth-status');
      const data = await res.json();
      setOauthStatus(data.authenticated ? 'authenticated' : 'not_authenticated');
    } catch {
      setOauthStatus('not_authenticated');
    }
  };

  const triggerOAuthLogin = async () => {
    if (loginPending) return;
    setLoginPending(true);
    setLoginUrl(null);
    setOauthCode('');
    setLoginProcessAlive(true);
    setLoginFlowActive(true);
    try {
      const res = await fetch('/api/settings/auth-login', { method: 'POST' });
      if (!res.ok) {
        setLoginPending(false);
        setLoginProcessAlive(false);
        setLoginFlowActive(false);
        return;
      }
    } catch (err) {
      console.error('Failed to trigger login:', err);
      setLoginPending(false);
      setLoginProcessAlive(false);
      setLoginFlowActive(false);
    } finally {
      setLoginPending(false);
    }
  };

  const cancelLoginFlow = () => {
    setLoginFlowActive(false);
    setLoginUrl(null);
    setOauthCode('');
    setLoginProcessAlive(false);
  };

  // 轮询 auth-url 获取 OAuth 链接
  useEffect(() => {
    if (!loginFlowActive) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/settings/auth-url');
        const data = await res.json();
        if (data.loginUrl) setLoginUrl(data.loginUrl);
        if (!data.processAlive) setLoginProcessAlive(false);
      } catch {
        setLoginProcessAlive(false);
      }
    };
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [loginFlowActive]);

  const handleCodeSubmit = async () => {
    if (!oauthCode.trim() || codeSubmitting) return;
    setCodeSubmitting(true);
    try {
      const res = await fetch('/api/settings/auth-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode.trim() }),
      });
      if (res.ok) {
        setOauthCode('');
        setLoginProcessAlive(false);
        setLoginFlowActive(false);
        setLoginUrl(null);
        await checkOAuthStatus();
      } else {
        const err = await res.json();
        console.error(err?.error || 'Submit failed');
      }
    } catch (err) {
      console.error('Failed to submit code:', err);
    } finally {
      setCodeSubmitting(false);
    }
  };

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
                oauthStatus={oauthStatus} loginPending={loginPending}
                loginUrl={loginUrl} loginFlowActive={loginFlowActive}
                oauthCode={oauthCode} codeSubmitting={codeSubmitting}
                preset={preset} isPresetModel={isPresetModel} modelSelectOptions={modelSelectOptions}
                onProviderChange={handleProviderChange} onAuthModeChange={setAuthMode}
                onApiKeyChange={setApiKey} onModelChange={setModel}
                onCustomModelChange={setCustomModel} onBaseUrlChange={setBaseUrl}
                onCheckOAuthStatus={checkOAuthStatus} onTriggerOAuthLogin={triggerOAuthLogin}
                onOauthCodeChange={setOauthCode} onCodeSubmit={handleCodeSubmit}
                onCancelLoginFlow={cancelLoginFlow}
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
