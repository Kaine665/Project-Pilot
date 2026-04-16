import { isValidProjectKey } from '@/lib/security-validation';

/**
 * 数据根下「工作资料」目录相对路径（`resolve=data`），与 `agents/workspaces/<agentId>` 并列：
 * `projects/workspaces/<projectKey>`。
 */
export function getProjectWorkMaterialsRelativePath(projectKey: string): string {
  if (!isValidProjectKey(projectKey)) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  return `projects/workspaces/${projectKey}`;
}
