/**
 * Code Card Matcher
 *
 * 根据 ActiveTask 的 scope（文件路径列表）匹配 Code Card 类型的 ContextEntry。
 * 匹配算法：前缀匹配（双向）。
 *
 * Code Card = tags 包含 'code-card' 的 ContextEntry，带 coveredPaths 字段。
 */

import type { ContextEntry } from '@/types';

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
  entries: ContextEntry[],
): ContextEntry[] {
  const codeCards = entries.filter(
    e => e.coveredPaths?.length &&
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
export function buildCodeCardIndex(cards: ContextEntry[], contextDir: string): string {
  if (cards.length === 0) return '';
  const header = '| Module | Description | Covered Paths | File |\n|--------|-------------|---------------|------|';
  const rows = cards.map(c => {
    const paths = c.coveredPaths?.join(', ') || '-';
    const filePath = c.sourcePath || `${contextDir}/${c.fileName}`;
    return `| ${c.label} | ${c.description} | \`${paths}\` | \`${filePath}\` |`;
  });
  return `## Code Cards 索引\n\n以下是本项目的 Code Cards。如需了解某个模块的详细信息，使用 cat 命令读取对应文件。\n\n${header}\n${rows.join('\n')}`;
}
