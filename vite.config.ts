import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: { alias: { '@': resolve(dirname(fileURLToPath(import.meta.url)), 'src') } },
  server: { port: 5173, strictPort: false, host: '127.0.0.1', hmr: process.env.OP2_NO_HMR ? false : undefined },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
