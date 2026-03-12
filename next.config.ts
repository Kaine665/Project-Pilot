import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Electron 打包时使用 standalone 输出，生成自包含服务器
  output: process.env.BUILD_TARGET === 'electron' ? 'standalone' : undefined,
  // 这些包内部依赖 import.meta.url / createRequire 定位原生二进制，
  // 被 Turbopack 打包后路径会失效，必须保持为外部包。
  serverExternalPackages: [
    '@openai/codex-sdk',
    '@openai/codex',
    '@anthropic-ai/claude-agent-sdk',
  ],
  experimental: {
    // Turbopack 文件系统缓存，减少二次启动和首次编译耗时
    turbopackFileSystemCacheForDev: true,
  },
};

export default withNextIntl(nextConfig);
