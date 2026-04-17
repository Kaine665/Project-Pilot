import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { assertDocumentTextWritable, documentTextWriteErrorResponse } from '@/lib/document-text-write-guard';
import {
  agentChatManager,
  generateSessionId,
} from '@/lib/chat-managers/agent-chat-manager';
import type { FlowContext } from '@/lib/chat-managers/agent-chat-manager';
import {
  loadSession,
  listAllSessions,
  listGuestSessions,
  readMessages,
  replaceSessionMessages,
} from '@/lib/chat-managers/agent-chat-session-store';
import {
  readEvents,
  readRuns,
  openRun,
  closeRun,
} from '@/lib/execution-event-store';
import {
  listSessions,
  listSessionsByProject,
  deleteSessionFromDisk,
  loadDeferredInputBuffer,
  markAsRead,
  setArchived,
  updateDeferredInputBufferOnDisk,
  updateUserMessageContentOnDisk,
  branchSession,
  buildPromptPreview,
  setSessionPinned,
  renameSessionTitle,
  bumpSessionUnread,
  forkChatSession,
} from '@/lib/agent-chat-manager';
import { normalizeOpenAIFastMode } from '@/lib/openai-fast-mode';
import { OPENAI_REASONING_EFFORTS, normalizeOpenAIReasoningEffort } from '@/lib/openai-reasoning-effort';
import { isValidProjectKey, isValidSessionId } from '@/lib/security-validation';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import { getModelContextWindow } from '@/lib/provider-registry';
import { normalizeImageAttachments } from '@/lib/image-assets';
import type { ImageAttachment } from '@/lib/image-assets';
import { readJsonFile, readProjectIndex, ensureDataDirV2Migrated } from '@/lib/file-store';
import {
  getLegacySessionPromptOverridePath,
  getPromptRuntimePath,
} from '@/lib/file-store';
import { resolveSegmentedContent } from '@/lib/segmented-prompt-store';
import { HttpError } from '@/lib/http-error';
import { spawnClaude } from '@/lib/claude-cli';
import { readTaskCard } from '@/lib/task-card-store';
import { getAgentById } from '@/lib/agents-store';
import { getProviderScopedModel, getSettings } from '@/lib/settings-manager';
import type { SessionConfig, ChatMessage } from '@/types/agent-chat';
import type { AgentEvent, OpenAIReasoningEffort, ProviderId } from '@/types';
import { SSETransportSink, agentEventToSSEData } from '@/lib/transport';

interface ProjectIndex {
  projects: Array<{ key: string; name: string }>;
}

const ALLOWED_PROVIDERS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);

/** 注册表内置 id + 用户在设置中添加的 custom-* 供应商 */
function isAllowedChatProvider(id: string): id is ProviderId {
  if (ALLOWED_PROVIDERS.includes(id as ProviderId)) return true;
  if (id.startsWith('custom-') && id.length > 'custom-'.length) return true;
  return false;
}

const ALLOWED_OPENAI_EFFORTS: OpenAIReasoningEffort[] = [...OPENAI_REASONING_EFFORTS];

const KEEP_RECENT_COUNT = 4;

const app = new Hono();

// ── Depth computation (recursive protection) ────────────────────

async function computeDepthFromParentChain(parentSessionId: string): Promise<number> {
  let depth = 1;
  let currentId: string | undefined = parentSessionId;
  const MAX_CHAIN = 10;

  while (currentId && depth < MAX_CHAIN) {
    const session = await loadSession(currentId);
    if (!session?.parentSessionId) break;
    currentId = session.parentSessionId;
    depth++;
  }
  return depth;
}

// ─── POST / — start an agent chat conversation ──────────────────
// DIRECT: replaces sidecarFetch('/agent-chat/start')

