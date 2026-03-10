import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Electron 打包时使用 standalone 输出，生成自包含服务器
  output: process.env.BUILD_TARGET === 'electron' ? 'standalone' : undefined,
};

export default withNextIntl(nextConfig);
