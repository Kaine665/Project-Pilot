'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from '@/client/i18n/routing';
import { useRouter } from '@/client/i18n/routing';

export default function DocsIndexPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/data/projects');
        const data = await res.json();
        const projects = (data.projects ?? []).filter((p: { archived?: boolean }) => !p.archived);
        if (projects.length > 0) {
          const qs = searchParams.toString();
          router.replace(qs ? `/flows/docs/${projects[0].key}?${qs}` : `/flows/docs/${projects[0].key}`);
          return;
        }
      } catch { /* ignore */ }
      setChecked(true);
    })();
  }, [router, searchParams]);

  if (!checked) return null;

  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      请先创建项目
    </div>
  );
}
