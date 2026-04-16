'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  FolderOpen,
  Layers,
  LoaderCircle,
  Pencil,
  Plus,
  SplitSquareHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { WorkspaceRailPanelHeader } from '@/components/workspace-rail-panel-header';
import {
  usePromptSegments,
  type SegmentWithContent,
} from '@/hooks/use-prompt-segments';
import type { PromptSegment, PromptSegmentScope } from '@/types';

// ── Types ──

type PromptTarget = 'resolved' | 'global' | 'project' | 'agent' | 'session';

export interface PromptStackSeedItem {
  scope: 'Resolved' | 'Global' | 'Project' | 'Agent' | 'Session';
  accent: string;
  label: string;
  path: string;
  tokens: number | null;
  description: string;
  target: PromptTarget;
  projectKey?: string;
  agentId?: string;
  sessionId?: string | null;
  content?: string;
}

interface AgentSessionPromptStackProps {
  items: PromptStackSeedItem[];
  hideHeader?: boolean;
}

// ── Helpers ──

function estimateTokenCount(content: string | undefined): number | null {
  const normalized = content?.trim() ?? '';
  if (!normalized) return null;
  return Math.max(1, Math.round(normalized.length / 4));
}

function formatTokenLabel(tokens: number | null): string {
  if (!tokens) return '未估算';
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(1)}k Token`;
  return `~${tokens} Token`;
}

function getScopeTone(target: PromptTarget) {
  if (target === 'resolved') {
    return {
      rail: 'border-rose-200',
      token: 'text-rose-700',
      title: 'text-slate-900',
      card: 'border-rose-200 bg-rose-50/40 hover:border-rose-300 hover:ring-rose-100',
      panel: 'border-rose-100 bg-rose-50/70',
      badge: 'bg-rose-50 text-rose-800 border-rose-100',
    };
  }
  if (target === 'global') {
    return {
      rail: 'border-sky-200',
      token: 'text-sky-700',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-sky-200 hover:ring-sky-100',
      panel: 'border-sky-100 bg-sky-50/70',
      badge: 'bg-sky-50 text-sky-700 border-sky-100',
    };
  }
  if (target === 'project') {
    return {
      rail: 'border-amber-200',
      token: 'text-amber-700',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-amber-200 hover:ring-amber-100',
      panel: 'border-amber-100 bg-amber-50/70',
      badge: 'bg-amber-50 text-amber-700 border-amber-100',
    };
  }
  if (target === 'agent') {
    return {
      rail: 'border-emerald-200',
      token: 'text-emerald-700',
      title: 'text-emerald-900',
      card: 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300 hover:ring-emerald-100',
      panel: 'border-emerald-100 bg-emerald-50/70',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };
  }
  return {
    rail: 'border-violet-200',
    token: 'text-violet-700',
    title: 'text-slate-900',
    card: 'border-slate-200 hover:border-violet-200 hover:ring-violet-100',
    panel: 'border-violet-100 bg-violet-50/70',
    badge: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  };
}

function getScopeLabel(target: PromptTarget): string {
  switch (target) {
    case 'resolved': return '实际';
    case 'global': return '全局';
    case 'project': return '项目';
    case 'agent': return 'Agent';
    case 'session': return '会话';
  }
}

function buildSegmentScope(item: PromptStackSeedItem): PromptSegmentScope | null {
  switch (item.target) {
    case 'resolved':
      return null;
    case 'global':
      return { type: 'global' };
    case 'project':
      return item.projectKey ? { type: 'project', projectKey: item.projectKey } : null;
    case 'agent':
      return item.agentId ? { type: 'agent', agentId: item.agentId } : null;
    case 'session':
      return item.agentId && item.sessionId
        ? { type: 'runtime', agentId: item.agentId, sessionId: item.sessionId }
        : null;
  }
}

function generateSegmentId(): string {
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '请求失败');
  }
  return data;
}

// ── Modal ──

function PromptModal({
  title,
  subtitle,
  size = 'lg',
  children,
  footer,
  onClose,
}: {
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[min(88vh,920px)] w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)] ${
          size === 'lg' ? 'max-w-5xl' : 'max-w-2xl'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-950">{title}</div>
            {subtitle ? (
              <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── Resolved prompt (server-assembled full system prompt) ──

function ResolvedPromptScopeGroup({
  item,
  defaultOpen,
}: {
  item: PromptStackSeedItem;
  defaultOpen: boolean;
}) {
  const t = useTranslations('agentsWorkspace');
  const tone = getScopeTone('resolved');
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedText, setResolvedText] = useState('');
  const [tokenEstimate, setTokenEstimate] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      if (!item.agentId) {
        setLoading(false);
        setError('缺少 Agent');
        return;
      }
      const seq = ++fetchSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ agentId: item.agentId, includeText: '1' });
        if (item.sessionId) params.set('sessionId', item.sessionId);
        if (item.projectKey) params.set('projectKey', item.projectKey);
        const res = await fetch(`/api/agent-chat/prompt-info?${params}`, {
          cache: 'no-store',
          signal: ac.signal,
          headers: { 'X-PP-Include-Prompt-Text': '1' },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || seq !== fetchSeqRef.current) return;
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : '请求失败');
        }
        const raw =
          typeof data.text === 'string'
            ? data.text
            : typeof (data as { fullText?: unknown }).fullText === 'string'
              ? (data as { fullText: string }).fullText
              : '';
        setResolvedText(raw);
        setTokenEstimate(typeof data.estimatedTokens === 'number' ? data.estimatedTokens : null);
        if (
          !raw &&
          typeof data.charCount === 'number' &&
          data.charCount > 0 &&
          typeof data.estimatedTokens === 'number' &&
          data.estimatedTokens > 0
        ) {
          setError('正文未返回（可能为代理或旧版 API）。请硬刷新页面并确认 Hono 已重启。');
        }
      } catch (e) {
        if (cancelled || seq !== fetchSeqRef.current) return;
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : '加载失败');
        setResolvedText('');
        setTokenEstimate(null);
      } finally {
        if (!cancelled && seq === fetchSeqRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [item.agentId, item.sessionId, item.projectKey]);

  const displayTokens = tokenEstimate != null ? Math.max(1, Math.round(tokenEstimate)) : null;

  return (
    <section>
      <WorkspaceRailPanelHeader
        variant="group"
        title={item.label}
        icon={<Layers className="h-3 w-3 text-rose-600/90" />}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        toggleTitle={collapsed ? t('workspaceRail.expandSection') : t('workspaceRail.collapseSection')}
        actions={
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] font-medium ${tone.token}`}>
              {loading ? '…' : formatTokenLabel(displayTokens)}
            </span>
          </div>
        }
      />

      {!collapsed ? (
        <div className="space-y-0.5 px-1.5 pb-1.5 pt-0.5">
          {loading ? (
            <div className="flex items-center justify-center gap-1.5 py-3 text-[10px] text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-2 text-[10px] text-destructive">
              {error}
            </div>
          ) : (
            <article
              className={`rounded-lg border bg-card p-2 shadow-sm transition-all hover:ring-1 hover:ring-ring/30 ${tone.card}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-3 pl-0 text-[10px] leading-4 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setViewOpen(true)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title={t('promptStack.viewDetailAria')}
                >
                  <Eye className="h-3 w-3" />
                </button>
              </div>
            </article>
          )}
        </div>
      ) : null}

      {viewOpen ? (
        <PromptModal
          title={item.label}
          subtitle={t('promptStack.items.resolved.description')}
          onClose={() => setViewOpen(false)}
        >
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              正在拉取完整提示词…
            </div>
          ) : (
            <pre className="min-h-[200px] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">
              {resolvedText || '（空）'}
            </pre>
          )}
        </PromptModal>
      ) : null}
    </section>
  );
}

// ── Scope Group (renders one scope with its blocks) ──

function ScopeGroup({
  item,
  defaultOpen,
}: {
  item: PromptStackSeedItem;
  defaultOpen: boolean;
}) {
  const t = useTranslations('agentsWorkspace');
  const tone = getScopeTone(item.target);
  const scope = useMemo(() => buildSegmentScope(item), [item]);
  const segments = usePromptSegments(scope);

  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const [viewSegment, setViewSegment] = useState<SegmentWithContent | null>(null);
  const [editSegment, setEditSegment] = useState<SegmentWithContent | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Legacy single-file content for non-segmented scopes
  const [legacyContent, setLegacyContent] = useState<string | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(false);

  // Close modal on Escape
  useEffect(() => {
    if (!viewSegment && !editSegment && !showCreate) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewSegment(null);
        setEditSegment(null);
        setShowCreate(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [viewSegment, editSegment, showCreate]);

  const totalTokens = useMemo(() => {
    if (segments.isSegmented) {
      return segments.segments
        .filter(s => s.enabled)
        .reduce((sum, s) => sum + (estimateTokenCount(s.content) ?? 0), 0);
    }
    return item.tokens;
  }, [segments.segments, segments.isSegmented, item.tokens]);

  const loadLegacyContent = useCallback(async () => {
    if (legacyContent !== null) return legacyContent;
    setLegacyLoading(true);
    try {
      let content = '';
      switch (item.target) {
        case 'global': {
          const data = await readJson(await fetch('/api/global-prompt', { cache: 'no-store' }));
          content = typeof data.content === 'string' ? data.content : '';
          break;
        }
        case 'project': {
          if (item.projectKey) {
            const data = await readJson(
              await fetch(`/api/project-prompt/${encodeURIComponent(item.projectKey)}`, { cache: 'no-store' }),
            );
            content = typeof data.content === 'string' ? data.content : '';
          }
          break;
        }
        case 'agent':
          content = item.content ?? '';
          break;
        case 'session': {
          if (item.agentId && item.sessionId) {
            const data = await readJson(
              await fetch(
                `/api/agent-chat/runtime-prompt?agentId=${encodeURIComponent(item.agentId)}&sessionId=${encodeURIComponent(item.sessionId)}`,
                { cache: 'no-store' },
              ),
            );
            content = typeof data.content === 'string' ? data.content : '';
          }
          break;
        }
      }
      setLegacyContent(content);
      return content;
    } finally {
      setLegacyLoading(false);
    }
  }, [item, legacyContent]);

  const handleInitSegmented = async () => {
    await segments.initSegmented();
    setLegacyContent(null);
  };

  const handleSaveEdit = async () => {
    if (!editSegment) return;
    setEditSaving(true);
    try {
      await segments.updateSegmentContent(editSegment.id, editDraft);
      setEditSegment(null);
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!createTitle.trim()) return;
    setCreateSaving(true);
    try {
      const seg: PromptSegment = {
        id: generateSegmentId(),
        title: createTitle.trim(),
        enabled: true,
      };
      await segments.createSegment(seg, createContent);
      setShowCreate(false);
      setCreateTitle('');
      setCreateContent('');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return;
    const ids = segments.segments.map(s => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await segments.reorderSegments(ids);
  };

  const handleMoveDown = async (index: number) => {
    if (index >= segments.segments.length - 1) return;
    const ids = segments.segments.map(s => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await segments.reorderSegments(ids);
  };

  return (
    <section>
      <WorkspaceRailPanelHeader
        variant="group"
        title={getScopeLabel(item.target)}
        icon={<FolderOpen className="h-3 w-3 text-[#cfb690]" />}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(v => !v)}
        toggleTitle={collapsed ? t('workspaceRail.expandSection') : t('workspaceRail.collapseSection')}
        actions={
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] font-medium ${tone.token}`}>
              {formatTokenLabel(totalTokens)}
            </span>
            {segments.isSegmented && !collapsed ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCreate(true); }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="添加 Block"
              >
                <Plus className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        }
      />

      {!collapsed ? (
        <div className="px-1.5 pb-1.5 pt-0.5 space-y-0.5">
          {segments.loading ? (
            <div className="flex items-center justify-center gap-1.5 py-3 text-[10px] text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : segments.isSegmented ? (
            <>
              {segments.segments.length === 0 ? (
                <div className="py-2 text-center text-[10px] text-muted-foreground">
                  暂无 Block，点击 + 添加
                </div>
              ) : (
                segments.segments.map((seg, idx) => {
                  const segTokens = estimateTokenCount(seg.content);
                  return (
                    <article
                      key={seg.id}
                      className={`group rounded-lg border bg-card p-1.5 shadow-sm transition-all hover:ring-1 hover:ring-ring/30 ${tone.card} ${
                        !seg.enabled ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {/* Enable/disable checkbox */}
                        <button
                          type="button"
                          onClick={() => segments.toggleSegment(seg.id, !seg.enabled)}
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                            seg.enabled
                              ? 'border-emerald-400 bg-emerald-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                          title={seg.enabled ? '禁用' : '启用'}
                        >
                          {seg.enabled ? <Check className="h-2 w-2" /> : null}
                        </button>

                        {/* Title & tokens */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <FileText className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
                            <span className={`truncate text-[10px] font-semibold ${tone.title}`}>
                              {seg.title}
                            </span>
                            <span className={`text-[8px] font-medium ${tone.token}`}>
                              {formatTokenLabel(segTokens)}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {idx > 0 ? (
                            <button
                              type="button"
                              onClick={() => handleMoveUp(idx)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="上移"
                            >
                              <ChevronUp className="h-2.5 w-2.5" />
                            </button>
                          ) : null}
                          {idx < segments.segments.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => handleMoveDown(idx)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="下移"
                            >
                              <ChevronDown className="h-2.5 w-2.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setViewSegment(seg)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="查看"
                          >
                            <Eye className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditSegment(seg);
                              setEditDraft(seg.content);
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="编辑"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`确定删除 Block「${seg.title}」？`)) {
                                segments.deleteSegment(seg.id);
                              }
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                            title="删除"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </>
          ) : (
            /* Non-segmented: single card with split action */
            <article className={`rounded-lg border bg-card p-2 shadow-sm transition-all hover:ring-1 hover:ring-ring/30 ${tone.card}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-start gap-1.5">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
                    <span className={`truncate text-[11px] font-semibold ${tone.title}`}>
                      {item.label}
                    </span>
                  </div>
                  <p className="line-clamp-2 pl-[18px] text-[10px] leading-4 text-muted-foreground">
                    {item.description || '暂无摘要'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const content = await loadLegacyContent();
                      setViewSegment({
                        id: '_legacy',
                        title: item.label,
                        enabled: true,
                        content: content ?? '',
                      });
                    }}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="查看"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                  {scope ? (
                    <button
                      type="button"
                      onClick={handleInitSegmented}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="拆分为 Blocks"
                    >
                      <SplitSquareHorizontal className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )}
        </div>
      ) : null}

      {/* View Modal */}
      {viewSegment ? (
        <PromptModal
          title={`${viewSegment.title}`}
          subtitle={`${getScopeLabel(item.target)}级 Block`}
          onClose={() => setViewSegment(null)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewSegment(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              >
                关闭
              </button>
              {viewSegment.id !== '_legacy' ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditSegment(viewSegment);
                    setEditDraft(viewSegment.content);
                    setViewSegment(null);
                  }}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                >
                  编辑
                </button>
              ) : null}
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${tone.badge}`}>
                {item.target}
              </span>
              <span className={`text-xs font-medium ${tone.token}`}>
                {formatTokenLabel(estimateTokenCount(viewSegment.content))}
              </span>
            </div>
            <pre className="min-h-[200px] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">
              {viewSegment.content || '暂无内容'}
            </pre>
          </div>
        </PromptModal>
      ) : null}

      {/* Edit Modal */}
      {editSegment ? (
        <PromptModal
          title={`编辑 ${editSegment.title}`}
          subtitle={`${getScopeLabel(item.target)}级 Block`}
          onClose={() => setEditSegment(null)}
          footer={
            <div className="flex items-center justify-between gap-3">
              <span className={`text-xs font-medium ${tone.token}`}>
                {formatTokenLabel(estimateTokenCount(editDraft))}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditSegment(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {editSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          }
        >
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            disabled={editSaving}
            placeholder="输入 Block 内容..."
            className="min-h-[360px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700 outline-none transition-colors focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </PromptModal>
      ) : null}

      {/* Create Modal */}
      {showCreate ? (
        <PromptModal
          title="新建 Block"
          subtitle={`添加到 ${getScopeLabel(item.target)} 层`}
          size="md"
          onClose={() => setShowCreate(false)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!createTitle.trim() || createSaving}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {createSaving ? '创建中...' : '创建'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Block 名称</label>
              <input
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="例如：项目架构、API 文档、角色定义..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">内容</label>
              <textarea
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                placeholder="输入 Block 内容..."
                className="min-h-[200px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-slate-400"
              />
            </div>
          </div>
        </PromptModal>
      ) : null}
    </section>
  );
}

// ── Main Component ──

export function AgentSessionPromptStack({
  items,
  hideHeader = false,
}: AgentSessionPromptStackProps) {
  const t = useTranslations('agentsWorkspace');

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {!hideHeader ? (
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-muted/30 px-3">
          <h3 className="truncate text-xs font-semibold tracking-tight text-foreground">
            {t('promptStack.title')}
          </h3>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 py-1">
        <div className="space-y-0.5">
          {items.map((item) =>
            item.target === 'resolved' ? (
              <ResolvedPromptScopeGroup key="prompt-resolved" item={item} defaultOpen />
            ) : (
              <ScopeGroup key={item.target} item={item} defaultOpen />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
