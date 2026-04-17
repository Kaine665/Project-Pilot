/**
 * 浏览器内通知：磁盘上项目/工作区文件可能被 Agent 工具（Bash、Write 等）修改，
 * 侧栏文件树等非发起方 UI 可监听并重新拉取目录列表。
 */
export const PP_FILESYSTEM_MUTATED = 'pp:filesystem-mutated';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 合并短时间内的多次通知（同一轮里多个工具依次结束）为一次刷新。 */
export function notifyFilesystemMutatedDebounced(delayMs = 400): void {
  if (typeof window === 'undefined') return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    window.dispatchEvent(new CustomEvent(PP_FILESYSTEM_MUTATED));
  }, delayMs);
}

/** 工具名不区分大小写；涵盖常见 Claude / Codex 等写入路径。 */
export function toolMayMutateWorkspaceFiles(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const n = toolName.trim().toLowerCase();
  return (
    n === 'write'
    || n === 'edit'
    || n === 'multiedit'
    || n === 'strreplace'
    || n === 'apply_patch'
    || n === 'applypatch'
    || n === 'notebookedit'
    || n === 'bash'
    || n === 'delete'
    || n === 'move'
    || n === 'copy'
    || n === 'run_terminal_cmd'
    || n === 'execute'
  );
}
