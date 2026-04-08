import { Hono } from 'hono';
import catalogSeed from '@/data/community-catalog-seed.json';
import skillsSeed from '@/data/community-skills-seed.json';
import mcpSeed from '@/data/community-mcp-seed.json';
import { readProjectIndex } from '@/lib/file-store';
import {
  applyProjectPathTemplate,
  installMcpServerToMarket,
  listMcpMarketServerKeys,
} from '@/lib/mcp-market-store';
import {
  findAssistantById,
  findMcpById,
  findSkillById,
  resolveAssistantCatalogItems,
  resolveMcpCatalogItems,
  resolveSkillsCatalogItems,
} from '@/lib/community-catalog-remote';
import { parseSkillFrontmatter, writeSkillFile } from '@/lib/skill-store';
import type { SkillScope } from '@/lib/file-store';
import type { CommunityCatalogItem, CommunityMcpSeedItem, CommunitySkillSeedItem } from '@/types/community-catalog';

const app = new Hono();

/**
 * 社区市场：内置种子 + 路线 B（环境变量远程 JSON / MCP Registry）。
 * 契约见 docs/community-marketplace-lobechat-okr.md
 */
app.get('/catalog', async (c) => {
  const seedItems = catalogSeed.items as CommunityCatalogItem[];
  const resolved = await resolveAssistantCatalogItems(seedItems);
  return c.json({
    ...catalogSeed,
    items: resolved.items,
    source:
      resolved.origin === 'remote'
        ? `${String(catalogSeed.source)}+remote`
        : resolved.origin === 'dev-bulk'
          ? `${String(catalogSeed.source)}+dev-bulk`
          : String(catalogSeed.source),
    catalogOrigin: resolved.origin,
    remoteCatalogUrl: resolved.remoteUrl,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/item/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const seedItems = catalogSeed.items as CommunityCatalogItem[];
  const resolved = await resolveAssistantCatalogItems(seedItems);
  const item = findAssistantById(resolved.items, id);
  if (!item) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json(item);
});

// --- Skills ---

app.get('/skills/catalog', async (c) => {
  const seedItems = skillsSeed.items as CommunitySkillSeedItem[];
  const resolved = await resolveSkillsCatalogItems(seedItems);
  return c.json({
    ...skillsSeed,
    items: resolved.items,
    source:
      resolved.origin === 'remote'
        ? `${String(skillsSeed.source)}+remote`
        : resolved.origin === 'dev-bulk'
          ? `${String(skillsSeed.source)}+dev-bulk`
          : String(skillsSeed.source),
    catalogOrigin: resolved.origin,
    remoteCatalogUrl: resolved.remoteUrl,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/skills/item/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const seedItems = skillsSeed.items as CommunitySkillSeedItem[];
  const resolved = await resolveSkillsCatalogItems(seedItems);
  const item = findSkillById(resolved.items, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json(item);
});

app.post('/skills/install', async (c) => {
  try {
    const body = (await c.req.json()) as { id?: string; projectKey?: string };
    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: 'id is required' }, 400);
    }
    const seedItems = skillsSeed.items as CommunitySkillSeedItem[];
    const resolved = await resolveSkillsCatalogItems(seedItems);
    const seed = findSkillById(resolved.items, body.id);
    if (!seed) return c.json({ error: 'not_found' }, 404);

    const scope: SkillScope =
      body.projectKey && typeof body.projectKey === 'string'
        ? { level: 'project', projectKey: body.projectKey.trim() }
        : { level: 'global' };

    const meta = parseSkillFrontmatter(seed.skillMarkdown);
    if (!meta) {
      return c.json({ error: 'invalid_skill_markdown' }, 500);
    }
    const skillName = seed.dirName?.trim() || meta.name;
    await writeSkillFile(skillName, seed.skillMarkdown, scope);
    return c.json({ ok: true, name: skillName, scope }, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// --- MCP ---

app.get('/mcp/catalog', async (c) => {
  const seedItems = mcpSeed.items as CommunityMcpSeedItem[];
  const resolved = await resolveMcpCatalogItems(seedItems);
  const origin = resolved.origin;
  const sourceTag =
    origin === 'remote' ? '+remote' : origin === 'registry' ? '+registry' : '';
  return c.json({
    ...mcpSeed,
    items: resolved.items,
    source: `${String(mcpSeed.source)}${sourceTag}`,
    catalogOrigin: resolved.origin,
    remoteCatalogUrl: resolved.remoteUrl,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/mcp/item/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const seedItems = mcpSeed.items as CommunityMcpSeedItem[];
  const resolved = await resolveMcpCatalogItems(seedItems);
  const item = findMcpById(resolved.items, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json(item);
});

app.get('/mcp/installed', async (c) => {
  const keys = await listMcpMarketServerKeys();
  return c.json({ keys });
});

app.post('/mcp/install', async (c) => {
  try {
    const body = (await c.req.json()) as { id?: string; projectKey?: string };
    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: 'id is required' }, 400);
    }
    const seedItems = mcpSeed.items as CommunityMcpSeedItem[];
    const resolved = await resolveMcpCatalogItems(seedItems);
    const seed = findMcpById(resolved.items, body.id);
    if (!seed) return c.json({ error: 'not_found' }, 404);

    let config: unknown = JSON.parse(JSON.stringify(seed.mcpServer)) as unknown;

    if (seed.requiresProjectPath) {
      const pk = body.projectKey?.trim();
      if (!pk) {
        return c.json({ error: 'projectKey_required', message: '该 MCP 需指定已注册项目的磁盘路径' }, 400);
      }
      const index = await readProjectIndex();
      const entry = index.projects.find((p) => p.key === pk && !p.archived);
      const diskPath = entry?.path?.trim();
      if (!diskPath) {
        return c.json({ error: 'project_path_missing', message: '未找到该项目的本地路径' }, 400);
      }
      config = applyProjectPathTemplate(config, diskPath);
    }

    await installMcpServerToMarket(seed.serverKey, config);
    return c.json({ ok: true, serverKey: seed.serverKey }, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default app;
