/**
 * Task Card Store — read/write task card JSON files.
 *
 * Each session can have at most one task card, stored as:
 *   {DATA_DIR}/chat/messages/{sessionId}.task-card.json（默认 ~/.project-pilot/chat/）
 *
 * Optional per-session summary; may be written by tooling or future automation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getAgentChatMessagesDir } from '@/lib/file-store';

// ── Types ──

export interface TaskCard {
  version: number;
  sessionId: string;
  updatedAt: string; // ISO

  // Core content
  title: string;
  executor: string;
  stage: TaskCardStage;
  summary: string;

  // Optional
  scope?: string[];
  blockers?: string[];
}

export type TaskCardStage =
  | 'planning'
  | 'developing'
  | 'testing'
  | 'merging'
  | 'done'
  | 'discussing';

// ── Path helpers ──

function getTaskCardPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 200) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return path.join(getAgentChatMessagesDir(), `${safe}.task-card.json`);
}

// ── Read ──

export async function readTaskCard(sessionId: string): Promise<TaskCard | null> {
  try {
    const raw = await fs.readFile(getTaskCardPath(sessionId), 'utf-8');
    return JSON.parse(raw) as TaskCard;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.warn('[TaskCardStore] Failed to read task card:', err);
    return null;
  }
}

// ── Write ──

export async function writeTaskCard(card: TaskCard): Promise<void> {
  const filePath = getTaskCardPath(card.sessionId);
  const dir = getAgentChatMessagesDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(card, null, 2), 'utf-8');
}

// ── Delete ──

export async function deleteTaskCard(sessionId: string): Promise<void> {
  await fs.unlink(getTaskCardPath(sessionId)).catch(() => {});
}
