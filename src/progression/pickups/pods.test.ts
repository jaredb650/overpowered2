/**
 * Supply pods (weapons-update plan section 10): where the Crucible sells its guns, the drop pod every break carries the shop and
 * is not a pickup. E within reach of an open one is the only way into the shop, and it is gone when the break ends.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { WavePhase } from '../../core/gameplay';
import { noop } from '../../core/stubs';
import { makeRange, type Range } from '../../weapons/testkit';
import { DROP_POD } from '../data';
import { ModelMaterials } from '../modelkit';
import { DropPods, SUPPLY } from './pods';

let r: Range;
let opened = 0;
let scene: THREE.Scene;
/** The supply pods' beacons lit now. */
const beacons = (): number =>
  scene.children.filter(o => o.visible && o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry).length;
const waves = { wave: 3, phase: 'intermission' as WavePhase, nextWaveIn: 25 };
const SPOT = new THREE.Vector3(0, 0, -60);

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  opened = 0;
  waves.phase = 'intermission';
  const ctx = r.ctx as Ctx & Record<string, unknown>;
  scene = new THREE.Scene();
  const base = noop<Ctx['render']>('render');
  ctx.render = new Proxy(base, {
    get: (t, k) => (k === 'scene' ? scene : k === 'materials' ? { patch: (m: THREE.Material) => m } : Reflect.get(t, k)),
  });
  ctx.hud = { feed() {}, marker: () => () => {}, follow: () => () => {} } as unknown as Ctx['hud'];
  ctx.waves = waves as unknown as Ctx['waves'];
  ctx.combat = noop('combat');
  ctx.world = { pickupSpots: [SPOT] } as unknown as Ctx['world'];
  (ctx.player as unknown as { alive: boolean }).alive = true;
  ctx.events.on('shop:open', () => opened++);
});

/** A pod called onto SPOT, run until it has landed and opened. */
function landed(supply: boolean): DropPods {
  const pods = new DropPods(r.ctx, new ModelMaterials(r.ctx), supply);
  pods.call(SPOT.clone());
  step(pods, DROP_POD.warnSeconds + DROP_POD.height / DROP_POD.speed + 1.5);
  return pods;
}

function step(pods: DropPods, seconds: number, interact = false): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.input.simulate('interact', interact);
    pods.update(1 / 60);
    r.input.endFrame();
  }
}

const standAt = (z: number): void => void r.player.position.set(0, 0, z);

describe('supply pods', () => {
  it('come every break, where caches came every second wave', () => {
    let calls = 0;
    const pods = new DropPods(r.ctx, new ModelMaterials(r.ctx), true);
    const cache = new DropPods(r.ctx, new ModelMaterials(r.ctx), false);
    pods.call = () => void calls++;
    for (const w of [1, 2, 3, 4]) pods.onWaveClear(w);
    expect(calls).toBe(4);
    calls = 0;
    cache.call = () => void calls++;
    for (const w of [1, 2, 3, 4]) cache.onWaveClear(w);
    expect(calls).toBe(4 / DROP_POD.everyWaves);
  });

  it('open the shop on E only within reach of an open pod', () => {
    standAt(0);
    const pods = landed(true);
    // Far off, E does nothing.
    step(pods, 0.2, true);
    expect(opened).toBe(0);
    // In reach, standing there does not open it: E does.
    standAt(SPOT.z + SUPPLY.reach - 1);
    step(pods, 0.5);
    expect(pods.supplyNear).toBe(true);
    expect(opened).toBe(0);
    step(pods, 1 / 60, true);
    expect(opened).toBe(1);
    // Just out of reach, it does not.
    standAt(SPOT.z + SUPPLY.reach + 0.5);
    step(pods, 0.2);
    step(pods, 1 / 60, true);
    expect(pods.supplyNear).toBe(false);
    expect(opened).toBe(1);
  });

  it('are not pickups: walking into one hands nothing over', () => {
    const before = new Set(r.weapons.owned);
    standAt(SPOT.z);
    const pods = landed(true);
    step(pods, 2);
    expect(new Set(r.weapons.owned)).toEqual(before);
  });

  it('do not open before they land', () => {
    standAt(SPOT.z + 1);
    const pods = new DropPods(r.ctx, new ModelMaterials(r.ctx), true);
    pods.call(SPOT.clone());
    // Its beacon is up from the call, so the run starts before it lands.
    expect(beacons()).toBe(1);
    step(pods, DROP_POD.warnSeconds, true);
    expect(opened).toBe(0);
  });

  it('are gone when the break ends, open or not', () => {
    standAt(SPOT.z + 1);
    const pods = landed(true);
    step(pods, 0.2);
    expect(pods.supplyNear).toBe(true);
    expect(pods.entries.some(e => e.active)).toBe(true);
    waves.phase = 'spawning';
    step(pods, 1 / 60, true);
    expect(pods.supplyNear).toBe(false);
    expect(pods.entries.some(e => e.active)).toBe(false);
    expect(beacons()).toBe(0);
    expect(opened).toBe(0);
  });

  it('a weapon cache, with the shop off, is still the pickup it was', () => {
    standAt(SPOT.z);
    const pods = landed(false);
    step(pods, 0.5);
    expect(r.weapons.owned.has('judge')).toBe(true);
    expect(opened).toBe(0);
  });
});
