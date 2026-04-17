/**
 * 从 ZIP 安装标准 skill 目录（SKILL.md + scripts|references|assets）。
 * 与导出 ZIP（routes/skills.ts createSkillZip）布局互操作。
 */

// unzipper 无官方 TS 类型
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unzipper = require('unzipper') as { Open: { buffer: (buf: Buffer) => Promise<UnzipDirectory> } };

import type { SkillScope } from './file-store';
import {
  MAX_SKILL_SIZE,
  parseSkillFrontmatter,
  parseSkillBundleRelativePath,
  writeSkillFile,
  writeSkillSubFile,
} from './skill-store';

interface UnzipEntry {
  path: string;
  type: string;
  buffer: (password?: string) => Promise<Buffer>;
}

interface UnzipDirectory {
  files: Promise<UnzipEntry[]>;
}

const MAX_SKILL_ZIP_BYTES = 50 * 1024 * 1024;

function normalizeZipPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

export interface InstallSkillZipResult {
  name: string;
  scope: SkillScope;
  /** 相对 skill 根的路径 */
  written: string[];
  /** 因非 UTF-8 或过大而跳过的条目 */
  skipped: string[];
}

/**
 * 将 buffer 解压为单个 skill：须含 `SKILL.md`（压缩包根目录）或唯一一层 `name/SKILL.md`。
 * 仅写入 `SKILL.md` 与 `scripts/`、`references/`、`assets/` 下的一层文件（与 PP 约定一致）。
 */
export async function installSkillFromZipBuffer(
  zipBuffer: Buffer,
  scope: SkillScope,
  opts?: { dirNameOverride?: string },
): Promise<InstallSkillZipResult> {
  if (zipBuffer.length > MAX_SKILL_ZIP_BYTES) {
    throw new Error(`ZIP too large (max ${MAX_SKILL_ZIP_BYTES} bytes)`);
  }

  const directory = await unzipper.Open.buffer(zipBuffer);
  const rawFiles = await directory.files;

  const entries: UnzipEntry[] = [];
  for (const e of rawFiles) {
    if (e.type === 'Directory') continue;
    const p = normalizeZipPath(e.path);
    if (!p || p.includes('..')) continue;
    entries.push(e);
  }

  const skillMdPaths = entries
    .map(e => normalizeZipPath(e.path))
    .filter(p => /(^|\/)SKILL\.md$/i.test(p));

  if (skillMdPaths.length === 0) {
    throw new Error('ZIP must contain SKILL.md');
  }

  let rootPrefix = '';
  let skillEntry: UnzipEntry;

  const hasRootSkill = skillMdPaths.some(p => /^SKILL\.md$/i.test(p));
  if (hasRootSkill) {
    if (skillMdPaths.some(p => !/^SKILL\.md$/i.test(p))) {
      throw new Error('ZIP must not mix root SKILL.md with nested */SKILL.md');
    }
    const ent = entries.find(e => /^SKILL\.md$/i.test(normalizeZipPath(e.path)));
    if (!ent) throw new Error('SKILL.md not found');
    skillEntry = ent;
    rootPrefix = '';
  } else {
    const folderNames = new Set<string>();
    for (const p of skillMdPaths) {
      const parts = p.split('/');
      if (parts.length === 2 && parts[1]!.toLowerCase() === 'skill.md') {
        folderNames.add(parts[0]!);
      }
    }
    if (folderNames.size !== 1) {
      throw new Error(
        'ZIP layout: use SKILL.md at archive root, or exactly one folder like my-skill/SKILL.md',
      );
    }
    const folder = [...folderNames][0]!;
    rootPrefix = `${folder}/`;
    const ent = entries.find(e => normalizeZipPath(e.path).toLowerCase() === `${folder.toLowerCase()}/skill.md`);
    if (!ent) throw new Error('SKILL.md not found');
    skillEntry = ent;
  }

  const skillMdBuf = await skillEntry.buffer();
  if (skillMdBuf.length > MAX_SKILL_SIZE) {
    throw new Error(`SKILL.md too large (max ${MAX_SKILL_SIZE} bytes)`);
  }
  const skillMdText = skillMdBuf.toString('utf8');
  const meta = parseSkillFrontmatter(skillMdText);
  if (!meta) {
    throw new Error('SKILL.md must have valid YAML frontmatter (name, description)');
  }

  const folderFromZip = rootPrefix ? rootPrefix.replace(/\/$/, '') : '';
  const rawName = (opts?.dirNameOverride?.trim() || folderFromZip || meta.name).replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
  if (!rawName || rawName.length > 100) {
    throw new Error('Invalid skill name / directory name');
  }

  await writeSkillFile(rawName, skillMdText, scope);
  const written: string[] = ['SKILL.md'];
  const skipped: string[] = [];

  for (const e of entries) {
    const full = normalizeZipPath(e.path);
    if (/^SKILL\.md$/i.test(full)) continue;
    if (rootPrefix && full.toLowerCase() === `${rootPrefix.toLowerCase()}skill.md`) continue;

    if (rootPrefix) {
      if (!full.startsWith(rootPrefix)) continue;
    }

    const rel = rootPrefix && full.startsWith(rootPrefix) ? full.slice(rootPrefix.length) : full;
    if (!rel || rel.includes('..')) continue;
    if (/^\.history\//i.test(rel)) continue;

    const mapped = parseSkillBundleRelativePath(rel);
    if (!mapped) continue;

    const buf = await e.buffer();
    if (buf.length > MAX_SKILL_SIZE) {
      skipped.push(rel);
      continue;
    }
    let text: string;
    try {
      text = buf.toString('utf8');
    } catch {
      skipped.push(rel);
      continue;
    }
    if (Buffer.byteLength(text, 'utf8') !== buf.length) {
      skipped.push(rel);
      continue;
    }

    try {
      await writeSkillSubFile(rawName, mapped.subdir, mapped.fileName, text, scope);
      written.push(rel);
    } catch {
      skipped.push(rel);
    }
  }

  return { name: rawName, scope, written, skipped };
}
