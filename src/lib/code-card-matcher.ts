/**
 * Code Card Matcher
 *
 * 根据 ActiveTask 的 scope 匹配 Code Card 类型的知识文档（DocEntry）。
 * Code Card = documentKind knowledge + tags 含 code-card + coveredPaths。
 */

import type { DocEntry } from '@/types';

/**
 * 路径规范化：统一使用正斜杠，去除尾部斜杠
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 给定一组 scope 路径和全部 context 条目，返回匹配的 code card 条目。
 *
 * 匹配逻辑：
 * - card.coveredPaths 中任一路径是 scope 路径的前缀 → 匹配
 * - scope 路径是 card.coveredPaths 中任一路径的前缀 → 匹配
 *
 * 例：coveredPath = "src/lib/oauth-"，scope = "src/lib/oauth-flow.ts" → 匹配
 * 例：coveredPath = "src/lib/oauth-flow.ts"，scope = "src/lib/" → 匹配（scope 更宽）
 */
export function matchCodeCards(
  scopePaths: string[],
  entries: DocEntry[],
): DocEntry[] {
  const codeCards = entries.filter(
    e =>
      e.documentKind === 'knowledge' &&
      e.coveredPaths?.length &&
      e.tags?.includes('code-card') &&
      (!e.status || e.status === 'active'),
  );
  if (codeCards.length === 0 || scopePaths.length === 0) return [];

  const normalizedScopes = scopePaths.map(normalizePath);

  return codeCards.filter(card =>
    card.coveredPaths!.some(cp => {
      const ncp = normalizePath(cp);
      return normalizedScopes.some(sp =>
        sp.startsWith(ncp) || ncp.startsWith(sp),
      );
    }),
  );
}

/**
 * 为未匹配到 scope 的场景生成 code card 索引表（markdown）。
 * Agent 可通过 cat 命令按需读取具体卡片。
 */
export function buildCodeCardIndex(cards: DocEntry[], contentDir: string): string {
  if (cards.length === 0) return '';
  const header = '| Module | Description | Covered Paths | File |\n|--------|-------------|---------------|------|';
  const rows = cards.map(c => {
    const paths = c.coveredPaths?.join(', ') || '-';
    const filePath = c.sourcePath || `${contentDir}/${c.fileName}`;
    return `| ${c.title} | ${c.description ?? '-'} | \`${paths}\` | \`${filePath}\` |`;
  });
  return `## Code Cards 索引\n\n以下是本项目的 Code Cards。如需了解某个模块的详细信息，使用 cat 命令读取对应文件。\n\n${header}\n${rows.join('\n')}`;
}
