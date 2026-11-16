/** The Distraint Frame as a call-in: it lands ahead of the player, E beside it boards it for the call's seconds, and unboarded it is taken back. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { noop } from '../../core/stubs';
import type { Frame } from '../../frame/seat';
import { makeRange, type Range } from '../../weapons/testkit';
import { FRAME_DROP as D } from '../data';
import { ModelMaterials } from '../modelkit';
import { FrameDrop } from './frameDrop';
import { GroundProbe } from './ground';
import type { StrikeKit } from './shared';

let r: Range;
let kit: StrikeKit;
const log = { boarded: [] as { feet: THREE.Vector3; seconds: number }[], stood: [] as THREE.Vector3[], hidden: 0 };
let occupied = false;
const frame = {
  walker: { feet: new THREE.Vector3() },
  get occupied() { return occupied; },
  board: (feet: THREE.Vector3, _yaw: number, seconds: number) => { log.boarded.push({ feet: feet.clone(), seconds }); occupied = true; },
  stand: (feet: THREE.Vector3) => void log.stood.push(feet.clone()),
  hide: () => void log.hidden++,
} as unknown as Frame;
const LANDED = D.warn + D.height / D.speed + 0.1;

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  log.boarded.length = log.stood.length = 0;
  log.hidden = 0;
  occupied = false;
  const ctx = r.ctx as Ctx & Record<string, unknown>;
  const scene = new THREE.Scene();
  ctx.render = new Proxy(ctx.render, {
    get: (t, k) => (k === 'scene' ? scene : k === 'materials' ? { patch: (m: THREE.Material) => m } : Reflect.get(t, k)),
  });
  ctx.hud = { feed() {}, marker: () => () => {}, follow: () => () => {}, hitMarker() {} } as unknown as Ctx['hud'];
  ctx.world = { nav: { nearest: (p: THREE.Vector3, _d: number, out: THREE.Vector3) => (out.copy(p), true) } } as unknown as Ctx['world'];
  (r.player as unknown as { alive: boolean; yaw: number }).alive = true;
  (r.player as unknown as { yaw: number }).yaw = 0;
  r.player.position.set(0, 0, 0);
  kit = { ctx: r.ctx, probe: new GroundProbe(r.ctx), materials: new ModelMaterials(r.ctx), ordnance: noop('ordnance'), jet: new THREE.Group() };
});

function run(drop: FrameDrop, seconds: number, interact = false): boolean {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.input.simulate('interact', interact);
    const done = drop.update(1 / 60);
    r.input.endFrame();
    if (done) return true;
  }
  return false;
}

describe('the Frame call-in', () => {
  it('lands ahead of the player and boards on E beside it, for the call\'s seconds', () => {
    const drop = new FrameDrop(kit, frame);
    run(drop, LANDED);
    const feet = log.stood.at(-1)!;
    expect(feet.z).toBeCloseTo(-D.ahead, 1);
    expect(feet.y).toBeCloseTo(0, 1);
    // E from where the player called it is too far.
    run(drop, 0.2, true);
    expect(log.boarded).toHaveLength(0);
    r.player.position.set(0, 0, -D.ahead + 2);
    run(drop, 0.05);
    run(drop, 0.1, true);
    expect(log.boarded).toHaveLength(1);
    expect(log.boarded[0]!.seconds).toBe(D.seconds);
    // Out of the seat, it is done.
    expect(run(drop, 0.5)).toBe(false);
    occupied = false;
    expect(run(drop, 0.1)).toBe(true);
  });

  it('is taken back if nobody climbs in', () => {
    const drop = new FrameDrop(kit, frame);
    expect(run(drop, LANDED + D.wait + 0.5)).toBe(true);
    expect(log.boarded).toHaveLength(0);
    expect(log.hidden).toBeGreaterThan(0);
  });
});
