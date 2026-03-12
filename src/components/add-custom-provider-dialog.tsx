'use client';

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CustomProviderConfig } from '@/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFn = (key: string, params?: any) => string;

function generateCustomProviderId(): `custom-${string}` {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface AddCustomProviderDialogProps {
  t: TranslationFn;
  tActions: TranslationFn;
  onClose: () => void;
  onAdd: (cp: CustomProviderConfig) => void;
}

export function AddCustomProviderDialog({ t, tActions, onClose, onAdd }: AddCustomProviderDialogProps) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [apiProtocol, setApiProtocol] = useState<'anthropic' | 'openai'>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [authMethod, setAuthMethod] = useState<'AUTH_TOKEN' | 'API_KEY'>('AUTH_TOKEN');
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState('');
  const [apiKey, setApiKey] = useState('');

  const addModel = useCallback(() => {
    const trimmed = modelInput.trim();
    if (!trimmed || modelIds.includes(trimmed)) return;
    setModelIds((prev) => [...prev, trimmed]);
    setModelInput('');
  }, [modelInput, modelIds]);

  const removeModel = useCallback((id: string) => {
    setModelIds((prev) => prev.filter((m) => m !== id));
  }, []);

  const handleSubmit = () => {
    if (!name.trim() || !baseUrl.trim() || modelIds.length === 0) return;
    onAdd({
      id: generateCustomProviderId(),
      name: name.trim(),
      tag: tag.trim() || undefined,
      apiProtocol,
      baseUrl: baseUrl.trim(),
      authMethod,
      modelIds: [...modelIds],
      apiKey: apiKey.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('addCustomProvider')}
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              {t('customProviderName')} <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('customProviderNamePlaceholder')}
              className="h-9"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">{t('customProviderTag')}</label>
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={t('customProviderTagPlaceholder')}
              className="h-9"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              {t('customProviderApiProtocol')} <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApiProtocol('anthropic')}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                  apiProtocol === 'anthropic' ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t('customProviderApiProtocolAnthropic')}
              </button>
              <button
                type="button"
                onClick={() => setApiProtocol('openai')}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                  apiProtocol === 'openai' ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t('customProviderApiProtocolOpenai')}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              {t('customProviderBaseUrl')} <span className="text-red-500">*</span>
            </label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('customProviderBaseUrlPlaceholder')}
              className="h-9"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              {t('customProviderAuthMethod')} <span className="text-red-500">*</span>
            </label>
            <p className="mb-1 text-xs text-zinc-400">{t('customProviderAuthHint')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthMethod('AUTH_TOKEN')}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                  authMethod === 'AUTH_TOKEN' ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t('customProviderAuthMethodToken')}
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('API_KEY')}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                  authMethod === 'API_KEY' ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t('customProviderAuthMethodKey')}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              {t('customProviderModelIds')} <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-1">
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addModel())}
                placeholder={t('customProviderModelIdsPlaceholder')}
                className="h-9 flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addModel} className="h-9 px-3">
                +
              </Button>
            </div>
            {modelIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {modelIds.map((mid) => (
                  <span
                    key={mid}
                    className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                  >
                    {mid}
                    <button type="button" onClick={() => removeModel(mid)} className="text-zinc-500 hover:text-zinc-700">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">{t('customProviderApiKey')}</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('customProviderApiKeyPlaceholder')}
              className="h-9"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {tActions('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || !baseUrl.trim() || modelIds.length === 0}
          >
            {tActions('add')}
          </Button>
        </div>
      </div>
    </div>
  );
}
