import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeStartupLog } from './logger';

function existingDir(dir: string): string | null {
  try {
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function existingFile(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
}

export function setupDesktopEnv(): void {
  const home = os.homedir();
  const pathEntries = [
    process.env.PATH,
    path.join(home, '.nvm', 'versions', 'node', 'v24.14.0', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].filter(Boolean) as string[];

  const normalizedPath = Array.from(new Set(pathEntries.flatMap((entry) => entry.split(path.delimiter)).filter(Boolean))).join(path.delimiter);
  process.env.PATH = normalizedPath;

  if (!process.env.CLAUDE_CLI_PATH) {
    const candidates = [
      path.join(home, '.nvm', 'versions', 'node', 'v24.14.0', 'bin', 'claude'),
      path.join(home, '.npm-global', 'bin', 'claude'),
      path.join(home, '.local', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];

    const resolved = candidates.map(existingFile).find(Boolean);
    if (resolved) {
      process.env.CLAUDE_CLI_PATH = resolved;
    }
  }

  writeStartupLog(`[env] PATH=${process.env.PATH ?? ''}`);
  writeStartupLog(`[env] CLAUDE_CLI_PATH=${process.env.CLAUDE_CLI_PATH ?? ''}`);
}
