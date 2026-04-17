import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const require = createRequire(import.meta.url);
const { loadDevServerConfig } = require('./src/config/load-dev-server.cjs') as typeof import('./src/config/load-dev-server.cjs');

const root = path.dirname(fileURLToPath(import.meta.url));
const dev = loadDevServerConfig(root);

export default defineConfig({
  plugins: [react()],
  resolve: {
    /** 避免 Vite 预构建的 Radix 等包内嵌第二份 React → hooks dispatcher 为 null（useMemo 报错、整页白屏） */
    dedupe: ['react', 'react-dom'],
    /** 顺序：先最长前缀，避免 `@` 抢走 `@/app`、`@/lib` 等 */
    alias: [
      { find: '@/app', replacement: path.resolve(__dirname, 'src/client/app') },
      { find: '@/hooks', replacement: path.resolve(__dirname, 'src/shared/hooks') },
      { find: '@/lib', replacement: path.resolve(__dirname, 'src/shared/lib') },
      { find: '@/types', replacement: path.resolve(__dirname, 'src/shared/types') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@radix-ui/react-select'],
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: dev.clientPort,
    strictPort: true,
    host: dev.clientBindHost,
    proxy: {
      '/api': dev.viteProxyTarget,
    },
  },
});
