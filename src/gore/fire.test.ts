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
    // The decal sheet's own soot shape under what burned, a small burnt middle, and soot off to one side.
    expect(seen.decals.filter(k => k === 'soot').length).toBe(2);
    expect(seen.decals.filter(k => k === 'scorch').length).toBe(1);
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
    // Only what the gib threw off may still burn: its limbs (a head, and each arm and leg whole or in two) and the
    // pieces of its trunk. Nothing where the body stood, and the body's own fire is gone.
    expect(gore.fire.stats().alight).toBeLessThanOrEqual(9 + 6);
    expect(gore.fire.stats().alight).toBe(gore.stats().limbs + gore.stats().halves);
    expect(gore.fire.has(c)).toBe(false);
    expect(c.root.parent).toBe(null);
  });
});

describe('a burnt body that comes apart (the seams between fire and the rest)', () => {
  type Piece = { burn: number; dry: boolean; mesh: THREE.Mesh; emitter: unknown; ribbon: unknown; pooled: boolean };
  const halves = () => (gore.sliced as unknown as { halves: Piece[] }).halves;
  /** Every call that puts red on the world, counted. */
  function bloodCalls(): { n: number; names: string[]; restore(): void } {
    const blood = gore.blood as unknown as Record<string, (...args: unknown[]) => unknown>;
    const out = { n: 0, names: [] as string[], restore() {} };
    const names = ['burst', 'fan', 'pool', 'splatterAround', 'splatterAlong', 'spray', 'stainBelow', 'soak', 'castOff', 'drip'];
    const real = names.map(name => blood[name]!);
    names.forEach((name, i) => { blood[name] = (...args: unknown[]) => { out.n++; out.names.push(name); return real[i]!.apply(gore.blood, args); }; });
    out.restore = () => names.forEach((name, i) => { blood[name] = real[i]!; });
    return out;
  }

  it('burst, it throws charred pieces of trunk that burn on, and no blood: no stain, no pool, no ribbon', () => {
    const blood = bloodCalls();
    const opened = gore.trail.opened;
    const c = spawn();
    c.setBurn(0.9);
    gore.burnOn(c);
    gore.gib(c, new THREE.Vector3(0, 1, 0.5), 300);
    const pieces = halves();
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const p of pieces) {
      // Drawn as an instance of one, whose colour is its char.
      expect((p.mesh as THREE.InstancedMesh).isInstancedMesh).toBe(true);
      expect((p.mesh as THREE.InstancedMesh).instanceColor!.getX(0)).toBeLessThan(0.2);
      expect(p.burn).toBeCloseTo(0.9, 5);
      expect(p.dry).toBe(true);
      expect(p.emitter).toBe(null);
      expect(p.ribbon).toBe(null);
    }
    run(3);
    expect(blood.names).toEqual([]);
    expect(gore.trail.opened).toBe(opened);
    // Soot where it burst.
    expect(seen.decals).toContain('soot');
    // Its fire went with the pieces, and chars them the rest of the way.
    expect(gore.fire.stats().alight + gore.fire.stats().smouldering).toBeGreaterThan(pieces.length);
    run(FireTuning.limbBurn[1] + 2);
    for (const p of halves()) expect(p.burn).toBe(1);
    blood.restore();
  });

  it('an unburnt body bursts as red as ever, in plain meshes', () => {
    const blood = bloodCalls();
    const opened = gore.trail.opened;
    gore.gib(spawn(), new THREE.Vector3(0, 1, 0.5), 300);
    for (const p of halves()) {
      expect((p.mesh as THREE.InstancedMesh).isInstancedMesh).not.toBe(true);
      expect(p.dry).toBe(false);
    }
    run(1);
    expect(blood.n).toBeGreaterThan(3);
    expect(gore.trail.opened).toBeGreaterThan(opened);
    blood.restore();
  });

  it('cut in two by a blade while it burns, both halves burn on and char, and then smoulder', () => {
    const c = spawn();
    c.setBurn(0.3);
    run(0.3, [c]);
    expect(gore.fire.stats().alight).toBe(1);
    gore.slice(c, new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0, 1, 0), cut);
    const pieces = halves();
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(gore.fire.has(c)).toBe(false);
    expect(gore.fire.stats().alight).toBe(pieces.length);
    for (const p of pieces) expect(p.burn).toBeCloseTo(c.burn, 1);
    seen.licks = 0;
    seen.lickAt.length = 0;
    run(1);
    // Flames off both halves, where they are: from the floor to about the height the body stood.
    expect(seen.licks).toBeGreaterThan(10);
    expect(Math.max(...seen.lickAt)).toBeLessThan(2.2);
    run(FireTuning.limbBurn[1] + 1.5);
    for (const p of pieces) expect(p.burn).toBe(1);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: pieces.length });
    seen.wisps = 0;
    run(2);
    expect(seen.wisps).toBeGreaterThan(0);
    run(FireTuning.smoulder);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 0 });
  });

  it('a cold burnt corpse cut in two is two burnt halves with no blood and no fire', () => {
    const blood = bloodCalls();
    const c = spawn();
    c.setBurn(1);
    gore.slice(c, new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0, 1, 0), cut);
    for (const p of halves()) {
      expect(p.burn).toBe(1);
      expect(p.dry).toBe(true);
      expect(p.emitter).toBe(null);
    }
    run(6);
    expect(blood.n).toBe(0);
    expect(gore.fire.stats()).toMatchObject({ alight: 0, smouldering: 0 });
    blood.restore();
  });

  it('a limb cut from a burnt body sprays nothing, and neither end spurts', () => {
    const blood = bloodCalls();
    const c = spawn();
    c.setBurn(0.9);
    gore.ragdoll(c);
    const before = gore.stats().spurts;
    gore.sever(c, 'armL', cut);
    expect(gore.stats().spurts).toBe(before);
    run(2);
    expect(blood.names).toEqual([]);
    blood.restore();
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

describe('fire meets the rest of gore (F3)', () => {
  /** The bend at a joint: the angle between a bone and its parent. */
  const bend = (c: TestDummy, bone: number, parent: number) => {
    const a = new THREE.Quaternion(), b = new THREE.Quaternion();
    c.bones[parent]!.getWorldQuaternion(a);
    c.bones[bone]!.getWorldQuaternion(b);
    return a.angleTo(b);
  };

  it('a burning corpse draws its arms and legs up as it chars, and holds it', () => {
    const c = spawn(0, 0);
    c.setBurn(0.85);
    gore.burnOn(c);
    gore.ragdoll(c);
    run(FireTuning.corpseBurn[1] + 1.5);
    // Elbows closed toward the pose's 2 rad and knees toward its 1.25. A limb pinned under the body cannot get there, so
    // three of the four are asked for, whatever way it fell.
    const { elbow, knee } = FireTuning.curlPose;
    const drawn = [bend(c, 6, 5) / elbow, bend(c, 9, 8) / elbow, bend(c, 12, 11) / knee, bend(c, 15, 14) / knee];
    expect(drawn.filter(share => share > 0.6 && share < 1.3).length, drawn.map(v => v.toFixed(2)).join(' ')).toBeGreaterThanOrEqual(3);
    // It has finished and been left to lie: nothing simulated, and the pose is the one it froze in.
    expect(gore.fire.curling(c)).toBe(false);
    expect(gore.stats().ragdolls).toBe(0);
    const held = bend(c, 6, 5);
    run(3);
    expect(bend(c, 6, 5)).toBeCloseTo(held, 5);
  });

  it('only the nearest few draw up at once', () => {
    const crowd = Array.from({ length: FireTuning.curls + 4 }, (_, i) => spawn(i * 1.6 - 6, -3 - i));
    for (const c of crowd) {
      c.setBurn(0.85);
      gore.burnOn(c);
      gore.ragdoll(c);
    }
    run(1.5);
    expect(crowd.filter(c => gore.fire.curling(c)).length).toBe(FireTuning.curls);
  });

  it('the pieces of a burnt body are dark, and of an unburnt one are not', () => {
    const tintOf = (kind: string, slot: number) => {
      const mesh = (gore.chunks as unknown as { meshes: Map<string, THREE.InstancedMesh> }).meshes.get(kind)!;
      return mesh.instanceColor!.getX(slot);
    };
    const slots = () => (gore.chunks as unknown as { all: { kind: string; slot: number; alive: boolean }[] }).all.filter(c => c.alive);
    const c = spawn();
    c.setBurn(1);
    gore.burnOn(c);
    gore.gib(c, new THREE.Vector3(0, 1, 0.5), 300);
    const burntPieces = slots();
    expect(burntPieces.length).toBeGreaterThan(4);
    for (const p of burntPieces) expect(tintOf(p.kind, p.slot)).toBeLessThan(0.3);
    gore.clear();
    const fresh = spawn();
    gore.gib(fresh, new THREE.Vector3(0, 1, 0.5), 300);
    for (const p of slots()) expect(tintOf(p.kind, p.slot)).toBe(1);
  });
});

describe('fire burns through the skin (F2)', () => {
  it('catches somewhere on a man lit with no point of his own, and bares muscle only once he is well charred', () => {
    const c = spawn();
    run(0.2, [c]);
    expect(c.burnOrigin).toBeGreaterThanOrEqual(0);
    // Alight but hardly charred: nothing through yet, however long.
    run(2, [c]);
    expect(c.burnThrough).toBe(0);
    c.setBurn(0.9);
    run(2, [c]);
    expect(c.burnThrough).toBeCloseTo(2 * FireTuning.eatAlive, 1);
    run(10, [c]);
    expect(c.burnThrough).toBe(FireTuning.eatAliveMax);
  });

  it('a corpse burns through most of the way by the time its flames die, and stays so', () => {
    const c = spawn();
    c.setBurn(0.85);
    gore.burnOn(c);
    gore.ragdoll(c);
    run(1);
    const early = c.burnThrough;
    expect(early).toBeLessThan(0.2);
    run(FireTuning.corpseBurn[1] + 1);
    expect(c.burnThrough).toBeCloseTo(FireTuning.eatMax, 5);
    run(FireTuning.smoulder + 2);
    expect(c.burnThrough).toBeCloseTo(FireTuning.eatMax, 5);
  });

  it('a limb leaves with what its body had burnt through, and goes on', () => {
    const c = spawn();
    c.setBurn(0.95);
    run(3, [c]);
    const had = c.burnThrough;
    expect(had).toBeGreaterThan(0.2);
    gore.sever(c, 'armL', cut);
    const limb = (gore as unknown as { limbs: { piece: SeveredLimb }[] }).limbs[0]!.piece;
    expect(limb.burnThrough).toBeCloseTo(had, 5);
    run(FireTuning.limbBurn[1] + 1.5, [c]);
    expect(limb.burnThrough!).toBeCloseTo(FireTuning.eatMax, 5);
  });

  it('what is built to burn is not eaten', () => {
    const c = spawn();
    gore.burnOn(c, true);
    gore.ragdoll(c);
    run(FireTuning.corpseBurn[1] + 1);
    expect(c.burnThrough).toBe(0);
    expect(c.burn).toBe(0);
  });
});
