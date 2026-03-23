'use client';

import { type ReactNode, useMemo, useState } from 'react';
import {
  ChevronDown,
  Eye,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

export interface PromptStackSeedItem {
  scope: 'Global' | 'Project' | 'Agent' | 'Session';
  accent: string;
  label: string;
  path: string;
  tokens: number | null;
  description: string;
}

interface PromptCard {
  id: string;
  title: string;
  path: string;
  description: string;
  tokens: number | null;
}

interface PromptGroup {
  id: string;
  label: string;
  badge: string;
  accent: string;
  cards: PromptCard[];
}

interface EditorState {
  groupId: string;
  cardId: string | null;
  title: string;
  path: string;
  description: string;
  tokens: string;
}

interface PreviewState {
  groupId: string;
  card: PromptCard;
}

interface AgentSessionPromptStackProps {
  items: PromptStackSeedItem[];
}

function makeInitialGroups(items: PromptStackSeedItem[]): PromptGroup[] {
  return items.map((item) => ({
    id: item.scope.toLowerCase(),
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
    cards: [
      {
        id: `${item.scope.toLowerCase()}-primary`,
        title: item.label,
        path: item.path,
        description: item.description,
        tokens: item.tokens,
      },
    ],
  }));
}

function formatTokenLabel(tokens: number | null): string {
  if (!tokens) return '';
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(1)}k Token`;
  return `~${tokens} Token`;
}

function getScopeTone(groupId: string) {
  if (groupId === 'global') {
    return {
      rail: 'border-sky-200',
      token: 'text-sky-600',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-sky-200 hover:ring-sky-100',
    };
  }

  if (groupId === 'project') {
    return {
      rail: 'border-amber-200',
      token: 'text-amber-600',
      title: 'text-slate-900',
      card: 'border-slate-200 hover:border-amber-200 hover:ring-amber-100',
    };
  }

  if (groupId === 'agent') {
    return {
      rail: 'border-emerald-200',
      token: 'text-emerald-600',
      title: 'text-emerald-900',
      card: 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300 hover:ring-emerald-100',
    };
  }

  return {
    rail: 'border-violet-200',
    token: 'text-violet-600',
    title: 'text-slate-900',
    card: 'border-slate-200 hover:border-violet-200 hover:ring-violet-100',
  };
}

function PromptModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[min(70vh,720px)] overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function AgentSessionPromptStack({
  items,
}: AgentSessionPromptStackProps) {
  const initialGroups = useMemo(() => makeInitialGroups(items), [items]);
  const [groups, setGroups] = useState<PromptGroup[]>(initialGroups);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(() =>
    initialGroups.map((group) => group.id),
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const groupMap = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  const openCreate = (groupId: string) => {
    setEditor({
      groupId,
      cardId: null,
      title: '',
      path: '',
      description: '',
      tokens: '',
    });
  };

  const openEdit = (groupId: string, card: PromptCard) => {
    setEditor({
      groupId,
      cardId: card.id,
      title: card.title,
      path: card.path,
      description: card.description,
      tokens: card.tokens ? String(card.tokens) : '',
    });
  };

  const removeCard = (groupId: string, cardId: string) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, cards: group.cards.filter((card) => card.id !== cardId) }
          : group,
      ),
    );
  };

  const saveEditor = () => {
    if (!editor) return;
    const title = editor.title.trim();
    if (!title) return;

    setGroups((current) =>
      current.map((group) => {
        if (group.id !== editor.groupId) return group;

        const nextCard: PromptCard = {
          id: editor.cardId ?? `${group.id}-${Date.now()}`,
          title,
          path: editor.path.trim(),
          description: editor.description.trim(),
          tokens: editor.tokens.trim() ? Number(editor.tokens.trim()) || null : null,
        };

        if (editor.cardId) {
          return {
            ...group,
            cards: group.cards.map((card) => (card.id === editor.cardId ? nextCard : card)),
          };
        }

        return {
          ...group,
          cards: [...group.cards, nextCard],
        };
      }),
    );

    setEditor(null);
  };

  return (
    <div className="relative flex h-full flex-col bg-[#fcfbf8]">
      <div className="flex h-11 items-center justify-between border-b border-[#ece5d8] px-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9a8e7a]">
          提示词注入栈
        </h3>
        <div className="text-[10px] text-[#b5aa97]">支持预览与编辑</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          {groups.map((group) => {
            const isOpen = openGroupIds.includes(group.id);
            const tone = getScopeTone(group.id);
            return (
              <section key={group.id} className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform ${
                        isOpen ? '' : '-rotate-90'
                      }`}
                    />
                    <FolderOpen className="h-4 w-4 text-[#cfb690]" />
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${group.accent}`}
                    >
                      {group.label} ({group.badge})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreate(group.id)}
                    className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
                    title={`新增${group.label}提示词`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {isOpen ? (
                  <div className={`ml-2 border-l pl-4 ${tone.rail}`}>
                    <div className="space-y-2">
                      {group.cards.length > 0 ? (
                        group.cards.map((card) => (
                          <article
                            key={card.id}
                            className={`rounded-2xl border bg-white p-3 shadow-[0_6px_22px_rgba(15,23,42,0.04)] transition-all hover:ring-2 ${tone.card}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => setPreview({ groupId: group.id, card })}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="mb-1 flex items-start gap-2">
                                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <div className="min-w-0 flex-1">
                                    <div className={`truncate font-mono text-[10px] font-bold ${tone.title}`}>
                                      {card.title}
                                    </div>
                                    <div className="mt-1 truncate text-[10px] text-slate-400">
                                      {card.path || '未设置路径'}
                                    </div>
                                  </div>
                                </div>
                                <p className="line-clamp-2 text-[10px] leading-5 text-slate-500">
                                  {card.description || '暂无描述'}
                                </p>
                              </button>

                              <div className="flex shrink-0 items-center gap-1">
                                {card.tokens ? (
                                  <span className={`mr-1 text-[9px] ${tone.token}`}>
                                    {formatTokenLabel(card.tokens)}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => setPreview({ groupId: group.id, card })}
                                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  title="预览提示词"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEdit(group.id, card)}
                                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  title="编辑提示词"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeCard(group.id, card.id)}
                                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                  title="删除提示词"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-[#e4ddd0] bg-white/70 px-3 py-4 text-center text-[11px] text-slate-500">
                          这个分组下还没有提示词卡片。
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      {preview ? (
        <PromptModal
          title={`${groupMap.get(preview.groupId)?.label ?? ''} 提示词预览`}
          onClose={() => setPreview(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                文件名
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
                {preview.card.title}
              </div>
              <div className="mt-2 break-all text-xs text-slate-500">
                {preview.card.path || '未设置路径'}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                内容预览
              </div>
              <div className="min-h-[180px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 shadow-inner">
                {preview.card.description || '当前还没有可预览的内容。后续接入真实提示词内容后，这里会显示完整文本。'}
              </div>
            </div>
          </div>
        </PromptModal>
      ) : null}

      {editor ? (
        <PromptModal
          title={editor.cardId ? '编辑提示词卡片' : `新增${groupMap.get(editor.groupId)?.label ?? ''}提示词卡片`}
          onClose={() => setEditor(null)}
        >
          <div className="space-y-3">
            <input
              type="text"
              value={editor.title}
              onChange={(e) =>
                setEditor((current) =>
                  current ? { ...current, title: e.target.value } : current,
                )
              }
              placeholder="卡片标题"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-slate-400"
            />
            <input
              type="text"
              value={editor.path}
              onChange={(e) =>
                setEditor((current) =>
                  current ? { ...current, path: e.target.value } : current,
                )
              }
              placeholder="文件路径"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-slate-400"
            />
            <input
              type="text"
              value={editor.tokens}
              onChange={(e) =>
                setEditor((current) =>
                  current ? { ...current, tokens: e.target.value } : current,
                )
              }
              placeholder="Token 估算，可留空"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-slate-400"
            />
            <textarea
              value={editor.description}
              onChange={(e) =>
                setEditor((current) =>
                  current ? { ...current, description: e.target.value } : current,
                )
              }
              placeholder="提示词摘要或内容"
              rows={7}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-slate-400"
            />
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveEditor}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              保存
            </button>
          </div>
        </PromptModal>
      ) : null}
    </div>
  );
}