app.post('/', async (c) => {
  const body = await c.req.json();
  const {
    agentId, message, sessionId: requestedSessionId, projectKey,
    providerOverride, modelOverride, effortOverride, fastModeOverride,
    images, initialTitle, config, parentSessionId, depth, background,
    sourceType, sourceId, todoId, userMessageMeta: rawUserMessageMeta,
    reuseLastUserTurn,
  } = body as {
    agentId: string;
    message: string;
    sessionId?: string;
    projectKey?: string;
    providerOverride?: ProviderId;
    modelOverride?: string;
    effortOverride?: OpenAIReasoningEffort;
    fastModeOverride?: boolean;
    images?: Array<{ mediaType: string; data: string }>;
    initialTitle?: string;
    config?: SessionConfig;
    parentSessionId?: string;
    depth?: number;
    background?: boolean;
    sourceType?: 'manual' | 'schedule' | 'todo' | 'event';
    sourceId?: string;
    todoId?: string;
    userMessageMeta?: unknown;
    reuseLastUserTurn?: boolean;
  };

  let userMessageMeta: import('@/types/agent-chat').ChatMessageDiskMeta | undefined;
  if (rawUserMessageMeta !== undefined && rawUserMessageMeta !== null) {
    if (typeof rawUserMessageMeta === 'object') {
      const um = rawUserMessageMeta as { type?: unknown; executionRunId?: unknown };
      if (
        um.type === 'run_task'
        && typeof um.executionRunId === 'string'
        && um.executionRunId.length > 0
        && um.executionRunId.length <= 120
        && /^run-\d+-[a-z0-9]+$/.test(um.executionRunId)
      ) {
        userMessageMeta = { type: 'run_task', executionRunId: um.executionRunId };
      }
    }
  }

  if (!agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }

  if (typeof message !== 'string' || message.length > 10000) {
    return c.json({ error: 'message must be a string up to 10000 characters' }, 400);
  }

  const hasImages = Array.isArray(images) && images.length > 0;
  const reuseTurn = reuseLastUserTurn === true;
  if (reuseTurn && !requestedSessionId) {
    return c.json({ error: 'sessionId is required when reuseLastUserTurn is true' }, 400);
  }
  if (reuseTurn && hasImages) {
    return c.json({ error: 'reuseLastUserTurn cannot include new images in this request' }, 400);
  }
  if (!reuseTurn && message.length === 0 && !hasImages) {
    return c.json({ error: 'message or at least one image is required' }, 400);
  }

  let validatedImages: ImageAttachment[] | undefined;
  if (hasImages) {
    try {
      validatedImages = normalizeImageAttachments(images);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  }

  if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
    return c.json({ error: 'Invalid sessionId format' }, 400);
  }

  if (reuseTurn && requestedSessionId) {
    const sess = await loadSession(requestedSessionId);
    const lm = sess?.messages?.[sess.messages.length - 1];
    const lastOk =
      lm?.role === 'user'
      && (String(lm.content ?? '').trim().length > 0 || (lm.images && lm.images.length > 0));
    if (!lastOk) {
      return c.json(
        { error: 'Session must end with a user message that has text or images' },
        400,
      );
    }
  }

  if (projectKey && !isValidProjectKey(projectKey)) {
    return c.json({ error: 'Invalid projectKey format' }, 400);
  }

  const normalizedProvider = (typeof providerOverride === 'string' ? providerOverride.trim() : '') as ProviderId;
  if (normalizedProvider && !isAllowedChatProvider(normalizedProvider)) {
    return c.json({ error: 'Invalid providerOverride' }, 400);
  }
  const normalizedModel = typeof modelOverride === 'string' ? modelOverride.trim() : '';
  if (normalizedModel && normalizedModel.length > 200) {
    return c.json({ error: 'Invalid modelOverride (1-200 chars)' }, 400);
  }
  const normalizedEffort = normalizeOpenAIReasoningEffort(
    typeof effortOverride === 'string' ? effortOverride.trim() : undefined,
  );
  if (effortOverride !== undefined && !ALLOWED_OPENAI_EFFORTS.includes(normalizedEffort!)) {
    return c.json({ error: 'Invalid effortOverride (minimal|low|medium|high|xhigh)' }, 400);
  }
  const normalizedFastMode = normalizeOpenAIFastMode(fastModeOverride);
  if (fastModeOverride !== undefined && normalizedFastMode === undefined) {
    return c.json({ error: 'Invalid fastModeOverride (boolean)' }, 400);
  }

  const sessionId = requestedSessionId || generateSessionId();

  try {
    const ppApiT0 = Date.now();
    console.log(
      `[PP-AgentChat:API] POST / begin sessionId=${sessionId} agentId=${agentId}`
      + ` provider=${normalizedProvider || '(body default)'} model=${normalizedModel || '(default)'}`
      + ` msgLen=${message.length}${projectKey ? ` projectKey=${projectKey}` : ''}`,
    );

    let flowContext: FlowContext | undefined;
    if (projectKey) {
      await ensureDataDirV2Migrated();

      let projectName = projectKey;
      let projectRoot: string | undefined;
      try {
        const projectIndex = await readProjectIndex();
        const found = projectIndex.projects.find(p => p.key === projectKey);
        if (found) {
          projectName = found.name;
          const raw = found.path?.trim();
          if (raw) projectRoot = path.normalize(path.resolve(raw));
        }
      } catch { /* ignore */ }

      flowContext = {
        projectKey,
        projectName,
        ...(projectRoot ? { projectRoot } : {}),
      };
    }

    // Compute effective depth for recursive sub-agent protection
    let effectiveDepth: number = typeof depth === 'number' ? depth : 0;
    if (parentSessionId) {
      const serverDepth = await computeDepthFromParentChain(parentSessionId);
      effectiveDepth = Math.max(effectiveDepth, serverDepth);
    }
    const MAX_SUB_AGENT_DEPTH = 3;
    if (effectiveDepth > MAX_SUB_AGENT_DEPTH) {
      return c.json({
        error: `Sub-agent call depth ${effectiveDepth} exceeds maximum ${MAX_SUB_AGENT_DEPTH}. ` +
          `This prevents infinite recursion. Consider restructuring the task.`,
      }, 400);
    }

    const runId = await agentChatManager.start(
      sessionId,
      agentId,
      message,
      flowContext,
      validatedImages,
      initialTitle,
      config,
      parentSessionId,
      normalizedProvider || undefined,
      normalizedModel || undefined,
      normalizedEffort || undefined,
      normalizedFastMode,
      undefined, // ephemeral
      effectiveDepth,
      background || undefined,
      (sourceType || 'manual') as 'manual' | 'schedule' | 'todo' | 'event',
      sourceId,
      todoId,
      reuseTurn ? undefined : userMessageMeta,
      reuseTurn,
    );

    console.log(
      `[PP-AgentChat:API] POST / ok sessionId=${sessionId} runId=${runId} elapsedMs=${Date.now() - ppApiT0}`,
    );
    return c.json({ runId, sessionId });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    console.error(
      `[PP-AgentChat:API] POST / fail sessionId=${sessionId}`,
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: (err as Error).message }, status as 400 | 500);
  }
});

