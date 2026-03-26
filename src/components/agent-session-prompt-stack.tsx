'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import {
  Eye,
  FileText,
  FolderOpen,
  LoaderCircle,
  X,
} from 'lucide-react';
import { WorkspaceRailPanelHeader } from '@/components/workspace-rail-panel-header';

type PromptTarget = 'global' | 'project' | 'agent' | 'session';

export interface PromptStackSeedItem {
  scope: 'Global' | 'Project' | 'Agent' | 'Session';
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

interface PromptGroup {
  id: string;
  label: string;
  badge: string;
  accent: string;
  item: PromptStackSeedItem;
}

interface DetailState {
  item: PromptStackSeedItem;
  content: string;
  loading: boolean;
  error: string | null;
}

interface EditorState {
  item: PromptStackSeedItem;
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface AgentSessionPromptStackProps {
  items: PromptStackSeedItem[];
  /** 外层已提供统一顶栏时隐藏组件自带标题行 */
  hideHeader?: boolean;
}

function getItemId(item: PromptStackSeedItem): string {
  return item.scope.toLowerCase();
}

function buildGroups(items: PromptStackSeedItem[]): PromptGroup[] {
  return items.map((item) => ({
    id: getItemId(item),
    label:
      item.scope === 'Global'
        ? '全局'
        : item.scope === 'Project'
          ? '项目'
          : item.scope === 'Agent'
            ? 'Agent'
            : '会话',
    badge:
      item.scope === 'Global'
        ? 'GLOBAL'
        : item.scope === 'Project'
          ? 'PROJECT'
          : item.scope === 'Agent'
            ? 'AGENT'
            : 'SESSION',
    accent: item.accent,
    item,
  }));
}

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

function getScopeTone(groupId: string) {
  if (groupId === 'global') {
    return {
      rail: 'border-sky-200',
      token: 'text-sky-700',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-sky-200 hover:ring-sky-100',
      panel: 'border-sky-100 bg-sky-50/70',
    };
  }

  if (groupId === 'project') {
    return {
      rail: 'border-amber-200',
      token: 'text-amber-700',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-amber-200 hover:ring-amber-100',
      panel: 'border-amber-100 bg-amber-50/70',
    };
  }

  if (groupId === 'agent') {
    return {
      rail: 'border-emerald-200',
      token: 'text-emerald-700',
      title: 'text-emerald-900',
      card: 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300 hover:ring-emerald-100',
      panel: 'border-emerald-100 bg-emerald-50/70',
    };
  }

  return {
    rail: 'border-violet-200',
    token: 'text-violet-700',
    title: 'text-slate-900',
    card: 'border-slate-200 hover:border-violet-200 hover:ring-violet-100',
    panel: 'border-violet-100 bg-violet-50/70',
  };
}

function getFriendlyError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '操作失败，请稍后再试。';
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '请求失败');
  }
  return data;
}

function canEditItem(item: PromptStackSeedItem): boolean {
  return item.target !== 'session' || Boolean(item.sessionId && item.agentId);
}

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
        if (event.target === event.currentTarget) {
          onClose();
        }
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

