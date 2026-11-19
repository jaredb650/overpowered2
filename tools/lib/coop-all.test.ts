import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script, no types
import { PROOFS, runs, table, verdict } from '../scripts/coop-all.mjs';

const all = () => runs(new Set(['clean', 'bad', 'rtc', 'four', 'guest'])) as { id: string; script: string; env: Record<string, string>; transport: string; net: string; players: number; suite: string; sim: unknown }[];

describe('coop-all: the list of co-op proofs', () => {
  it('names every run once, and every script it names exists', () => {
    const list = all();
    expect(new Set(list.map(r => r.id)).size).toBe(list.length);
    for (const run of list) expect(existsSync(run.script), run.script).toBe(true);
    expect((PROOFS as unknown[]).length).toBeGreaterThan(50);
  });

  it('gives each run its transport, network and player count in the words its own script reads', () => {
    const list = all();
    const bad = list.find(r => r.id === 'team-break 3p loop bad')!;
    expect(bad.env).toMatchObject({ TEAM_NET: 'bad', COOP_NET: 'loop' });
    const fx = list.find(r => r.id === 'fx-matrix 3p loop bad')!;
    expect(fx.env.FX_NET).toBe('lag:120,jitter:40,loss:0.05');
    const four = list.find(r => r.id === 'callins-matrix 4p loop clean')!;
    expect(four.env.CALLINS_PLAYERS).toBe('4');
    expect(list.find(r => r.id === 'smoke/crucible 2p rtc clean')!.env.COOP_NET).toBe('rtc');
    // A proof that takes no network is not listed under the bad one; a solo page has no transport.
    expect(list.some(r => r.id.startsWith('gore-bytes') && r.net)).toBe(false);
    expect(list.find(r => r.id.startsWith('time-solo'))!.env.COOP_NET).toBeUndefined();
  });
});

describe('coop-all: a run\'s verdict', () => {
  const run = { t: 300, transport: 'loop', slow: false };
  it('passes a proof that returned its checks', () => {
    const v = verdict({ exit: 0, report: { errors: [], scriptResult: { checks: ['a', 'b'], errors: [] } }, run });
    expect(v).toMatchObject({ passed: 2, failed: 0, first: '', reason: '' });
  });

  it('fails a proof that threw, counts what passed from its evidence file, and gives the first failing check', () => {
    const v = verdict({ exit: 0, report: { errors: ['[script] Error: The guest shops :: {"x":1}\n    at check'] }, evidence: [{ checks: ['a', 'b', 'c'], failure: 'Error: The guest shops :: {"x":1}\n at' }], run });
    expect(v.passed).toBe(3);
    expect(v.failed).toBe(1);
    expect(v.first).toBe('The guest shops :: {"x":1}');
    expect(v.reason).toBe('');
  });

  it('counts every failed line of a matrix that goes on', () => {
    const v = verdict({ exit: 0, report: { errors: [], scriptResult: { checks: 40, failed: ['lance: no beam', 'kiln: no hose'] } }, run });
    expect(v).toMatchObject({ passed: 40, failed: 2, first: 'lance: no beam' });
  });

  it('reads a session proof that says ok: false, and one that wrote `failed` as text', () => {
    expect(verdict({ exit: 0, report: { errors: [], scriptResult: { checks: ['a'], ok: false, failed: 'Error: no board' } }, run }).first).toBe('no board');
    expect(verdict({ exit: 0, report: { errors: [], scriptResult: { checks: [], failed: 'Error: dropWeapon never took' } }, run }).failed).toBe(1);
  });

  it('calls a time limit, a starved page and a lobby that never formed on rtc the harness\'s', () => {
    expect(verdict({ exit: 2, report: null, log: '[shot] exceeded 300s, closing the browser', run }).reason).toBe('time limit');
    const starved = { checks: ['a'], failure: 'Error: x', frames: { host: { n: 10, mean: 58, min: 40, low: 0 }, 'guest-two': { n: 10, mean: 7, min: 1, low: 9 } } };
    expect(verdict({ exit: 0, report: { errors: ['[script] Error: x'] }, evidence: [starved], run }).reason).toMatch(/^starved \(guest-two 7/);
    // A proof that slows a page on purpose is not starved by it.
    expect(verdict({ exit: 0, report: { errors: ['[script] Error: x'] }, evidence: [starved], run: { ...run, slow: true } }).reason).toBe('');
    const relays = verdict({ exit: 0, report: { errors: ['[script] TimeoutError: locator.waitFor: Timeout 90000ms exceeded.\n    at joinFromSplash (coop-kit.mjs:1)\n    at openGuest'] }, run: { ...run, transport: 'rtc' } });
    expect(relays.reason).toMatch(/^relays/);
    expect(verdict({ exit: 0, report: { errors: ['[script] Error: real failure'] }, evidence: [{ checks: ['a'] }], cost: { load: [40, 44] }, run }).reason).toBe('machine load 44');
  });

  it('writes the table with one row a run', () => {
    const text = table({ a: { id: 'a', proof: 'smoke', lane: 'old', players: 2, mode: 'crucible', map: '', transport: 'loop', net: '', verdict: 'pass', passed: 5, failed: 0, seconds: 40, commit: 'abc', first: '', evidence: '/x' } }, { commit: 'abc' });
    expect(text).toContain('1 of 1 runs passed');
    expect(text).toContain('| `smoke` | 2 | crucible | loop | clean | pass | 5 / 0 | 40 | `abc` |');
  });
});
