import { Hono } from 'hono';
import { promises as fs } from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { isValidProjectKey, isValidWorkingDir } from '@/lib/security';
import { getDataDir, readProjectIndex } from '@/lib/file-store';

const execAsync = promisify(exec);

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const MAX_SIZE = 512 * 1024; // 512KB

/** True if `resolved` is `root` or a subdirectory of `root` (after normalization). */
function isPathInsideRoot(root: string, resolved: string): boolean {
  const r = path.normalize(root);
  const p = path.normalize(resolved);
  if (process.platform === 'win32') {
    const rl = r.replace(/[/\\]+$/, '').toLowerCase();
    const pl = p.toLowerCase();
    return pl === rl || pl.startsWith(`${rl}\\`);
  }
  const rel = path.relative(r, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Agent 私有工作区：<dataRoot>/agents/workspaces 及其子路径（见 ~/.project-pilot/agents/README.md；缺失时可自动创建）。
 * 用 POSIX 风格匹配相对路径，避免 Windows 下 path.sep 与 path.relative 混用导致误判、跳过 mkdir。
 */
function isAgentsWorkspaceSubtree(dataRoot: string, resolved: string): boolean {
  if (!isPathInsideRoot(dataRoot, resolved)) return false;
  const rel = path.normalize(path.relative(dataRoot, resolved)).replace(/\\/g, '/');
  return rel === 'agents/workspaces' || /^agents\/workspaces(\/|$)/.test(rel);
}

/** 是否为某一 Agent 的工作区根：agents/workspaces/<agentId>（不含更深子路径） */
function isAgentWorkspaceAgentRoot(dataRoot: string, resolved: string): boolean {
  if (!isPathInsideRoot(dataRoot, resolved)) return false;
  const rel = path.normalize(path.relative(dataRoot, resolved)).replace(/\\/g, '/');
  const parts = rel.split('/').filter(Boolean);
  return (
    parts.length === 3
    && parts[0] === 'agents'
    && parts[1] === 'workspaces'
    && parts[2].length > 0
  );
}

const TEXT_EXT = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'env', 'ini', 'cfg', 'conf', 'toml', 'log',
]);

// ---------------------------------------------------------------------------
// GET /list-dir — 列出指定目录下的文件和子目录
// ---------------------------------------------------------------------------

