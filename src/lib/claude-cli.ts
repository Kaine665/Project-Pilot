import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'child_process';
import { createCliResolver, type CliInvocation } from '@/lib/cli-resolver';

export type ClaudeCliInvocation = CliInvocation;

const resolver = createCliResolver({
  binName: 'claude',
  overrideEnvVar: 'CLAUDE_CLI_PATH',
  npmCliJsRelativePath: 'node_modules/@anthropic-ai/claude-code/cli.js',
});

/**
 * Resolve Claude CLI invocation in a platform-safe way.
 *
 * Windows note:
 * - Directly spawning npm-generated `claude.cmd` often fails with EINVAL when
 *   `shell: false`. We therefore prefer `node <.../claude-code/cli.js>`.
 */
export function resolveClaudeCliInvocation(): ClaudeCliInvocation {
  return resolver.resolveInvocation();
}

export function spawnClaude(args: string[], options: SpawnOptions): ChildProcess {
  return resolver.spawnCli(args, options);
}

export function execClaude(
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return resolver.execCli(args, options);
}

export function clearClaudeCliPathCache(): void {
  resolver.clearCache();
}
