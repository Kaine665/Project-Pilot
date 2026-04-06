import { Hono } from 'hono';
import catalogSeed from '@/data/community-catalog-seed.json';

const app = new Hono();

/**
 * 社区市场目录（MVP：内置种子；后续可合并远端 URL 与缓存）。
 * 契约见 docs/community-marketplace-lobechat-okr.md
 */
app.get('/catalog', (c) => {
  return c.json({
    ...catalogSeed,
    fetchedAt: new Date().toISOString(),
  });
});

export default app;
