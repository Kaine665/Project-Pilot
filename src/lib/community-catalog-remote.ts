/**
 * 社区市场路线 B：从远程目录或 MCP Registry 拉取条目，失败时回退内置种子。
 *
 * 环境变量（均为可选）：
 * - PROJECT_PILOT_COMMUNITY_CATALOG_URL — 助手目录 JSON（与内置 catalog 同形：{ version, source, items }）
 * - PROJECT_PILOT_COMMUNITY_SKILLS_CATALOG_URL — Skill 目录 JSON
 * - PROJECT_PILOT_COMMUNITY_MCP_CATALOG_URL — MCP 目录 JSON（与内置 mcp 种子同形）
 * - PROJECT_PILOT_COMMUNITY_MCP_REGISTRY — 设为 `1`/`true` 强制开启 Registry；`0` 或 PROJECT_PILOT_COMMUNITY_MCP_REGISTRY_OFF=1 强制关闭
 * - 未设置且 NODE_ENV === 'development' 时默认拉 Registry（与 dev-web / cross-env dev:server 一致；生产须显式设为 1）
 */

import type { CommunityCatalogItem, CommunityMcpSeedItem, CommunitySkillSeedItem } from '@/types/community-catalog';
import catalogDevBulk from '@/data/community-catalog-dev-bulk.json';
import skillsDevBulk from '@/data/community-skills-dev-bulk.json';

const REMOTE_TIMEOUT_MS = 12_000;
const REGISTRY_PAGE = 80;
const REGISTRY_MAX = 400;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogPayload<T> = { version?: number; source?: string; items?: T[] };

interface RegistryServer {
  name: string;
  description?: string;
  title?: string;
  version: string;
  repository?: { url?: string };
  websiteUrl?: string;
  remotes?: Array<{ type: string; url: string }>;
}

interface RegistryRow {
  server: RegistryServer;
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: { isLatest?: boolean };
  };
}

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** 生产须显式开启；开发默认开（可被 REGISTRY_OFF 或 REGISTRY=0 关掉） */
/** 开发环境合并本地「扩展模板」JSON；PROJECT_PILOT_COMMUNITY_DEV_BULK_OFF=1 可关闭以加快冷启动 */
function shouldMergeDevBulk(): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (envBool(process.env.PROJECT_PILOT_COMMUNITY_DEV_BULK_OFF)) return false;
  return true;
}

function shouldUseMcpRegistry(): boolean {
  if (
    envBool(process.env.PROJECT_PILOT_COMMUNITY_MCP_REGISTRY_OFF) ||
    process.env.PROJECT_PILOT_COMMUNITY_MCP_REGISTRY === '0'
  ) {
    return false;
  }
  if (envBool(process.env.PROJECT_PILOT_COMMUNITY_MCP_REGISTRY)) {
    return true;
  }
  return process.env.NODE_ENV === 'development';
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 远程条目排在前面；同 id 以远程为准。 */
type SkillInternal = CommunitySkillSeedItem & {
  __ppSkillOrigin?: 'seed' | 'dev-bulk' | 'remote';
};

/** 去掉合并用内部标记；无 sourceNote 时写入 sourceProvider（PP / 未知）。 */
type AgentInternal = CommunityCatalogItem & { __ppOrigin?: 'seed' | 'dev-bulk' | 'remote' };

function finalizeAssistantCatalogItems(items: AgentInternal[]): CommunityCatalogItem[] {
  return items.map((row) => {
    const { __ppOrigin, ...rest } = row;
    return { ...rest, catalogItemOrigin: __ppOrigin ?? 'seed' };
  });
}

type McpInternal = CommunityMcpSeedItem & { __ppOrigin?: 'seed' | 'remote' | 'registry' };

function finalizeMcpCatalogItems(items: McpInternal[]): CommunityMcpSeedItem[] {
  return items.map((row) => {
    const { __ppOrigin, ...rest } = row;
    return { ...rest, catalogItemOrigin: __ppOrigin ?? 'seed' };
  });
}

function finalizeSkillCatalogItems(items: SkillInternal[]): CommunitySkillSeedItem[] {
  return items.map(({ __ppSkillOrigin, ...rest }) => {
    const hasNote = !!rest.sourceNote?.trim();
    const listOrigin = __ppSkillOrigin ?? 'seed';
    const out: CommunitySkillSeedItem = { ...rest, skillListOrigin: listOrigin };
    if (!hasNote) {
      out.sourceProvider =
        rest.sourceProvider ?? (listOrigin === 'remote' ? 'unknown' : 'project-pilot');
    } else if (rest.sourceProvider) {
      out.sourceProvider = rest.sourceProvider;
    }
    return out;
  });
}

function mergeRemoteFirst<T extends { id: string }>(local: T[], remote: T[] | undefined | null): T[] {
  if (!remote?.length) return local;
  const byId = new Map<string, T>();
  for (const x of local) byId.set(x.id, x);
  for (const x of remote) byId.set(x.id, x);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of remote) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const m = byId.get(x.id);
    if (m) out.push(m);
  }
  for (const x of local) {
    if (!seen.has(x.id)) out.push(x);
  }
  return out;
}

