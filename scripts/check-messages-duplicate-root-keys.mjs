/**
 * messages/*.json 为 2 空格缩进时，根级键形如 `  "key":`。
 * 若同一文件内两行根级键同名，JSON.parse 会静默用后一段覆盖前一段，
 * 导致大段文案丢失、界面回显完整 i18n 键名。
 *
 * 用法：node scripts/check-messages-duplicate-root-keys.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const files = ['src/client/i18n/messages/zh.json', 'src/client/i18n/messages/en.json'];

function findDuplicateRootKeysByIndent(jsonText) {
  const lines = jsonText.split(/\r?\n/);
  const rootKeys = [];
  for (const line of lines) {
    const m = line.match(/^  "([^"]+)":/);
    if (m) rootKeys.push(m[1]);
  }
  const seen = new Set();
  const dups = [];
  for (const k of rootKeys) {
    if (seen.has(k)) dups.push(k);
    seen.add(k);
  }
  return [...new Set(dups)];
}

let failed = false;
for (const rel of files) {
  const fp = path.join(root, rel);
  const text = fs.readFileSync(fp, 'utf8');
  const dups = findDuplicateRootKeysByIndent(text);
  if (dups.length > 0) {
    console.error(`[check-messages] ${rel}: duplicate root keys: ${dups.join(', ')}`);
    failed = true;
  } else {
    try {
      JSON.parse(text);
    } catch (e) {
      console.error(`[check-messages] ${rel}: invalid JSON: ${e.message}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('[check-messages] OK: no duplicate root keys in zh.json / en.json');
