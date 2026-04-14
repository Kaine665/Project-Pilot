#!/usr/bin/env node
/**
 * PR 桌面 CI：在合并基线 `package.json` 的 X.Y.Z 上做 **patch + 1**，再拼 `-pr.<PR号>`，
 * 得到安装包 / GitHub 预发布共用的版本号（不改仓库文件、不动 lock）。
 *
 * 用法：node scripts/ci-compute-pr-desktop-version.mjs <pr_number>
 *  stdout：单行版本字符串，例如 0.1.6-pr.42
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
const v = `${major}.${minor}.${patch}-pr.${pr}`;
process.stdout.write(v);
