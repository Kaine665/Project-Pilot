import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 部署到子路径时设置环境变量，例如：BASE_PATH=/project-pilot/ vite build
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 4010,
    strictPort: false,
  },
});
