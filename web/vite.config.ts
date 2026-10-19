import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` proxies the API to a running Host so the page can be iterated on with hot reload.
const hostPort = process.env.CONSOLE_PORT ?? '4317';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': `http://127.0.0.1:${hostPort}` },
  },
});
