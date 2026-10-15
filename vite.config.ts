import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend is a static SPA. In production it is served by the Worker as
// static assets (`wrangler dev` / `wrangler deploy`). During UI-focused local
// development, `vite` serves the SPA and proxies `/api` to `wrangler dev`.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