export function AgentSessionPromptStack({
  items,
  hideHeader = false,
}: AgentSessionPromptStackProps) {
  const t = useTranslations('agentsWorkspace');
  const groups = useMemo(() => buildGroups(items), [items]);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(() =>
    groups.map((group) => group.id),
  );
  const [contentOverrides, setContentOverrides] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  useEffect(() => {
    if (!detail && !editor) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetail(null);
        setEditor(null);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [detail, editor]);

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  const loadPromptContent = async (item: PromptStackSeedItem): Promise<string> => {
    const itemId = getItemId(item);
    if (contentOverrides[itemId] !== undefined) {
      return contentOverrides[itemId];
    }
    if (item.content !== undefined) {
      return item.content;
    }

    switch (item.target) {
      case 'global': {
        const data = await readJson(await fetch('/api/global-prompt', { cache: 'no-store' }));
        return typeof data.content === 'string' ? data.content : '';
      }

      case 'project': {
        if (!item.projectKey) return '';
        const data = await readJson(
          await fetch(`/api/project-prompt/${encodeURIComponent(item.projectKey)}`, {
            cache: 'no-store',
          }),
        );
        return typeof data.content === 'string' ? data.content : '';
      }

      case 'agent':
        return item.content ?? '';

      case 'session': {
        if (!item.agentId || !item.sessionId) return '';
        const data = await readJson(
          await fetch(
            `/api/agent-chat/runtime-prompt?agentId=${encodeURIComponent(item.agentId)}&sessionId=${encodeURIComponent(item.sessionId)}`,
            { cache: 'no-store' },
          ),
        );
        return typeof data.content === 'string' ? data.content : '';
      }

      default:
        return '';
    }
  };

  const savePromptContent = async (item: PromptStackSeedItem, content: string) => {
    switch (item.target) {
      case 'global': {
        await readJson(
          await fetch('/api/global-prompt', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          }),
        );
        return;
      }

      case 'project': {
        if (!item.projectKey) {
          throw new Error('缺少 projectKey，无法保存项目级提示词。');
        }
        await readJson(
          await fetch(`/api/project-prompt/${encodeURIComponent(item.projectKey)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          }),
        );
        return;
      }

      case 'agent': {
        if (!item.agentId) {
          throw new Error('缺少 agentId，无法保存 Agent 提示词。');
        }
        await readJson(
          await fetch('/api/agents', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.agentId, systemPrompt: content }),
          }),
        );
        return;
      }

      case 'session': {
        if (!item.agentId || !item.sessionId) {
          throw new Error('当前会话还没有生成运行时提示词副本。');
        }
        await readJson(
          await fetch(
            `/api/agent-chat/runtime-prompt?agentId=${encodeURIComponent(item.agentId)}&sessionId=${encodeURIComponent(item.sessionId)}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            },
          ),
        );
        return;
      }
    }
  };

  const openDetail = async (item: PromptStackSeedItem) => {
    const itemId = getItemId(item);
    setEditor(null);
    setDetail({
      item,
      content: '',
      loading: true,
      error: null,
    });

    try {
      const content = await loadPromptContent(item);
      setDetail((current) =>
        current && getItemId(current.item) === itemId
          ? { ...current, content, loading: false, error: null }
          : current,
      );
    } catch (error) {
      setDetail((current) =>
        current && getItemId(current.item) === itemId
          ? { ...current, content: '', loading: false, error: getFriendlyError(error) }
          : current,
      );
    }
  };

  const openEditor = async (item: PromptStackSeedItem) => {
    const itemId = getItemId(item);
    setDetail(null);
    setEditor({
      item,
      draft: '',
      loading: true,
      saving: false,
      error: null,
    });

    try {
      const content = await loadPromptContent(item);
      setEditor((current) =>
        current && getItemId(current.item) === itemId
          ? { ...current, draft: content, loading: false, error: null }
          : current,
      );
    } catch (error) {
      setEditor((current) =>
        current && getItemId(current.item) === itemId
          ? { ...current, draft: '', loading: false, error: getFriendlyError(error) }
          : current,
      );
    }
  };

  const handleSaveEditor = async () => {
    if (!editor) return;

    const itemId = getItemId(editor.item);
    setEditor((current) => (current ? { ...current, saving: true, error: null } : current));

    try {
      await savePromptContent(editor.item, editor.draft);
      setContentOverrides((current) => ({
        ...current,
        [itemId]: editor.draft,
      }));
      setEditor(null);
    } catch (error) {
      setEditor((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: getFriendlyError(error),
            }
          : current,
      );
    }
  };

  const detailTone = detail ? getScopeTone(getItemId(detail.item)) : null;
  const editorTone = editor ? getScopeTone(getItemId(editor.item)) : null;
  const editorTokenEstimate = editor ? estimateTokenCount(editor.draft) : null;
  const editorCanSave = editor ? canEditItem(editor.item) && !editor.loading && !editor.saving : false;

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
          {groups.map((group) => {
            const isOpen = openGroupIds.includes(group.id);
            const tone = getScopeTone(group.id);
            const overriddenContent = contentOverrides[group.id];
            const displayTokens =
              overriddenContent !== undefined
                ? estimateTokenCount(overriddenContent)
                : group.item.tokens;

            return (
              <section key={group.id}>
                <WorkspaceRailPanelHeader
                  variant="group"
                  title={group.label}
                  icon={<FolderOpen className="h-3 w-3 text-[#cfb690]" />}
                  collapsed={!isOpen}
                  onToggleCollapsed={() => toggleGroup(group.id)}
                  toggleTitle={isOpen ? t('workspaceRail.collapseSection') : t('workspaceRail.expandSection')}
                  actions={
                    <span className={`text-[9px] font-medium ${tone.token}`}>
                      {formatTokenLabel(displayTokens)}
                    </span>
                  }
                />

                {isOpen ? (
                  <div className="px-1.5 pb-1.5 pt-0.5">
                    <article
                      className={`rounded-lg border bg-card p-2 shadow-sm transition-all hover:ring-1 hover:ring-ring/30 ${tone.card}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-start gap-1.5">
                            <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
                            <span className={`truncate text-[11px] font-semibold ${tone.title}`}>
                              {group.item.label}
                            </span>
                          </div>
                          <p className="line-clamp-2 pl-[18px] text-[10px] leading-4 text-muted-foreground">
                            {group.item.description || '暂无摘要'}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() => openDetail(group.item)}
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={t('promptStack.viewDetailAria')}
                          >
                            <Eye className="h-3 w-3" aria-hidden />
                          </button>
                        </div>
                      </div>
                    </article>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      {detail && detailTone ? (
        <PromptModal
          title={`${detail.item.label} 详情`}
          subtitle="这里看的是完整 prompt 正文，不重复做卡片摘要预览。"
          onClose={() => setDetail(null)}
          footer={
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {detail.error
                  ? '正文加载失败时，可以直接进入编辑重新写入。'
                  : '如果正文不对，就直接点右侧按钮进入编辑。'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={() => openEditor(detail.item)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                >
                  编辑正文
                </button>
              </div>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <section className={`space-y-3 rounded-3xl border px-5 py-5 ${detailTone.panel}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${groups.find((group) => group.id === getItemId(detail.item))?.accent ?? ''}`}
                >
                  {detail.item.scope}
                </span>
                <span className={`text-xs font-medium ${detailTone.token}`}>
                  {formatTokenLabel(
                    detail.loading ? detail.item.tokens : estimateTokenCount(detail.content) ?? detail.item.tokens,
                  )}
                </span>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  名称
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{detail.item.label}</div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  摘要
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-700">{detail.item.description}</div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  来源路径
                </div>
                <div className="mt-2 break-all text-xs leading-6 text-slate-600">{detail.item.path}</div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="text-sm font-semibold text-slate-900">正文内容</div>
                <div className="mt-1 text-sm text-slate-500">
                  查看按钮看的是完整内容本身，不是卡片再放大一遍。
                </div>
              </div>

              <div className="px-5 py-5">
                {detail.loading ? (
                  <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-slate-500">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载正文...
                  </div>
                ) : detail.error ? (
                  <div className="min-h-[360px] rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm leading-6 text-red-700">
                    {detail.error}
                  </div>
                ) : (
                  <pre className="min-h-[360px] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">
                    {detail.content || '当前没有可显示的正文内容。'}
                  </pre>
                )}
              </div>
            </section>
          </div>
        </PromptModal>
      ) : null}

      {editor && editorTone ? (
        <PromptModal
          title={`编辑 ${editor.item.label}`}
          subtitle="这里直接编辑 prompt 正文。名称和摘要只是列表信息，不是这次的主编辑对象。"
          onClose={() => setEditor(null)}
          footer={
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {editor.error
                  ? editor.error
                  : canEditItem(editor.item)
                    ? '保存后会直接写回对应的 prompt 文件或会话副本。'
                    : '当前还没有运行时副本，暂时不能编辑会话级正文。'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  disabled={!editorCanSave}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {editor.saving ? '保存中...' : '保存正文'}
                </button>
              </div>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <section className={`space-y-3 rounded-3xl border px-5 py-5 ${editorTone.panel}`}>
              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  名称
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{editor.item.label}</div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  摘要
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-700">{editor.item.description}</div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  来源路径
                </div>
                <div className="mt-2 break-all text-xs leading-6 text-slate-600">{editor.item.path}</div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  当前估算
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {formatTokenLabel(editorTokenEstimate)}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="text-sm font-semibold text-slate-900">正文编辑器</div>
                <div className="mt-1 text-sm text-slate-500">
                  直接改正文。你要看的、要改的核心内容都在这里。
                </div>
              </div>

              <div className="px-5 py-5">
                {editor.loading ? (
                  <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-slate-500">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载正文...
                  </div>
                ) : (
                  <textarea
                    value={editor.draft}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, draft: event.target.value, error: null } : current,
                      )
                    }
                    disabled={!canEditItem(editor.item) || editor.saving}
                    placeholder={
                      canEditItem(editor.item)
                        ? '在这里直接编辑 prompt 正文...'
                        : '当前会话还没有运行时副本，暂时不能编辑。'
                    }
                    className="min-h-[420px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700 outline-none transition-colors focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                )}
              </div>
            </section>
          </div>
        </PromptModal>
      ) : null}
    </div>
  );
}
