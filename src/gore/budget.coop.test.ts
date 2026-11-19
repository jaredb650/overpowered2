/**
 * Gore budgets are the local machine's alone (the owner's rule, docs/notes/coop.md "Gore on every screen"): corpses, ragdolls,
 * limbs, decals and blood are capped by tuning set from the local quality setting, never by whether this machine hosts a
 * co-op match or is a guest in one. The cheapest way to keep that true is to keep the role out of this code altogether.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('gore budgets', () => {
  it('never read whether this machine hosts: nothing that draws gore, effects or decals knows of co-op', () => {
    const role = /\bctx\.coop\b|\.hosting\b|\bCoopSession\b|\bCoopWorld\b/;
    const knows = ['src/gore', 'src/fx', 'src/render'].flatMap(dir => sources(dir)).filter(file => role.test(readFileSync(file, 'utf8')));
    expect(knows).toEqual([]);
  });
});
