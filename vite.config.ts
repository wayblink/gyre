import { defineConfig } from 'vite';

const extraAllowedHosts =
  process.env.VITE_ALLOWED_HOSTS?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) ?? [];

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 60627,
    allowedHosts: ['.trycloudflare.com', ...extraAllowedHosts],
    proxy: {
      '/api': 'http://127.0.0.1:60628',
    },
  },
});
