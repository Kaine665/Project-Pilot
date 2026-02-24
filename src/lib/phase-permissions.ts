import type { SessionPhase } from '@/types';

/**
 * 根据 Session 当前 phase 决定 Claude CLI 的权限参数。
 *
 * - understanding（Phase 1-2）：不传 --dangerously-skip-permissions，
 *   -p 模式下无交互审批，所有工具自动被拒。AI 只能纯文本对话。
 * - planning / executing / summarizing（Phase 3-5）：
 *   传 --dangerously-skip-permissions，完整工具权限。
 */
export function getClaudeArgsForPhase(phase: SessionPhase | undefined): string[] {
  const effective = phase ?? 'understanding';

  switch (effective) {
    case 'branching':
    case 'understanding':
      return [];
    case 'planning':
    case 'executing':
    case 'summarizing':
      return ['--dangerously-skip-permissions'];
    default:
      return [];
  }
}
