/**
 * 将仓库内 Markdown 种子同步到 {DATA_DIR}/prompts/builtin/。
 * - 首次：缺失文件从种子复制。
 * - 版本：种子 manifest.json 的 version 大于数据目录 .applied-builtin-prompts.json 时，先备份再覆盖全部内置 md，并更新 applied。
 * 生产包种子在 dist/server/builtin-prompt-seeds/（与 index.js 同构）。
 */

import { existsSync } from 'fs';
import { copyFile, cp, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJsonSafe } from './file-store';
import {
  getBuiltinAgentPromptPath,
  getBuiltinGlobalPromptPath,
  getBuiltinPromptAppliedManifestPath,
  getBuiltinPromptBackupsDir,
  getBuiltinPromptsRootDir,
} from './file-store';

const MAX_BUILTIN_PROMPT_BYTES = 10 * 1024 * 1024;

/** 与 agents.json 内置条目一致；新增内置 Agent 时须补种子文件 agents/<id>.md 并递增 manifest version */
export const BUILTIN_AGENT_PROMPT_IDS = ['agent-builtin-butler', 'agent-builtin-self-dev'] as const;

interface SeedManifest {
  version?: number;
}

interface AppliedManifest {
  version?: number;
  updatedAt?: string;
}

function resolveBuiltinPromptSeedRoot(): string | undefined {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(here, 'builtin-prompt-seeds'));
    candidates.push(path.join(here, '../data/defaults/prompts/builtin'));
  } catch {
    /* import.meta.url unavailable */
  }
  candidates.push(path.join(process.cwd(), 'src/data/defaults/prompts/builtin'));
  for (const c of candidates) {
    const g = path.join(c, 'global.md');
    if (existsSync(g)) {
      return path.normalize(c);
    }
  }
  return undefined;
}

async function readSeedFile(seedRoot: string, relFromBuiltinRoot: string): Promise<string> {
  const full = path.join(seedRoot, relFromBuiltinRoot);
  const buf = await readFile(full);
  if (buf.length > MAX_BUILTIN_PROMPT_BYTES) {
    throw new Error(`Builtin prompt seed too large: ${full}`);
  }
  return buf.toString('utf-8');
}

async function readSeedManifestVersion(seedRoot: string): Promise<number> {
  const manifestPath = path.join(seedRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return 1;
  }
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const j = parseJsonSafe<SeedManifest>(raw);
    const v = j.version;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
  } catch {
    return 1;
  }
}

async function readAppliedBuiltinVersion(): Promise<number> {
  const p = getBuiltinPromptAppliedManifestPath();
  try {
    const raw = await readFile(p, 'utf-8');
    const j = parseJsonSafe<AppliedManifest>(raw);
    const v = j.version;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

async function writeAppliedBuiltinVersion(version: number): Promise<void> {
  const p = getBuiltinPromptAppliedManifestPath();
  await mkdir(path.dirname(p), { recursive: true });
  const body: AppliedManifest = { version, updatedAt: new Date().toISOString() };
  await writeFile(p, `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
}

async function backupExistingBuiltinPrompts(backupDir: string): Promise<void> {
  const root = getBuiltinPromptsRootDir();
  const glo = getBuiltinGlobalPromptPath();
  const agentsDir = path.join(root, 'agents');
  const any = existsSync(glo) || existsSync(agentsDir);
  if (!any) return;

  await mkdir(backupDir, { recursive: true });
  if (existsSync(glo)) {
    await copyFile(glo, path.join(backupDir, 'global.md'));
  }
  if (existsSync(agentsDir)) {
    await cp(agentsDir, path.join(backupDir, 'agents'), { recursive: true });
  }
}

/** 从种子根目录覆盖写入 global + 全部已知 agent md */
async function writeAllBuiltinPromptsFromSeeds(seedRoot: string): Promise<void> {
  const globalText = await readSeedFile(seedRoot, 'global.md');
  const root = getBuiltinPromptsRootDir();
  await mkdir(path.join(root, 'agents'), { recursive: true });
  await writeFile(getBuiltinGlobalPromptPath(), globalText, 'utf-8');

  for (const id of BUILTIN_AGENT_PROMPT_IDS) {
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const text = await readSeedFile(seedRoot, path.join('agents', `${safe}.md`));
    await writeFile(getBuiltinAgentPromptPath(id), text, 'utf-8');
  }
}

async function installMissingBuiltinFiles(seedRoot: string): Promise<void> {
  const destGlobal = getBuiltinGlobalPromptPath();
  if (!existsSync(destGlobal)) {
    await mkdir(path.dirname(destGlobal), { recursive: true });
    const text = await readSeedFile(seedRoot, 'global.md');
    await writeFile(destGlobal, text, 'utf-8');
  }
  for (const id of BUILTIN_AGENT_PROMPT_IDS) {
    const dest = getBuiltinAgentPromptPath(id);
    if (existsSync(dest)) continue;
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const text = await readSeedFile(seedRoot, path.join('agents', `${safe}.md`));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, text, 'utf-8');
  }
}

/** 确保某内置 Agent 的 prompts/builtin/agents/<id>.md 存在（仅补缺，不升版本） */
export async function ensureBuiltinAgentPromptOnDisk(agentId: string): Promise<void> {
  if (!(BUILTIN_AGENT_PROMPT_IDS as readonly string[]).includes(agentId)) return;
  const seedRoot = resolveBuiltinPromptSeedRoot();
  if (!seedRoot) return;
  const dest = getBuiltinAgentPromptPath(agentId);
  if (existsSync(dest)) return;
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  const text = await readSeedFile(seedRoot, path.join('agents', `${safe}.md`));
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf-8');
}

/** 确保 prompts/builtin/global.md 存在 */
export async function ensureBuiltinGlobalPromptOnDisk(): Promise<void> {
  const seedRoot = resolveBuiltinPromptSeedRoot();
  if (!seedRoot) return;
  const dest = getBuiltinGlobalPromptPath();
  if (existsSync(dest)) return;
  const text = await readSeedFile(seedRoot, 'global.md');
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf-8');
}

/**
 * 按版本同步内置提示词：必要时备份并覆盖，再补缺文件。
 */
export async function materializeAllBuiltinPromptSeeds(): Promise<void> {
  const seedRoot = resolveBuiltinPromptSeedRoot();
  if (!seedRoot) {
    throw new Error(
      '未找到内置提示词种子目录（期望 dist/server/builtin-prompt-seeds 或 src/data/defaults/prompts/builtin）。',
    );
  }

  const seedVer = await readSeedManifestVersion(seedRoot);
  const appliedVer = await readAppliedBuiltinVersion();

  if (appliedVer > seedVer) {
    console.warn(
      `[builtin-prompts] 数据目录已应用版本 ${appliedVer} 高于当前应用种子 ${seedVer}，跳过降级覆盖。`,
    );
    await installMissingBuiltinFiles(seedRoot);
    return;
  }

  if (appliedVer < seedVer) {
    const backupsRoot = getBuiltinPromptBackupsDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(backupsRoot, `pre-upgrade-to-v${seedVer}-${stamp}`);
    await backupExistingBuiltinPrompts(backupDir);
    if (existsSync(backupDir)) {
      console.info(`[builtin-prompts] 已备份旧版至 ${backupDir}`);
    }
    await writeAllBuiltinPromptsFromSeeds(seedRoot);
    await writeAppliedBuiltinVersion(seedVer);
    console.info(`[builtin-prompts] 已升级内置提示词至种子版本 ${seedVer}`);
    return;
  }

  await installMissingBuiltinFiles(seedRoot);
}
