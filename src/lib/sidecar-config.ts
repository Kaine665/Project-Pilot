import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getWorktreePortsPath, parseJsonSafe } from './file-store';

interface WorktreePortEntry {
  branch: string;
  port: number;
  releasedAt?: string;
}

interface WorktreePortsData {
  entries?: WorktreePortEntry[];
}

export interface SidecarConfig {
  branch: string | null;
  scope: string;
  devPort: number;
  port: number;
  lockPath: string;
  source: 'main-default' | 'worktree-registry' | 'branch-hash';
}

const MAIN_BRANCHES = new Set(['develop-static', 'main', 'master']);
const MAIN_DEV_PORT = 4000;
const MAIN_SIDECAR_PORT = 4500;
const SIDECAR_PORT_OFFSET = MAIN_SIDECAR_PORT - MAIN_DEV_PORT;
const HASH_PORT_START = 4510;
const HASH_PORT_SIZE = 90;

function sanitizeScope(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'main';
}

function getCurrentBranchSync(cwd = process.cwd()): string | null {
  try {
    const branch = execSync('git branch --show-current', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

function readRegisteredDevPortSync(branch: string): number | null {
  try {
    const raw = fs.readFileSync(getWorktreePortsPath(), 'utf8');
    const data = parseJsonSafe<WorktreePortsData>(raw);
    const entry = (data.entries ?? []).find(item => item.branch === branch && !item.releasedAt);
    return typeof entry?.port === 'number' ? entry.port : null;
  } catch {
    return null;
  }
}

function hashScopeToPort(scope: string): number {
  let hash = 0;
  for (const char of scope) {
    hash = ((hash * 31) + char.charCodeAt(0)) % HASH_PORT_SIZE;
  }
  return HASH_PORT_START + hash;
}

export function resolveSidecarConfigSync(cwd = process.cwd()): SidecarConfig {
  const branch = getCurrentBranchSync(cwd);

  if (!branch || MAIN_BRANCHES.has(branch)) {
    return {
      branch,
      scope: 'main',
      devPort: MAIN_DEV_PORT,
      port: MAIN_SIDECAR_PORT,
      lockPath: path.join(os.homedir(), '.project-pilot', 'sidecar.lock'),
      source: 'main-default',
    };
  }

  const scope = sanitizeScope(branch);
  const devPort = readRegisteredDevPortSync(branch);
  if (devPort !== null) {
    return {
      branch,
      scope,
      devPort,
      port: devPort + SIDECAR_PORT_OFFSET,
      lockPath: path.join(os.homedir(), '.project-pilot', `sidecar-${scope}.lock`),
      source: 'worktree-registry',
    };
  }

  const port = hashScopeToPort(scope);
  return {
    branch,
    scope,
    devPort: port - SIDECAR_PORT_OFFSET,
    port,
    lockPath: path.join(os.homedir(), '.project-pilot', `sidecar-${scope}.lock`),
    source: 'branch-hash',
  };
}