// ─── POST /stop — stop a running agent chat session ─────────────
// DIRECT: replaces sidecarFetch('/agent-chat/stop')

app.post('/stop', async (c) => {
  const body = await c.req.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  try {
    const stopped = await agentChatManager.stop(sessionId);
    return c.json({ stopped });
  } catch {
    return c.json({ stopped: false });
  }
});

// ─── GET /status — check whether a session process is running ───
// DIRECT: replaces sidecarFetch('/agent-chat/status')

app.get('/status', (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  const info = agentChatManager.getStatus(sessionId);
  return c.json(info, 200, { 'Cache-Control': 'no-store' });
});

// ─── GET /stream — SSE stream for agent chat events ─────────────

app.get('/stream', (c) => {
  const sessionId = c.req.query('sessionId') ?? '';
  const since = parseInt(c.req.query('since') ?? '0', 10);

  if (!sessionId) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: agentEventToSSEData({ type: 'error', message: 'sessionId is required' }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    const sseT0 = Date.now();
    console.log(`[PP-AgentChat:API] GET stream open sessionId=${sessionId} since=${since}`);
    await stream.writeSSE({ data: '' }); // initial heartbeat

    const sink = new SSETransportSink(stream);

    let resolveKeepAlive: (() => void) | undefined;
    const keepAlive = new Promise<void>((r) => { resolveKeepAlive = r; });

    const push = (event: AgentEvent, index: number): void => {
      console.log(
        `[PP-AgentChat:API] SSE push type=${event.type} idx=${index} session=${sessionId}`
        + ` (+${Date.now() - sseT0}ms since stream open)`,
      );
      sink.send({ event, index });
      if (event.type === 'done' || event.type === 'stream_end') {
        resolveKeepAlive?.();
      }
    };

    const unsubscribe = agentChatManager.subscribe(sessionId, since, push);
    console.log(
      `[PP-AgentChat:API] GET stream subscribe session=${sessionId} since=${since}`
      + ` → ${unsubscribe ? 'listener added' : 'null (no run — client will get empty done)'}`,
    );

    if (!unsubscribe) {
      await stream.writeSSE({ data: agentEventToSSEData({ type: 'done' }) });
      sink.close();
      return;
    }

    stream.onAbort(() => {
      console.log(`[PP-AgentChat:API] GET stream abort session=${sessionId}`);
      unsubscribe();
      resolveKeepAlive?.();
    });

    await keepAlive;
    console.log(`[PP-AgentChat:API] GET stream close session=${sessionId} totalMs=${Date.now() - sseT0}`);
  });
});

