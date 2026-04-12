import type { ProjectEntry } from '@/types';

/** 系统保留：无本地目录时的默认工作区 key（与 `isValidProjectKey` 一致） */
export const DEFAULT_PLACEHOLDER_PROJECT_KEY = '_pp_inbox' as const;

export function isReservedDefaultProjectKey(key: string): boolean {
  return key === DEFAULT_PLACEHOLDER_PROJECT_KEY;
}

export function buildDefaultPlaceholderProject(): ProjectEntry {
  const now = new Date().toISOString();
  return {
    key: DEFAULT_PLACEHOLDER_PROJECT_KEY,
    /** 磁盘占位名；界面层对 systemPlaceholder 使用 i18n 覆盖展示 */
    name: 'General workspace',
    description:
      'Default space when no local folder is bound. Add a real project or set a path here anytime.',
    location: 'local',
    techStack: 'other',
    systemPlaceholder: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** 顶栏、列表等：内置默认工作区用 i18n 文案覆盖磁盘 `name` */
export function projectDisplayName(project: ProjectEntry, defaultNameI18n: string): string {
  if (project.systemPlaceholder || isReservedDefaultProjectKey(project.key)) return defaultNameI18n;
  return project.name;
}

/** 列表副标题：内置项用 i18n 描述，否则 description 或 key */
export function projectDisplaySubtitle(project: ProjectEntry, defaultDescI18n: string): string {
  if (project.systemPlaceholder || isReservedDefaultProjectKey(project.key)) return defaultDescI18n;
  return project.description?.trim() || project.key;
}
