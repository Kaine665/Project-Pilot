/**
 * InboxManager — per-agent change notification inbox.
 *
 * Each agent has a JSONL file at `agents/inboxes/{agentId}.jsonl`.
 * When a ChangeEvent fires, InboxManager checks which agents watch
 * the affected resource and appends an entry to their inboxes.
 *
 * On session start, the InboxDigestLoader reads unread entries
 * and injects a "what changed since last time" section into the prompt.
 */

import { promises as fs } from 'fs';
import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';

import { changeEmitter, type ChangeEvent } from './change-emitter';
import { listAgents } from './agents-store';
import { parseJsonSafe, getDataDir } from './file-store';

// ── Types ──

export interface InboxEntry {
  id: string;
  type: ChangeEvent['type'];
  sourceId: string;
  summary: string;
  createdAt: string;
  read: boolean;
  projectKey?: string;
  fromAgentId?: string;
}

// ── Path helpers ──

function getInboxDir(): string {
  return path.join(getDataDir(), 'agents', 'inboxes');
}

function getInboxPath(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error(`Invalid agent id: ${agentId}`);
  return path.join(getInboxDir(), `${safe}.jsonl`);
}

// ── Core operations ──

/** Append an entry to an agent's inbox */
export function push(agentId: string, entry: InboxEntry): void {
  const filePath = getInboxPath(agentId);
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
  } catch { /* already exists */ }
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read all entries (optionally only unread) */
export async function list(agentId: string, unreadOnly = false): Promise<InboxEntry[]> {
  const filePath = getInboxPath(agentId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const entries: InboxEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = parseJsonSafe<InboxEntry>(trimmed);
        if (unreadOnly && entry.read) continue;
        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Mark specific entries as read */
export async function markRead(agentId: string, entryIds: string[]): Promise<void> {
  const entries = await list(agentId);
  const idSet = new Set(entryIds);
  const updated = entries.map(e =>
    idSet.has(e.id) ? { ...e, read: true } : e,
  );
  await writeAll(agentId, updated);
}

/** Mark all entries as read */
export async function markAllRead(agentId: string): Promise<void> {
  const entries = await list(agentId);
  const updated = entries.map(e => ({ ...e, read: true }));
  await writeAll(agentId, updated);
}

/** Get unread count */
export async function getUnreadCount(agentId: string): Promise<number> {
  const entries = await list(agentId, true);
  return entries.length;
}

/** Atomically rewrite the full inbox file */
async function writeAll(agentId: string, entries: InboxEntry[]): Promise<void> {
  const filePath = getInboxPath(agentId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  const tmpPath = filePath + `.tmp_${Date.now()}`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.copyFile(tmpPath, filePath);
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/** Prune old read entries (keep last N) */
export async function prune(agentId: string, keepRead = 50): Promise<void> {
  const entries = await list(agentId);
  const unread = entries.filter(e => !e.read);
  const read = entries.filter(e => e.read);
  const kept = [...unread, ...read.slice(-keepRead)];
  await writeAll(agentId, kept);
}

// ── Unique ID generator ──

function makeEntryId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── ChangeEmitter subscriber ──

/**
 * Initialize: subscribe to change events and route to agent inboxes.
 * Call once at server startup.
 */
export function initInboxRouting(): void {
  changeEmitter.subscribe(async (event: ChangeEvent) => {
    try {
      const agents = await listAgents();
      for (const agent of agents) {
        if (shouldNotify(agent, event)) {
          const entry: InboxEntry = {
            id: makeEntryId(),
            type: event.type,
            sourceId: event.sourceId,
            summary: event.summary,
            createdAt: event.timestamp,
            read: false,
            projectKey: event.projectKey,
            fromAgentId: event.agentId,
          };
          push(agent.id, entry);
        }
      }
    } catch (err) {
      console.error('[InboxManager] routing error:', err);
    }
  });
}

/**
 * Determine if an agent should receive a notification for this event.
 *
 * Rules:
 * 1. If agent has watchRefs, check if event matches any watched resource type
 * 2. If agent has no watchRefs, it gets notifications for events in its project scope
 * 3. Never notify an agent about its own changes (avoid loops)
 */
function shouldNotify(agent: { id: string; watchRefs?: Array<{ type: string }>; projectKey?: string }, event: ChangeEvent): boolean {
  // Don't notify agent about its own actions
  if (event.agentId === agent.id) return false;

  // If agent has explicit watch refs, check type match
  if (agent.watchRefs?.length) {
    const watchedTypes = new Set(agent.watchRefs.map(r => changeTypeForResourceType(r.type)));
    return watchedTypes.has(event.type);
  }

  // Default: notify if same project scope (or event is global)
  if (agent.projectKey && event.projectKey) {
    return agent.projectKey === event.projectKey;
  }

  // Global agents get all non-agent-specific events
  return !event.agentId;
}

/** Map ResourceType → ChangeEventType for watch matching */
function changeTypeForResourceType(resourceType: string): ChangeEvent['type'] | null {
  switch (resourceType) {
    case 'design-docs-index': return 'doc_updated';
    case 'todo-list': return 'todo_changed';
    case 'shared-memory': return 'memory_written';
    case 'system-prompt':
    case 'prompt-block': return 'prompt_updated';
    default: return null;
  }
}