// ─── POST /guest — start a guest (side-listener) agent session ──
// DIRECT: replaces sidecarFetch('/agent-chat/guest')

app.post('/guest', async (c) => {
  const body = await c.req.json();
  const {
    agentId,
    message,
    parentSessionId,
    guestSessionId: requestedGuestSessionId,
    importedTurns,
  } = body as {
    agentId: string;
    message: string;
    parentSessionId: string;
    guestSessionId?: string;
    importedTurns?: number[] | 'all';
  };

  if (!agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }
  if (!parentSessionId) {
    return c.json({ error: 'parentSessionId is required' }, 400);
  }
  if (typeof message !== 'string' || message.length === 0 || message.length > 10000) {
    return c.json({ error: 'message must be a non-empty string up to 10000 characters' }, 400);
  }
  if (!isValidSessionId(parentSessionId)) {
    return c.json({ error: 'Invalid parentSessionId format' }, 400);
  }
  if (requestedGuestSessionId && !isValidSessionId(requestedGuestSessionId)) {
    return c.json({ error: 'Invalid guestSessionId format' }, 400);
  }

  const resolvedImportedTurns: number[] | 'all' = importedTurns ?? 'all';
  if (resolvedImportedTurns !== 'all') {
    if (!Array.isArray(resolvedImportedTurns) || !resolvedImportedTurns.every(n => typeof n === 'number' && n >= 0)) {
      return c.json({ error: 'importedTurns must be "all" or an array of non-negative integers' }, 400);
    }
  }

  const guestSessionId = requestedGuestSessionId || generateSessionId();

  try {
    const runId = await agentChatManager.startGuest(
      guestSessionId,
      agentId,
      message,
      parentSessionId,
      resolvedImportedTurns,
    );
    return c.json({ runId, sessionId: guestSessionId, parentSessionId });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return c.json({ error: (err as Error).message }, status as 400 | 500);
  }
});

// ─── GET /guest — list guest sessions for a host session ────────

app.get('/guest', async (c) => {
  const parentSessionId = c.req.query('parentSessionId');
  if (!parentSessionId) {
    return c.json({ error: 'parentSessionId is required' }, 400);
  }

  const sessions = await listGuestSessions(parentSessionId);
  return c.json({ sessions }, 200, { 'Cache-Control': 'no-store' });
});

// ─── GET /runtime-snapshot — current runtime read model ─────────
// DIRECT: replaces sidecarFetch('/agent-chat/runtime-snapshot')

app.get('/runtime-snapshot', (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  const snapshot = agentChatManager.getRuntimeSnapshot(sessionId);
  if (!snapshot) {
    return c.json(
      { available: false, ...agentChatManager.getStatus(sessionId), messages: [] },
      200,
      { 'Cache-Control': 'no-store' },
    );
  }
  return c.json({ available: true, ...snapshot }, 200, { 'Cache-Control': 'no-store' });
});

