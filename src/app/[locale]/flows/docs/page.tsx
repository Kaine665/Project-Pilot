'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/routing';

export default function DocsIndexPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/data/projects');
        const data = await res.json();
        const projects = (data.projects ?? []).filter((p: { archived?: boolean }) => !p.archived);
        if (projects.length > 0) {
          router.replace(`/flows/docs/${projects[0].key}`);
          return;
        }
      } catch { /* ignore */ }
      setChecked(true);
    })();
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      请先创建项目
    </div>
  );
}
