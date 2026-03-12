'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import { X, ExternalLink, Copy, Check, Loader2, FileText } from 'lucide-react';
import { FormattedText } from '@/components/formatted-text';

interface FilePreviewDialogProps {
  filePath: string;
  onClose: () => void;
}

export const FilePreviewDialog = memo(function FilePreviewDialog({
  filePath,
  onClose,
}: FilePreviewDialogProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isMarkdown = ext === 'md' || ext === 'mdx';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    (async () => {
      try {
        // Try the path directly first
        let res = await fetch(
          `/api/fs/read-file?path=${encodeURIComponent(filePath)}`,
          { cache: 'no-store' },
        );
        // If 404 and the path looks relative, try resolving via the data directory
        if (res.status === 404 && !filePath.match(/^([a-zA-Z]:[/\\]|\/)/)) {
          res = await fetch(
            `/api/fs/read-file?path=${encodeURIComponent(filePath)}&resolve=data`,
            { cache: 'no-store' },
          );
        }
        if (cancelled) return;
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? '读取失败');
        } else {
          setContent(data.content);
        }
      } catch {
        if (!cancelled) setError('无法读取文件');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [filePath]);

  const handleOpenExternal = useCallback(async () => {
    const electron = (window as Window & { electron?: { openFile: (p: string) => Promise<{ ok?: boolean; error?: string }> } }).electron;
    if (electron?.openFile) {
      await electron.openFile(filePath);
    } else {
      try {
        await fetch('/api/fs/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        });
      } catch { /* ignore */ }
    }
  }, [filePath]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white/95 backdrop-blur-sm dark:bg-zinc-900/95">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
        <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300" title={filePath}>
          {filePath.replace(/\\/g, '/')}
        </span>

        <button
          onClick={handleCopyPath}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="复制路径"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleOpenExternal}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="用系统应用打开"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
        {content !== null && !loading && (
          isMarkdown ? (
            <FormattedText text={content} className="prose-sm leading-relaxed space-y-2" />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {content}
            </pre>
          )
        )}
      </div>
    </div>
  );
});