// ─── GET /runtime-prompt — read runtime prompt file ─────────────

app.get('/runtime-prompt', async (c) => {
  const agentId = c.req.query('agentId');
  const sessionId = c.req.query('sessionId');

  if (!agentId || !sessionId) {
    return c.json({ error: 'agentId and sessionId are required' }, 400);
  }

  // Try segmented mode first
  try {
    const segmented = await resolveSegmentedContent({ type: 'runtime', agentId, sessionId });
    if (segmented !== undefined) {
      return c.json({ content: segmented });
    }
  } catch {
    // Segmented mode failed — fall through to single file
  }

  const primary = getPromptRuntimePath(agentId, sessionId);
  const legacy = getLegacySessionPromptOverridePath(agentId, sessionId);
  try {
    const content = await readFile(primary, 'utf-8');
    return c.json({ content });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        const content = await readFile(legacy, 'utf-8');
        return c.json({ content });
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === 'ENOENT') {
          return c.json({ content: '' });
        }
        throw e2;
      }
    }
    console.error('[runtime-prompt] GET error:', error);
    return c.json({ error: 'Failed to read runtime prompt' }, 500);
  }
});

// ─── PUT /runtime-prompt — write runtime prompt file ────────────

app.put('/runtime-prompt', async (c) => {
  const agentId = c.req.query('agentId');
  const sessionId = c.req.query('sessionId');

  if (!agentId || !sessionId) {
    return c.json({ error: 'agentId and sessionId are required' }, 400);
  }

  try {
    const { content } = (await c.req.json()) as { content?: string };
    if (typeof content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400);
    }

    assertDocumentTextWritable(content);

    const overridePath = getPromptRuntimePath(agentId, sessionId);
    await mkdir(path.dirname(overridePath), { recursive: true });
    await writeFile(overridePath, content, 'utf-8');

    return c.json({ ok: true });
  } catch (error) {
    const enc = documentTextWriteErrorResponse(error);
    if (enc) return c.json(enc.body, enc.status);
    console.error('[runtime-prompt] PUT error:', error);
    return c.json({ error: 'Failed to write runtime prompt' }, 500);
  }
});

// ─── GET /prompt-info — build prompt preview for token estimation ─

