'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { useRouter } from '@/client/i18n/routing';
import { useProject } from '@/components/project-context';

export default function ContextPage() {
  const router = useRouter();
  const { activeKey } = useProject();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (activeKey) {
        router.replace(`/flows/docs/${activeKey}?view=context`);
        return;
      }

      try {
        const res = await fetch('/api/data/projects');
        const data = await res.json();
        const first = (data.projects ?? []).find((project: { archived?: boolean }) => !project.archived);
        if (first) {
          router.replace(`/flows/docs/${first.key}?view=context`);
          return;
        }
      } catch {
        // ignore
      }

      setReady(true);
    })();
  }, [activeKey, router]);

  if (!ready) return null;

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          <BookOpen className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          上下文已并入文档
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          旧的独立上下文页面已经收口到统一文档页。你可以在文档里继续通过“上下文”筛选保持相同的工作焦点，而不用再把系统拆成两个入口。
        </p>
        <button
          onClick={() => router.push('/flows/docs?view=context')}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950"
        >
          打开文档
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
