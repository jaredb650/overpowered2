import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/** The build id co-op players compare in the lobby (src/net/build.ts): the commit Pages built, or this checkout's. */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildId()) },
  resolve: { alias: { '@': resolve(dirname(fileURLToPath(import.meta.url)), 'src') } },
  server: { port: 5173, strictPort: false, host: '127.0.0.1', hmr: process.env.OP2_NO_HMR ? false : undefined },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  // tools/out is scratch: bots and probes leave test files and whole copies of src there.
  test: { exclude: ['**/node_modules/**', 'tools/out/**'] },
});
