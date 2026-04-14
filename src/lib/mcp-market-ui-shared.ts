/**
 * MCP 市场条目的纯函数（无 Node/fs），供前端与 `mcp-market-store` 共用。
 */

const PP_MCP_META_KEYS = ['enabled', 'description'] as const;

export function isMcpServerEntryEnabled(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return true;
  const e = (cfg as Record<string, unknown>).enabled;
  if (typeof e === 'boolean') return e;
  return true;
}

/** 卡片简介：配置中的 `description` 字符串。 */
export function getMcpEntryDescription(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  const d = (cfg as Record<string, unknown>).description;
  if (typeof d !== 'string') return null;
  const s = d.trim();
  return s.length ? s : null;
}

/** 供搜索/调试：启动命令一行摘要（非简介）。 */
export function getMcpEntryCommandSummary(cfg: unknown): string {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return '';
  const o = cfg as Record<string, unknown>;
  if (typeof o.url === 'string') return o.url;
  const cmd = typeof o.command === 'string' ? o.command : '';
  const args = Array.isArray(o.args) ? o.args.map((a) => String(a)) : [];
  return [cmd, ...args].filter(Boolean).join(' ');
}

/** 传给 MCP 宿主前去掉 PP 扩展字段。 */
export function stripMcpEntryForSpawn(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return cfg;
  const o = { ...(cfg as Record<string, unknown>) };
  for (const k of PP_MCP_META_KEYS) {
    delete o[k];
  }
  return o;
}

export function mergeMcpServersForSpawn(
  marketServers: Record<string, unknown> | undefined,
  projectServers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const keys = new Set([
    ...Object.keys(marketServers ?? {}),
    ...Object.keys(projectServers ?? {}),
  ]);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const raw =
      projectServers && Object.prototype.hasOwnProperty.call(projectServers, k)
        ? projectServers[k]
        : marketServers?.[k];
    if (raw === undefined) continue;
    if (!isMcpServerEntryEnabled(raw)) continue;
    out[k] = stripMcpEntryForSpawn(raw);
  }
  return out;
}
