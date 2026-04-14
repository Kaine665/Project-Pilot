'use client';

import { Package, X } from 'lucide-react';

export type ArtifactsPanelKnowledge = { title: string; type?: string; content?: string };
export type ArtifactsPanelTodo = { title: string; priority?: string };

/** 右栏「产物」面板当前展示的数据（提炼、生成物等将逐步汇总于此） */
export interface ArtifactsPanelPayload {
  knowledge: ArtifactsPanelKnowledge[];
  todos: ArtifactsPanelTodo[];
  updatedAt: number;
  error?: string;
}

interface ArtifactsPanelProps {
  payload: ArtifactsPanelPayload | null;
  onClose: () => void;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** 仅正文（供 Agents 右侧 Rail「产物」页与抽屉共用） */
export function ArtifactsPanelBody({ payload }: { payload: ArtifactsPanelPayload | null }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 text-xs">
      {payload?.error && (
        <p className="rounded border border-amber-200 bg-amber-50/90 p-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {payload.error}
        </p>
      )}
      {payload && !payload.error && payload.knowledge.length === 0 && payload.todos.length === 0 && (
        <p className="text-zinc-500 dark:text-zinc-400">本次未提取到新条目。</p>
      )}
      {payload && payload.knowledge.length > 0 && (
        <section className="mb-3">
          <h3 className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-100">
            <span className="mr-1 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              提炼 ·
            </span>
            知识（{payload.knowledge.length}）
          </h3>
          <ul className="space-y-2">
            {payload.knowledge.map((k, i) => (
              <li
                key={`${k.title}-${i}`}
                className="rounded border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900/80"
              >
                <div className="font-medium text-zinc-800 dark:text-zinc-100">{k.title}</div>
                {k.type && (
                  <span className="mt-0.5 inline-block rounded bg-violet-100 px-1 py-0.5 text-[10px] text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                    {k.type}
                  </span>
                )}
                {k.content && (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                    {truncate(k.content, 400)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {payload && payload.todos.length > 0 && (
        <section>
          <h3 className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-100">
            <span className="mr-1 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              提炼 ·
            </span>
            待办（{payload.todos.length}）
          </h3>
          <ul className="space-y-1.5">
            {payload.todos.map((todo, i) => (
              <li
                key={`${todo.title}-${i}`}
                className="rounded border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/80"
              >
                <span className="text-zinc-800 dark:text-zinc-100">{todo.title}</span>
                {todo.priority && (
                  <span className="ml-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">({todo.priority})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ArtifactsPanel({ payload, onClose }: ArtifactsPanelProps) {
  return (
    <div className="flex h-full flex-col border-l border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
          <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">产物</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ArtifactsPanelBody payload={payload} />
    </div>
  );
}
