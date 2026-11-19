import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { setPriority } from 'node:os';

// Tests run at the lowest priority with a bounded number of workers: the dev machine is shared, and a full-suite run on
// every core at normal priority from several agents at once starved everyone else. OP2_TEST_WORKERS overrides the bound.
if (process.env.VITEST) {
  try { setPriority(0, 19); } catch { /* not allowed here: run at the normal priority */ }
}

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
  // setupFiles: Math.random is seeded per test (tools/test-setup.ts), so a test of real ragdolls checks the same case every
  // run. hookTimeout: a `beforeAll` that builds every gun model or a physics world takes a second alone and has taken over
  // the default 10 s on a busy machine at this priority ("failed to load"); it now has what `--testTimeout=60000` gives a test.
  test: {
    exclude: ['**/node_modules/**', 'tools/out/**'], maxWorkers: Number(process.env.OP2_TEST_WORKERS ?? 8),
    setupFiles: ['tools/test-setup.ts'], hookTimeout: 60000,
  },
});
