/**
 * Static cartoon avatars under /public/agents/*.svg.
 * 内置 Agent：默认 icon（与 defaults/agents.json 一致）或留空时用 slug 立绘；
 * 用户改过 icon 后优先用 ICON_TO_AVATAR，便于在设置里自选头像风格。
 */

const SLUG_TO_AVATAR: Record<string, string> = {
  butler: '/agents/butler.png',
  'self-dev': '/agents/self-dev.svg',
};

/** 与各内置条目的默认 icon 对齐；与之一致（或 icon 未设置）时才用 slug 专属图 */
const SLUG_DEFAULT_ICON: Record<string, string> = {
  butler: 'sparkles',
  'self-dev': 'wrench',
};

const ICON_TO_AVATAR: Record<string, string> = {
  sparkles: '/agents/sparkles.svg',
  bot: '/agents/bot.svg',
  brain: '/agents/brain.svg',
  database: '/agents/database.svg',
  code: '/agents/code.svg',
  terminal: '/agents/terminal.svg',
  zap: '/agents/zap.svg',
  search: '/agents/search.svg',
  shield: '/agents/shield.svg',
  wrench: '/agents/wrench.svg',
  'book-open': '/agents/book-open.svg',
  users: '/agents/users.svg',
};

export const GENERIC_AGENT_AVATAR = '/agents/generic.svg';

export type AgentAvatarResolveOptions = {
  customAvatar?: boolean;
  agentId?: string | null;
  updatedAt?: string | null;
};

export function resolveAgentAvatarSrc(
  slug?: string | null,
  icon?: string | null,
  options?: AgentAvatarResolveOptions,
): string {
  if (options?.customAvatar && options.agentId) {
    const q = options.updatedAt ? `?t=${encodeURIComponent(options.updatedAt)}` : '';
    return `/api/agents/avatar/${encodeURIComponent(options.agentId)}${q}`;
  }
  const s = slug?.trim();
  const key = icon?.trim().toLowerCase();
  if (s && SLUG_TO_AVATAR[s]) {
    const def = SLUG_DEFAULT_ICON[s]?.toLowerCase();
    if (!def || key === '' || key === def) {
      return SLUG_TO_AVATAR[s];
    }
  }
  if (key && ICON_TO_AVATAR[key]) return ICON_TO_AVATAR[key];
  return GENERIC_AGENT_AVATAR;
}
