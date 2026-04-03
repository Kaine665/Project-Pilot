import { replaceAgentChatManagerForDataRootSwitch } from '@/lib/chat-managers/agent-chat-manager';
import { replaceSchedulerManagerForDataRootSwitch } from '@/lib/scheduler-manager';
import { replaceEventTriggerManagerForDataRootSwitch } from '@/lib/event-trigger-manager';

let _lastBoundDataRoot: string | null = null;
let _managerGeneration = 0;

export function getDataRootManagerGeneration(): number {
  return _managerGeneration;
}

/**
 * 进程内数据根变化时重建有状态单例（调度器、事件触发、Agent 内存会话），避免跨账号串数据。
 */
export async function ensureManagersAlignedWithDataRoot(currentRoot: string): Promise<void> {
  if (_lastBoundDataRoot === currentRoot) return;
  _lastBoundDataRoot = currentRoot;
  _managerGeneration += 1;
  replaceAgentChatManagerForDataRootSwitch();
  await replaceSchedulerManagerForDataRootSwitch();
  await replaceEventTriggerManagerForDataRootSwitch();
}

/** 供测试或特殊场景重置（一般无需调用）。 */
export function resetBoundDataRootForTests(): void {
  _lastBoundDataRoot = null;
}
