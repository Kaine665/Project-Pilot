/**
 * Code Card Updater
 *
 * Detects which Code Cards are stale (their covered source files changed
 * since the card was last updated), regenerates content via AI, and
 * updates documents/content + documents/entries.
 */

import { execSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { getDocumentContentPath } from '@/lib/file-store';
import { readDocsIndexFromDocuments, saveDocsIndexToDocuments } from '@/lib/documents-store';
import { getAppWorkingDir } from '@/lib/app-paths';
import { callLightweightAI } from '@/lib/lightweight-ai';
import type { DocEntry } from '@/types';

const LOG = '[CodeCardUpdater]';

export interface RefreshResult {
  checked: number;
  stale: number;
  updated: number;
  failed: number;
  details: CardRefreshDetail[];
}

export interface CardRefreshDetail {
  id: string;
  label: string;
  status: 'up-to-date' | 'updated' | 'failed' | 'skipped';
  changedFiles?: string[];
  error?: string;
}

async function loadCodeCards(): Promise<DocEntry[]> {
  const idx = await readDocsIndexFromDocuments();
  const flat = Object.values(idx.projects).flat();
  return flat.filter(
    e =>
      e.documentKind === 'knowledge' &&
      e.tags?.includes('code-card') &&
      e.coveredPaths?.length &&
      (!e.status || e.status === 'active'),
  );
}

function getChangedFiles(sinceRef: string): string[] {
  const cwd = getAppWorkingDir();
  try {
    const output = execSync(`git diff --name-only ${sinceRef}..HEAD`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`${LOG} git diff failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

function getCardLastCommit(card: DocEntry): string | undefined {
  return card.lastCheckedCommit;
}

function getCurrentCommit(): string {
  const cwd = getAppWorkingDir();
  return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function fileMatchesCoveredPaths(file: string, coveredPaths: string[]): boolean {
  const nf = normalizePath(file);
  return coveredPaths.some(cp => {
    const ncp = normalizePath(cp);
    return nf.startsWith(ncp) || ncp.startsWith(nf);
  });
}

async function readCoveredSources(
  coveredPaths: string[],
  changedFiles: string[],
  maxChars: number = 30_000,
): Promise<string> {
  const cwd = getAppWorkingDir();
  const relevantFiles = changedFiles.filter(f => fileMatchesCoveredPaths(f, coveredPaths));
  const allFiles = [...new Set([...relevantFiles])];

  let totalChars = 0;
  const sections: string[] = [];

  for (const file of allFiles) {
    if (totalChars >= maxChars) break;
    try {
      const fullPath = `${cwd}/${file}`;
      const content = await readFile(fullPath, 'utf-8');
      const truncated = content.slice(0, Math.min(content.length, maxChars - totalChars));
      sections.push(`### ${file}\n\`\`\`typescript\n${truncated}\n\`\`\``);
      totalChars += truncated.length;
    } catch {
      /* file missing */
    }
  }

  return sections.join('\n\n');
}

function buildRegeneratePrompt(card: DocEntry, sourceCode: string): string {
  return `你是一个代码理解助手。请根据以下源代码更新模块理解文档。

当前 Code Card 标题：${card.title}
当前 Code Card 描述：${card.description || ''}
覆盖路径：${card.coveredPaths?.join(', ')}

以下是该模块最新变更的源代码：
---
${sourceCode}
---

请输出更新后的模块理解文档（Markdown 格式），保持与原格式一致。要求：
1. 用 # 标题开头，模块名
2. 列出核心文件职责
3. 关键数据结构/接口
4. 核心函数及其流程
5. 重要的设计决策和约束
6. 与其他模块的交互关系

直接输出 Markdown 内容，不要加额外包裹。控制在 300-800 字。`;
}

async function patchCardCommit(cardId: string, currentCommit: string): Promise<void> {
  const idx = await readDocsIndexFromDocuments();
  const now = new Date().toISOString();
  for (const pk of Object.keys(idx.projects)) {
    const arr = idx.projects[pk];
    const i = arr.findIndex(e => e.id === cardId);
    if (i >= 0) {
      arr[i] = { ...arr[i], updatedAt: now, lastCheckedCommit: currentCommit };
    }
  }
  await saveDocsIndexToDocuments(idx);
}

export async function refreshStaleCodeCards(options: {
  dryRun?: boolean;
  sinceCommit?: string;
  cardId?: string;
} = {}): Promise<RefreshResult> {
  const { dryRun = false, sinceCommit, cardId } = options;

  let cards = await loadCodeCards();
  if (cardId) {
    cards = cards.filter(c => c.id === cardId);
  }

  if (cards.length === 0) {
    console.log(`${LOG} No Code Cards found.`);
    return { checked: 0, stale: 0, updated: 0, failed: 0, details: [] };
  }

  const currentCommit = getCurrentCommit();
  const result: RefreshResult = { checked: cards.length, stale: 0, updated: 0, failed: 0, details: [] };

  for (const card of cards) {
    const lastCommit = sinceCommit || getCardLastCommit(card);

    if (!lastCommit) {
      if (!sinceCommit) {
        result.details.push({
          id: card.id,
          label: card.title,
          status: 'skipped',
          error: 'No lastCheckedCommit baseline',
        });
        continue;
      }
    }

    const ref = lastCommit || 'HEAD~10';
    const changedFiles = getChangedFiles(ref);
    const relevantChanges = changedFiles.filter(
      f => fileMatchesCoveredPaths(f, card.coveredPaths!),
    );

    if (relevantChanges.length === 0) {
      result.details.push({
        id: card.id,
        label: card.title,
        status: 'up-to-date',
      });
      continue;
    }

    result.stale++;
    console.log(`${LOG} Stale: "${card.title}" — ${relevantChanges.length} file(s) changed`);

    if (dryRun) {
      result.details.push({
        id: card.id,
        label: card.title,
        status: 'skipped',
        changedFiles: relevantChanges,
      });
      continue;
    }

    try {
      const sourceCode = await readCoveredSources(card.coveredPaths!, changedFiles);
      if (!sourceCode.trim()) {
        result.details.push({
          id: card.id,
          label: card.title,
          status: 'skipped',
          changedFiles: relevantChanges,
          error: 'No readable source files',
        });
        continue;
      }

      const prompt = buildRegeneratePrompt(card, sourceCode);
      const newContent = await callLightweightAI(prompt, 60_000);

      if (!newContent || newContent.length < 100) {
        result.failed++;
        result.details.push({
          id: card.id,
          label: card.title,
          status: 'failed',
          changedFiles: relevantChanges,
          error: 'AI returned empty or too short',
        });
        continue;
      }

      const writePath = card.sourcePath || getDocumentContentPath(card.fileName);
      await writeFile(writePath, newContent, 'utf-8');
      await patchCardCommit(card.id, currentCommit);

      result.updated++;
      result.details.push({
        id: card.id,
        label: card.title,
        status: 'updated',
        changedFiles: relevantChanges,
      });

      console.log(`${LOG} Updated: "${card.title}"`);
    } catch (err) {
      result.failed++;
      result.details.push({
        id: card.id,
        label: card.title,
        status: 'failed',
        changedFiles: relevantChanges,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`${LOG} Failed to update "${card.title}":`, err);
    }
  }

  return result;
}

export async function stampAllCardsWithCurrentCommit(): Promise<number> {
  const currentCommit = getCurrentCommit();
  const cards = await loadCodeCards();

  for (const card of cards) {
    if (card.tags?.includes('code-card') && card.coveredPaths?.length) {
      await patchCardCommit(card.id, currentCommit);
    }
  }

  console.log(`${LOG} Stamped ${cards.length} Code Cards with commit ${currentCommit.slice(0, 8)}`);
  return cards.length;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const stampMode = args.includes('--stamp');

  const sinceIdx = args.indexOf('--since');
  const sinceCommit = sinceIdx !== -1 ? args[sinceIdx + 1] : undefined;

  const cardIdx = args.indexOf('--card');
  const cardId = cardIdx !== -1 ? args[cardIdx + 1] : undefined;

  if (stampMode) {
    const count = await stampAllCardsWithCurrentCommit();
    console.log(JSON.stringify({ stamped: count }));
    return;
  }

  const result = await refreshStaleCodeCards({ dryRun, sinceCommit, cardId });

  console.log(JSON.stringify({
    checked: result.checked,
    stale: result.stale,
    updated: result.updated,
    failed: result.failed,
    details: result.details,
  }, null, 2));
}

if (require.main === module || process.argv[1]?.includes('code-card-updater')) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
