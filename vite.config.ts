import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const require = createRequire(import.meta.url);
const { loadDevServerConfig } = require('./config/load-dev-server.cjs') as typeof import('./config/load-dev-server.cjs');

const root = path.dirname(fileURLToPath(import.meta.url));
const dev = loadDevServerConfig(root);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
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
