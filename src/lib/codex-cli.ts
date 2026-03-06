import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'child_process';
import { createCliResolver, type CliInvocation } from '@/lib/cli-resolver';

export type CodexCliInvocation = CliInvocation;

const resolver = createCliResolver({
  binName: 'codex',
  overrideEnvVar: 'CODEX_CLI_PATH',
  npmCliJsRelativePath: 'node_modules/@openai/codex/bin/codex.js',
});

export function resolveCodexCliInvocation(): CodexCliInvocation {
  return resolver.resolveInvocation();
}

export function spawnCodex(args: string[], options: SpawnOptions): ChildProcess {
  return resolver.spawnCli(args, options);
}

export function execCodex(
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return resolver.execCli(args, options);
}

export function clearCodexCliPathCache(): void {
  resolver.clearCache();
}
