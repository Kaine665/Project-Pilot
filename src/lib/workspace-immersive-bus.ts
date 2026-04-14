/** Agents 简单浏览器等工作区铺满时，通知 `WorkspaceShell` 隐藏顶栏与左侧栏 */
export const PP_WORKSPACE_IMMERSIVE_EVENT = 'pp:workspace-immersive' as const;

export type WorkspaceImmersiveDetail = { immersive: boolean };

export function dispatchWorkspaceImmersive(immersive: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceImmersiveDetail>(PP_WORKSPACE_IMMERSIVE_EVENT, {
      detail: { immersive },
    }),
  );
}
