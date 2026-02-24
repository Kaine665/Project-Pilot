'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { ArtifactSummary, ArtifactItem, AIPlan } from '@/types';
import { Image, FileCode, FileText, X } from 'lucide-react';

interface ArtifactViewerProps {
  taskId: string;
}

function ArtifactIcon({ type }: { type: ArtifactItem['type'] }) {
  switch (type) {
    case 'screenshot':
      return <Image className="h-4 w-4 text-blue-500" />;
    case 'diff':
      return <FileCode className="h-4 w-4 text-green-500" />;
    case 'log':
      return <FileText className="h-4 w-4 text-zinc-500" />;
  }
}

function DiffViewer({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 dark:bg-zinc-900">
      {lines.map((line, i) => {
        let color = 'text-zinc-300';
        if (line.startsWith('+') && !line.startsWith('+++')) color = 'text-green-400';
        else if (line.startsWith('-') && !line.startsWith('---')) color = 'text-red-400';
        else if (line.startsWith('@@')) color = 'text-blue-400';
        return (
          <div key={i} className={color}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

export function ArtifactViewer({ taskId }: ArtifactViewerProps) {
  const t = useTranslations('artifacts');
  const [summary, setSummary] = useState<ArtifactSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [diffContents, setDiffContents] = useState<Record<string, string>>({});

  const fetchArtifacts = useCallback(async () => {
    try {
      setLoading(true);

      // First, get the latest plan for this task
      const plansRes = await fetch(`/api/ai-plans?taskId=${taskId}`);
      if (!plansRes.ok) return;
      const plansData = await plansRes.json();
      const plans: AIPlan[] = plansData.plans ?? [];

      if (plans.length === 0) {
        setSummary(null);
        return;
      }

      // Get the latest plan (highest version)
      const latestPlan = plans.reduce((a, b) => (a.version > b.version ? a : b));

      // Fetch artifacts for this plan
      const artifactsRes = await fetch(`/api/artifacts?planId=${latestPlan.plan_id}`);
      if (artifactsRes.ok) {
        const data = await artifactsRes.json();
        setSummary(data);

        // Fetch diff contents
        if (data?.artifacts) {
          for (const artifact of data.artifacts) {
            if (artifact.type === 'diff') {
              try {
                const diffRes = await fetch(`/api/artifacts/${data.planId}/${artifact.path}`);
                if (diffRes.ok) {
                  const text = await diffRes.text();
                  setDiffContents((prev) => ({ ...prev, [artifact.path]: text }));
                }
              } catch {
                // Ignore individual diff fetch errors
              }
            }
          }
        }
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.error('Failed to fetch artifacts:', err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  if (loading) {
    return <div className="p-4 text-center text-sm text-zinc-400">{t('loading')}</div>;
  }

  if (!summary) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <p className="text-sm text-zinc-400">{t('completionHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary header */}
      <div className="flex items-center gap-3">
        <Badge variant="secondary">
          {t(`changeTypes.${summary.changeType}`, { defaultValue: summary.changeType })}
        </Badge>
        <span className="text-xs text-zinc-400">
          {new Date(summary.timestamp).toLocaleString('zh-CN')}
        </span>
      </div>

      {/* Changed files */}
      {summary.filesChanged.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('changeFilesCount', { count: summary.filesChanged.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {summary.filesChanged.map((file) => (
                <li key={file} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <FileCode className="h-3 w-3 shrink-0" />
                  <span className="font-mono">{file}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Artifacts */}
      {summary.artifacts.map((artifact) => (
        <Card key={artifact.path}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ArtifactIcon type={artifact.type} />
              <CardTitle className="text-sm">{artifact.label}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {artifact.type === 'screenshot' && (
              <button
                onClick={() => setZoomedImage(`/api/artifacts/${summary.planId}/${artifact.path}`)}
                className="cursor-zoom-in overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
              >
                <img
                  src={`/api/artifacts/${summary.planId}/${artifact.path}`}
                  alt={artifact.label}
                  className="max-h-[400px] w-full object-contain"
                />
              </button>
            )}
            {artifact.type === 'diff' && (
              diffContents[artifact.path] ? (
                <DiffViewer content={diffContents[artifact.path]} />
              ) : (
                <p className="text-xs text-zinc-400">{t('loadingDiff')}</p>
              )
            )}
            {artifact.type === 'log' && (
              <pre className="overflow-x-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                <a
                  href={`/api/artifacts/${summary.planId}/${artifact.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {t('viewLogFile')}
                </a>
              </pre>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Zoomed image overlay */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setZoomedImage(null)}
        >
          <button
            onClick={() => setZoomedImage(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomedImage}
            alt="Zoomed artifact"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
