/**
 * Distiller v0 — 会话结束后提炼知识 / 待办。
 */

import { changeEmitter } from '@/lib/change-emitter';
import { handleSessionCompleted } from './trigger';

let distillerInitialized = false;

/** 在进程启动时调用一次；订阅 session_completed 并异步提炼 */
export function initDistiller(): void {
  if (distillerInitialized) {
    console.warn('[Distiller] initDistiller called more than once; ignoring');
    return;
  }
  distillerInitialized = true;

  changeEmitter.subscribe((event) => {
    if (event.type !== 'session_completed') return;
    void handleSessionCompleted(event).catch((err) => {
      console.error('[Distiller] subscriber error:', err);
    });
  });

  console.log('[Distiller] initialized');
}

export type {
  DistillerInput,
  DistillerOutput,
  ExtractedKnowledge,
  ExtractedTodo,
  KnowledgeKind,
} from './types';

export { trimMessagesForDistiller, buildDistillerPrompt, parseDistillerJson, extractDistillerOutput } from './extract';
export { persistDistillerOutput } from './persist';
export { handleSessionCompleted } from './trigger';
