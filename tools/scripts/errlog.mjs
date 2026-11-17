#!/usr/bin/env node
// Read-only diagnostics client. Never put the read secret in a URL, output, or Vite variable.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

export const catalogTags = source => Object.fromEntries(
  [...source.matchAll(/^  ([A-Z][A-Z0-9_]+): \[[^\n]*,\s*['"]([^'"]+)['"]\]/gm)].map(m => [m[1], m[2]]),
);

export async function main(args = process.argv.slice(2)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const source = await readFile(resolve(root, 'src/net/turn.ts'), 'utf8');
  const url = process.env.VITE_TURN_URL || /const WORKER_URL\s*=\s*['"]([^'"]*)['"]/.exec(source)?.[1];
  if (!url) throw new Error('Set WORKER_URL in src/net/turn.ts first.');
  const key = (await readFile(resolve(homedir(), '.config/op2/errlog.key'), 'utf8')).trim();
  if (!key) throw new Error('The errlog.key file is empty.');
  const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const endpoint = new URL(`${url.replace(/\/$/, '')}/logs`);
  endpoint.searchParams.set('since', option('--since', new Date(Date.now() - 86400000).toISOString()));
  endpoint.searchParams.set('limit', option('--limit', '1000'));
  let response;
  try { response = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Could not reach the log Worker.'); }
  if (!response.ok) throw new Error(`Log Worker answered ${response.status}. Check the binding and local read key.`);
  const { events, limit } = await response.json();
  if (args.includes('--raw')) { console.log(JSON.stringify(events, null, 2)); return; }
  // Use the same catalog the game ships, without requiring a TS runtime.
  const catalog = await readFile(resolve(root, 'src/core/errors.ts'), 'utf8');
  const tags = catalogTags(catalog);
  const groups = Map.groupBy(events, e => e.code);
  console.log(`${events.length} reports since ${endpoint.searchParams.get('since')}${events.length === limit ? ' (limit reached; narrow --since)' : ''}`);
  for (const [code, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const platforms = [...new Set(rows.map(e => `${e.browser}/${e.os}`))].join(', ');
    console.log(`\n${code}: ${rows.length} [${tags[code] || 'unknown'}] — ${platforms}`);
    for (const e of rows.slice(0, 3)) console.log(`  ${new Date(e.receivedAt).toISOString()} build=${e.build} ${e.role}/${e.mode} session=${e.session} lobby=${e.lobby || '-'}\n  ${e.detail || e.message}${e.stack ? `\n  ${e.stack}` : ''}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
