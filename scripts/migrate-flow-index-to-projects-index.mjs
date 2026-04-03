#!/usr/bin/env node
/**
 * 将备份的 workflows/legacy-board/_index.json（或旧路径 workflows/flows/_index.json；等价 JSON：顶层含 projects 数组）
 * 转为 projects/index.json（磁盘字段以 id 为主，不写 techStack）。
 *
 * 用法：
 *   node scripts/migrate-flow-index-to-projects-index.mjs <源_index.json路径> [输出目录]
 * 默认输出目录：~/.project-pilot/projects（Windows: %USERPROFILE%\.project-pilot\projects）
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = process.argv[2];
const defaultUserProjects = path.join(os.homedir(), '.project-pilot', 'projects');
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : defaultUserProjects;

if (!src) {
  console.error('用法: node scripts/migrate-flow-index-to-projects-index.mjs <源_index.json> [输出目录]');
  process.exit(1);
}

const raw = await readFile(src, 'utf-8');
const parsed = JSON.parse(raw);
const projectsIn = Array.isArray(parsed.projects) ? parsed.projects : [];
const now = new Date().toISOString();

const projects = projectsIn.map((p) => {
  const id = (p.id || p.key || '').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return null;
  const { key: _k, techStack: _t, id: _i, ...rest } = p;
  return {
    id,
    ...rest,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : id,
    updatedAt: p.updatedAt || now,
  };
}).filter(Boolean);

const out = {
  version: 1,
  _migrated_to_projects_domain: true,
  projects,
};

await mkdir(outDir, { recursive: true });
const dest = path.join(outDir, 'index.json');
await writeFile(dest, JSON.stringify(out, null, 2), 'utf-8');
console.log(`已写入 ${dest}（${projects.length} 条）`);