app.get('/prompt-info', async (c) => {
  const agentId = c.req.query('agentId');
  const sessionId = c.req.query('sessionId') ?? undefined;
  const projectKey = c.req.query('projectKey') ?? undefined;
  const model = c.req.query('model') ?? '';

  if (!agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }

  if (sessionId && !isValidSessionId(sessionId)) {
    return c.json({ error: 'Invalid sessionId format' }, 400);
  }

  if (projectKey && !isValidProjectKey(projectKey)) {
    return c.json({ error: 'Invalid projectKey format' }, 400);
  }

  try {
    const q = (c.req.query('includeText') ?? '').toLowerCase();
    const includeText =
      q === '1' ||
      q === 'true' ||
      q === 'yes' ||
      c.req.header('x-pp-include-prompt-text') === '1' ||
      c.req.header('x-pp-include-prompt-text')?.toLowerCase() === 'true';
    const session = sessionId ? await loadSession(sessionId) : null;
    const preview = await buildPromptPreview(
      agentId,
      sessionId,
      projectKey,
      session?.config,
      { includeText },
    );
    const charCount = preview.charCount;
    const estimatedTokens = preview.estimatedTokens;
    const fullText = includeText ? (preview.text ?? '') : undefined;
    const settings = await getSettings();
    const agent = await getAgentById(agentId);
    const resolvedProvider =
      session?.config?.provider
      || agent?.defaultProvider
      || settings.claude.provider
      || 'anthropic';
    const resolvedModel =
      model.trim()
      || session?.config?.model
      || agent?.defaultModel
      || getProviderScopedModel(settings.claude, resolvedProvider);
    const contextWindow = getModelContextWindow(resolvedModel);

    if (includeText) {
      return c.json({
        charCount,
        estimatedTokens,
        contextWindow,
        text: fullText,
      });
    }
    return c.json({
      charCount,
      estimatedTokens,
      contextWindow,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── GET /sessions — list chat sessions ─────────────────────────

app.get('/sessions', async (c) => {
  const agentId = c.req.query('agentId');
  const projectKey = c.req.query('projectKey');

  let sessions;
  if (agentId && projectKey) {
    sessions = await listSessionsByProject(agentId, projectKey);
  } else if (agentId) {
    sessions = await listSessions(agentId);
  } else if (projectKey) {
    const all = await listAllSessions();
    // 与 Agents 侧栏 project 过滤一致：无 projectKey 的会话视为全局/旧版落盘，仍应在当前项目下可见
    sessions = all.filter(s => !s.projectKey || s.projectKey === projectKey);
  } else {
    sessions = await listAllSessions();
  }

  return c.json({ sessions }, 200, { 'Cache-Control': 'no-store' });
});

// ─── DELETE /sessions — delete an agent chat session ────────────
// Partially DIRECT: clears in-memory run via agentChatManager.clear()

app.delete('/sessions', async (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  try {
    agentChatManager.clear(sessionId);
  } catch { /* best-effort */ }

  const deleted = await deleteSessionFromDisk(sessionId);
  if (!deleted) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json({ deleted: true });
});

// ─── POST /sessions/branch — branch a session at a message index ─

app.post('/sessions/branch', async (c) => {
  try {
    const { sourceSessionId, branchAtIndex, frontendMessageCount } = await c.req.json();
    if (!sourceSessionId || typeof branchAtIndex !== 'number') {
      return c.json(
        { error: 'sourceSessionId (string) and branchAtIndex (number) are required' },
        400,
      );
    }

    const newSession = await branchSession(
      sourceSessionId,
      branchAtIndex,
      typeof frontendMessageCount === 'number' ? frontendMessageCount : undefined,
    );

    return c.json({
      sessionId: newSession.id,
      title: newSession.title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') || message.includes('out of range') ? 404 : 500;
    return c.json({ error: message }, status as 404 | 500);
  }
});

// ─── GET /sessions/:id — get full session data ──────────────────

app.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');

  const session = await loadSession(id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const deferredInputBuffer = await loadDeferredInputBuffer(id);

  return c.json(
    { ...session, adjuncts: { deferredInputBuffer } },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

// ─── PATCH /sessions/:id — update session metadata ──────────────
// Partially DIRECT: 'updateConfig' action calls agentChatManager.updateConfig()

app.patch('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  if (body.action === 'markAsRead') {
    const found = await markAsRead(id);
    if (!found) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ ok: true });
  }

  if (body.action === 'archive' || body.action === 'unarchive') {
    try {
      const found = await setArchived(id, body.action === 'archive');
      if (!found) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error('[API] setArchived failed:', err);
      return c.json({ error: 'Internal error' }, 500);
    }
  }

  if (body.action === 'pin' || body.action === 'unpin') {
    const found = await setSessionPinned(id, body.action === 'pin');
    if (!found) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ ok: true });
  }

  if (body.action === 'rename') {
    if (typeof body.title !== 'string') {
      return c.json({ error: 'title must be a string' }, 400);
    }
    const ok = await renameSessionTitle(id, body.title);
    if (!ok) {
      return c.json({ error: 'Session not found or invalid title' }, 404);
    }
    return c.json({ ok: true });
  }

  if (body.action === 'markAsUnread') {
    const found = await bumpSessionUnread(id);
    if (!found) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ ok: true });
  }

  if (body.action === 'fork') {
    try {
      const forkedId = await forkChatSession(id);
      if (!forkedId) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json({ ok: true, forkedId });
    } catch (err) {
      console.error('[API] forkChatSession failed:', err);
      return c.json({ error: 'Internal error' }, 500);
    }
  }

  if (body.action === 'updateConfig') {
    const config = body.config ?? {};
    try {
      const found = await agentChatManager.updateConfig(id, config);
      if (!found) {
        return c.json({ error: 'Session not found' }, 404);
      }
    } catch {
      // best-effort when no run is active
    }
    return c.json({ ok: true });
  }

  if (body.action === 'updateDeferredInputBuffer' || body.action === 'updatePendingUserQueue') {
    const queue = body.queue;
    const items = Array.isArray(queue?.items) ? queue.items : null;
    if (!items) {
      return c.json({ error: 'queue.items must be an array' }, 400);
    }

    const normalizedItems = items
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null;
        const text = typeof (item as { text?: unknown }).text === 'string'
          ? (item as { text: string }).text.trim()
          : '';
        const images = Array.isArray((item as { images?: unknown }).images)
          ? (item as { images: unknown[] }).images.filter((img): img is string => typeof img === 'string' && img.length > 0)
          : [];
        if (!text && images.length === 0) return null;
        return { text, images: images.length > 0 ? images : undefined };
      })
      .filter((item: { text: string; images?: string[] } | null): item is { text: string; images?: string[] } => item !== null);

    const found = await updateDeferredInputBufferOnDisk(id, {
      items: normalizedItems,
      expanded: queue?.expanded === false ? false : undefined,
    });
    if (!found) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ ok: true });
  }

  if (body.action === 'updateUserMessage') {
    if (typeof body.messageIndex !== 'number' || body.messageIndex < 0) {
      return c.json({ error: 'messageIndex must be a non-negative number' }, 400);
    }
    if (typeof body.content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400);
    }

    const result = await updateUserMessageContentOnDisk(
      id,
      body.messageIndex,
      body.content,
      typeof body.frontendMessageCount === 'number' ? body.frontendMessageCount : undefined,
      body.truncateAfter === true,
    );

    if (result === 'not_found') {
      return c.json({ error: 'Session not found' }, 404);
    }
    if (result === 'out_of_range') {
      return c.json({ error: 'Message index out of range' }, 400);
    }
    if (result === 'not_user') {
      return c.json({ error: 'Only user messages can be edited' }, 400);
    }
    if (result === 'empty') {
      return c.json({ error: 'Message content cannot be empty' }, 400);
    }

    return c.json({ ok: true });
  }

  return c.json({ error: 'Unknown action' }, 400);
});

