#!/usr/bin/env node
/**
 * PR 桌面 CI：合并基线 `package.json` 的 X.Y.Z 做 **patch+1**，再拼 `-pr.<PR号>`；若存在环境变量
 * **GITHUB_RUN_NUMBER**（Actions 默认注入），再拼 `.<run号>`，使「基线未 bump」时每次构建版本串仍不同。
 *
 * 基线 `version` 未变时，`0.1.6` 段会固定为 patch+1；要升正式号请在 `next` 上 `npm run release:desktop:bump` 或改 `package.json`。
 *
 * 用法：node scripts/ci-compute-pr-desktop-version.mjs <pr_number>
 *  stdout：例如 0.1.6-pr.42 或 0.1.6-pr.42.184523
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pr = process.argv[2];
if (!pr || !/^\d+$/.test(pr)) {
  console.error('Usage: node scripts/ci-compute-pr-desktop-version.mjs <pr_number>');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const raw = String(pkg.version ?? '0.0.0');
const m = raw.match(/^(\d+)\.(\d+)\.(\d+)/);
if (!m) {
  console.error(`ci-compute-pr-desktop-version: cannot parse X.Y.Z prefix from "${raw}"`);
  process.exit(1);
}
const major = m[1];
const minor = m[2];
const patch = Number(m[3]) + 1;
const run = process.env.GITHUB_RUN_NUMBER?.trim() ?? '';
const runSuffix = /^\d+$/.test(run) ? `.${run}` : '';
const v = `${major}.${minor}.${patch}-pr.${pr}${runSuffix}`;
process.stdout.write(v);
