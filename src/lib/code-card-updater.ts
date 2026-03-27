/**
 * Code Card Updater
 *
 * Detects which Code Cards are stale (their covered source files changed
 * since the card was last updated), regenerates content via AI, and
 * updates the context entries.
 *
 * Can be used as:
 * 1. CLI: `npx tsx src/lib/code-card-updater.ts [--dry-run] [--since <commit>] [--card <id>]`
 * 2. Library: import { refreshStaleCodeCards } from './code-card-updater'
 */

import { execSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import {
  getContextIndexPath,
  getContextFilePath,
  modifyJsonFile,
} from '@/lib/file-store';
import { getAppWorkingDir } from '@/lib/app-paths';
import { callLightweightAI } from '@/lib/lightweight-ai';
import type { ContextEntry, ContextIndexData } from '@/types';

const LOG = '[CodeCardUpdater]';

// ── Types ──

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

// ── Core logic ──

/**
 * Load all Code Cards from the context index.
 */
async function loadCodeCards(): Promise<ContextEntry[]> {
  try {
    const raw = await readFile(getContextIndexPath(), 'utf-8');
    const data: ContextIndexData = JSON.parse(raw);
    return data.entries.filter(
      e => e.tags?.includes('code-card') &&
        e.coveredPaths?.length &&
        (!e.status || e.status === 'active'),
    );
  } catch {
    return [];
  }
}

/**
 * Get list of files changed since a given commit ref.
 */
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

/**
 * Get the last commit hash stored in a card's metadata.
 * Falls back to checking git log for the card's updatedAt timestamp.
 */
function getCardLastCommit(card: ContextEntry): string | undefined {
  return card.lastCheckedCommit;
}

/**
 * Get the current HEAD commit hash.
 */
function getCurrentCommit(): string {
  const cwd = getAppWorkingDir();
  return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
}

/**
 * Normalize path for comparison (forward slashes, no trailing slash).
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Check if a file path matches any of the card's coveredPaths (prefix match).
 */
function fileMatchesCoveredPaths(file: string, coveredPaths: string[]): boolean {
  const nf = normalizePath(file);
  return coveredPaths.some(cp => {
    const ncp = normalizePath(cp);
    return nf.startsWith(ncp) || ncp.startsWith(nf);
  });
}

/**
 * Read source files covered by a card (up to a budget) for AI context.
 */
async function readCoveredSources(
  coveredPaths: string[],
  changedFiles: string[],
  maxChars: number = 30_000,
): Promise<string> {
  const cwd = getAppWorkingDir();
  const relevantFiles = changedFiles.filter(f => fileMatchesCoveredPaths(f, coveredPaths));

  // Also include key files from coveredPaths that might not be in changedFiles
  // to give AI full context
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
      // File might have been deleted
    }
  }

  return sections.join('\n\n');
}

/**
 * Build a prompt for AI to regenerate a Code Card's content.
 */
function buildRegeneratePrompt(card: ContextEntry, sourceCode: string): string {
  return `你是一个代码理解助手。请根据以下源代码更新模块理解文档。

当前 Code Card 标题：${card.label}
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

/**
 * Main entry: check all Code Cards for staleness and optionally refresh.
 */
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
      // No baseline — skip unless explicit sinceCommit provided
      if (!sinceCommit) {
        result.details.push({
          id: card.id,
          label: card.label,
          status: 'skipped',
          error: 'No lastCheckedCommit baseline',
        });
        continue;
      }
    }

    const ref = lastCommit || 'HEAD~10'; // fallback: last 10 commits
    const changedFiles = getChangedFiles(ref);
    const relevantChanges = changedFiles.filter(
      f => fileMatchesCoveredPaths(f, card.coveredPaths!),
    );

    if (relevantChanges.length === 0) {
      result.details.push({
        id: card.id,
        label: card.label,
        status: 'up-to-date',
      });
      continue;
    }

    // Card is stale
    result.stale++;
    console.log(`${LOG} Stale: "${card.label}" — ${relevantChanges.length} file(s) changed`);

    if (dryRun) {
      result.details.push({
        id: card.id,
        label: card.label,
        status: 'skipped',
        changedFiles: relevantChanges,
      });
      continue;
    }

    // Regenerate via AI
    try {
      const sourceCode = await readCoveredSources(card.coveredPaths!, changedFiles);
      if (!sourceCode.trim()) {
        result.details.push({
          id: card.id,
          label: card.label,
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
          label: card.label,
          status: 'failed',
          changedFiles: relevantChanges,
          error: 'AI returned empty or too short',
        });
        continue;
      }

      // Write updated content file
      await writeFile(getContextFilePath(card.fileName), newContent, 'utf-8');

      // Update index: set lastCheckedCommit and updatedAt
      await modifyJsonFile<ContextIndexData>(
        getContextIndexPath(),
        { entries: [] },
        (data) => {
          const entry = data.entries.find(e => e.id === card.id);
          if (entry) {
            entry.updatedAt = new Date().toISOString();
            entry.lastCheckedCommit = currentCommit;
          }
          return data;
        },
      );

      result.updated++;
      result.details.push({
        id: card.id,
        label: card.label,
        status: 'updated',
        changedFiles: relevantChanges,
      });

      console.log(`${LOG} Updated: "${card.label}"`);
    } catch (err) {
      result.failed++;
      result.details.push({
        id: card.id,
        label: card.label,
        status: 'failed',
        changedFiles: relevantChanges,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`${LOG} Failed to update "${card.label}":`, err);
    }
  }

  return result;
}

/**
 * Stamp all existing Code Cards with the current commit as baseline.
 * Call this once after initial card creation to establish the baseline.
 */
export async function stampAllCardsWithCurrentCommit(): Promise<number> {
  const currentCommit = getCurrentCommit();
  const cards = await loadCodeCards();

  await modifyJsonFile<ContextIndexData>(
    getContextIndexPath(),
    { entries: [] },
    (data) => {
      for (const entry of data.entries) {
        if (entry.tags?.includes('code-card') && entry.coveredPaths?.length) {
          entry.lastCheckedCommit = currentCommit;
        }
      }
      return data;
    },
  );

  console.log(`${LOG} Stamped ${cards.length} Code Cards with commit ${currentCommit.slice(0, 8)}`);
  return cards.length;
}

// ── CLI ──

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
