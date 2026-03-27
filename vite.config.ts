import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.TORRENT_GRAIN_UI_API_TARGET ?? 'http://127.0.0.1:32101';

export default defineConfig({
  plugins: [react()],
  root: 'ui',
  server: {
    port: 32102,
    proxy: {
      '/health': backendTarget,
      '/status': backendTarget,
      '/targets': backendTarget,
    },
  },
  preview: {
    port: 32102,
  },
  build: {
    outDir: '../ui-dist',
    emptyOutDir: true,
  },
});