app.get('/list-dir', async (c) => {
  const pathParam = c.req.query('path');
  const resolveMode = c.req.query('resolve');
  if (!pathParam || typeof pathParam !== 'string') {
    return c.json({ error: 'path is required' }, 400);
  }

  try {
    const decoded = decodeURIComponent(pathParam).trim();
    if (!decoded) {
      return c.json({ error: 'path is required' }, 400);
    }

    const dataRoot = path.normalize(getDataDir());
    const resolved = resolveMode === 'data'
      ? path.normalize(path.resolve(dataRoot, decoded))
      : path.normalize(path.resolve(decoded));

    if (!isValidWorkingDir(resolved)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    if (resolveMode === 'data' && !isPathInsideRoot(dataRoot, resolved)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch (statErr) {
      const code = (statErr as NodeJS.ErrnoException)?.code;
      const enoent = code === 'ENOENT';
      if (enoent && resolveMode === 'data' && isAgentsWorkspaceSubtree(dataRoot, resolved)) {
        await fs.mkdir(resolved, { recursive: true });
        stat = await fs.stat(resolved);
      } else {
        throw statErr;
      }
    }

    if (!stat.isDirectory()) {
      return c.json({ error: 'Path is not a directory' }, 400);
    }

    // 与其它 Agent 工作区一致：根目录下默认有 data/（历史 UI 与 bash 白名单习惯）
    if (resolveMode === 'data' && isAgentWorkspaceAgentRoot(dataRoot, resolved)) {
      await fs.mkdir(path.join(resolved, 'data'), { recursive: true });
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const result: DirEntry[] = [];

    for (const ent of entries) {
      const fullPath = path.join(resolved, ent.name);
      if (!isValidWorkingDir(fullPath)) continue;
      result.push({
        name: ent.name,
        path: fullPath,
        isDirectory: ent.isDirectory(),
      });
    }

    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return c.json({ path: resolved, entries: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errCode = (err as NodeJS.ErrnoException)?.code;
    const attempted = pathParam
      ? (resolveMode === 'data'
          ? path.normalize(path.resolve(getDataDir(), decodeURIComponent(pathParam).trim()))
          : path.normalize(path.resolve(decodeURIComponent(pathParam).trim())))
      : '';
    if (errCode === 'ENOENT' || msg.includes('ENOENT')) {
      return c.json(
        { error: 'Directory not found', attempted: process.env.NODE_ENV === 'development' ? attempted : undefined },
        404,
      );
    }
    if (msg.includes('EACCES') || msg.includes('EPERM')) {
      return c.json({ error: 'Access denied' }, 403);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /read-file — 读取文本文件内容
// ---------------------------------------------------------------------------

app.get('/read-file', async (c) => {
  const pathParam = c.req.query('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return c.json({ error: 'path is required' }, 400);
  }

  const decoded = decodeURIComponent(pathParam).trim();
  const resolveMode = c.req.query('resolve');
  const projectKeyParam = c.req.query('projectKey');

  let resolved: string;
  if (resolveMode === 'project') {
    if (!projectKeyParam || typeof projectKeyParam !== 'string' || !isValidProjectKey(projectKeyParam)) {
      return c.json({ error: 'Valid projectKey is required for resolve=project' }, 400);
    }
    let root: string;
    try {
      const index = await readProjectIndex();
      const proj = index.projects.find((p) => p.key === projectKeyParam);
      if (!proj?.path || typeof proj.path !== 'string') {
        return c.json({ error: 'Project not found' }, 404);
      }
      root = path.normalize(path.resolve(proj.path.trim()));
    } catch {
      return c.json({ error: 'Project not found' }, 404);
    }
    if (!isValidWorkingDir(root)) {
      return c.json({ error: 'Invalid project path' }, 400);
    }
    const decodedNorm = decoded.replace(/\\/g, '/');
    const looksAbsolute =
      /^[a-zA-Z]:\//.test(decodedNorm)
      || decodedNorm.startsWith('/')
      || decodedNorm.startsWith('\\\\');
    const candidate = looksAbsolute
      ? path.normalize(path.resolve(decoded))
      : path.normalize(path.resolve(root, decoded));
    if (!isPathInsideRoot(root, candidate)) {
      return c.json({ error: 'Path escapes project root' }, 400);
    }
    resolved = candidate;
  } else if (resolveMode === 'data') {
    resolved = path.normalize(path.resolve(getDataDir(), decoded));
  } else {
    resolved = path.normalize(path.resolve(decoded));
  }

  try {
    if (!isValidWorkingDir(resolved)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return c.json({ error: 'Path is a directory' }, 400);
    }
    if (stat.size > MAX_SIZE) {
      return c.json({ error: `File too large (max ${MAX_SIZE / 1024}KB)` }, 400);
    }

    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (!TEXT_EXT.has(ext) && ext !== '') {
      return c.json({ error: 'Unsupported file type for preview' }, 400);
    }

    const content = await fs.readFile(resolved, 'utf-8');
    return c.json({ path: resolved, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return c.json({ error: 'File not found' }, 404);
    }
    if (msg.includes('EACCES') || msg.includes('EPERM')) {
      return c.json({ error: 'Access denied' }, 403);
    }
    if (msg.includes('invalid') && msg.toLowerCase().includes('encoding')) {
      return c.json({ error: 'File is not valid UTF-8 text' }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /open-file — 用系统默认应用打开文件
// ---------------------------------------------------------------------------

app.post('/open-file', async (c) => {
  let body: { path?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const pathParam = body?.path;
  if (!pathParam || typeof pathParam !== 'string') {
    return c.json({ error: 'path is required' }, 400);
  }

  const decoded = pathParam.trim();
  const resolved = path.normalize(path.resolve(decoded));

  if (!isValidWorkingDir(resolved)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  try {
    const platform = process.platform;
    const escaped = resolved.replace(/"/g, '\\"');
    let cmd: string;
    if (platform === 'win32') {
      cmd = `start "" "${escaped}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${escaped}"`;
    } else {
      cmd = `xdg-open "${escaped}"`;
    }
    await execAsync(cmd, { windowsHide: true });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /create — Create a new file or directory
// ---------------------------------------------------------------------------

app.post('/create', async (c) => {
  let body: { path?: string; type?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const filePath = body?.path?.trim();
  const fileType = body?.type;
  if (!filePath) {
    return c.json({ error: 'path is required' }, 400);
  }
  if (fileType !== 'file' && fileType !== 'directory') {
    return c.json({ error: 'type must be "file" or "directory"' }, 400);
  }

  const resolved = path.normalize(path.resolve(filePath));
  if (!isValidWorkingDir(resolved)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  try {
    try {
      await fs.stat(resolved);
      return c.json({ error: 'Path already exists' }, 409);
    } catch {
      // OK — doesn't exist yet
    }

    if (fileType === 'directory') {
      await fs.mkdir(resolved, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, '', 'utf-8');
    }

    return c.json({ ok: true, path: resolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /delete — Delete a file or directory
// ---------------------------------------------------------------------------

app.post('/delete', async (c) => {
  let body: { path?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const filePath = body?.path?.trim();
  if (!filePath) {
    return c.json({ error: 'path is required' }, 400);
  }

  const resolved = path.normalize(path.resolve(filePath));
  if (!isValidWorkingDir(resolved)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const force = c.req.query('force') === 'true';

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      if (force) {
        await fs.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.rmdir(resolved);
      }
    } else {
      await fs.unlink(resolved);
    }
    return c.json({ ok: true, path: resolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return c.json({ error: 'Path not found' }, 404);
    }
    if (msg.includes('ENOTEMPTY')) {
      return c.json({ error: 'Directory is not empty. Use force=true to delete recursively.' }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rename — Rename/move a file or directory
// ---------------------------------------------------------------------------

app.post('/rename', async (c) => {
  let body: { oldPath?: string; newPath?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const oldPath = body?.oldPath?.trim();
  const newPath = body?.newPath?.trim();
  if (!oldPath || !newPath) {
    return c.json({ error: 'oldPath and newPath are required' }, 400);
  }

  const resolvedOld = path.normalize(path.resolve(oldPath));
  const resolvedNew = path.normalize(path.resolve(newPath));

  if (!isValidWorkingDir(resolvedOld) || !isValidWorkingDir(resolvedNew)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  try {
    await fs.rename(resolvedOld, resolvedNew);
    return c.json({ ok: true, oldPath: resolvedOld, newPath: resolvedNew });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return c.json({ error: 'Source path not found' }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /git-info — Returns git branch name and file count for a project directory
// ---------------------------------------------------------------------------

app.get('/git-info', async (c) => {
  const pathParam = c.req.query('path');
  if (!pathParam) {
    return c.json({ error: 'path is required' }, 400);
  }

  const resolved = path.normalize(path.resolve(decodeURIComponent(pathParam).trim()));
  if (!isValidWorkingDir(resolved)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  let branch: string | null = null;
  let hasGit = false;

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: resolved,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    hasGit = true;
  } catch {
    // Not a git repo
  }

  let fileCount = 0;
  let dirCount = 0;
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      if (ent.isDirectory()) dirCount++;
      else fileCount++;
    }
  } catch {
    // ignore
  }

  const folderName = path.basename(resolved);

  return c.json({
    path: resolved,
    folderName,
    branch,
    hasGit,
    fileCount,
    dirCount,
  });
});

// ---------------------------------------------------------------------------
// POST /api/fs/pick-folder — 后端调系统选文件夹对话框（PowerShell / zenity）
// 适用于非 Electron 环境（浏览器直接访问 Vite 时没有 window.electron）
// ---------------------------------------------------------------------------

app.post('/pick-folder', async (c) => {
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select project folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`,
        { timeout: 120_000, windowsHide: false },
      );
      const folder = stdout.trim();
      if (!folder) return c.json({ path: null });
      return c.json({ path: folder });
    }
    // macOS / Linux — zenity or osascript
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select project folder")'`,
        { timeout: 120_000 },
      );
      const folder = stdout.trim();
      return c.json({ path: folder || null });
    }
    // Linux fallback
    try {
      const { stdout } = await execAsync('zenity --file-selection --directory --title="Select project folder"', { timeout: 120_000 });
      return c.json({ path: stdout.trim() || null });
    } catch {
      return c.json({ path: null, error: 'no dialog available' });
    }
  } catch (err) {
    return c.json({ path: null, error: String(err) });
  }
});

export default app;
