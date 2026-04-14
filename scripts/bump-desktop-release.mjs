#!/usr/bin/env node
/**
 * 桌面发布版本自增：更新 package.json / package-lock.json，生成 chore(release) 提交与 v* 标签。
 * 推送后若存在匹配 tag 的 push，会触发 .github/workflows/release.yml 构建 exe + dmg 并上传 Release。
 * （针对 `next` 的 PR 桌面包另有 CI：`scripts/ci-compute-pr-desktop-version.mjs` 在不打 git 的前提下做 patch+1 并加 `-pr.<N>`，与发版流程分离。）
 *
 * 用法：
 *   node scripts/bump-desktop-release.mjs [patch|minor|major]
 *   npm run release:desktop:bump
 *
 * 成功后执行（脚本会打印）：
 *   git push origin next && git push origin vX.Y.Z
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
}

function readBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
}

function porcelain() {
  return execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
}

const level = ['patch', 'minor', 'major'].includes(process.argv[2])
  ? process.argv[2]
  : 'patch';

const branch = readBranch();
if (branch !== 'next') {
  console.error(`当前分支为 "${branch}"，请在 next 分支上执行桌面版本发布自增。`);
  process.exit(1);
}

const dirty = porcelain();
if (dirty) {
  console.error('工作区不干净，请先提交或 stash 后再运行版本自增：\n' + dirty);
  process.exit(1);
}

sh(`npm version ${level} --no-git-tag-version`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const v = pkg.version;
const tag = `v${v}`;

sh('git add package.json package-lock.json');
sh(`git commit -m "chore(release): desktop ${tag}"`);
sh(`git tag ${tag}`);

console.log('\n已创建提交与标签 ' + tag + '。推送到 GitHub 以触发构建：');
console.log(`  git push origin next && git push origin ${tag}\n`);
