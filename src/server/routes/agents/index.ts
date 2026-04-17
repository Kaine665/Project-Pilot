/**
 * Agent routes - 聚合 agents, agent-chat, agent-inbox 三个子路由
 */
import { Hono } from 'hono';
import agents from './agents';
import chat from './agent-chat';
import inbox from './agent-inbox';

const app = new Hono();

app.route('/', agents);
app.route('/', chat);
app.route('/', inbox);

export default app;
