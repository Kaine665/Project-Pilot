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
import { ensureGlobalAgentsMigratedToPresets } from '@/lib/migrations/migrate-global-agents-to-presets';
import { schedulerManager } from '@/lib/scheduler-manager';
import { eventTriggerManager } from '@/lib/event-trigger-manager';
import { initInboxRouting } from '@/lib/inbox-manager';

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
  googleAuth: '/api/auth/google',
} as const;

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
app.route(api.googleAuth, lazyApiRoute(api.googleAuth, () => import('./routes/google-auth')));
/** 须挂在所有其它 `/api/...` 子树之后，否则会吞掉 `/api/auth/google` 等路径并 404 */
app.route(api.root, lazyApiRoute(api.root, () => import('./routes/prompts')));

// --- Static file serving (production) ---
const clientDistPath = path.resolve(__dirname, '../../dist/client');
if (fs.existsSync(clientDistPath)) {
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
  await ensureGlobalAgentsMigratedToPresets();
  initInboxRouting();
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