function registryServerKey(name: string): string {
  const base = `reg-${name.replace(/\//g, '-').replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  return base.length > 90 ? base.slice(0, 90) : base;
}

function mapRegistryRow(row: RegistryRow): CommunityMcpSeedItem | null {
  const official = row._meta?.['io.modelcontextprotocol.registry/official'];
  if (official && official.isLatest === false) return null;
  const s = row.server;
  const remote = s.remotes?.[0];
  if (!remote?.url) return null;
  const slug = s.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const id = `mcp-reg-${slug}:${s.version}`;
  const serverKey = registryServerKey(s.name);
  const repo = s.repository?.url;
  const sourceUrl = s.websiteUrl?.trim() || repo;
  return {
    id,
    identifier: id,
    title: s.title || s.name,
    titleEn: s.title || s.name,
    description: s.description ?? '',
    descriptionEn: s.description ?? '',
    tags: ['MCP Registry'],
    tagsEn: ['MCP Registry'],
    category: 'general',
    updatedAt: new Date().toISOString(),
    serverKey,
    mcpServer: { type: remote.type, url: remote.url },
    installNote:
      `条目来自官方 MCP Registry（https://registry.modelcontextprotocol.io/）。传输类型：${remote.type}。请确认当前 Claude / 客户端支持该远程 MCP。${repo ? ` 仓库：${repo}` : ''}`,
    installNoteEn: `From MCP Registry (https://registry.modelcontextprotocol.io/). Transport: ${remote.type}. Ensure your client supports this remote MCP.${repo ? ` Repo: ${repo}` : ''}`,
    sourceUrl,
  };
}

async function fetchMcpRegistryItems(): Promise<CommunityMcpSeedItem[]> {
  const out: CommunityMcpSeedItem[] = [];
  let cursor: string | undefined;
  while (out.length < REGISTRY_MAX) {
    const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
    url.searchParams.set('limit', String(Math.min(REGISTRY_PAGE, REGISTRY_MAX - out.length)));
    if (cursor) url.searchParams.set('cursor', cursor);
    const data = await fetchJson<{ servers?: RegistryRow[]; metadata?: { nextCursor?: string } }>(url.toString());
    const rows = data?.servers;
    if (!rows?.length) break;
    for (const row of rows) {
      const item = mapRegistryRow(row);
      if (item) out.push(item);
    }
    cursor = data?.metadata?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// ── 简单进程内缓存（避免每次列表请求都打 Registry）──

type CacheEntry<T> = { expires: number; value: T };

let cacheAssistants: CacheEntry<{ items: CommunityCatalogItem[]; origin: string; remoteUrl?: string }> | null = null;
let cacheSkills: CacheEntry<{ items: CommunitySkillSeedItem[]; origin: string; remoteUrl?: string }> | null = null;
let cacheMcp: CacheEntry<{ items: CommunityMcpSeedItem[]; origin: string; remoteUrl?: string }> | null = null;

function getCached<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry || Date.now() > entry.expires) return null;
  return entry.value;
}

export async function resolveAssistantCatalogItems(
  seedItems: CommunityCatalogItem[],
): Promise<{ items: CommunityCatalogItem[]; origin: string; remoteUrl?: string }> {
  const hit = getCached(cacheAssistants);
  if (hit) return hit;

  const url = process.env.PROJECT_PILOT_COMMUNITY_CATALOG_URL?.trim();
  let origin: string = 'local';
  let remoteUrl: string | undefined;

  let base: AgentInternal[] = seedItems.map((it) => ({ ...it, __ppOrigin: 'seed' }));
  if (shouldMergeDevBulk()) {
    const extra = (catalogDevBulk as { items?: CommunityCatalogItem[] }).items ?? [];
    if (extra.length) {
      base = [...base, ...extra.map((it) => ({ ...it, __ppOrigin: 'dev-bulk' as const }))];
      origin = 'dev-bulk';
    }
  }

  let merged: AgentInternal[] = base;
  if (url) {
    const payload = await fetchJson<CatalogPayload<CommunityCatalogItem>>(url);
    const remote = payload?.items;
    if (remote?.length) {
      merged = mergeRemoteFirst(
        base,
        remote.map((it) => ({ ...it, __ppOrigin: 'remote' as const })),
      );
      origin = 'remote';
      remoteUrl = url;
    }
  }

  const items = finalizeAssistantCatalogItems(merged);

  const result = { items, origin, remoteUrl };
  cacheAssistants = { expires: Date.now() + CACHE_TTL_MS, value: result };
  return result;
}

