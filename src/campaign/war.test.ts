/** The war's bookkeeping without a game: the breach watch, and both sides' call-outs (who, what, when, and how often). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { CALLS, FRONTS } from './missions/foreclosure.lines';
import { War } from './war';

function fakeCtx() {
  const listeners = new Map<string, ((p: unknown) => void)[]>();
  const fed: { text: string; kind: string; speaker: string | null }[] = [];
  const stage: { fn: ((s: string) => void) | null } = { fn: null };
  const gate = { kind: 'gate', stage: 'intact', spec: { x: 70, z: 50 }, onStageChange: (fn: (s: string) => void) => { stage.fn = fn; return () => { stage.fn = null; }; } };
  const far = { kind: 'wall', stage: 'intact', spec: { x: 0, z: 50 }, onStageChange: () => () => {} };
  const ctx = {
    time: { elapsed: 0 },
    player: { position: new THREE.Vector3(70, 0, 60) },
    world: { objects: { structures: [gate, far] } },
    events: {
      on: (name: string, fn: (p: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
        return () => {};
      },
      emit: (name: string, p: { text: string; kind: string; speaker: string | null }) => {
        if (name === 'comms:line') fed.push({ text: p.text, kind: p.kind, speaker: p.speaker });
      },
    },
  };
  return { ctx, fed, stage, gate };
}

describe('the war', () => {
  it('raises war:breached once, when a watched gate goes, and not for a wall far off', () => {
    const { ctx, stage } = fakeCtx();
    const signals: string[] = [];
    const war = new War(ctx as unknown as Ctx, { tagOf: () => undefined, squadMen: [], release() {}, signal: n => signals.push(n) }, CALLS, FRONTS);
    war.watch([{ at: [70, 0, 44] }]);
    expect(stage.fn).not.toBeNull();
    stage.fn!('damaged');
    expect(signals).toEqual([]);
    stage.fn!('breached');
    stage.fn!('breached');
    expect(signals).toEqual(['war:breached']);
    war.clear();
    expect(stage.fn).toBeNull();
  });

  it('calls a front\'s contact on both sides, under its own squad name, and keeps the feed readable', () => {
    const { ctx, fed } = fakeCtx();
    const war = new War(ctx as unknown as Ctx, { tagOf: () => undefined, squadMen: [], release() {}, signal() {} }, CALLS, FRONTS);
    const man = { def: { label: 'Rifleman' }, body: { center: new THREE.Vector3(118, 1, 66) }, detached: false, state: 'up' };
    war.front('eastStreet', { at: [118, 0, 66] }, { at: [112, 1.7, 48.6] }, [man as never]);
    expect(man.detached).toBe(true);
    expect(fed).toHaveLength(1);
    expect(fed[0]!.kind).toBe('ally');
    expect(fed[0]!.speaker).toBe('Rifleman, 9th Recoveries');
    expect(fed[0]!.text).not.toMatch(/[{}]/);
    expect(war.said[0]).toMatch(/^mission\.foreclosure\.call\.bureau\.contact\.\d$/);
    // Too far to hear: a front 300 m off is not on the player's feed.
    ctx.time.elapsed = 10;
    war.front('flats', { at: [400, 0, 400] }, { at: [410, 0, 380] }, []);
    expect(fed).toHaveLength(1);
  });

  it('gives every call-out a stable id of its own and fills every slot it uses', () => {
    const ids = new Set(CALLS.map(c => c.id));
    expect(ids.size).toBe(CALLS.length);
    for (const c of CALLS) expect(c.text.replace(/\{(place|label|Place|Label)\}/g, '')).not.toMatch(/[{}]/);
    for (const side of ['bureau', 'militia'] as const) expect(CALLS.some(c => c.side === side && c.kind === 'contact')).toBe(true);
  });
});
