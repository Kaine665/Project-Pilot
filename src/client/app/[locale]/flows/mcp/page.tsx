'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Pencil, Plug, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/client/i18n/routing';
import { useTranslations } from '@/client/i18n/use-translations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  getMcpEntryCommandSummary,
  getMcpEntryDescription,
  isMcpServerEntryEnabled,
} from '@/lib/mcp-market-ui-shared';

type McpServersMap = Record<string, unknown>;

const KEY_RE = /^[a-zA-Z0-9_-]{1,80}$/;

const DEFAULT_ADD_JSON = `{
  "enabled": true,
  "description": "一句话说明这个 MCP 是做什么的（会显示在卡片上）。",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-example"]
}`;

type EditorState =
  | { mode: 'add'; keyInput: string; draft: string }
  | { mode: 'edit'; key: string; draft: string };

export default memo(function McpPage() {
  const t = useTranslations('mcpPage');
  const tActions = useTranslations('actions');
  const [servers, setServers] = useState<McpServersMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [jsonDetail, setJsonDetail] = useState<{ key: string; cfg: unknown } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const parseJson = (text: string): { mcpServers?: McpServersMap; error?: string } => {
        try {
          return JSON.parse(text) as { mcpServers?: McpServersMap; error?: string };
        } catch {
          const preview = text.trim().slice(0, 160);
          throw new Error(preview ? `${t('badResponse')}: ${preview}` : t('badResponse'));
        }
      };

      let res = await fetch('/api/data/mcp-market', { cache: 'no-store' });
      if (res.status === 404) {
        res = await fetch('/api/community/mcp/installed', { cache: 'no-store' });
      }
      const data = parseJson(await res.text());
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setServers(typeof data.mcpServers === 'object' && data.mcpServers ? data.mcpServers : {});
    } catch (e) {
      setServers(null);
      setLoadError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => {
    if (!servers) return [];
    return Object.entries(servers).sort(([a], [b]) => a.localeCompare(b));
  }, [servers]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([k, cfg]) => {
      const blob = [
        k,
        getMcpEntryDescription(cfg) ?? '',
        getMcpEntryCommandSummary(cfg),
      ]
        .join('\n')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [entries, search]);

  const toggleEnabled = useCallback(
    async (key: string, enabled: boolean) => {
      setTogglingKey(key);
      try {
        const res = await fetch(`/api/data/mcp-market/${encodeURIComponent(key)}/enabled`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const text = await res.text();
        let body: { error?: string } = {};
        try {
          body = JSON.parse(text) as { error?: string };
        } catch {
          /* ignore */
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : t('saveFailed'));
      } finally {
        setTogglingKey(null);
      }
    },
    [load, t],
  );

  const deleteServer = useCallback(
    async (key: string) => {
      if (!window.confirm(t('confirmDelete', { key }))) return;
      try {
        const res = await fetch(`/api/data/mcp-market/${encodeURIComponent(key)}`, {
          method: 'DELETE',
        });
        const text = await res.text();
        let body: { error?: string } = {};
        try {
          body = JSON.parse(text) as { error?: string };
        } catch {
          /* ignore */
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : t('saveFailed'));
      }
    },
    [load, t],
  );

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    setEditorError(null);
    const key = editor.mode === 'add' ? editor.keyInput.trim() : editor.key;
    if (!KEY_RE.test(key)) {
      setEditorError(t('invalidKey'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.draft);
    } catch {
      setEditorError(t('invalidJson'));
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setEditorError(t('invalidJson'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/data/mcp-market/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const text = await res.text();
      let body: { error?: string } = {};
      try {
        body = JSON.parse(text) as { error?: string };
      } catch {
        /* ignore */
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditor(null);
      await load();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [editor, load, t]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-zinc-200 bg-zinc-50/80 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Plug className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {loading
                  ? '…'
                  : search.trim()
                    ? t('countFiltered', { total: entries.length, shown: filteredEntries.length })
                    : t('countLabel', { count: entries.length })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t('refresh')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setEditorError(null);
                setEditor({ mode: 'add', keyInput: '', draft: DEFAULT_ADD_JSON });
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('addManual')}
            </Button>
            <Button size="sm" className="gap-1.5" asChild>
              <Link to="/workspace/community/mcp">
                <Plus className="h-4 w-4" aria-hidden />
                {t('addFromCommunity')}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

          {loading && !loadError ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : null}

          {!loading && !loadError && entries.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
                <Button asChild>
                  <Link to="/workspace/community/mcp">{t('addFromCommunity')}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {!loading && !loadError && entries.length > 0 ? (
            <>
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  className="pl-8"
                  placeholder={t('searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t('searchPlaceholder')}
                />
              </div>
              {filteredEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('filterEmpty')}</p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {filteredEntries.map(([key, cfg]) => (
                    <li key={key}>
                      <Card
                        className={cn(
                          'h-full overflow-hidden border-zinc-200 dark:border-zinc-800',
                          !isMcpServerEntryEnabled(cfg) && 'opacity-65',
                        )}
                      >
                        <CardHeader className="space-y-2 pb-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <CardTitle className="font-mono text-base tracking-tight">{key}</CardTitle>
                            <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={isMcpServerEntryEnabled(cfg)}
                                disabled={togglingKey === key}
                                onChange={(e) => void toggleEnabled(key, e.target.checked)}
                                className="h-4 w-4 rounded border border-input accent-primary"
                              />
                              <span>{t('enabledLabel')}</span>
                            </label>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {getMcpEntryDescription(cfg) ?? t('noDescriptionHint')}
                          </p>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2 pt-0">
                          <Button type="button" variant="outline" size="sm" onClick={() => setJsonDetail({ key, cfg })}>
                            {t('toggleJson')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              setEditorError(null);
                              setEditor({ mode: 'edit', key, draft: JSON.stringify(cfg, null, 2) });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            {tActions('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void deleteServer(key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            {tActions('delete')}
                          </Button>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>

      <Dialog.Root open={jsonDetail !== null} onOpenChange={(open) => !open && setJsonDetail(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,720px)] w-[min(100vw-1.5rem,560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-background shadow-2xl',
              'dark:border-zinc-700 dark:bg-zinc-900',
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-5">
              <div className="min-w-0">
                <Dialog.Title className="truncate font-mono text-base font-semibold tracking-tight text-foreground">
                  {jsonDetail ? t('jsonDialogTitle', { key: jsonDetail.key }) : ''}
                </Dialog.Title>
                <Dialog.Description className="sr-only">{t('jsonDialogDescription')}</Dialog.Description>
              </div>
              <Dialog.Close
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label={tActions('close')}
              >
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                {jsonDetail ? JSON.stringify(jsonDetail.cfg, null, 2) : ''}
              </pre>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/20 p-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!jsonDetail) return;
                  const { key, cfg } = jsonDetail;
                  setJsonDetail(null);
                  setEditorError(null);
                  setEditor({ mode: 'edit', key, draft: JSON.stringify(cfg, null, 2) });
                }}
              >
                {tActions('edit')}
              </Button>
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  {tActions('close')}
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={editor !== null} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/45 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[60] flex max-h-[min(92vh,780px)] w-[min(100vw-1.5rem,600px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-background shadow-2xl',
              'dark:border-zinc-700 dark:bg-zinc-900',
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-5">
              <Dialog.Title className="text-base font-semibold tracking-tight text-foreground">
                {editor?.mode === 'add' ? t('editorTitleAdd') : editor ? t('editorTitleEdit', { key: editor.key }) : ''}
              </Dialog.Title>
              <Dialog.Description className="sr-only">{t('editorDescription')}</Dialog.Description>
              <Dialog.Close
                type="button"
                disabled={saving}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label={tActions('close')}
              >
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {editor?.mode === 'add' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="mcp-new-key">
                    {t('serverKeyLabel')}
                  </label>
                  <Input
                    id="mcp-new-key"
                    className="font-mono"
                    placeholder="my-mcp-server"
                    value={editor.keyInput}
                    onChange={(e) => setEditor({ ...editor, keyInput: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              ) : null}
              <Textarea
                className="min-h-[220px] font-mono text-xs leading-relaxed"
                spellCheck={false}
                value={editor?.draft ?? ''}
                onChange={(e) => editor && setEditor({ ...editor, draft: e.target.value })}
              />
              {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/20 p-4">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditor(null)}>
                {tActions('cancel')}
              </Button>
              <Button type="button" disabled={saving} onClick={() => void saveEditor()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {saving ? t('saving') : tActions('save')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
});
