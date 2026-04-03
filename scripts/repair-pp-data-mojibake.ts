/**
 * 遍历 PP 数据根目录，仅对**明确可疑**的文本尝试轻度修复（Latin-1 误读 UTF-8），并写回。
 *
 * 不再使用 repairStoredTextIfNeeded / GB18030 试探，避免误伤已是合法 UTF-8 的中文文件。
 *
 * 触发条件（任一）：
 * - 含 Unicode 替换字符 U+FFFD
 * - 含 UTF-8 解码替换字符
 *
 * 用法：
 *   bun scripts/repair-pp-data-mojibake.ts [DATA_DIR]
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { repairTextIfNeeded } from '../src/lib/text-repair';

const REPLACEMENT = '\uFFFD';
const MAX_BYTES = 8 * 1024 * 1024;

const SKIP_EXT = new Set([
  '', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.7z', '.rar',
  '.exe', '.dll', '.node', '.wasm', '.pdf', '.mp3', '.mp4', '.webm', '.woff', '.woff2',
  '.ttf', '.eot', '.sqlite', '.db',
]);

const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv',
  '.html', '.htm', '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.env',
  '.gitignore', '.editorconfig',
]);

const SPECIAL_NAMES = new Set(['LICENSE', 'README', 'CHANGELOG', 'CONTRIBUTING']);

function shouldConsiderFile(filePath: string, base: string): boolean {
  const rel = path.relative(base, filePath).replace(/\\/g, '/');
  if (rel.includes('/node_modules/') || rel.startsWith('node_modules/')) return false;
  if (rel.includes('/.git/')) return false;

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);
  if (SKIP_EXT.has(ext)) return false;
  if (ext === '.jsonl') return false;
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && SPECIAL_NAMES.has(baseName)) return true;
  return false;
}

function isProbablyBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(8192, buf.length));
  if (sample.length === 0) return false;
  let nul = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) nul++;
  }
  return nul / sample.length > 0.02;
}

function needsRepair(text: string): boolean {
  return text.includes(REPLACEMENT) || text.includes('\0');
}

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full, root);
    } else if (ent.isFile()) {
      if (shouldConsiderFile(full, root)) yield full;
    }
  }
}

function tryParseJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** 去 NUL + 仅 Latin-1→UTF8 修复路径 */
function sanitizeText(text: string): string {
  const noNul = text.replace(/\0/g, '');
  return repairTextIfNeeded(noNul) ?? noNul;
}

async function repairJsonlFile(filePath: string): Promise<'fixed' | 'skip' | 'unchanged'> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const lines: string[] = [];
  let changed = false;
  for await (const line of rl) {
    if (!line.trim()) {
      lines.push(line);
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      lines.push(line);
      continue;
    }
    if (typeof obj !== 'object' || obj === null) {
      lines.push(line);
      continue;
    }
    const o = obj as Record<string, unknown>;
    let lineChanged = false;
    for (const key of Object.keys(o)) {
      const v = o[key];
      if (typeof v !== 'string' || v.length === 0) continue;
      if (!needsRepair(v)) continue;
      const r = sanitizeText(v);
      if (r !== v) {
        o[key] = r;
        lineChanged = true;
      }
    }
    if (lineChanged) {
      lines.push(JSON.stringify(obj));
      changed = true;
    } else {
      lines.push(line);
    }
  }
  if (!changed) return 'unchanged';
  const out = lines.join('\n') + (lines.length ? '\n' : '');
  await fs.writeFile(filePath, out, 'utf-8');
  return 'fixed';
}

async function repairWholeFile(filePath: string): Promise<'fixed' | 'skip' | 'unchanged'> {
  const st = await fs.stat(filePath);
  if (st.size > MAX_BYTES) return 'skip';

  const buf = await fs.readFile(filePath);
  if (isProbablyBinary(buf)) return 'skip';

  let text: string;
  try {
    text = buf.toString('utf8');
  } catch {
    return 'skip';
  }

  if (!needsRepair(text)) {
    return 'unchanged';
  }

  const repaired = sanitizeText(text);
  if (repaired === text) return 'unchanged';

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' && !tryParseJson(repaired)) {
    console.warn(`[skip] JSON 修复后无法 parse，未写入: ${filePath}`);
    return 'skip';
  }

  await fs.writeFile(filePath, repaired, 'utf-8');
  return 'fixed';
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const root = path.resolve(
    arg ?? process.env.PROJECT_PILOT_DATA_DIR ?? path.join(os.homedir(), '.project-pilot'),
  );

  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch {
    console.error(`数据根不存在或不可读: ${root}`);
    process.exit(1);
  }
  if (!rootStat.isDirectory()) {
    console.error(`不是目录: ${root}`);
    process.exit(1);
  }

  console.log(`扫描数据根（仅 U+FFFD、NUL 与 Latin-1 误读轻度修复）: ${root}`);

  let fixed = 0;
  let unchanged = 0;
  let skipped = 0;
  let jsonlFixed = 0;

  for await (const filePath of walk(root, root)) {
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === '.jsonl') {
        const r = await repairJsonlFile(filePath);
        if (r === 'fixed') {
          jsonlFixed++;
          console.log(`[jsonl] ${path.relative(root, filePath)}`);
        } else if (r === 'skip') skipped++;
        else unchanged++;
        continue;
      }

      const r = await repairWholeFile(filePath);
      if (r === 'fixed') {
        fixed++;
        console.log(`[fix] ${path.relative(root, filePath)}`);
      } else if (r === 'skip') skipped++;
      else unchanged++;
    } catch (e) {
      skipped++;
      console.warn(`[err] ${path.relative(root, filePath)}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `完成：整文件修复 ${fixed} 个，jsonl 修复 ${jsonlFixed} 个文件；跳过 ${skipped}；检查未改 ${unchanged} 次。`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
