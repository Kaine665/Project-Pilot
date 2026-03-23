'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  FolderOpen, Folder, X, Loader2, Copy, ArrowUp,
  ChevronRight, ChevronDown, ExternalLink, Maximize2,
  FilePlus, FolderPlus, Pencil, Trash2, AtSign,
  GitBranch, FileText, ArrowLeft, RefreshCw,
} from 'lucide-react';
import { FileTypeIcon } from '@/components/file-type-icon';

// ── Types ──

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

interface GitInfo {
  folderName: string;
  branch: string | null;
  hasGit: boolean;
  fileCount: number;
  dirCount: number;
}

interface FolderExplorerPanelProps {
  onClose: () => void;
  onInsertPath?: (path: string) => void;
  /** Auto-open this path on mount */
  initialPath?: string;
  embedded?: boolean;
}

// ── Context Menu State ──
interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

// ── Inline Input State ──
interface InlineInputState {
  type: 'new-file' | 'new-folder' | 'rename';
  parentPath: string;
  existingName?: string;
  existingPath?: string;
}

// ── API helpers ──

async function fetchDir(dirPath: string): Promise<{ path: string; entries: DirEntry[] }> {
  const res = await fetch(`/api/fs/list-dir?path=${encodeURIComponent(dirPath)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { path: data.path, entries: data.entries ?? [] };
}

async function fetchGitInfo(dirPath: string): Promise<GitInfo> {
  const res = await fetch(`/api/fs/git-info?path=${encodeURIComponent(dirPath)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function apiCreate(filePath: string, type: 'file' | 'directory') {
  const res = await fetch('/api/fs/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Create failed');
  return data;
}

async function apiRename(oldPath: string, newPath: string) {
  const res = await fetch('/api/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Rename failed');
  return data;
}

async function apiDelete(filePath: string, force = false) {
  const res = await fetch(`/api/fs/delete${force ? '?force=true' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Delete failed');
  return data;
}

async function apiReadFile(filePath: string): Promise<{ path: string; content: string }> {
  const res = await fetch(`/api/fs/read-file?path=${encodeURIComponent(filePath)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Read failed');
  return data;
}

async function apiOpenFile(filePath: string) {
  const electron = (window as Window & { electron?: { openFile: (p: string) => Promise<{ ok?: boolean; error?: string }> } }).electron;
  if (electron?.openFile) {
    const result = await electron.openFile(filePath);
    if (result?.error) throw new Error(result.error);
    return;
  }
  const res = await fetch('/api/fs/open-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Open failed');
}

// ── Tree mutation helpers ──

function updateNodeInTree(nodes: TreeNode[], targetPath: string, updater: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) return updater(node);
    if (node.children) return { ...node, children: updateNodeInTree(node.children, targetPath, updater) };
    return node;
  });
}

function addChildToTree(nodes: TreeNode[], parentPath: string, child: TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === parentPath) {
      const existing = node.children ?? [];
      const merged = [...existing, child].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      return { ...node, children: merged, expanded: true, loaded: true };
    }
    if (node.children) return { ...node, children: addChildToTree(node.children, parentPath, child) };
    return node;
  });
}

function removeNodeFromTree(nodes: TreeNode[], targetPath: string): TreeNode[] {
  return nodes.filter((n) => n.path !== targetPath).map((n) => {
    if (n.children) return { ...n, children: removeNodeFromTree(n.children, targetPath) };
    return n;
  });
}

// ── Path separator helper ──
function pathJoin(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? base + name : base + sep + name;
}

function pathDirname(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const i = p.lastIndexOf(sep);
  return i > 0 ? p.slice(0, i) : p;
}

// ══════════════════════════════════════════
// ─── MAIN COMPONENT ───
// ══════════════════════════════════════════

