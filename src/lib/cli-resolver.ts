import fs from 'fs';
import path from 'path';
import { execFile, spawn, type ChildProcess, type ExecFileOptions, type SpawnOptions } from 'child_process';

export interface CliInvocation {
  command: string;
  preArgs: string[];
}

export interface CliResolverConfig {
  binName: string;
  overrideEnvVar: string;
  npmCliJsRelativePath: string;
}

export interface CliResolver {
  resolveInvocation: () => CliInvocation;
  spawnCli: (args: string[], options: SpawnOptions) => ChildProcess;
  execCli: (args: string[], options?: ExecFileOptions) => Promise<{ stdout: string; stderr: string }>;
  clearCache: () => void;
}

function isUsableFile(filePath: string | undefined | null): boolean {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findInPath(candidates: string[]): string | null {
  const rawPath = process.env.PATH || '';
  const dirs = rawPath.split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const bin of candidates) {
      const full = path.join(dir, bin);
      if (isUsableFile(full)) {
        return full;
      }
    }
  }

  return null;
}

function nodeBinary(): string {
  return isUsableFile(process.execPath) ? process.execPath : 'node';
}

export function createCliResolver(config: CliResolverConfig): CliResolver {
  let cachedInvocation: CliInvocation | null = null;

  const wrapWindowsScript = (scriptPath: string): CliInvocation => {
    const cliJs = path.join(path.dirname(scriptPath), config.npmCliJsRelativePath);
    if (isUsableFile(cliJs)) {
      return { command: nodeBinary(), preArgs: [cliJs] };
    }
    return { command: scriptPath, preArgs: [] };
  };

  const resolveFromOverride = (override: string): CliInvocation | null => {
    if (!isUsableFile(override)) return null;

    const ext = path.extname(override).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      return { command: nodeBinary(), preArgs: [override] };
    }

    if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat' || ext === '.ps1')) {
      return wrapWindowsScript(override);
    }

    return { command: override, preArgs: [] };
  };

  const resolveWindowsGlobalCli = (): CliInvocation | null => {
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    const npmRoots = [
      appData ? path.join(appData, 'npm') : '',
      userProfile ? path.join(userProfile, 'AppData', 'Roaming', 'npm') : '',
    ].filter(Boolean);

    for (const root of npmRoots) {
      const cliJs = path.join(root, config.npmCliJsRelativePath);
      if (isUsableFile(cliJs)) {
        return { command: nodeBinary(), preArgs: [cliJs] };
      }
    }

    return null;
  };

  const resolveFromPath = (): CliInvocation | null => {
    if (process.platform === 'win32') {
      const exe = findInPath([`${config.binName}.exe`]);
      if (exe) return { command: exe, preArgs: [] };

      const script = findInPath([`${config.binName}.cmd`, `${config.binName}.bat`, `${config.binName}.ps1`]);
      if (script) return wrapWindowsScript(script);

      const noExt = findInPath([config.binName]);
      if (noExt) return { command: noExt, preArgs: [] };

      return null;
    }

    const cli = findInPath([config.binName]);
    return cli ? { command: cli, preArgs: [] } : null;
  };

  const resolveInvocation = (): CliInvocation => {
    if (cachedInvocation) {
      return cachedInvocation;
    }

    const override = process.env[config.overrideEnvVar];
    if (typeof override === 'string' && override) {
      const fromOverride = resolveFromOverride(override);
      if (fromOverride) {
        cachedInvocation = fromOverride;
        return cachedInvocation;
      }
    }

    if (process.platform === 'win32') {
      const globalCli = resolveWindowsGlobalCli();
      if (globalCli) {
        cachedInvocation = globalCli;
        return cachedInvocation;
      }
    }

    const fromPath = resolveFromPath();
    if (fromPath) {
      cachedInvocation = fromPath;
      return cachedInvocation;
    }

    cachedInvocation = { command: config.binName, preArgs: [] };
    return cachedInvocation;
  };

  const spawnCli = (args: string[], options: SpawnOptions): ChildProcess => {
    const cli = resolveInvocation();
    return spawn(cli.command, [...cli.preArgs, ...args], options);
  };

  const execCli = (
    args: string[],
    options: ExecFileOptions = {},
  ): Promise<{ stdout: string; stderr: string }> => {
    const cli = resolveInvocation();
    return new Promise((resolve, reject) => {
      execFile(
        cli.command,
        [...cli.preArgs, ...args],
        options,
        (error, stdout, stderr) => {
          if (error) {
            const err = error as Error & { stdout?: string; stderr?: string };
            err.stdout = String(stdout ?? '');
            err.stderr = String(stderr ?? '');
            reject(err);
            return;
          }
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        },
      );
    });
  };

  const clearCache = (): void => {
    cachedInvocation = null;
  };

  return { resolveInvocation, spawnCli, execCli, clearCache };
}
