'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { TopNav } from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Shield, Brain, Wrench, Check, X, Loader2, ExternalLink, Server,
  Settings, Gauge, RotateCw, Palette, Database, Eye, Sun, Moon, Monitor,
  Download, Upload, Trash2, FolderOpen, Info, Github,
} from 'lucide-react';
import { PROVIDER_REGISTRY, getProviderPreset } from '@/lib/provider-registry';
import { useTheme, type Theme } from '@/components/theme-provider';
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
    try {
      await fetch('/api/settings/auth-login', { method: 'POST' });
      setTimeout(() => {
        checkOAuthStatus();
        setLoginPending(false);
      }, 5000);
    } catch (err) {
      console.error('Failed to trigger login:', err);
      setLoginPending(false);
    }
  };

  // ── Language switch ──
  const switchLocale = (newLocale: string) => {
    router.push(pathname, { locale: newLocale });
  };

  // ── Data management handlers ──
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

    // 先让用户确认
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

  // ── Active button style helper ──
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
            {/* ══════════════ AI Configuration ══════════════ */}
            {activeSection === 'ai' && (
              <>
                {/* Provider */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-5 w-5" />
                      {t('provider')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      {PROVIDER_REGISTRY.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleProviderChange(p.id)}
                          className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                            provider === p.id ? btnActive : btnInactive
                          }`}
                        >
                          {t(`providers.${p.id}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">{t(`providerHints.${provider}`)}</p>
                  </CardContent>
                </Card>

                {/* Authentication */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      {t('authentication')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {preset.supportsOAuth && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('authMode')}
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAuthMode('api_key')}
                            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                              authMode === 'api_key' ? btnActive : btnInactive
                            }`}
                          >
                            {t('apiKeyMode')}
                          </button>
                          <button
                            onClick={() => setAuthMode('oauth')}
                            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                              authMode === 'oauth' ? btnActive : btnInactive
                            }`}
                          >
                            {t('oauthMode')}
                          </button>
                        </div>
                      </div>
                    )}

                    {(authMode === 'api_key' || !preset.supportsOAuth) && provider !== 'ollama' && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('apiKey')}
                        </label>
                        <Input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={preset.apiKeyPlaceholder || t('apiKeyPlaceholder')}
                        />
                        <p className="text-xs text-zinc-500">{t('apiKeyHint')}</p>
                      </div>
                    )}

                    {provider === 'ollama' && (
                      <p className="text-xs text-zinc-500">{t('ollamaNoAuth')}</p>
                    )}

                    {preset.supportsOAuth && authMode === 'oauth' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            {t('oauthStatus')}
                          </label>
                          <span className="flex items-center gap-1.5 text-sm">
                            {oauthStatus === 'checking' && (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                                <span className="text-zinc-400">{t('oauthChecking')}</span>
                              </>
                            )}
                            {oauthStatus === 'authenticated' && (
                              <>
                                <Check className="h-3.5 w-3.5 text-green-500" />
                                <span className="text-green-600 dark:text-green-400">{t('oauthAuthenticated')}</span>
                              </>
                            )}
                            {oauthStatus === 'not_authenticated' && (
                              <>
                                <X className="h-3.5 w-3.5 text-red-500" />
                                <span className="text-red-600 dark:text-red-400">{t('oauthNotAuthenticated')}</span>
                              </>
                            )}
                            {oauthStatus === 'unknown' && (
                              <span className="text-zinc-400">--</span>
                            )}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={triggerOAuthLogin} disabled={loginPending}>
                            {loginPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                            {t('oauthLogin')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={checkOAuthStatus}>
                            {t('oauthCheckStatus')}
                          </Button>
                        </div>
                        <p className="text-xs text-zinc-500">{t('oauthHint')}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Model */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      {t('model')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {preset.models.length > 0 ? (
                      <>
                        <Select
                          options={modelSelectOptions}
                          value={isPresetModel ? model : '__custom__'}
                          onChange={(v) => {
                            if (v === '__custom__') {
                              setModel('__custom__');
                              setCustomModel('');
                            } else {
                              setModel(v);
                              setCustomModel('');
                            }
                          }}
                        />
                        {(model === '__custom__' || !isPresetModel) && (
                          <Input
                            value={customModel}
                            onChange={(e) => setCustomModel(e.target.value)}
                            placeholder={t('customModelPlaceholder')}
                          />
                        )}
                      </>
                    ) : (
                      <Input
                        value={customModel || (model === '__custom__' ? '' : model)}
                        onChange={(e) => {
                          setModel('__custom__');
                          setCustomModel(e.target.value);
                        }}
                        placeholder={t('customModelPlaceholder')}
                      />
                    )}
                    <p className="text-xs text-zinc-500">{t('modelHint')}</p>
                  </CardContent>
                </Card>

                {/* Advanced: Base URL */}
                {(preset.editableBaseUrl || provider === 'anthropic') && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Wrench className="h-5 w-5" />
                        {t('advanced')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('baseUrl')}
                      </label>
                      <Input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder={preset.baseUrl || t('baseUrlPlaceholder')}
                      />
                      <p className="text-xs text-zinc-500">{t('baseUrlHint')}</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* ══════════════ Claude Code Configuration ══════════════ */}
            {activeSection === 'claude' && (
              <>
                {/* Skip Permissions */}
                <Card>
                  <CardContent className="pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          <Shield className="h-4 w-4" />
                          {t('skipPermissions')}
                        </div>
                        <p className="text-xs text-zinc-500 pr-4">{t('skipPermissionsHint')}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={skipPermissions}
                        onClick={() => setSkipPermissions(!skipPermissions)}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                          skipPermissions ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                            skipPermissions ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </label>
                  </CardContent>
                </Card>

                {/* Effort Level */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Gauge className="h-5 w-5" />
                      {t('effortLevel')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      {(['high', 'medium', 'low'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => setEffortLevel(level)}
                          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                            effortLevel === level ? btnActive : btnInactive
                          }`}
                        >
                          {t(`effort${level.charAt(0).toUpperCase() + level.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">{t('effortLevelHint')}</p>
                  </CardContent>
                </Card>

                {/* Max Turns */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <RotateCw className="h-5 w-5" />
                      {t('maxTurns')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Input
                      type="number"
                      min={0}
                      value={maxTurns || ''}
                      onChange={(e) => setMaxTurns(parseInt(e.target.value) || 0)}
                      placeholder={t('maxTurnsPlaceholder')}
                    />
                    <p className="text-xs text-zinc-500">{t('maxTurnsHint')}</p>
                  </CardContent>
                </Card>

                {/* Default Expose Prompt Path */}
                <Card>
                  <CardContent className="pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          <Eye className="h-4 w-4" />
                          {t('defaultExposePromptPath')}
                        </div>
                        <p className="text-xs text-zinc-500 pr-4">{t('defaultExposePromptPathHint')}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={defaultExposePromptPath}
                        onClick={() => setDefaultExposePromptPath(!defaultExposePromptPath)}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                          defaultExposePromptPath ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                            defaultExposePromptPath ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </label>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ══════════════ Appearance ══════════════ */}
            {activeSection === 'appearance' && (
              <>
                {/* Theme */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sun className="h-5 w-5" />
                      {t('theme')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      {([
                        { value: 'light' as Theme, label: t('themeLight'), icon: Sun },
                        { value: 'dark' as Theme, label: t('themeDark'), icon: Moon },
                        { value: 'system' as Theme, label: t('themeSystem'), icon: Monitor },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setTheme(opt.value)}
                          className={`flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                            theme === opt.value ? btnActive : btnInactive
                          }`}
                        >
                          <opt.icon className="h-4 w-4" />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">{t('themeHint')}</p>
                  </CardContent>
                </Card>

                {/* Language */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-base">A</span>
                      {t('language')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => switchLocale('zh')}
                        className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                          locale === 'zh' ? btnActive : btnInactive
                        }`}
                      >
                        中文
                      </button>
                      <button
                        onClick={() => switchLocale('en')}
                        className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                          locale === 'en' ? btnActive : btnInactive
                        }`}
                      >
                        English
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500">{t('languageHint')}</p>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ══════════════ Data Management ══════════════ */}
            {activeSection === 'data' && (
              <>
                {/* Data Directory */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FolderOpen className="h-5 w-5" />
                      {t('dataDir')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="rounded-md bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 break-all">
                      {dataDir || '...'}
                    </div>
                    {diskUsage && (
                      <p className="text-xs text-zinc-500">{diskUsage}</p>
                    )}
                    <p className="text-xs text-zinc-500">{t('dataDirHint')}</p>
                  </CardContent>
                </Card>

                {/* Export / Import */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Download className="h-5 w-5" />
                      {t('exportData')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-xs text-zinc-500">{t('exportDataHint')}</p>
                    <Button variant="outline" onClick={handleExport} disabled={exporting}>
                      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {exporting ? t('exporting') : t('exportData')}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      {t('importData')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-xs text-zinc-500">{t('importDataHint')}</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleImportFile}
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                    >
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {importing ? t('importing') : t('importData')}
                    </Button>
                  </CardContent>
                </Card>

                {/* Clear Data */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-red-500" />
                      {t('clearData')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      {/* Clear Sessions */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('clearSessions')}</p>
                          <p className="text-xs text-zinc-500">{t('clearSessionsHint')}</p>
                        </div>
                        {confirmAction === 'sessions' ? (
                          <div className="flex gap-2">
                            <Button variant="destructive" size="sm" onClick={() => handleClear('sessions')}>
                              {tActions('confirm')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>
                              {tActions('cancel')}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setConfirmAction('sessions')}>
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('clearSessions')}
                          </Button>
                        )}
                      </div>

                      <div className="border-t border-zinc-100 dark:border-zinc-800" />

                      {/* Clear Flows */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('clearFlows')}</p>
                          <p className="text-xs text-zinc-500">{t('clearFlowsHint')}</p>
                        </div>
                        {confirmAction === 'flows' ? (
                          <div className="flex gap-2">
                            <Button variant="destructive" size="sm" onClick={() => handleClear('flows')}>
                              {tActions('confirm')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>
                              {tActions('cancel')}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setConfirmAction('flows')}>
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('clearFlows')}
                          </Button>
                        )}
                      </div>

                      <div className="border-t border-zinc-100 dark:border-zinc-800" />

                      {/* Clear All */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">{t('clearAll')}</p>
                          <p className="text-xs text-zinc-500">{t('clearAllHint')}</p>
                        </div>
                        {confirmAction === 'all' ? (
                          <div className="flex gap-2">
                            <Button variant="destructive" size="sm" onClick={() => handleClear('all')}>
                              {tActions('confirm')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>
                              {tActions('cancel')}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="destructive" size="sm" onClick={() => setConfirmAction('all')}>
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('clearAll')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Data status feedback */}
                {dataStatus && (
                  <div className={`flex items-center gap-2 text-sm ${
                    dataStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {dataStatus.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    {dataStatus.message}
                  </div>
                )}
              </>
            )}

            {/* ══════════════ Privacy ══════════════ */}
            {activeSection === 'privacy' && (
              <>
                {/* Data Storage Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-5 w-5" />
                      {t('dataStorageTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                      {t('dataStorageInfo')}
                    </div>
                  </CardContent>
                </Card>

                {/* Telemetry */}
                <Card>
                  <CardContent className="pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          <Eye className="h-4 w-4" />
                          {t('telemetry')}
                        </div>
                        <p className="text-xs text-zinc-500 pr-4">{t('telemetryHint')}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={telemetry}
                        onClick={() => setTelemetry(!telemetry)}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                          telemetry ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                            telemetry ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </label>
                  </CardContent>
                </Card>

                {/* Open Source */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Github className="h-5 w-5" />
                      {t('openSourceTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {t('openSourceInfo')}
                    </p>
                  </CardContent>
                </Card>
              </>
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
