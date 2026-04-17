import fs from 'fs';
import path from 'path';
import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'child_process';
import { createCliResolver, type CliInvocation } from '@/lib/cli-resolver';

export type CodexCliInvocation = CliInvocation;

/** 平台包名 → vendor 子目录 */
const PLATFORM_VENDOR: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

/**
 * 解析 Codex 原生二进制路径，供 Codex SDK 的 codexPathOverride 使用。
 * SDK 在 Next.js 等环境下可能无法正确 resolve 平台包，显式传入路径可绕过。
 *
 * 解析策略（按优先级）：
 * 1. 环境变量 CODEX_BINARY_PATH（用户显式指定）
 * 2. 从已验证的 CODEX_CLI_PATH 推导 node_modules 根目录
 * 3. 从 process.cwd() 推导
 */
export function resolveCodexBinaryPath(): string | null {
  if (process.env.CODEX_BINARY_PATH && fs.existsSync(process.env.CODEX_BINARY_PATH)) {
    return process.env.CODEX_BINARY_PATH;
  }

  const { platform, arch } = process;
  const TARGET_MAP: Record<string, Record<string, string>> = {
    win32:    { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
    darwin:   { x64: 'x86_64-apple-darwin',     arm64: 'aarch64-apple-darwin' },
    linux:    { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
    android:  { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  };
  const targetTriple = TARGET_MAP[platform]?.[arch];
  if (!targetTriple) return null;

  const pkgName = PLATFORM_VENDOR[targetTriple];
  if (!pkgName) return null;

  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';
  const relVendor = path.join(pkgName, 'vendor', targetTriple, 'codex', binaryName);

  // 策略 2：从 CODEX_CLI_PATH 推导 node_modules 位置
  const cliPath = process.env.CODEX_CLI_PATH;
  if (cliPath) {
    // cliPath 形如 …/node_modules/@openai/codex/bin/codex.js
    const idx = cliPath.replace(/\\/g, '/').lastIndexOf('node_modules/');
    if (idx !== -1) {
      const nodeModulesDir = cliPath.substring(0, idx + 'node_modules/'.length);
      const candidate = path.join(nodeModulesDir, relVendor);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // 策略 3：cwd 兜底
  const cwdCandidate = path.join(process.cwd(), 'node_modules', relVendor);
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  return null;
}

// 若未设置 CODEX_CLI_PATH，优先使用项目 node_modules 中的 @openai/codex
if (!process.env.CODEX_CLI_PATH) {
  const projectCodex = path.join(process.cwd(), 'node_modules/@openai/codex/bin/codex.js');
  if (fs.existsSync(projectCodex)) {
    process.env.CODEX_CLI_PATH = projectCodex;
  }
}

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
