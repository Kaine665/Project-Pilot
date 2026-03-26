/**
 * Static cartoon avatars under /public/agents/*.svg.
 * Slug (built-in) wins over icon key so each内置角色有固定人设图。
 */

const SLUG_TO_AVATAR: Record<string, string> = {
  butler: '/agents/butler.png',
  'task-worker': '/agents/task-worker.svg',
  'self-dev': '/agents/self-dev.svg',
  manager: '/agents/manager.svg',
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

export function resolveAgentAvatarSrc(
  slug?: string | null,
  icon?: string | null,
): string {
  const s = slug?.trim();
  if (s && SLUG_TO_AVATAR[s]) return SLUG_TO_AVATAR[s];
  const key = icon?.trim().toLowerCase();
  if (key && ICON_TO_AVATAR[key]) return ICON_TO_AVATAR[key];
  return GENERIC_AGENT_AVATAR;
}
