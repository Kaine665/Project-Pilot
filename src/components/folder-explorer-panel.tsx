'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  FolderOpen,
  Folder,
  File,
  FileText,
  X,
  Loader2,
  Copy,
  ArrowUp,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Maximize2,
} from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
  loading?: boolean;
}

interface FolderExplorerPanelProps {
  onClose: () => void;
  onInsertPath?: (path: string) => void;
}

async function fetchDir(dirPath: string): Promise<{ path: string; entries: DirEntry[] }> {
  const res = await fetch(
    `/api/fs/list-dir?path=${encodeURIComponent(dirPath)}`,
    { cache: 'no-store' },
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error ?? `HTTP ${res.status}`;
    throw new Error(data.attempted ? `${msg}（路径: ${data.attempted}）` : msg);
  }
  return { path: data.path, entries: data.entries ?? [] };
}

export function FolderExplorerPanel({ onClose, onInsertPath }: FolderExplorerPanelProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedView, setExpandedView] = useState(false);

  useEffect(() => {
    if (!expandedView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedView(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedView]);

  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const { entries } = await fetchDir(dirPath);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      children: e.isDirectory ? undefined : undefined,
      expanded: false,
      loaded: false,
    }));
  }, []);

  const loadRoot = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const nodes = await loadDir(dirPath);
      setRootPath(dirPath);
      setTree(nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [loadDir]);

  const loadChildren = useCallback(
    async (parentPath: string): Promise<TreeNode[]> => {
      const { entries } = await fetchDir(parentPath);
      return entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        children: undefined,
        expanded: false,
        loaded: false,
      }));
    },
    [],
  );

  const setNodeExpanded = useCallback(
    (path: string, expanded: boolean, nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((node) => {
        if (node.path === path) {
          return { ...node, expanded };
        }
        if (node.children) {
          return { ...node, children: setNodeExpanded(path, expanded, node.children) };
        }
        return node;
      });
    },
    [],
  );

  const setNodeLoading = useCallback(
    (path: string, loading: boolean, nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((node) => {
        if (node.path === path) return { ...node, loading };
        if (node.children) {
          return { ...node, children: setNodeLoading(path, loading, node.children) };
        }
        return node;
      });
    },
    [],
  );

  const setNodeChildren = useCallback(
    (path: string, children: TreeNode[], nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((node) => {
        if (node.path === path) {
          return { ...node, children, loaded: true, loading: false, expanded: true };
        }
        if (node.children) {
          return { ...node, children: setNodeChildren(path, children, node.children) };
        }
        return node;
      });
    },
    [],
  );

  const handleExpand = useCallback(
    async (node: TreeNode) => {
      if (!node.isDirectory) return;
      if (node.loaded && node.children) {
        setTree((prev) => setNodeExpanded(node.path, !node.expanded, prev));
        return;
      }
      if (node.loading) return;

      setTree((prev) => setNodeLoading(node.path, true, prev));
      try {
        const children = await loadChildren(node.path);
        setTree((prev) => setNodeChildren(node.path, children, prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载子目录失败');
        setTree((prev) => setNodeLoading(node.path, false, prev));
      }
    },
    [loadChildren, setNodeExpanded, setNodeLoading, setNodeChildren],
  );

  const handleOpenFolder = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const electron = (window as Window & { electron?: { openFolderDialog: () => Promise<string | null> } }).electron;
    if (electron?.openFolderDialog) {
      try {
        const selected = await electron.openFolderDialog();
        if (selected?.trim()) {
          await loadRoot(selected.trim());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '选择文件夹失败');
      }
      return;
    }

    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> })
          .showDirectoryPicker();
        setPathInput(handle.name);
        setError('请在上方输入框粘贴完整路径');
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError('请在上方输入框输入或粘贴文件夹路径');
      }
      return;
    }

    setError('请在上方输入框输入或粘贴文件夹路径');
  }, [loadRoot]);

  const handleOpenByPath = useCallback(() => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    loadRoot(trimmed);
  }, [pathInput, loadRoot]);

  const handleGoUp = useCallback(() => {
    if (!rootPath) return;
    const sep = rootPath.includes('\\') ? '\\' : '/';
    const lastSep = rootPath.lastIndexOf(sep);
    if (lastSep <= 0) return;
    const parent = rootPath.slice(0, lastSep);
    if (parent.length < 2) return;
    loadRoot(parent);
  }, [rootPath, loadRoot]);

  const handleCopyPath = useCallback((p: string) => {
    navigator.clipboard.writeText(p);
  }, []);

  const handleInsertPath = useCallback(
    (p: string) => {
      onInsertPath?.(p);
    },
    [onInsertPath],
  );

  const handleOpenInApp = useCallback(async (filePath: string, fileName: string) => {
    setFileLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/fs/read-file?path=${encodeURIComponent(filePath)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '读取失败');
        return;
      }
      setViewingFile({ path: data.path, name: fileName, content: data.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setFileLoading(false);
    }
  }, []);

  const handleOpenFile = useCallback(async (filePath: string) => {
    const electron = (window as Window & { electron?: { openFile: (p: string) => Promise<{ ok?: boolean; error?: string }> } }).electron;
    if (electron?.openFile) {
      try {
        const result = await electron.openFile(filePath);
        if (result?.error) {
          setError(`打开失败: ${result.error}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '打开文件失败');
      }
      return;
    }
    // 回退：通过 API 用系统默认应用打开（Electron 内 preload 可能未注入时）
    try {
      const res = await fetch('/api/fs/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `打开失败`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开文件失败');
    }
  }, []);

  function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
    const hasChildren = node.isDirectory;
    const isExpanded = node.expanded && hasChildren;
    const indent = depth * 14;

    return (
      <div key={node.path} className="select-none">
        <div
          className="group flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          style={{ paddingLeft: indent + 4 }}
        >
          <button
            onClick={() => {
              if (hasChildren) handleExpand(node);
              else if (!node.isDirectory) handleOpenInApp(node.path, node.name);
            }}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {hasChildren ? (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {node.loading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                ) : (
                  isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                  )
                )}
              </span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            {node.isDirectory ? (
              isExpanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
              )
            ) : (
              <File className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
            )}
            <span className="truncate text-zinc-700 dark:text-zinc-300">{node.name}</span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {!node.isDirectory && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenInApp(node.path, node.name);
                  }}
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  title="在应用内打开"
                >
                  <FileText className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenFile(node.path);
                  }}
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  title="用系统默认应用打开"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopyPath(node.path);
              }}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="复制路径"
            >
              <Copy className="h-3 w-3" />
            </button>
            {onInsertPath && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleInsertPath(node.path);
                }}
                className="rounded p-0.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                title="插入到对话"
              >
                插入
              </button>
            )}
          </div>
        </div>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">本地文件夹</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenByPath()}
            placeholder="输入或粘贴文件夹路径"
            className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
          />
          <button
            onClick={handleOpenByPath}
            disabled={loading || !pathInput.trim()}
            className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            打开
          </button>
        </div>
        <button
          onClick={handleOpenFolder}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-zinc-200 py-2 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          选择文件夹
        </button>
      </div>

      {rootPath && (
        <div className="flex items-center gap-1 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <button
            onClick={handleGoUp}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="上一级"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title={rootPath}>
            {rootPath}
          </span>
        </div>
      )}

      {error && (
        <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1">
        {viewingFile ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-1.5 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
              <button
                onClick={() => {
                  setViewingFile(null);
                  setExpandedView(false);
                }}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="返回"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <span className="truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400" title={viewingFile.path}>
                {viewingFile.name}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => setExpandedView(true)}
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  title="放大展示"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleCopyPath(viewingFile.path)}
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  title="复制路径"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {viewingFile.content}
            </pre>
            {expandedView && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                onClick={() => setExpandedView(false)}
              >
                <div
                  className="flex max-h-[90vh] max-w-[90vw] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-700">
                    <span className="truncate font-mono text-sm text-zinc-700 dark:text-zinc-300" title={viewingFile.path}>
                      {viewingFile.name}
                    </span>
                    <button
                      onClick={() => setExpandedView(false)}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      title="关闭"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <pre className="max-h-[80vh] flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {viewingFile.content}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ) : fileLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : tree.length === 0 && !rootPath ? (
          <div className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
            <FolderOpen className="mx-auto mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p>输入路径或点击「选择文件夹」打开</p>
          </div>
        ) : tree.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">空目录</div>
        ) : (
          <div className="py-1">
            {tree.map((node) => (
              <TreeItem key={node.path} node={node} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