export async function resolveSkillsCatalogItems(
  seedItems: CommunitySkillSeedItem[],
): Promise<{ items: CommunitySkillSeedItem[]; origin: string; remoteUrl?: string }> {
  const hit = getCached(cacheSkills);
  if (hit) return hit;

  const url = process.env.PROJECT_PILOT_COMMUNITY_SKILLS_CATALOG_URL?.trim();
  let origin: string = 'local';
  let remoteUrl: string | undefined;

  const baseSeed: SkillInternal[] = seedItems.map((it) => ({ ...it, __ppSkillOrigin: 'seed' }));
  let base: SkillInternal[] = [...baseSeed];
  if (shouldMergeDevBulk()) {
    const extra = (skillsDevBulk as { items?: CommunitySkillSeedItem[] }).items ?? [];
    if (extra.length) {
      base = [...base, ...extra.map((it) => ({ ...it, __ppSkillOrigin: 'dev-bulk' as const }))];
      origin = 'dev-bulk';
    }
  }

  let merged: SkillInternal[] = base;
  if (url) {
    const payload = await fetchJson<CatalogPayload<CommunitySkillSeedItem>>(url);
    const remote = payload?.items;
    if (remote?.length) {
      merged = mergeRemoteFirst(
        base,
        remote.map((it) => ({ ...it, __ppSkillOrigin: 'remote' as const })),
      );
      origin = 'remote';
      remoteUrl = url;
    }
  }

  const items = finalizeSkillCatalogItems(merged);

  const result = { items, origin, remoteUrl };
  cacheSkills = { expires: Date.now() + CACHE_TTL_MS, value: result };
  return result;
}

export async function resolveMcpCatalogItems(
  seedItems: CommunityMcpSeedItem[],
): Promise<{ items: CommunityMcpSeedItem[]; origin: string; remoteUrl?: string }> {
  const hit = getCached(cacheMcp);
  if (hit) return hit;

  const url = process.env.PROJECT_PILOT_COMMUNITY_MCP_CATALOG_URL?.trim();
  const useRegistry = shouldUseMcpRegistry();

  let origin = 'local';
  let remoteUrl: string | undefined;

  const seedTagged: McpInternal[] = seedItems.map((it) => ({ ...it, __ppOrigin: 'seed' }));

  let items: CommunityMcpSeedItem[];

  if (url) {
    const payload = await fetchJson<CatalogPayload<CommunityMcpSeedItem>>(url);
    const remote = payload?.items;
    if (remote?.length) {
      const merged = mergeRemoteFirst(
        seedTagged,
        remote.map((it) => ({ ...it, __ppOrigin: 'remote' as const })),
      );
      items = finalizeMcpCatalogItems(merged);
      origin = 'remote';
      remoteUrl = url;
    } else {
      items = finalizeMcpCatalogItems(seedTagged);
    }
  } else if (useRegistry) {
    try {
      const reg = await fetchMcpRegistryItems();
      if (reg.length) {
        const merged: McpInternal[] = [
          ...reg.map((it) => ({ ...it, __ppOrigin: 'registry' as const })),
          ...seedTagged,
        ];
        items = finalizeMcpCatalogItems(merged);
        origin = 'registry';
        remoteUrl = 'https://registry.modelcontextprotocol.io/';
      } else {
        items = finalizeMcpCatalogItems(seedTagged);
      }
    } catch {
      items = finalizeMcpCatalogItems(seedTagged);
    }
  } else {
    items = finalizeMcpCatalogItems(seedTagged);
  }

  const result = { items, origin, remoteUrl };
  cacheMcp = { expires: Date.now() + CACHE_TTL_MS, value: result };
  return result;
}

export function findAssistantById(
  items: CommunityCatalogItem[],
  id: string,
): CommunityCatalogItem | undefined {
  return items.find((it) => it.id === id || it.identifier === id);
}

export function findSkillById(
  items: CommunitySkillSeedItem[],
  id: string,
): CommunitySkillSeedItem | undefined {
  return items.find((it) => it.id === id || it.identifier === id);
}

export function findMcpById(items: CommunityMcpSeedItem[], id: string): CommunityMcpSeedItem | undefined {
  return items.find((it) => it.id === id || it.identifier === id);
}