export function FolderExplorerPanel({
  onClose,
  onInsertPath,
  initialPath,
  embedded = false,
}: FolderExplorerPanelProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // File preview
  const [viewingFile, setViewingFile] = useState<{
    path: string;
    name: string;
    content: string | null;
    previewError?: string | null;
  } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedView, setExpandedView] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Inline input (new file / folder / rename)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null);

  // Multi-select
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const closePreview = useCallback(() => {
    setViewingFile(null);
    setExpandedView(false);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      } else {
        // Close on any click
        setContextMenu(null);
      }
    };
    // Use setTimeout to avoid closing immediately
    const timer = setTimeout(() => {
      window.addEventListener('click', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handler);
    };
  }, [contextMenu]);

  // Close expanded file preview on Escape
  useEffect(() => {
    if (!expandedView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePreview, expandedView]);

  // ── Load directory ──
  const loadRoot = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    setSelectedPaths(new Set());
    try {
      const { entries } = await fetchDir(dirPath);
      setRootPath(dirPath);
      setTree(entries.map((e) => ({
        name: e.name, path: e.path, isDirectory: e.isDirectory,
        expanded: false, loaded: false,
      })));
      // Load git info in parallel
      fetchGitInfo(dirPath).then(setGitInfo).catch(() => setGitInfo(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-open initialPath
  useEffect(() => {
    if (initialPath) loadRoot(initialPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  // ── Expand/collapse directory ──
  const handleExpand = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory) return;
    if (node.loaded && node.children) {
      setTree((prev) => updateNodeInTree(prev, node.path, (n) => ({ ...n, expanded: !n.expanded })));
      return;
    }
    if (node.loading) return;

    setTree((prev) => updateNodeInTree(prev, node.path, (n) => ({ ...n, loading: true })));
    try {
      const { entries } = await fetchDir(node.path);
      const children = entries.map((e) => ({
        name: e.name, path: e.path, isDirectory: e.isDirectory,
        expanded: false, loaded: false,
      }));
      setTree((prev) => updateNodeInTree(prev, node.path, (n) => ({
        ...n, children, loaded: true, loading: false, expanded: true,
      })));
    } catch {
      setTree((prev) => updateNodeInTree(prev, node.path, (n) => ({ ...n, loading: false })));
    }
  }, []);

  // ── File preview ──
  const handlePreviewFile = useCallback(async (filePath: string, fileName: string) => {
    setFileLoading(true);
    setError(null);
    try {
      const data = await apiReadFile(filePath);
      setViewingFile({
        path: data.path,
        name: fileName,
        content: data.content,
        previewError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Read failed';
      setViewingFile({
        path: filePath,
        name: fileName,
        content: null,
        previewError: message,
      });
    } finally {
      if (embedded) {
        setExpandedView(true);
      }
      setFileLoading(false);
    }
  }, [embedded]);

  // ── Go up ──
  const handleGoUp = useCallback(() => {
    if (!rootPath) return;
    const parent = pathDirname(rootPath);
    if (parent.length < 2 || parent === rootPath) return;
    loadRoot(parent);
  }, [rootPath, loadRoot]);

  // ── Refresh ──
  const handleRefresh = useCallback(() => {
    if (rootPath) loadRoot(rootPath);
  }, [rootPath, loadRoot]);

  // ── Open folder dialog ──
  const handleOpenFolder = useCallback(async () => {
    const electron = (window as Window & { electron?: { openFolderDialog: () => Promise<string | null> } }).electron;
    if (electron?.openFolderDialog) {
      try {
        const selected = await electron.openFolderDialog();
        if (selected?.trim()) await loadRoot(selected.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
      return;
    }
    setError('Please type or paste a folder path above');
  }, [loadRoot]);

  // ── Context menu actions ──
  const handleContextMenuAction = useCallback(async (action: string, node: TreeNode) => {
    setContextMenu(null);
    switch (action) {
      case 'reference':
        onInsertPath?.(node.path);
        break;
      case 'copy-path':
        navigator.clipboard.writeText(node.path);
        break;
      case 'new-file':
        setInlineInput({
          type: 'new-file',
          parentPath: node.isDirectory ? node.path : pathDirname(node.path),
        });
        // Ensure parent is expanded
        if (node.isDirectory && !node.expanded) {
          handleExpand(node);
        }
        break;
      case 'new-folder':
        setInlineInput({
          type: 'new-folder',
          parentPath: node.isDirectory ? node.path : pathDirname(node.path),
        });
        if (node.isDirectory && !node.expanded) {
          handleExpand(node);
        }
        break;
      case 'rename':
        setInlineInput({
          type: 'rename',
          parentPath: pathDirname(node.path),
          existingName: node.name,
          existingPath: node.path,
        });
        break;
      case 'delete':
        setDeleteConfirm({ path: node.path, name: node.name, isDir: node.isDirectory });
        break;
      case 'open-external':
        try { await apiOpenFile(node.path); } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed');
        }
        break;
      case 'preview':
        if (!node.isDirectory) handlePreviewFile(node.path, node.name);
        break;
    }
  }, [onInsertPath, handleExpand, handlePreviewFile]);

  // ── Inline input submit ──
  const handleInlineSubmit = useCallback(async (name: string) => {
    if (!inlineInput || !name.trim()) { setInlineInput(null); return; }
    const trimmed = name.trim();
    try {
      if (inlineInput.type === 'rename' && inlineInput.existingPath) {
        const newPath = pathJoin(inlineInput.parentPath, trimmed);
        await apiRename(inlineInput.existingPath, newPath);
        // Update tree: remove old, add new
        setTree((prev) => {
          const removed = removeNodeFromTree(prev, inlineInput.existingPath!);
          const newNode: TreeNode = {
            name: trimmed,
            path: newPath,
            isDirectory: false, // will be corrected below
            expanded: false,
            loaded: false,
          };
          // Try to find the old node to preserve isDirectory
          const findNode = (nodes: TreeNode[], p: string): TreeNode | null => {
            for (const n of nodes) {
              if (n.path === p) return n;
              if (n.children) { const found = findNode(n.children, p); if (found) return found; }
            }
            return null;
          };
          const oldNode = findNode(prev, inlineInput.existingPath!);
          if (oldNode) {
            newNode.isDirectory = oldNode.isDirectory;
            newNode.children = oldNode.children;
            newNode.loaded = oldNode.loaded;
            newNode.expanded = oldNode.expanded;
          }
          return addChildToTree(removed, inlineInput.parentPath, newNode);
        });
      } else {
        const isDir = inlineInput.type === 'new-folder';
        const newPath = pathJoin(inlineInput.parentPath, trimmed);
        await apiCreate(newPath, isDir ? 'directory' : 'file');
        const newNode: TreeNode = {
          name: trimmed, path: newPath, isDirectory: isDir,
          expanded: false, loaded: isDir, children: isDir ? [] : undefined,
        };
        // If parentPath === rootPath, add to root level
        if (inlineInput.parentPath === rootPath) {
          setTree((prev) => {
            const merged = [...prev, newNode].sort((a, b) => {
              if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
              return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            return merged;
          });
        } else {
          setTree((prev) => addChildToTree(prev, inlineInput.parentPath, newNode));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    }
    setInlineInput(null);
  }, [inlineInput, rootPath]);

  // ── Delete confirm ──
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await apiDelete(deleteConfirm.path, deleteConfirm.isDir);
      setTree((prev) => removeNodeFromTree(prev, deleteConfirm.path));
      setSelectedPaths((prev) => { const next = new Set(prev); next.delete(deleteConfirm.path); return next; });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
    setDeleteConfirm(null);
  }, [deleteConfirm]);

  // ── Selection ──
  const handleSelect = useCallback((path: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      });
    } else {
      setSelectedPaths(new Set([path]));
    }
  }, []);

  // ── Keyboard shortcut in panel ──
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' && selectedPaths.size === 1) {
      const path = [...selectedPaths][0];
      const findNode = (nodes: TreeNode[], p: string): TreeNode | null => {
        for (const n of nodes) {
          if (n.path === p) return n;
          if (n.children) { const found = findNode(n.children, p); if (found) return found; }
        }
        return null;
      };
      const node = findNode(tree, path);
      if (node) setDeleteConfirm({ path: node.path, name: node.name, isDir: node.isDirectory });
    }
    if (e.key === 'F2' && selectedPaths.size === 1) {
      const path = [...selectedPaths][0];
      const findNode = (nodes: TreeNode[], p: string): TreeNode | null => {
        for (const n of nodes) {
          if (n.path === p) return n;
          if (n.children) { const found = findNode(n.children, p); if (found) return found; }
        }
        return null;
      };
      const node = findNode(tree, path);
      if (node) {
        setInlineInput({
          type: 'rename',
          parentPath: pathDirname(node.path),
          existingName: node.name,
          existingPath: node.path,
        });
      }
    }
  }, [selectedPaths, tree]);

  // ══════════════════════════════════════════
  // ─── INLINE INPUT COMPONENT ───
  // ══════════════════════════════════════════

  function InlineNameInput({ initialValue, onSubmit, onCancel }: {
    initialValue: string;
    onSubmit: (v: string) => void;
    onCancel: () => void;
  }) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, []);
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(value); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => onSubmit(value)}
        className="w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs outline-none dark:border-blue-600 dark:bg-zinc-800"
        autoComplete="off"
        spellCheck={false}
      />
    );
  }

  // ══════════════════════════════════════════
  // ─── TREE ITEM COMPONENT ───
  // ══════════════════════════════════════════

  function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
    const isDir = node.isDirectory;
    const isExpanded = node.expanded && isDir;
    const isSelected = selectedPaths.has(node.path);
    const isRenaming = inlineInput?.type === 'rename' && inlineInput.existingPath === node.path;
    const indent = depth * 16;

    return (
      <div className="select-none">
        <div
          className={`group flex items-center gap-0.5 rounded px-1 py-[3px] text-xs cursor-pointer transition-colors
            ${isSelected
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
            }`}
          style={{ paddingLeft: indent + 4 }}
          onClick={(e) => {
            handleSelect(node.path, e);
            if (!e.ctrlKey && !e.metaKey) {
              if (isDir) handleExpand(node);
              else handlePreviewFile(node.path, node.name);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, node });
          }}
        >
          {/* Expand chevron */}
          {isDir ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {node.loading ? (
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
              ) : isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
              )}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {/* Icon */}
          {isDir ? (
            isExpanded
              ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
              : <Folder className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          ) : (
            <FileTypeIcon filename={node.name} className="h-4 w-4" />
          )}

          {/* Name or rename input */}
          {isRenaming ? (
            <div className="ml-1 min-w-0 flex-1">
              <InlineNameInput
                initialValue={node.name}
                onSubmit={(v) => handleInlineSubmit(v)}
                onCancel={() => setInlineInput(null)}
              />
            </div>
          ) : (
            <span className="ml-1 min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
              {node.name}
            </span>
          )}

          {/* Hover action buttons */}
          {!isRenaming && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {onInsertPath && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onInsertPath(node.path); }}
                  className="rounded p-0.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                  title="@引用到对话"
                >
                  <AtSign className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(node.path); }}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                title="Copy path"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Children */}
        {isExpanded && node.children && (
          <div>
            {/* Inline input for new file/folder inside this dir */}
            {inlineInput && (inlineInput.type === 'new-file' || inlineInput.type === 'new-folder') && inlineInput.parentPath === node.path && (
              <div className="flex items-center gap-1 px-1 py-[3px]" style={{ paddingLeft: (depth + 1) * 16 + 4 }}>
                <span className="w-4 shrink-0" />
                {inlineInput.type === 'new-folder'
                  ? <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  : <FilePlus className="h-4 w-4 shrink-0 text-zinc-400" />
                }
                <div className="ml-1 min-w-0 flex-1">
                  <InlineNameInput
                    initialValue=""
                    onSubmit={(v) => handleInlineSubmit(v)}
                    onCancel={() => setInlineInput(null)}
                  />
                </div>
              </div>
            )}
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} />
            ))}
            {node.children.length === 0 && !inlineInput && (
              <div className="py-0.5 text-[11px] italic text-zinc-400" style={{ paddingLeft: (depth + 1) * 16 + 24 }}>
                Empty
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════
  // ─── CONTEXT MENU ───
  // ══════════════════════════════════════════

  const contextMenuEl = contextMenu && (
    <div
      className="fixed z-[100] min-w-[180px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onInsertPath && (
        <ContextMenuItem
          icon={AtSign} label="@引用到对话" shortcut=""
          onClick={() => handleContextMenuAction('reference', contextMenu.node)}
        />
      )}
      {!contextMenu.node.isDirectory && (
        <ContextMenuItem
          icon={FileText} label="Preview" shortcut=""
          onClick={() => handleContextMenuAction('preview', contextMenu.node)}
        />
      )}
      <ContextMenuItem
        icon={ExternalLink} label="Open in System" shortcut=""
        onClick={() => handleContextMenuAction('open-external', contextMenu.node)}
      />
      <ContextMenuItem
        icon={Copy} label="Copy Path" shortcut=""
        onClick={() => handleContextMenuAction('copy-path', contextMenu.node)}
      />
      <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
      <ContextMenuItem
        icon={FilePlus} label="New File" shortcut=""
        onClick={() => handleContextMenuAction('new-file', contextMenu.node)}
      />
      <ContextMenuItem
        icon={FolderPlus} label="New Folder" shortcut=""
        onClick={() => handleContextMenuAction('new-folder', contextMenu.node)}
      />
      <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
      <ContextMenuItem
        icon={Pencil} label="Rename" shortcut="F2"
        onClick={() => handleContextMenuAction('rename', contextMenu.node)}
      />
      <ContextMenuItem
        icon={Trash2} label="Delete" shortcut="Del" danger
        onClick={() => handleContextMenuAction('delete', contextMenu.node)}
      />
    </div>
  );

  // ══════════════════════════════════════════
  // ─── DELETE DIALOG ───
  // ══════════════════════════════════════════

  const deleteDialog = deleteConfirm && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
      <div className="w-80 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-800" onClick={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          Delete <span className="font-medium">{deleteConfirm.name}</span>?
          {deleteConfirm.isDir && ' (and all contents)'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDeleteConfirm(null)}
            className="rounded px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDeleteConfirm}
            className="rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  const embeddedPreviewDialog = embedded && expandedView && viewingFile && (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/38 p-5 backdrop-blur-[2px]" onClick={closePreview}>
      <div
        className="flex h-[min(88vh,900px)] w-[min(92vw,1240px)] flex-col overflow-hidden rounded-[28px] border border-[#e6ddcf] bg-[#fffdfa] shadow-[0_32px_120px_rgba(15,23,42,0.20)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#ece4d6] px-6 py-5">
          <div className="min-w-0 flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4e8d8] text-[#d97745]">
              <FileTypeIcon filename={viewingFile.name} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="truncate text-lg font-semibold text-slate-900">{viewingFile.name}</div>
              </div>
              <div className="mt-1 truncate text-sm text-[#8c7d68]" title={viewingFile.path}>
                {viewingFile.path}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                try {
                  await apiOpenFile(viewingFile.path);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Open failed');
                }
              }}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#171312] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2b2421]"
            >
              <Pencil className="h-4 w-4" />
              编辑
            </button>
            <button
              type="button"
              onClick={closePreview}
              className="rounded-2xl border border-[#d8ccbb] bg-[#f3ede3] px-4 py-2 text-sm font-semibold text-[#493f32] transition-colors hover:bg-[#ece3d6]"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#fffdfa]">
          {viewingFile.previewError ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="w-full max-w-xl rounded-3xl border border-[#eadfd0] bg-white px-6 py-8 text-center shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
                <div className="text-base font-semibold text-slate-900">
                  Unsupported file type for preview
                </div>
                <div className="mt-2 text-sm text-[#8c7d68]">
                  {viewingFile.previewError}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-max border-t border-[#f4ede2] bg-[#fffdfa] px-0 py-6">
              <pre className="overflow-auto px-6 font-mono text-[13px] leading-8 text-slate-700">
                {viewingFile.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════
  // ─── FILE PREVIEW ───
  // ══════════════════════════════════════════

  if (viewingFile && !embedded) {
    return (
      <div
        ref={panelRef}
        className={`flex h-full flex-col bg-white dark:bg-zinc-950 ${
          embedded ? '' : 'border-l border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={closePreview}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <FileTypeIcon filename={viewingFile.name} className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400" title={viewingFile.path}>
            {viewingFile.name}
          </span>
          <div className="flex items-center gap-0.5">
            {onInsertPath && (
              <button
                type="button"
                onClick={() => onInsertPath(viewingFile.path)}
                className="rounded p-0.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                title="@引用到对话"
              >
                <AtSign className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpandedView(true)}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="Expand"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(viewingFile.path)}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="Copy path"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
        {viewingFile.previewError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {viewingFile.previewError}
            </div>
          </div>
        ) : (
          <pre className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {viewingFile.content}
          </pre>
        )}
        {expandedView && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePreview}>
            <div className="flex max-h-[90vh] max-w-[90vw] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <FileTypeIcon filename={viewingFile.name} className="h-4 w-4" />
                  <span className="truncate font-mono text-sm text-zinc-700 dark:text-zinc-300">{viewingFile.name}</span>
                </div>
                <button type="button" onClick={closePreview} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {viewingFile.previewError ? (
                <div className="flex min-h-[240px] items-center justify-center p-6 text-center">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {viewingFile.previewError}
                  </div>
                </div>
              ) : (
                <pre className="max-h-[80vh] flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {viewingFile.content}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════
  // ─── MAIN PANEL ───
  // ══════════════════════════════════════════

  return (
    <div
      ref={panelRef}
      className={`flex h-full flex-col bg-white dark:bg-zinc-950 ${
        embedded ? '' : 'border-l border-zinc-200 dark:border-zinc-800'
      }`}
      tabIndex={0}
      onKeyDown={handlePanelKeyDown}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Workspace</span>
          </div>
          <div className="flex items-center gap-1">
            {rootPath && (
              <>
                <button type="button" onClick={handleRefresh} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInlineInput({ type: 'new-file', parentPath: rootPath });
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="New File"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInlineInput({ type: 'new-folder', parentPath: rootPath });
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="New Folder"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Path input area (only when no root loaded) */}
      {!rootPath && (
        <div className="space-y-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pathInput.trim() && loadRoot(pathInput.trim())}
              placeholder="Paste folder path..."
              className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => pathInput.trim() && loadRoot(pathInput.trim())}
              disabled={loading || !pathInput.trim()}
              className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Open
            </button>
          </div>
          <button
            type="button"
            onClick={handleOpenFolder}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-zinc-200 py-2 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Select Folder
          </button>
        </div>
      )}

      {/* Project info */}
      {rootPath && gitInfo && (
        <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {embedded ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <FolderOpen className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                {gitInfo.folderName}
              </span>
              {gitInfo.hasGit && gitInfo.branch && (
                <span className="flex shrink-0 items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {gitInfo.branch}
                </span>
              )}
              <span className="shrink-0">{gitInfo.dirCount} dirs, {gitInfo.fileCount} files</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
                <FolderOpen className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {gitInfo.folderName}
                  </span>
                  <button type="button" onClick={handleGoUp} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Go up">
                    <ArrowUp className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {gitInfo.hasGit && gitInfo.branch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {gitInfo.branch}
                    </span>
                  )}
                  <span>{gitInfo.dirCount} dirs, {gitInfo.fileCount} files</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-amber-500 hover:text-amber-700">&times;</button>
        </div>
      )}

      {/* Tree area */}
      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : fileLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : tree.length === 0 && !rootPath ? (
          <div className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
            <FolderOpen className="mx-auto mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p>Open a folder to browse files</p>
          </div>
        ) : (
          <div className="py-1">
            {/* Root-level inline input for new file/folder */}
            {inlineInput && (inlineInput.type === 'new-file' || inlineInput.type === 'new-folder') && inlineInput.parentPath === rootPath && (
              <div className="flex items-center gap-1 px-1 py-[3px]" style={{ paddingLeft: 4 }}>
                <span className="w-4 shrink-0" />
                {inlineInput.type === 'new-folder'
                  ? <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  : <FilePlus className="h-4 w-4 shrink-0 text-zinc-400" />
                }
                <div className="ml-1 min-w-0 flex-1">
                  <InlineNameInput
                    initialValue=""
                    onSubmit={(v) => handleInlineSubmit(v)}
                    onCancel={() => setInlineInput(null)}
                  />
                </div>
              </div>
            )}
            {tree.map((node) => (
              <TreeItem key={node.path} node={node} depth={0} />
            ))}
            {tree.length === 0 && rootPath && (
              <div className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">Empty directory</div>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenuEl}

      {/* Delete confirmation dialog */}
      {deleteDialog}

      {/* Embedded preview dialog */}
      {embeddedPreviewDialog}
    </div>
  );
}

// ── Context Menu Item ──

function ContextMenuItem({
  icon: Icon, label, shortcut, onClick, danger,
}: {
  icon: typeof AtSign;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-zinc-400">{shortcut}</span>}
    </button>
  );
}
