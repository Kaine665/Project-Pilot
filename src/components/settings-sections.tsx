'use client';

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Link } from '@/client/i18n/routing';
import {
  Shield, Brain, Wrench, Check, X, Loader2, ExternalLink, Copy,
  Gauge, RotateCw, Eye, Sun, Moon, Monitor,
  Download, Upload, Trash2, FolderOpen, Info, Github, ShieldAlert,
  Sparkles, Plus, Minus, Zap, Timer, Search, Star,
} from 'lucide-react';
import type { DangerCategory, DangerActionLevel, DangerDetectorSettings, TitleGenerationChainEntry } from '@/types';
import { PROVIDER_REGISTRY, getProviderPreset } from '@/lib/provider-registry';
import type { AggregateLiveModelItem, SupplierAvailabilityRow } from '@/lib/aggregate-models-live';
import { useAvailableModels } from '@/hooks/use-available-models';
import {
  compositeKeyForAggregateItem,
  modelSelectOptionsFromAggregate,
  parseAggregateCompositeKey,
} from '@/lib/aggregate-model-key';
import { PROVIDER_LABELS } from '@/components/agent-chat/types';
import { partitionBuiltInProviders } from '@/lib/provider-supplier-tier';
import { cn } from '@/lib/utils';
import type { Theme } from '@/components/theme-provider';
import type { CustomProviderConfig, ProviderId, EffortLevel } from '@/types';

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
  model: string;
  customModel: string;
  isPresetModel: boolean;
  onModelChange: (m: string) => void;
  onCustomModelChange: (m: string) => void;
  customProviders?: CustomProviderConfig[];
  onAddCustomProvider?: () => void;
  onDeleteCustomProvider?: (id: `custom-${string}`) => void;
  /** 全部供应商的 API Key 映射 */
  providerApiKeys: Partial<Record<ProviderId, string>>;
  onProviderApiKeyChange: (pid: ProviderId, key: string) => void;
  /** 各供应商自定义根地址（如 Ollama） */
  providerBaseUrls: Partial<Record<ProviderId, string>>;
  onProviderBaseUrlChange: (pid: ProviderId, url: string) => void;
  /** 各供应商接口拉取的聚合模型（非 registry 静态表） */
  aggregateLiveModels: AggregateLiveModelItem[];
  aggregateLiveStatus: 'idle' | 'loading' | 'success' | 'error';
  /** 各供应商可用性（错误原因用 reasonKey + i18n，不在模型页展示原文） */
  supplierAvailability: SupplierAvailabilityRow[];
  /** Key 输入旁自动探测结果（优先于聚合结果展示） */
  supplierProbeRow: Partial<Record<ProviderId, SupplierAvailabilityRow>>;
  supplierProbeLoading: Partial<Record<ProviderId, boolean>>;
  /** 某供应商 Key 变化后防抖触发单供应商探测 */
  onScheduleSupplierProbe: (pid: ProviderId) => void;
  /** 切换到「供应商」子页时批量调度探测 */
  onSupplierTabProbes: () => void;
  /** 整次拉取失败时的可读原因（HTTP/JSON/服务端 fatalError） */
  aggregateLiveErrorDetail?: string;
  onRefreshAggregateLiveModels: () => void;
  /** 从聚合模型列表选择模型（自动切换供应商） */
  onModelSelectFromAggregate: (pid: ProviderId, mid: string) => void;
}

