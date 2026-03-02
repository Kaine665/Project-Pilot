'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Shield, Brain, Wrench, Check, X, Loader2, ExternalLink, Server,
  Gauge, RotateCw, Eye, Sun, Moon, Monitor,
  Download, Upload, Trash2, FolderOpen, Info, Github,
} from 'lucide-react';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import type { Theme } from '@/components/theme-provider';
import type { ProviderId, ClaudeAuthMode, EffortLevel } from '@/types';

// ── Shared props ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFn = (key: string, params?: any) => string;

interface TranslationProps {
  t: TranslationFn;
  tActions: TranslationFn;
  btnActive: string;
  btnInactive: string;
}

// ══════════════ AI Configuration ══════════════

interface AIConfigSectionProps extends TranslationProps {
  provider: ProviderId;
  authMode: ClaudeAuthMode;
  apiKey: string;
  model: string;
  customModel: string;
  baseUrl: string;
  oauthStatus: 'unknown' | 'checking' | 'authenticated' | 'not_authenticated';
  loginPending: boolean;
  preset: { supportsOAuth?: boolean; apiKeyPlaceholder?: string; editableBaseUrl?: boolean; baseUrl?: string; models: Array<{ id: string; label: string }> };
  isPresetModel: boolean;
  modelSelectOptions: Array<{ value: string; label: string }>;
  onProviderChange: (p: ProviderId) => void;
  onAuthModeChange: (m: ClaudeAuthMode) => void;
  onApiKeyChange: (k: string) => void;
  onModelChange: (m: string) => void;
  onCustomModelChange: (m: string) => void;
  onBaseUrlChange: (u: string) => void;
  onCheckOAuthStatus: () => void;
  onTriggerOAuthLogin: () => void;
}

export function SettingsAISection({
  t, btnActive, btnInactive,
  provider, authMode, apiKey, model, customModel, baseUrl,
  oauthStatus, loginPending,
  preset, isPresetModel, modelSelectOptions,
  onProviderChange, onAuthModeChange, onApiKeyChange,
  onModelChange, onCustomModelChange, onBaseUrlChange,
  onCheckOAuthStatus, onTriggerOAuthLogin,
}: AIConfigSectionProps) {
  return (
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
                onClick={() => onProviderChange(p.id)}
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
                  onClick={() => onAuthModeChange('api_key')}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    authMode === 'api_key' ? btnActive : btnInactive
                  }`}
                >
                  {t('apiKeyMode')}
                </button>
                <button
                  onClick={() => onAuthModeChange('oauth')}
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
                onChange={(e) => onApiKeyChange(e.target.value)}
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
                <Button variant="outline" size="sm" onClick={onTriggerOAuthLogin} disabled={loginPending}>
                  {loginPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  {t('oauthLogin')}
                </Button>
                <Button variant="ghost" size="sm" onClick={onCheckOAuthStatus}>
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
                    onModelChange('__custom__');
                    onCustomModelChange('');
                  } else {
                    onModelChange(v);
                    onCustomModelChange('');
                  }
                }}
              />
              {(model === '__custom__' || !isPresetModel) && (
                <Input
                  value={customModel}
                  onChange={(e) => onCustomModelChange(e.target.value)}
                  placeholder={t('customModelPlaceholder')}
                />
              )}
            </>
          ) : (
            <Input
              value={customModel || (model === '__custom__' ? '' : model)}
              onChange={(e) => {
                onModelChange('__custom__');
                onCustomModelChange(e.target.value);
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
              onChange={(e) => onBaseUrlChange(e.target.value)}
              placeholder={preset.baseUrl || t('baseUrlPlaceholder')}
            />
            <p className="text-xs text-zinc-500">{t('baseUrlHint')}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ══════════════ Claude Code Configuration ══════════════

interface ClaudeSectionProps extends TranslationProps {
  skipPermissions: boolean;
  effortLevel: EffortLevel;
  maxTurns: number;
  defaultExposePromptPath: boolean;
  onSkipPermissionsChange: (v: boolean) => void;
  onEffortLevelChange: (l: EffortLevel) => void;
  onMaxTurnsChange: (n: number) => void;
  onDefaultExposePromptPathChange: (v: boolean) => void;
}

export function SettingsClaudeSection({
  t, btnActive, btnInactive,
  skipPermissions, effortLevel, maxTurns, defaultExposePromptPath,
  onSkipPermissionsChange, onEffortLevelChange, onMaxTurnsChange, onDefaultExposePromptPathChange,
}: ClaudeSectionProps) {
  return (
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
              onClick={() => onSkipPermissionsChange(!skipPermissions)}
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
                onClick={() => onEffortLevelChange(level)}
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
            onChange={(e) => onMaxTurnsChange(parseInt(e.target.value) || 0)}
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
              onClick={() => onDefaultExposePromptPathChange(!defaultExposePromptPath)}
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
  );
}

// ══════════════ Appearance ══════════════

interface AppearanceSectionProps extends TranslationProps {
  theme: Theme;
  locale: string;
  onThemeChange: (t: Theme) => void;
  onLocaleChange: (l: string) => void;
}

export function SettingsAppearanceSection({
  t, btnActive, btnInactive,
  theme, locale,
  onThemeChange, onLocaleChange,
}: AppearanceSectionProps) {
  return (
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
                onClick={() => onThemeChange(opt.value)}
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
              onClick={() => onLocaleChange('zh')}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                locale === 'zh' ? btnActive : btnInactive
              }`}
            >
              中文
            </button>
            <button
              onClick={() => onLocaleChange('en')}
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
  );
}

// ══════════════ Data Management ══════════════

interface DataSectionProps extends TranslationProps {
  dataDir: string;
  diskUsage: string;
  exporting: boolean;
  importing: boolean;
  dataStatus: { type: 'success' | 'error'; message: string } | null;
  confirmAction: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: (target: 'sessions' | 'flows' | 'all') => void;
  onSetConfirmAction: (a: string | null) => void;
}

export function SettingsDataSection({
  t, tActions,
  dataDir, diskUsage, exporting, importing, dataStatus, confirmAction, fileInputRef,
  onExport, onImportFile, onClear, onSetConfirmAction,
}: DataSectionProps) {
  return (
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

      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('exportData')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">{t('exportDataHint')}</p>
          <Button variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? t('exporting') : t('exportData')}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
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
            onChange={onImportFile}
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
                  <Button variant="destructive" size="sm" onClick={() => onClear('sessions')}>
                    {tActions('confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSetConfirmAction(null)}>
                    {tActions('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onSetConfirmAction('sessions')}>
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
                  <Button variant="destructive" size="sm" onClick={() => onClear('flows')}>
                    {tActions('confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSetConfirmAction(null)}>
                    {tActions('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onSetConfirmAction('flows')}>
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
                  <Button variant="destructive" size="sm" onClick={() => onClear('all')}>
                    {tActions('confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSetConfirmAction(null)}>
                    {tActions('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => onSetConfirmAction('all')}>
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
  );
}

// ══════════════ Privacy ══════════════

interface PrivacySectionProps extends TranslationProps {
  telemetry: boolean;
  onTelemetryChange: (v: boolean) => void;
}

export function SettingsPrivacySection({
  t,
  telemetry, onTelemetryChange,
}: PrivacySectionProps) {
  return (
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
              onClick={() => onTelemetryChange(!telemetry)}
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
  );
}
