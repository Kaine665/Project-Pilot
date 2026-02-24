/**
 * 对话数据懒迁移 — 将旧的单文件格式迁移为新的目录格式。
 *
 * 旧格式: data/conversations/{taskId}.json  (单个 ChatSession)
 * 新格式: data/conversations/{taskId}/_index.json + {convId}.json
 */

import { promises as fs } from 'fs';
import {
  getConversationPath,
  getConversationDir,
  getConversationIndexPath,
  getConversationFilePath,
  getTasksPath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { ChatSession, ConversationIndex, ConversationMeta, Session } from '@/types';

/**
 * 确保指定 task 的对话索引存在。
 * - 如果已有 _index.json → 直接返回
 * - 如果有旧格式单文件 → 迁移为第一个 conversation
 * - 否则 → 创建空索引
 */
export async function ensureConversationIndex(taskId: string): Promise<ConversationIndex> {
  const indexPath = getConversationIndexPath(taskId);

  // 1. 已有新格式索引
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as ConversationIndex;
  } catch (err) {
    // File not found or empty/corrupt → fall through to rebuild
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
  }

  // 2. 检查旧格式文件
  const legacyPath = getConversationPath(taskId);
  let legacySession: ChatSession | null = null;
  try {
    const content = await fs.readFile(legacyPath, 'utf-8');
    legacySession = JSON.parse(content) as ChatSession;
  } catch {
    // 不存在或解析失败
  }

  const convDir = getConversationDir(taskId);
  await fs.mkdir(convDir, { recursive: true });

  if (legacySession && legacySession.messages.length > 0) {
    // 迁移旧数据
    const conversationId = `conv-legacy`;
    const now = new Date().toISOString();

    // 读取 task 的 claudeSessionId 作为此对话的 claudeSessionId
    let claudeSessionId: string | undefined;
    try {
      const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
      const task = tasksData.tasks.find((t) => t.id === taskId);
      claudeSessionId = task?.claudeSessionId;
    } catch { /* ignore */ }

    // 写入对话文件
    const migratedSession: ChatSession = {
      ...legacySession,
      conversationId,
      claudeSessionId,
    };
    await writeJsonFile(getConversationFilePath(taskId, conversationId), migratedSession);

    // 计算标题：第一条用户消息的前 30 字
    const firstUserMsg = legacySession.messages.find((m) => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
      : '对话 1';

    const meta: ConversationMeta = {
      conversationId,
      title,
      claudeSessionId,
      messageCount: legacySession.messages.length,
      createdAt: legacySession.createdAt,
      updatedAt: legacySession.updatedAt ?? now,
    };

    const index: ConversationIndex = {
      taskId,
      activeConversationId: conversationId,
      conversations: [meta],
    };
    await writeJsonFile(indexPath, index);
    return index;
  }

  // 3. 无旧数据，创建空索引
  const emptyIndex: ConversationIndex = {
    taskId,
    activeConversationId: undefined,
    conversations: [],
  };
  await writeJsonFile(indexPath, emptyIndex);
  return emptyIndex;
}

/**
 * 创建一个新的空对话，返回 conversationId。
 */
export async function createConversation(taskId: string): Promise<string> {
  const index = await ensureConversationIndex(taskId);
  const conversationId = `conv-${Date.now()}`;
  const now = new Date().toISOString();

  const session: ChatSession = {
    sessionId: taskId,
    conversationId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonFile(getConversationFilePath(taskId, conversationId), session);

  const meta: ConversationMeta = {
    conversationId,
    title: '新对话',
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  index.conversations.push(meta);
  index.activeConversationId = conversationId;
  await writeJsonFile(getConversationIndexPath(taskId), index);

  return conversationId;
}

/**
 * 更新对话索引中某个对话的元数据。
 */
export async function updateConversationMeta(
  taskId: string,
  conversationId: string,
  updates: Partial<Pick<ConversationMeta, 'title' | 'claudeSessionId' | 'messageCount' | 'updatedAt'>>,
): Promise<void> {
  const index = await ensureConversationIndex(taskId);
  const meta = index.conversations.find((c) => c.conversationId === conversationId);
  if (meta) {
    Object.assign(meta, updates);
    await writeJsonFile(getConversationIndexPath(taskId), index);
  }
}

/**
 * 软删除：将对话标记为已归档。
 * 如果归档的是活跃对话，自动切换到最近的未归档对话。
 */
export async function archiveConversation(taskId: string, conversationId: string): Promise<void> {
  const index = await ensureConversationIndex(taskId);
  const meta = index.conversations.find((c) => c.conversationId === conversationId);
  if (!meta) return;

  meta.archived = true;
  meta.archivedAt = new Date().toISOString();

  // 如果归档的是活跃对话，切换到最近的未归档对话
  if (index.activeConversationId === conversationId) {
    const active = index.conversations
      .filter((c) => !c.archived)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    index.activeConversationId = active[0]?.conversationId;
  }

  await writeJsonFile(getConversationIndexPath(taskId), index);
}

/**
 * 从回收站恢复对话。
 */
export async function restoreConversation(taskId: string, conversationId: string): Promise<void> {
  const index = await ensureConversationIndex(taskId);
  const meta = index.conversations.find((c) => c.conversationId === conversationId);
  if (!meta) return;

  meta.archived = undefined;
  meta.archivedAt = undefined;

  // 如果当前没有活跃对话，设为活跃
  if (!index.activeConversationId) {
    index.activeConversationId = conversationId;
  }

  await writeJsonFile(getConversationIndexPath(taskId), index);
}

/**
 * 从已有对话的某条消息处创建分支。
 * 复制该消息及之前的所有历史到新对话，然后设为活跃。
 */
export async function branchConversation(
  taskId: string,
  sourceConversationId: string,
  branchFromMessageId: string,
): Promise<{ conversationId: string; messageCount: number }> {
  const index = await ensureConversationIndex(taskId);

  // 读取源对话
  const sourcePath = getConversationFilePath(taskId, sourceConversationId);
  const sourceSession = await readJsonFile<ChatSession>(sourcePath, {
    sessionId: taskId,
    conversationId: sourceConversationId,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // 找到分支点消息
  const msgIndex = sourceSession.messages.findIndex((m) => m.id === branchFromMessageId);
  if (msgIndex === -1) {
    throw new Error(`Message ${branchFromMessageId} not found in conversation ${sourceConversationId}`);
  }

  // 复制消息到分支点（含该消息）
  const copiedMessages = sourceSession.messages.slice(0, msgIndex + 1);

  const conversationId = `conv-${Date.now()}`;
  const now = new Date().toISOString();

  // 创建新对话文件（不复制 claudeSessionId，分支开始新的 Claude 会话）
  const newSession: ChatSession = {
    sessionId: taskId,
    conversationId,
    messages: copiedMessages,
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonFile(getConversationFilePath(taskId, conversationId), newSession);

  // 生成标题
  const sourceMeta = index.conversations.find((c) => c.conversationId === sourceConversationId);
  const sourceTitle = sourceMeta?.title || '对话';
  const title = `从「${sourceTitle}」分支 @ #${msgIndex + 1}`.slice(0, 60);

  const meta: ConversationMeta = {
    conversationId,
    title,
    messageCount: copiedMessages.length,
    createdAt: now,
    updatedAt: now,
    parentConversationId: sourceConversationId,
    branchFromMessageId,
    branchFromMessageIndex: msgIndex,
  };
  index.conversations.push(meta);
  index.activeConversationId = conversationId;
  await writeJsonFile(getConversationIndexPath(taskId), index);

  return { conversationId, messageCount: copiedMessages.length };
}

/**
 * 永久删除对话（从回收站彻底清除）。
 */
export async function permanentlyDeleteConversation(taskId: string, conversationId: string): Promise<void> {
  const index = await ensureConversationIndex(taskId);
  index.conversations = index.conversations.filter((c) => c.conversationId !== conversationId);

  if (index.activeConversationId === conversationId) {
    const active = index.conversations.filter((c) => !c.archived);
    index.activeConversationId = active[0]?.conversationId;
  }

  await writeJsonFile(getConversationIndexPath(taskId), index);

  // 删除对话文件
  try {
    await fs.unlink(getConversationFilePath(taskId, conversationId));
  } catch { /* ignore */ }
}
