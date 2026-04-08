import type { AgentCapabilities } from '@/types';

/** 与 LobeHub 助手分类相近的本地枚举（用于侧栏与筛选）。 */
export type CommunityAssistantCategory =
  | 'all'
  | 'programming'
  | 'copywriting'
  | 'discover'
  | 'general';

export type CommunityCatalogSort = 'recommended' | 'updatedAt' | 'title';

/** Skill 在无 sourceNote 时由服务端或种子标注的提供方 */
export type CommunitySkillSourceProvider = 'project-pilot' | 'unknown';

/** 合并后条目来自哪条链路（列表「来源」筛选）；MCP Registry 单独标 `registry` */
export type CommunityCatalogListOrigin = 'seed' | 'dev-bulk' | 'remote' | 'registry';

/** @deprecated 使用 CommunityCatalogListOrigin；Skills JSON 仍可能只出现前三者 */
export type CommunitySkillListOrigin = Exclude<CommunityCatalogListOrigin, 'registry'>;

export interface CommunityCatalogItem {
  id: string;
  /** 对外展示与 URL 路径，默认等于 id */
  identifier?: string;
  title: string;
  /** 英文 UI 用；缺省时回退 title */
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  tags?: string[];
  tagsEn?: string[];
  /** lucide 图标名，如 wrench、book-open */
  icon?: string;
  systemPrompt?: string;
  systemPromptEn?: string;
  capabilities?: Partial<AgentCapabilities>;
  skillIds?: string[];
  author?: string;
  userName?: string;
  category?: CommunityAssistantCategory;
  createdAt?: string;
  updatedAt?: string;
  forkCount?: number;
  pluginCount?: number;
  knowledgeCount?: number;
  tokenUsage?: number;
  /** 上游社区或 Registry 页面，便于路线 B 外链溯源 */
  sourceUrl?: string;
  /** 人类可读来源说明（中文），与 Skills 种子字段语义一致 */
  sourceNote?: string;
  /** 人类可读来源说明（英文） */
  sourceNoteEn?: string;
  /** 目录合并管道（用于来源筛选） */
  catalogItemOrigin?: Exclude<CommunityCatalogListOrigin, 'registry'>;
}

export interface CommunityCatalogResponse {
  version: number;
  source: string;
  items: CommunityCatalogItem[];
  fetchedAt: string;
  /** local | remote | registry | merged */
  catalogOrigin?: string;
  /** 实际拉取的远程目录 URL（若有） */
  remoteCatalogUrl?: string;
}

/** 社区商店 — Skills 种子条目（安装时写入 SKILL.md）。 */
export interface CommunitySkillSeedItem {
  id: string;
  identifier?: string;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  tags?: string[];
  tagsEn?: string[];
  category?: CommunityAssistantCategory;
  updatedAt?: string;
  dirName: string;
  skillMarkdown: string;
  /** 英文界面详情预览；缺省用 skillMarkdown */
  skillMarkdownEn?: string;
  /** 人类可读来源说明（中文） */
  sourceNote?: string;
  /** 人类可读来源说明（英文） */
  sourceNoteEn?: string;
  /**
   * 外部参考或上游页面（http/https）；存在时 UI 提供「在浏览器中打开」。
   * 与 sourceNote 配合使用：正文仍可能由本仓库编写，链接指向规范/文档而非逐字转载。
   */
  sourceUrl?: string;
  /**
   * 无 `sourceNote` 时由服务端推断或 JSON 显式提供：`project-pilot` = 内置种子/开发扩展/未被远程覆盖的本地项；`unknown` = 来自远程合并或同 id 被远程覆盖且未写说明。
   */
  sourceProvider?: CommunitySkillSourceProvider;
  /** 合并管道：内置种子 / 开发扩展 / 远程 JSON（用于筛选，与 `sourceProvider` 互补） */
  skillListOrigin?: CommunitySkillListOrigin;
}

export interface CommunitySkillsCatalogResponse {
  version: number;
  source: string;
  items: CommunitySkillSeedItem[];
  fetchedAt: string;
  catalogOrigin?: string;
  remoteCatalogUrl?: string;
}

/** 社区商店 — MCP 种子条目（安装时合并进 config/mcp-market.json）。 */
export interface CommunityMcpSeedItem {
  id: string;
  identifier?: string;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  tags?: string[];
  tagsEn?: string[];
  category?: CommunityAssistantCategory;
  updatedAt?: string;
  serverKey: string;
  mcpServer: unknown;
  requiresProjectPath?: boolean;
  installNote?: string;
  installNoteEn?: string;
  sourceUrl?: string;
  /** 目录合并：种子 / 远程 JSON / MCP Registry */
  catalogItemOrigin?: CommunityCatalogListOrigin;
}

export interface CommunityMcpCatalogResponse {
  version: number;
  source: string;
  items: CommunityMcpSeedItem[];
  fetchedAt: string;
  catalogOrigin?: string;
  remoteCatalogUrl?: string;
}