// ─── POST /sessions/:id/compress — compress session messages ────

app.post('/sessions/:id/compress', async (c) => {
  const rawId = c.req.param('id');
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  if (!id) {
    return c.json({ error: 'Invalid session ID' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body.action;

  if (action === 'preview') {
    const messages = await readMessages(id);

    if (messages.length === 0) {
      return c.json({ error: 'Session not found or empty' }, 404);
    }

    if (messages.length <= KEEP_RECENT_COUNT) {
      return c.json({ error: '消息数量不足，无需压缩' }, 400);
    }

    const messagesToCompress = messages.slice(0, -KEEP_RECENT_COUNT);
    const recentMessages = messages.slice(-KEEP_RECENT_COUNT);

    const prompt = `请将以下对话历史压缩为一段简洁的摘要。保留关键决策、结论和重要上下文，去除过程性细节。

<conversation>
${messagesToCompress.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}
</conversation>

请直接输出摘要内容，不要加任何前缀或解释。摘要应该是第三人称叙述，概括对话的要点。`;

    try {
      const summary = await new Promise<string>((resolve, reject) => {
        const child = spawnClaude(['--print', '-p', '-'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CLAUDECODE: '' },
        });

        let stdout = '';
        let stderr = '';
        let prevLen = 0;
        let stallCount = 0;
        const MAX_STALLS = 2;

        const stallCheck = setInterval(() => {
          if (stdout.length === prevLen) {
            stallCount++;
            if (stallCount >= MAX_STALLS) {
              clearInterval(stallCheck);
              child.kill();
              resolve(stdout.trim());
            }
          } else {
            stallCount = 0;
            prevLen = stdout.length;
          }
        }, 30000);

        child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('error', (err) => { clearInterval(stallCheck); reject(err); });
        child.on('close', (code) => {
          clearInterval(stallCheck);
          if (code !== 0 && !stdout.trim()) {
            reject(new Error(`claude exited ${code}: ${stderr}`));
          } else {
            resolve(stdout.trim());
          }
        });

        child.stdin?.write(prompt);
        child.stdin?.end();
      });

      if (!summary) {
        return c.json({ error: 'AI 返回了空摘要' }, 500);
      }

      const compressedMessages = [
        {
          role: 'assistant' as const,
          content: `[会话摘要]\n${summary}`,
          id: `compress-summary-${Date.now()}`,
          timestamp: new Date().toISOString(),
        },
        ...recentMessages,
      ];

      return c.json({ messages: compressedMessages });
    } catch (err) {
      console.error('[compress/preview] AI 摘要生成失败:', err);
      return c.json({ error: 'AI 摘要生成失败' }, 500);
    }
  }

  if (action === 'apply') {
    const messages = body.messages;

    if (!Array.isArray(messages)) {
      return c.json({ error: 'messages 字段必须是数组' }, 400);
    }

    try {
      const found = await replaceSessionMessages(id, messages as ChatMessage[]);
      if (!found) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error('[compress/apply] 写入失败:', err);
      return c.json({ error: 'Internal error' }, 500);
    }
  }

  return c.json({ error: 'Unknown action' }, 400);
});

// ─── GET /sessions/:id/task-card — get task card for a session ──

app.get('/sessions/:id/task-card', async (c) => {
  const id = c.req.param('id');

  const card = await readTaskCard(id);
  return c.json({ card }, 200, { 'Cache-Control': 'no-store' });
});

// ─── GET /sessions/:id/children — list child sessions ───────────

app.get('/sessions/:id/children', async (c) => {
  const id = c.req.param('id');
  const children = await listGuestSessions(id);
  return c.json({ children }, 200, { 'Cache-Control': 'no-store' });
});

// ═══════════════════════════════════════════════════════════════════════
// Execution Events & Runs
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /sessions/:id/events — list execution events ──────────────

app.get('/sessions/:id/events', async (c) => {
  const id = c.req.param('id');
  const session = await loadSession(id);
  if (!session) {
    return c.json({ events: [] }, 200, { 'Cache-Control': 'no-store' });
  }
  const events = await readEvents(id);
  return c.json({ events }, 200, { 'Cache-Control': 'no-store' });
});

// ─── GET /sessions/:id/runs — list execution runs ──────────────────

app.get('/sessions/:id/runs', async (c) => {
  const id = c.req.param('id');
  const session = await loadSession(id);
  if (!session) {
    return c.json({ runs: [] }, 200, { 'Cache-Control': 'no-store' });
  }
  const runs = await readRuns(id);
  return c.json({ runs }, 200, { 'Cache-Control': 'no-store' });
});

// ─── POST /sessions/:id/runs — open a new Run ─────────────────────

app.post('/sessions/:id/runs', async (c) => {
  const sessionId = c.req.param('id');
  const session = await loadSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  const body = await c.req.json<{ goal?: string; taskId?: string }>();

  const events = await readEvents(sessionId);
  const startEventId = events.length > 0 ? events[events.length - 1].id : 'none';

  const run = await openRun(sessionId, {
    goal: body.goal,
    taskId: body.taskId,
    startEventId,
  });
  return c.json(run, 201);
});

// ─── PATCH /sessions/:id/runs/:runId — close/evaluate a Run ───────

app.patch('/sessions/:id/runs/:runId', async (c) => {
  const sessionId = c.req.param('id');
  const session = await loadSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  const runId = c.req.param('runId');
  const body = await c.req.json<{
    outcome: 'success' | 'failure' | 'partial' | 'shelved';
    evaluationText?: string;
  }>();

  if (!body.outcome) {
    return c.json({ error: 'outcome is required' }, 400);
  }

  const events = await readEvents(sessionId);
  const endEventId = events.length > 0 ? events[events.length - 1].id : undefined;

  const run = await closeRun(sessionId, runId, {
    outcome: body.outcome,
    evaluationText: body.evaluationText,
    endEventId,
  });

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }
  return c.json(run);
});

export default app;
