/**
 * `prompts/global/rules/*.md` 与 `prompts/projects/{key}/rules/*.md` 条件注入（Phase 3）。
 * Frontmatter 见 `docs/design/prompt-system-architecture.md` §4.2。
 */

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import picomatch from 'picomatch';
import { getGlobalPromptRulesDir, getProjectPromptRulesDir } from '@/lib/file-store';

export interface PromptRuleFrontmatter {
  alwaysApply?: boolean;
  globs?: string[];
  description?: string;
  manual?: boolean;
  concern?: string;
}

function parseFrontmatter(raw: string): { attrs: PromptRuleFrontmatter; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('---')) {
    return { attrs: { alwaysApply: true }, body: raw.trim() };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { attrs: { alwaysApply: true }, body: raw.trim() };
  }

  let i = 1;
  const fmLines: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '---') break;
    fmLines.push(line);
    i++;
  }
  if (i >= lines.length) {
    return { attrs: {}, body: raw.trim() };
  }

  const body = lines.slice(i + 1).join('\n').replace(/^\n/, '');
  let attrs: PromptRuleFrontmatter = {};
  try {
    const parsed = yaml.load(fmLines.join('\n'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attrs = parsed as PromptRuleFrontmatter;
    }
  } catch {
    attrs = {};
  }

  return { attrs, body: body.trim() };
}

/** 是否应自动注入该条 rule（不含 manual / 纯 description 占位） */
function shouldInjectRule(attrs: PromptRuleFrontmatter, matchPaths: string[]): boolean {
  if (attrs.manual === true) return false;

  const hasGlobs = Array.isArray(attrs.globs) && attrs.globs.length > 0;
  const onlyDescription =
    attrs.description != null &&
    String(attrs.description).trim() !== '' &&
    !hasGlobs &&
    attrs.alwaysApply !== true;

  if (onlyDescription) {
    // 设计态「由模型判断是否相关」— 服务端暂不实现，不自动注入
    return false;
  }

  if (hasGlobs) {
    return pathsMatchAnyGlob(matchPaths, attrs.globs!);
  }

  if (attrs.alwaysApply === false) return false;

  return true;
}

function pathsMatchAnyGlob(paths: string[], globs: string[]): boolean {
  if (paths.length === 0 || globs.length === 0) return false;
  const normalizedGlobs = globs.map(g => g.replace(/\\/g, '/'));
  const opts = { dot: true } as const;
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    if (picomatch.isMatch(p, normalizedGlobs, opts)) return true;
    const base = path.posix.basename(p);
    if (picomatch.isMatch(base, normalizedGlobs, opts)) return true;
  }
  return false;
}

/**
 * 将工作区路径转为用于 glob 匹配的候选串（绝对 + 相对项目根）。
 */
export function normalizePathsForPromptGlobs(paths: string[], projectRoot?: string): string[] {
  const out = new Set<string>();
  const root = projectRoot ? path.normalize(projectRoot) : '';
  const rootPosix = root.replace(/\\/g, '/');

  for (const raw of paths) {
    const n = path.normalize(raw).replace(/\\/g, '/');
    out.add(n);
    if (rootPosix && n.startsWith(rootPosix)) {
      const rel = n.slice(rootPosix.length).replace(/^\//, '');
      if (rel) out.add(rel);
    }
  }
  return [...out];
}

async function loadRulesFromDir(rulesDir: string, matchPaths: string[]): Promise<string> {
  let names: string[] = [];
  try {
    names = await readdir(rulesDir);
  } catch {
    return '';
  }

  const mdFiles = names.filter(f => f.endsWith('.md')).sort((a, b) => a.localeCompare(b));
  const chunks: string[] = [];

  for (const name of mdFiles) {
    const full = path.join(rulesDir, name);
    let raw: string;
    try {
      raw = await readFile(full, 'utf-8');
    } catch {
      continue;
    }

    const { attrs, body } = parseFrontmatter(raw);
    if (!body.trim()) continue;
    if (!shouldInjectRule(attrs, matchPaths)) continue;

    chunks.push(body.trim());
  }

  return chunks.join('\n\n---\n\n');
}

/** 全局 rules（在 global.md / global.d 正文之后拼接） */
export async function loadGlobalPromptRulesContent(matchPaths: string[]): Promise<string> {
  return loadRulesFromDir(getGlobalPromptRulesDir(), matchPaths);
}

/** 项目 rules（在 project.md / project.d 正文之后拼接） */
export async function loadProjectPromptRulesContent(
  projectKey: string,
  matchPaths: string[],
): Promise<string> {
  return loadRulesFromDir(getProjectPromptRulesDir(projectKey), matchPaths);
}
