/**
 * Hono Backend — ProjectPilot unified server.
 * Replaces both Next.js API Routes and the standalone Sidecar process.
 */
// Enable proxy for Node.js native fetch (undici-based)
import { ProxyAgent, setGlobalDispatcher } from 'undici';
const _proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (_proxy) {
  setGlobalDispatcher(new ProxyAgent(_proxy));
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';

import { errorHandler } from './middleware/error-handler';
import { lazyApiRoute } from './lazy-route';

import { ensureDataDirV2Migrated } from '@/lib/file-store';
import {
  ensureDefaultMcpMarketSeeded,
  readMcpMarketFile,
  removeMcpServerFromMarket,
  setMcpServerEnabledInMarket,
  updateMcpServerInMarket,
} from '@/lib/mcp-market-store';
import { materializeAllBuiltinPromptSeeds } from '@/lib/builtin-prompt-materialize';
import { ensureGlobalAgentsMigratedToPresets } from '@/lib/migrations/migrate-global-agents-to-presets';
import { schedulerManager } from '@/lib/scheduler-manager';
import { eventTriggerManager } from '@/lib/event-trigger-manager';
import { initInboxRouting } from '@/lib/inbox-manager';
import { initDistiller } from '@/lib/distiller';

const app = new Hono();

function loadCorsAllowedOrigins(): Set<string> {
  const fromEnv =
    process.env.PP_ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const defaults = [
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ];
  const fe = process.env.PP_FRONTEND_ORIGIN?.trim().replace(/\/$/, '');
  const set = new Set<string>([...defaults, ...fromEnv]);
  if (fe) set.add(fe);
  return set;
}

const corsAllowedOrigins = loadCorsAllowedOrigins();

// --- Middleware ---
app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      return corsAllowedOrigins.has(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use('/api/*', errorHandler);

// --- Health check ---
app.get('/health', (c) => c.json({ ok: true, uptime: process.uptime() }));

// --- API routes (lazy-loaded on first hit — see lazy-route.ts) ---
const api = {
  agents: '/api/agents',
  settings: '/api/settings',
  todos: '/api/todos',
  data: '/api/data',
  docs: '/api/docs',
  dimensions: '/api/dimensions',
  usage: '/api/usage',
  root: '/api',
  skills: '/api/skills',
  fs: '/api/fs',
  recycleBin: '/api/recycle-bin',
  upload: '/api/upload',
  projects: '/api/projects',
  aiDiscuss: '/api/ai-discuss',
  agentChat: '/api/agent-chat',
  schedules: '/api/schedules',
  eventTriggers: '/api/event-triggers',
  community: '/api/community',
  agentInbox: '/api/agent-inbox',
  distiller: '/api/distiller',
  googleAuth: '/api/auth/google',
} as const;

/**
 * MCP 市场快照：挂在主 Hono 实例上（勿仅放在 `/api/data` 懒子树），避免部分环境下子应用路径未命中导致纯文本 404。
 */
app.get(`${api.data}/mcp-market`, async (c) => {
  try {
    return c.json(await readMcpMarketFile());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** 须先于 `PATCH .../mcp-market/:key`，避免 `:key` 吞掉 `xxx/enabled`。 */
app.patch(`${api.data}/mcp-market/:key/enabled`, async (c) => {
  try {
    const key = decodeURIComponent(c.req.param('key') ?? '');
    const body = (await c.req.json()) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return c.json({ error: 'enabled_boolean_required' }, 400);
    }
    await setMcpServerEnabledInMarket(key, body.enabled);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.patch(`${api.data}/mcp-market/:key`, async (c) => {
  try {
    const key = decodeURIComponent(c.req.param('key') ?? '');
    const body = await c.req.json();
    await updateMcpServerInMarket(key, body);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.delete(`${api.data}/mcp-market/:key`, async (c) => {
  try {
    const key = decodeURIComponent(c.req.param('key') ?? '');
    await removeMcpServerFromMarket(key);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.route(api.agents, lazyApiRoute(api.agents, () => import('./routes/agents')));
app.route(api.settings, lazyApiRoute(api.settings, () => import('./routes/settings')));
app.route(api.todos, lazyApiRoute(api.todos, () => import('./routes/todos')));
app.route(api.data, lazyApiRoute(api.data, () => import('./routes/data')));
app.route(api.docs, lazyApiRoute(api.docs, () => import('./routes/docs')));
app.route(api.dimensions, lazyApiRoute(api.dimensions, () => import('./routes/dimensions')));
app.route(api.usage, lazyApiRoute(api.usage, () => import('./routes/usage')));
app.route(api.skills, lazyApiRoute(api.skills, () => import('./routes/skills')));
app.route(api.fs, lazyApiRoute(api.fs, () => import('./routes/fs')));
app.route(api.recycleBin, lazyApiRoute(api.recycleBin, () => import('./routes/recycle-bin')));
app.route(api.upload, lazyApiRoute(api.upload, () => import('./routes/upload')));
app.route(api.projects, lazyApiRoute(api.projects, () => import('./routes/projects')));
app.route(api.aiDiscuss, lazyApiRoute(api.aiDiscuss, () => import('./routes/ai-discuss')));
app.route(api.agentChat, lazyApiRoute(api.agentChat, () => import('./routes/agent-chat')));
app.route(api.schedules, lazyApiRoute(api.schedules, () => import('./routes/schedules')));
app.route(api.eventTriggers, lazyApiRoute(api.eventTriggers, () => import('./routes/event-triggers')));
app.route(api.community, lazyApiRoute(api.community, () => import('./routes/community')));
app.route(api.agentInbox, lazyApiRoute(api.agentInbox, () => import('./routes/agent-inbox')));
app.route(api.distiller, lazyApiRoute(api.distiller, () => import('./routes/distiller')));
app.route(api.googleAuth, lazyApiRoute(api.googleAuth, () => import('./routes/google-auth')));
/** 须挂在所有其它 `/api/...` 子树之后，否则会吞掉 `/api/auth/google` 等路径并 404 */
app.route(api.root, lazyApiRoute(api.root, () => import('./routes/prompts')));

// --- Static file serving (production) ---
// Electron 子进程：由 `electron/server.ts` 注入 `PROJECT_PILOT_CLIENT_DIST`（resourcesPath 下 unpacked/asar），
// 避免单文件 bundle 内 `__dirname` 与安装目录不一致导致找不到 `dist/client` → 浏览器 404。
// 其它启动方式仍用候选路径探测。
function resolveClientDistDir(): string | null {
  const fromEnv = process.env.PROJECT_PILOT_CLIENT_DIST?.trim();
  if (fromEnv) {
    try {
      if (fs.existsSync(path.join(fromEnv, 'index.html'))) return path.normalize(fromEnv);
    } catch {
      /* ignore */
    }
  }
  const candidates = [
    path.join(__dirname, '..', 'client'),
    path.resolve(__dirname, '..', '..', 'dist', 'client'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch {
      /* ignore */
    }
  }
  return null;
}
const clientDistPath = resolveClientDistDir();
if (!clientDistPath && process.env.NODE_ENV === 'production') {
  console.error(
    '[server] No client static root (no index.html). Set PROJECT_PILOT_CLIENT_DIST or run from dist/server with dist/client present.',
  );
}
if (clientDistPath) {
  app.use('/*', serveStatic({ root: clientDistPath }));
  app.get('*', async (c) => {
    // 勿把未匹配的 /api 当成 SPA：否则前端会收到 HTML 且难排查
    if (c.req.path.startsWith('/api')) {
      return c.json({ ok: false, error: 'API route not found', path: c.req.path }, 404);
    }
    const html = await fs.promises.readFile(
      path.join(clientDistPath, 'index.html'),
      'utf-8',
    );
    return c.html(html);
  });
}

// --- Start server（与 config/load-dev-server.cjs 一致：PROJECT_PILOT_API_PORT 优先于 PORT）---
const port = parseInt(
  process.env.PROJECT_PILOT_API_PORT ?? process.env.PORT ?? '4500',
  10,
);

async function startServer(): Promise<void> {
  await ensureDataDirV2Migrated();
  try {
    await ensureDefaultMcpMarketSeeded();
  } catch (e) {
    console.warn('[server] ensureDefaultMcpMarketSeeded:', e);
  }
  try {
    await materializeAllBuiltinPromptSeeds();
  } catch (e) {
    console.warn('[server] materializeAllBuiltinPromptSeeds:', e);
  }
  await ensureGlobalAgentsMigratedToPresets();
  initInboxRouting();
  initDistiller();
  await schedulerManager.init();
  await eventTriggerManager.init();
  console.log(`[server] Starting Hono backend on http://127.0.0.1:${port}`);

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: '127.0.0.1',
    },
    (info) => {
      console.log(`[server] Hono backend ready on http://127.0.0.1:${info.port}`);
    },
  );
}

void startServer().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

/** Named export only — default export would make `bun ./src/server/index.ts` start a second listener on :3000. */
export { app };
