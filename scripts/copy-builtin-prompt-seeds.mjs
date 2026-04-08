/**
 * 将内置提示词种子复制到 dist/server/builtin-prompt-seeds/，供生产 bundle 运行时读取。
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src/data/defaults/prompts/builtin');
const dest = path.join(root, 'dist/server/builtin-prompt-seeds');

try {
  await fs.access(src);
} catch {
  console.warn('[copy-builtin-prompt-seeds] skip: source missing', src);
  process.exit(0);
}

await fs.mkdir(path.dirname(dest), { recursive: true });
await fs.rm(dest, { recursive: true, force: true });
await fs.cp(src, dest, { recursive: true });
console.log('[copy-builtin-prompt-seeds]', dest);
