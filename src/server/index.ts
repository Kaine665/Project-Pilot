/**
 * Hono Backend — ProjectPilot unified server.
 * Replaces both Next.js API Routes and the standalone Sidecar process.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';

import { errorHandler } from './middleware/error-handler';

import agentsRoutes from './routes/agents';
import settingsRoutes from './routes/settings';
import todosRoutes from './routes/todos';
import dataRoutes from './routes/data';
import docsRoutes from './routes/docs';
import dimensionsRoutes from './routes/dimensions';
import usageRoutes from './routes/usage';
import promptsRoutes from './routes/prompts';
import skillsRoutes from './routes/skills';
import fsRoutes from './routes/fs';
import recycleBinRoutes from './routes/recycle-bin';
import uploadRoutes from './routes/upload';
import projectsRoutes from './routes/projects';
import aiDiscussRoutes from './routes/ai-discuss';
import agentChatRoutes from './routes/agent-chat';
import schedulesRoutes from './routes/schedules';
import eventTriggersRoutes from './routes/event-triggers';
import communityRoutes from './routes/community';
import agentInboxRoutes from './routes/agent-inbox';
import googleAuthRoutes from './routes/google-auth';

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

// --- API Routes ---
app.route('/api/agents', agentsRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/todos', todosRoutes);
app.route('/api/data', dataRoutes);
app.route('/api/docs', docsRoutes);
app.route('/api/dimensions', dimensionsRoutes);
app.route('/api/usage', usageRoutes);
app.route('/api', promptsRoutes);
app.route('/api/skills', skillsRoutes);
app.route('/api/fs', fsRoutes);
app.route('/api/recycle-bin', recycleBinRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/projects', projectsRoutes);
app.route('/api/ai-discuss', aiDiscussRoutes);
app.route('/api/agent-chat', agentChatRoutes);
app.route('/api/schedules', schedulesRoutes);
app.route('/api/event-triggers', eventTriggersRoutes);
app.route('/api/community', communityRoutes);
app.route('/api/agent-inbox', agentInboxRoutes);
app.route('/api/auth/google', googleAuthRoutes);

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
