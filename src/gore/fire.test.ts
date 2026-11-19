/** Fire on bodies (gore/fire.ts): the living are fed, a corpse burns on and smoulders, limbs burn, soot for blood. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo, SeveredLimb } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { createGoreSystem, type Gore } from './index';
import { FireTuning } from './fire';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();
const seen = { licks: 0, wisps: 0, flashes: 0, shimmers: 0, pools: 0, decals: [] as string[], lickAt: [] as number[] };

function spawn(x = 0, z = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

/** `feed`: bodies kept alight by their owner, as EnemyManager does each frame. */
const run = (seconds: number, feed: TestDummy[] = []) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    ctx.time.tick(1 / 60);
    for (const c of feed) gore.alight(c);
    physics.step(ctx.time.dt);
    gore.update();
  }
};
const cut: DamageInfo = { amount: 80, type: 'slash', point: new THREE.Vector3(0.3, 1.4, 0), dir: new THREE.Vector3(1, 0, 0), force: 30, source: 'sword' };

beforeAll(async () => {
  physics = await Physics.create();
  const fx = new Proxy({}, {
    get: (_, name) => {
      if (name === 'flameLick') return (p: THREE.Vector3) => { seen.licks++; seen.lickAt.push(p.y); };
      if (name === 'smokeWisp') return () => { seen.wisps++; };
      if (name === 'heatShimmer') return () => { seen.shimmers++; };
      if (name === 'attachEmitter') return () => ({ stop() {}, alive: true });
      return () => {};
    },
  }) as Ctx['fx'];
  ctx = makeCtx({
    physics, fx,
    render: {
      scene, camera: new THREE.PerspectiveCamera(), lights: { flash: () => { seen.flashes++; } },
      decals: { add: (kind: string) => { seen.decals.push(kind); }, splat() {}, clear() {} },
    } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(40, 0.5, 40), null, 'concrete');
  physics.flushQueries();
});

beforeEach(() => {
  gore.clear();
  DevFlags.fire = true;
  seen.licks = seen.wisps = seen.flashes = seen.shimmers = 0;
  seen.decals.length = 0;
  seen.lickAt.length = 0;
});

describe('fire on a living body', () => {
  it('burns over the whole body while it is fed, and stops when it is not', () => {
    const c = spawn();
    run(1, [c]);
    expect(gore.fire.stats().alight).toBe(1);
    // About `rate` licks a second, from the feet to the head and not from one point on the chest.
    expect(seen.licks).toBeGreaterThan(FireTuning.rate * 0.7);
    expect(seen.licks).toBeLessThan(FireTuning.rate * 1.4);
    expect(Math.min(...seen.lickAt)).toBeLessThan(0.5);
    expect(Math.max(...seen.lickAt)).toBeGreaterThan(1.4);
    expect(seen.flashes).toBeGreaterThan(3);
    expect(seen.shimmers).toBeGreaterThan(0);
    expect(c.ember).toBe(1);
    // Not fed: an unburnt body's fire is simply out.
    seen.licks = 0;
    run(0.5);
    expect(gore.fire.stats().alight).toBe(0);
    run(0.5);
    expect(seen.licks).toBeLessThan(8);
  });

  it('a charred man whose fire goes out smokes for a moment, and then nothing', () => {
    const c = spawn();
    c.setBurn(0.6);
    run(0.3, [c]);
    run(0.5);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 1 });
    run(FireTuning.putOut + 0.5);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 0 });
    expect(c.ember).toBe(0);
    expect(c.burn).toBeCloseTo(0.6);
  });

  it('with the switch off nothing is drawn', () => {
    DevFlags.fire = false;
    const c = spawn();
    run(0.5, [c]);
    expect(seen.licks).toBe(0);
    expect(gore.fire.stats().alight).toBe(0);
  });
});

describe('a corpse', () => {
  it('burns on after death, blackens the rest of the way, then smoulders and goes cold', () => {
    const c = spawn();
    c.setBurn(0.85);
    gore.burnOn(c);
    gore.ragdoll(c);
    run(1);
    expect(gore.fire.stats().alight).toBe(1);
    expect(seen.licks).toBeGreaterThan(10);
    expect(c.burn).toBeGreaterThan(0.85);
    expect(c.burn).toBeLessThan(1);
    run(FireTuning.corpseBurn[1] + 1);
    expect(c.burn).toBe(1);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 1 });
    expect(c.ember).toBeGreaterThan(0.2);
    expect(seen.wisps).toBeGreaterThan(3);
    const licks = seen.licks;
    const hot = c.ember;
    run(10);
    expect(seen.licks).toBe(licks);
    expect(c.ember).toBeLessThan(hot * 0.5);
    run(FireTuning.smoulder);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 0 });
    expect(c.ember).toBe(0);
    // Still a burnt body, for good.
    expect(c.burn).toBe(1);
  });

  it('leaves soot and a scorch where it lies, and no blood pool', () => {
    const pools = gore.blood.pool.bind(gore.blood);
    let pooled = 0;
    gore.blood.pool = (...args) => { pooled++; pools(...args); };
    const c = spawn();
    c.setBurn(0.9);
    gore.burnOn(c);
    gore.ragdoll(c);
    run(9);
    expect(seen.decals.filter(k => k === 'scorch').length).toBeGreaterThanOrEqual(1);
    expect(gore.stats().ragdolls).toBe(0);
    expect(pooled).toBe(0);
    // An unburnt one still pools.
    const plain = spawn(4, 0);
    gore.ragdoll(plain);
    run(9);
    expect(pooled).toBe(1);
    gore.blood.pool = pools;
  });

  it('a body that is gibbed or taken back stops burning at once', () => {
    const c = spawn();
    c.setBurn(0.9);
    gore.burnOn(c);
    gore.gib(c, new THREE.Vector3(0, 1, 0.5), 300);
    seen.licks = 0;
    run(0.5);
    expect(gore.fire.stats().alight).toBeLessThanOrEqual(5);
    // Only what the gib threw off as limbs may still burn: nothing where the body stood.
    expect(c.root.parent).toBe(null);
  });
});

describe('a limb cut from a burning body', () => {
  it('burns where it lands, and the body stops burning there', () => {
    const c = spawn();
    c.setBurn(0.5);
    run(0.3, [c]);
    const before = gore.fire.stats().alight;
    const res = gore.sever(c, 'armL', cut);
    expect(res).not.toBeNull();
    expect(gore.fire.stats().alight).toBe(before + 1);
    seen.licks = 0;
    run(1, [c]);
    // The arm's share is on top of the body's.
    expect(seen.licks).toBeGreaterThan(FireTuning.rate * 0.75);
    const limb = (gore as unknown as { limbs: { piece: SeveredLimb }[] }).limbs[0]!.piece;
    expect(limb.burn).toBeGreaterThan(0.5);
    run(FireTuning.limbBurn[1] + 1.5, [c]);
    expect(limb.burn).toBe(1);
    expect(gore.fire.stats()).toMatchObject({ alight: 1, smouldering: 1 });
  });
});

describe('the caps', () => {
  it('never holds more than `max`, and the licks stay inside the budget', () => {
    const crowd = Array.from({ length: FireTuning.max + 6 }, (_, i) => spawn((i % 12) * 1.2 - 7, Math.floor(i / 12) * 1.5 - 4));
    run(1, crowd);
    const s = gore.fire.stats();
    expect(s.alight).toBe(FireTuning.max);
    seen.licks = 0;
    run(1, crowd);
    expect(seen.licks).toBeLessThan(FireTuning.budget * 1.1);
    expect(seen.licks).toBeGreaterThan(FireTuning.budget * 0.6);
  });
});