export function SettingsAISection({
  t, tActions,
  provider, model, customModel, isPresetModel,
  onModelChange, onCustomModelChange,
  customProviders = [],
  onAddCustomProvider,
  onDeleteCustomProvider,
  providerApiKeys,
  aggregateLiveModels,
  aggregateLiveStatus,
  supplierAvailability,
  supplierProbeRow,
  supplierProbeLoading,
  onScheduleSupplierProbe,
  onSupplierTabProbes,
  aggregateLiveErrorDetail = '',
  onRefreshAggregateLiveModels,
  onProviderApiKeyChange,
  providerBaseUrls,
  onProviderBaseUrlChange,
  onModelSelectFromAggregate,
}: AIConfigSectionProps) {
  const [aiPanel, setAiPanel] = useState<'supplier' | 'model'>('model');
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    if (aiPanel !== 'supplier') return;
    onSupplierTabProbes();
  }, [aiPanel, onSupplierTabProbes]);

  const { oem: oemPresets, aggregate: aggregatePresets, builtInCustom } = useMemo(
    () => partitionBuiltInProviders(PROVIDER_REGISTRY),
    [],
  );

  const flatRows = useMemo(
    () =>
      aggregateLiveModels.map((m) => ({
        value: m.value,
        label: m.label,
        providerId: m.providerId,
      })),
    [aggregateLiveModels],
  );

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return flatRows;
    return flatRows.filter(
      (m) => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q),
    );
  }, [flatRows, modelSearch]);

  const listLoading = aggregateLiveStatus === 'idle' || aggregateLiveStatus === 'loading';
  const listFailed = aggregateLiveStatus === 'error';
  const availabilityById = useMemo(() => {
    const m = new Map<ProviderId, SupplierAvailabilityRow>();
    for (const r of supplierAvailability) m.set(r.providerId, r);
    return m;
  }, [supplierAvailability]);
  const hasUnavailableSuppliers = useMemo(
    () => supplierAvailability.some((r) => r.status === 'error'),
    [supplierAvailability],
  );

  function renderSupplierHealthLine(pid: ProviderId) {
    const probing = supplierProbeLoading[pid] === true;
    const row = supplierProbeRow[pid] ?? availabilityById.get(pid);
    if (probing) {
      return (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden />
          {t('supplierAvailabilityChecking')}
        </p>
      );
    }
    if (!row) {
      if (listLoading) {
        return (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden />
            {t('supplierAvailabilityChecking')}
          </p>
        );
      }
      return (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{t('supplierAvailabilityUnknown')}</p>
      );
    }
    if (row.status === 'skipped') {
      if (row.reasonKey === 'not_applicable') return null;
      if (row.reasonKey === 'ollama_not_enabled') {
        return (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('supplierAvailabilityReasons.ollama_not_enabled')}
          </p>
        );
      }
      return (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('supplierAvailabilityNotConfigured')}</p>
      );
    }
    if (row.status === 'ok') {
      return (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('supplierAvailabilityOk')}
        </p>
      );
    }
    const rk = row.reasonKey ?? 'generic';
    const reason = t(`supplierAvailabilityReasons.${rk}` as never);
    return (
      <div className="mt-2 rounded-lg bg-amber-50/90 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="flex items-center gap-1 font-medium">
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('supplierAvailabilityError')}
        </p>
        <p className="mt-1 leading-relaxed text-amber-800/95 dark:text-amber-100/90">{reason}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t('modelAndSuppliersTitle')}
        </h2>
        <nav className="mt-4 flex gap-1" aria-label="AI settings tabs">
          <button
            type="button"
            onClick={() => setAiPanel('model')}
            className={cn(
              'border-b-2 px-2 pb-3 text-sm font-medium transition-colors sm:px-4',
              aiPanel === 'model'
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
            )}
          >
            {t('aiSubtabModel')}
          </button>
          <button
            type="button"
            onClick={() => setAiPanel('supplier')}
            className={cn(
              'border-b-2 px-2 pb-3 text-sm font-medium transition-colors sm:px-4',
              aiPanel === 'supplier'
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
            )}
          >
            {t('aiSubtabSupplier')}
          </button>
        </nav>
      </div>

      {aiPanel === 'supplier' ? (
        <>
      <div className="space-y-8">
        <div className="flex flex-col gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('supplierAvailabilityIntro')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-2"
            onClick={() => onRefreshAggregateLiveModels()}
            disabled={listLoading}
          >
            {listLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCw className="h-4 w-4" aria-hidden />
            )}
            {t('supplierAvailabilityRecheckAll')}
          </Button>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('supplierTierOem')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {oemPresets.map((p) => {
              const keyVal = providerApiKeys[p.id as ProviderId] || '';
              const configured = !!keyVal.trim();
              const isOllama = p.id === 'ollama';
              return (
                <div
                  key={p.id}
                  className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                        {t(`providers.${p.id}`)}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {t(`providerHints.${p.id}`)}
                      </p>
                    </div>
                    {configured && !isOllama && (
                      <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        {t('supplierConfigured')}
                      </span>
                    )}
                  </div>
                  {isOllama ? (
                    <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{t('ollamaNoAuth')}</p>
                      <label
                        htmlFor={`ollama-base-${p.id}`}
                        className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
                      >
                        {t('ollamaBaseUrlLabel')}
                      </label>
                      <Input
                        id={`ollama-base-${p.id}`}
                        type="url"
                        autoComplete="off"
                        value={providerBaseUrls.ollama ?? ''}
                        onChange={(e) => {
                          onProviderBaseUrlChange('ollama', e.target.value);
                          onScheduleSupplierProbe('ollama');
                        }}
                        placeholder={t('ollamaBaseUrlPlaceholder')}
                        className="h-9"
                      />
                      {renderSupplierHealthLine(p.id as ProviderId)}
                    </div>
                  ) : (
                    <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                      <Input
                        type="password"
                        value={keyVal}
                        onChange={(e) => {
                          onProviderApiKeyChange(p.id as ProviderId, e.target.value);
                          onScheduleSupplierProbe(p.id as ProviderId);
                        }}
                        placeholder={p.apiKeyPlaceholder || t('apiKeyPlaceholder')}
                        className="h-9"
                      />
                      {renderSupplierHealthLine(p.id as ProviderId)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('supplierTierAggregate')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {aggregatePresets.map((p) => {
              const keyVal = providerApiKeys[p.id as ProviderId] || '';
              const configured = !!keyVal.trim();
              return (
                <div
                  key={p.id}
                  className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                        {t(`providers.${p.id}`)}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {t(`providerHints.${p.id}`)}
                      </p>
                    </div>
                    {configured && (
                      <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        {t('supplierConfigured')}
                      </span>
                    )}
                  </div>
                  <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <Input
                      type="password"
                      value={keyVal}
                      onChange={(e) => {
                        onProviderApiKeyChange(p.id as ProviderId, e.target.value);
                        onScheduleSupplierProbe(p.id as ProviderId);
                      }}
                      placeholder={p.apiKeyPlaceholder || t('apiKeyPlaceholder')}
                      className="h-9"
                    />
                    {renderSupplierHealthLine(p.id as ProviderId)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('supplierTierCustom')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {builtInCustom && (
              <div
                key={builtInCustom.id}
                className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                      {t(`providers.${builtInCustom.id}`)}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t(`providerHints.${builtInCustom.id}`)}
                    </p>
                  </div>
                  {!!(providerApiKeys[builtInCustom.id as ProviderId] || '').trim() && (
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      {t('supplierConfigured')}
                    </span>
                  )}
                </div>
                <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                  <Input
                    type="password"
                    value={providerApiKeys[builtInCustom.id as ProviderId] || ''}
                    onChange={(e) => {
                      onProviderApiKeyChange(builtInCustom.id as ProviderId, e.target.value);
                      onScheduleSupplierProbe(builtInCustom.id as ProviderId);
                    }}
                    placeholder={builtInCustom.apiKeyPlaceholder || t('apiKeyPlaceholder')}
                    className="h-9"
                  />
                  {renderSupplierHealthLine(builtInCustom.id as ProviderId)}
                </div>
              </div>
            )}
            {customProviders.map((cp) => {
              const keyVal = providerApiKeys[cp.id] || '';
              const configured = !!keyVal.trim();
              return (
                <div
                  key={cp.id}
                  className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                        {cp.name}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {cp.baseUrl}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      {configured && (
                        <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
                          <Check className="h-3 w-3" />
                          {t('supplierConfigured')}
                        </span>
                      )}
                      {onDeleteCustomProvider && (
                        <button
                          type="button"
                          onClick={() => onDeleteCustomProvider(cp.id)}
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                          title={tActions('delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <Input
                      type="password"
                      value={keyVal}
                      onChange={(e) => {
                        onProviderApiKeyChange(cp.id, e.target.value);
                        onScheduleSupplierProbe(cp.id);
                      }}
                      placeholder={t('customProviderApiKeyPlaceholder')}
                      className="h-9"
                    />
                    {renderSupplierHealthLine(cp.id)}
                  </div>
                </div>
              );
            })}
            {onAddCustomProvider && (
              <button
                type="button"
                onClick={onAddCustomProvider}
                className="col-span-full flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-transparent py-3.5 text-sm font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
                {t('addCustomProvider')}
              </button>
            )}
          </div>
        </div>
      </div>
        </>
      ) : (
        <>
      {/* Model */}
      <Card className="border-zinc-200/80 shadow-sm dark:border-zinc-800">
        <CardContent className="space-y-4 pt-6">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('aggregateModelsHint')}</p>
              <div className="flex flex-col gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder={t('modelSearchPlaceholder')}
                    className="h-10 pl-9"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 shrink-0 gap-2"
                  onClick={() => onRefreshAggregateLiveModels()}
                  disabled={listLoading}
                >
                  {listLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <RotateCw className="h-4 w-4" aria-hidden />
                  )}
                  {t('aggregateModelsRefresh')}
                </Button>
              </div>
              {!listFailed && hasUnavailableSuppliers && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('modelListUnavailableSuppliersHint')}</p>
              )}
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20">
                <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
                {listLoading && filteredModels.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" aria-hidden />
                    {t('aggregateModelsLoading')}
                  </div>
                )}
                {listFailed && aggregateLiveModels.length === 0 && !listLoading && (
                  <div className="space-y-3 px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    <p>{t('aggregateModelsError')}</p>
                    {aggregateLiveErrorDetail.trim() ? (
                      <p className="break-all text-left font-mono text-xs text-zinc-600 dark:text-zinc-500">
                        {aggregateLiveErrorDetail}
                      </p>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => onRefreshAggregateLiveModels()}>
                      {t('aggregateModelsRefresh')}
                    </Button>
                  </div>
                )}
                {!listLoading && !listFailed && filteredModels.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {flatRows.length === 0
                      ? t('modelListNoConfiguredSuppliers')
                      : t('modelListNoSearchResults')}
                  </div>
                )}
                {filteredModels.map((opt) => {
                  const rowSelected = model === opt.value && provider === opt.providerId;
                  const providerLabel = opt.providerId.startsWith('custom-')
                    ? (customProviders.find((c) => c.id === opt.providerId)?.name ?? opt.providerId)
                    : t(`providers.${opt.providerId}`);
                  return (
                    <button
                      key={`${opt.providerId}/${opt.value}`}
                      type="button"
                      onClick={() => onModelSelectFromAggregate(opt.providerId, opt.value)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                        rowSelected
                          ? 'bg-white dark:bg-zinc-950'
                          : 'hover:bg-white/80 dark:hover:bg-zinc-950/50',
                      )}
                    >
                      <span className="flex w-5 shrink-0 justify-center">
                        {rowSelected ? (
                          <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden />
                        ) : (
                          <span className="block h-4 w-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-xs text-zinc-400 dark:text-zinc-500">
                          {opt.value}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {providerLabel}
                      </span>
                    </button>
                  );
                })}
                {/* Custom model ID row */}
                <button
                  type="button"
                  onClick={() => {
                    onModelChange('__custom__');
                    if (!customModel.trim()) onCustomModelChange('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                    (model === '__custom__' || !isPresetModel)
                      ? 'bg-white dark:bg-zinc-950'
                      : 'hover:bg-white/80 dark:hover:bg-zinc-950/50',
                  )}
                >
                  <span className="flex w-5 shrink-0 justify-center">
                    {(model === '__custom__' || !isPresetModel) ? (
                      <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden />
                    ) : (
                      <span className="block h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                      {t('customModel')}
                    </div>
                  </div>
                  <Brain className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
                </button>
                </div>
              </div>
              {(model === '__custom__' || !isPresetModel) && (
                <Input
                  value={customModel}
                  onChange={(e) => onCustomModelChange(e.target.value)}
                  placeholder={t('customModelPlaceholder')}
                />
              )}
          <p className="text-xs text-zinc-500">{t('modelHint')}</p>
        </CardContent>
      </Card>
        </>
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
  onClear: (target: 'sessions' | 'legacyBoard' | 'all') => void;
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

            {/* Clear legacy board */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('clearLegacyBoard')}</p>
                <p className="text-xs text-zinc-500">{t('clearLegacyBoardHint')}</p>
              </div>
              {confirmAction === 'legacyBoard' ? (
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={() => onClear('legacyBoard')}>
                    {tActions('confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSetConfirmAction(null)}>
                    {tActions('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onSetConfirmAction('legacyBoard')}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('clearLegacyBoard')}
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

// ══════════════ Safety Detection ══════════════

const DANGER_CATEGORIES: Array<{
  key: DangerCategory;
  labelKey: string;
  hintKey: string;
}> = [
  { key: 'dataDirectory', labelKey: 'dangerDataDirectory', hintKey: 'dangerDataDirectoryHint' },
  { key: 'sqlDestructive', labelKey: 'dangerSqlDestructive', hintKey: 'dangerSqlDestructiveHint' },
  { key: 'diskFormat', labelKey: 'dangerDiskFormat', hintKey: 'dangerDiskFormatHint' },
  { key: 'fileDestructive', labelKey: 'dangerFileDestructive', hintKey: 'dangerFileDestructiveHint' },
  { key: 'gitDangerous', labelKey: 'dangerGitDangerous', hintKey: 'dangerGitDangerousHint' },
  { key: 'npmPublish', labelKey: 'dangerNpmPublish', hintKey: 'dangerNpmPublishHint' },
  { key: 'processKill', labelKey: 'dangerProcessKill', hintKey: 'dangerProcessKillHint' },
];

const DANGER_LEVELS: DangerActionLevel[] = ['critical', 'warning', 'disabled'];

interface SafetySectionProps extends TranslationProps {
  dangerSettings: DangerDetectorSettings;
  onDangerSettingChange: (category: DangerCategory, level: DangerActionLevel) => void;
}

export function SettingsSafetySection({
  t, btnActive, btnInactive,
  dangerSettings,
  onDangerSettingChange,
}: SafetySectionProps) {
  const levelColors: Record<DangerActionLevel, string> = {
    critical: 'bg-red-600 text-white dark:bg-red-500',
    warning: 'bg-amber-500 text-white dark:bg-amber-400 dark:text-zinc-900',
    disabled: '',
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            {t('safetyDetection')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-xs text-zinc-500 mb-4">{t('safetyDetectionHint')}</p>
          <div className="space-y-4">
            {DANGER_CATEGORIES.map(({ key, labelKey, hintKey }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t(labelKey)}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {t(hintKey)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {DANGER_LEVELS.map((level) => (
                    <button
                      key={level}
                      onClick={() => onDangerSettingChange(key, level)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        dangerSettings[key] === level
                          ? (levelColors[level] || btnActive)
                          : btnInactive
                      }`}
                    >
                      {t(`dangerLevel${level.charAt(0).toUpperCase() + level.slice(1)}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

interface DeveloperSectionProps extends TranslationProps {
  schedulesPageEnabled: boolean;
  onSchedulesPageEnabledChange: (v: boolean) => void;
  taskTriggersPageEnabled: boolean;
  onTaskTriggersPageEnabledChange: (v: boolean) => void;
}

export function SettingsDeveloperSection({
  t,
  schedulesPageEnabled,
  onSchedulesPageEnabledChange,
  taskTriggersPageEnabled,
  onTaskTriggersPageEnabledChange,
}: DeveloperSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          {t('developerTools')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              <Timer className="h-4 w-4" />
              {t('schedulesPageEnabled')}
            </div>
            <p className="pr-4 text-xs text-zinc-500">{t('schedulesPageEnabledHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={schedulesPageEnabled}
            onClick={() => onSchedulesPageEnabledChange(!schedulesPageEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              schedulesPageEnabled ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                schedulesPageEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        <label className="flex items-center justify-between cursor-pointer">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              <Zap className="h-4 w-4" />
              {t('taskTriggersPageEnabled')}
            </div>
            <p className="pr-4 text-xs text-zinc-500">{t('taskTriggersPageEnabledHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={taskTriggersPageEnabled}
            onClick={() => onTaskTriggersPageEnabledChange(!taskTriggersPageEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              taskTriggersPageEnabled ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                taskTriggersPageEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </CardContent>
    </Card>
  );
}

// ══════════════ Title Generation ══════════════

interface TitleGenerationSectionProps extends TranslationProps {
  enabled: boolean;
  chain: TitleGenerationChainEntry[];
  onEnabledChange: (v: boolean) => void;
  onChainChange: (chain: TitleGenerationChainEntry[]) => void;
}

export function SettingsTitleGenerationSection({
  t, btnActive, btnInactive,
  enabled, chain,
  onEnabledChange, onChainChange,
}: TitleGenerationSectionProps) {
  const { items: aggregateItems } = useAvailableModels();

  type TestState = 'idle' | 'testing' | 'success' | 'failed';
  const [entryTestStates, setEntryTestStates] = useState<Record<number, TestState>>({});
  const [entryTestMessages, setEntryTestMessages] = useState<Record<number, string>>({});

  const titleChainLabel = useCallback(
    (id: ProviderId) => t(`providers.${id}`) || PROVIDER_LABELS[id] || id,
    [t],
  );

  const titleChainOptionsForEntry = useCallback(
    (entry: TitleGenerationChainEntry) => {
      const base = modelSelectOptionsFromAggregate(aggregateItems, titleChainLabel);
      const cur = compositeKeyForAggregateItem({
        providerId: entry.provider,
        value: entry.model,
        label: entry.model,
      });
      if (!base.some((o) => o.value === cur)) {
        return [
          {
            value: cur,
            label: `${entry.model} · ${titleChainLabel(entry.provider)}（当前）`,
          },
          ...base,
        ];
      }
      return base;
    },
    [aggregateItems, titleChainLabel],
  );

  const testEntry = async (index: number, entry: TitleGenerationChainEntry) => {
    setEntryTestStates((prev) => ({ ...prev, [index]: 'testing' }));
    setEntryTestMessages((prev) => ({ ...prev, [index]: '' }));
    try {
      const res = await fetch('/api/settings/test-title-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: entry.provider, model: entry.model }),
      });
      const data = await res.json() as { ok: boolean; error?: string; latencyMs?: number };
      if (data.ok) {
        setEntryTestStates((prev) => ({ ...prev, [index]: 'success' }));
        setEntryTestMessages((prev) => ({ ...prev, [index]: data.latencyMs ? `${data.latencyMs}ms` : '' }));
      } else {
        setEntryTestStates((prev) => ({ ...prev, [index]: 'failed' }));
        setEntryTestMessages((prev) => ({ ...prev, [index]: data.error || t('testFailed') }));
      }
    } catch (err) {
      setEntryTestStates((prev) => ({ ...prev, [index]: 'failed' }));
      setEntryTestMessages((prev) => ({ ...prev, [index]: err instanceof Error ? err.message : t('testFailed') }));
    }
  };

  const addEntry = () => {
    if (chain.length >= 10) return;
    const first = aggregateItems[0];
    if (first) {
      onChainChange([...chain, { provider: first.providerId, model: first.value }]);
    } else {
      onChainChange([...chain, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }]);
    }
  };

  const removeEntry = (index: number) => {
    onChainChange(chain.filter((_, i) => i !== index));
  };

  const setEntryFromComposite = (index: number, composite: string) => {
    const parsed = parseAggregateCompositeKey(composite);
    if (!parsed) return;
    onChainChange(
      chain.map((entry, i) =>
        i === index ? { provider: parsed.providerId, model: parsed.modelId } : entry,
      ),
    );
  };

  return (
    <>
      {/* Enable toggle */}
      <Card>
        <CardContent className="pt-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                <Sparkles className="h-4 w-4" />
                {t('titleGenerationEnabled')}
              </div>
              <p className="text-xs text-zinc-500 pr-4">{t('titleGenerationEnabledHint')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => onEnabledChange(!enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                enabled ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        </CardContent>
      </Card>

      {/* Retry chain */}
      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {t('titleGenerationChain')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-zinc-500">{t('titleGenerationChainHint')}</p>

            {chain.length === 0 && (
              <p className="text-xs text-zinc-400 italic">{t('titleGenerationChainEmpty')}</p>
            )}

            <div className="space-y-2">
              {chain.map((entry, index) => (
                <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-5 shrink-0 text-center">{index + 1}</span>
                  <select
                    value={compositeKeyForAggregateItem({
                      providerId: entry.provider,
                      value: entry.model,
                      label: entry.model,
                    })}
                    onChange={(e) => setEntryFromComposite(index, e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    {titleChainOptionsForEntry(entry).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => testEntry(index, entry)}
                    disabled={entryTestStates[index] === 'testing'}
                    className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                    title={t('titleGenerationTest')}
                  >
                    {entryTestStates[index] === 'testing'
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Zap className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => removeEntry(index)}
                    className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800 dark:hover:text-red-400 transition-colors"
                    title={t('titleGenerationRemove')}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {entryTestStates[index] === 'success' && (
                  <div className="flex items-center gap-1 pl-7 text-xs text-green-600 dark:text-green-400">
                    <Check className="h-3 w-3" />
                    {t('titleGenerationTestOk')}{entryTestMessages[index] ? ` · ${entryTestMessages[index]}` : ''}
                  </div>
                )}
                {entryTestStates[index] === 'failed' && (
                  <div className="flex items-center gap-1 pl-7 text-xs text-red-600 dark:text-red-400">
                    <X className="h-3 w-3" />
                    <span className="break-all">{entryTestMessages[index]}</span>
                  </div>
                )}
                </div>
              ))}
            </div>

            {chain.length < 10 && (
              <Button variant="outline" size="sm" onClick={addEntry}>
                <Plus className="h-3.5 w-3.5" />
                {t('titleGenerationAddEntry')}
              </Button>
            )}
          </CardContent>
        </Card>
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

// ══════════════ Notifications ══════════════

interface NotificationsSectionProps extends TranslationProps {}

export function SettingsNotificationsSection({
  t,
}: NotificationsSectionProps) {
  return (
    <>
      <Card>
        <CardContent className="pt-4">
          {/* 动态导入 NotificationPreferences 组件 */}
          <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 mb-4">
            💡 当 Agent 完成回复时，Windows 右下角会显示桌面通知并播放提示音。
          </div>
          <NotificationsEditor />
        </CardContent>
      </Card>
    </>
  );
}

// Lazy-loaded notifications component
const NotificationPreferencesComponent = lazy(() =>
  import('@/components/notification-preferences').then((mod) => ({
    default: mod.NotificationPreferences,
  }))
);

// 单独组件，延迟导入防止 SSR 问题
function NotificationsEditor() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Suspense fallback={<div className="text-sm text-gray-500">加载中...</div>}>
      <NotificationPreferencesComponent />
    </Suspense>
  );
}
