import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CharacterInstance, DamageInfo, DamageType } from '../core/contracts';
import { SPRAY_HEAVY, sprayMark } from '../fx/recipes/blood';
import { Decals, RING_CAPACITY } from '../render/Decals';
import type { MaterialPatcher } from '../render/materials/patch';
import type { BakedSet } from '../render/materials/TextureBaker';
import { makeCtx } from '../sandbox/harness';
import { WEAPONS } from '../weapons/data';
import { BloodField, BloodTuning, puffOf, sprayOf } from './blood';

const damage = (type: DamageType, amount: number, force = 0): DamageInfo => ({
  type, amount, force, source: 'test', point: new THREE.Vector3(0, 1.2, 0), dir: new THREE.Vector3(0, 0, -1), bone: 1,
});

/** A BloodField whose effects are counted rather than drawn. */
function field() {
  const calls = { sprays: [] as { weight: number; radial: boolean }[], drips: 0, splats: 0, puffs: [] as { weight: number; scale: number }[] };
  const ctx = makeCtx({
    fx: {
      bloodSpray: (_p: THREE.Vector3, _d: THREE.Vector3, weight: number, radial = false) => calls.sprays.push({ weight, radial }),
      bloodDrip: () => calls.drips++,
      bloodPuff: (_p: THREE.Vector3, _d: THREE.Vector3, weight = 0.3, scale = 1) => calls.puffs.push({ weight, scale }),
    } as unknown as ReturnType<typeof makeCtx>['fx'],
    render: { decals: { add() {}, splat: () => calls.splats++, clear() {} } } as unknown as ReturnType<typeof makeCtx>['render'],
  });
  return { blood: new BloodField(ctx), ctx, calls };
}

function body(): CharacterInstance {
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = [new THREE.Bone(), new THREE.Bone()];
  root.add(bones[0]!);
  bones[0]!.add(bones[1]!);
  bones[1]!.position.y = 1.2;
  return { root, bones, setBloodiness() {} } as unknown as CharacterInstance;
}

describe('exit sprays', () => {
  it('scale with the round: a light round mists, a shotgun or heavy round splashes, a blast bursts every way', () => {
    const smg = sprayOf(damage('bullet', WEAPONS.smg.damage))!;
    const pellet = sprayOf(damage('pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force))!;
    const judge = sprayOf(damage('bullet', WEAPONS.judge.damage, WEAPONS.judge.force))!;
    const blast = sprayOf(damage('explosive', 150))!;
    expect(smg.weight).toBeLessThan(SPRAY_HEAVY);
    expect(pellet.weight).toBeGreaterThanOrEqual(SPRAY_HEAVY);
    expect(judge.weight).toBeGreaterThan(pellet.weight);
    expect([smg.radial, pellet.radial, judge.radial, blast.radial]).toEqual([false, false, false, true]);
    // The mark on the wall grows with it: a hand's width for the SMG, most of a metre for the Judge.
    expect(sprayMark(smg.weight)).toBeLessThan(0.5);
    expect(sprayMark(judge.weight)).toBeGreaterThan(0.8);
    expect(sprayMark(judge.weight)).toBeGreaterThan(sprayMark(pellet.weight));
    expect(sprayMark(pellet.weight)).toBeGreaterThan(sprayMark(smg.weight));
    // Fire, shock and blades leave no spray.
    for (const t of ['fire', 'shock', 'slash', 'melee'] as DamageType[]) expect(sprayOf(damage(t, 50)), t).toBeNull();
  });

  it('turns a shotgun blast on one body into one spray and one dripping wound', () => {
    const { blood, calls } = field();
    const man = body();
    for (let i = 0; i < 8; i++) blood.onHit(man, damage('pellet', 20, 30), 0.2);
    expect(calls.sprays.length).toBe(1);
    expect(blood.bleeding).toBe(1);
    // A second body in the same blast sprays too.
    blood.onHit(body(), damage('pellet', 20, 30), 0.2);
    expect(calls.sprays.length).toBe(2);
  });

  it('holds sprays to a budget a frame', () => {
    const { blood, calls } = field();
    for (let i = 0; i < 20; i++) blood.onHit(body(), damage('explosive', 120), 0.8);
    expect(calls.sprays.length).toBe(BloodTuning.spraysPerFrame);
    blood.update(1 / 60);
    blood.onHit(body(), damage('explosive', 120), 0.8);
    expect(calls.sprays.length).toBe(BloodTuning.spraysPerFrame + 1);
  });
});

describe('drips', () => {
  it('hold the bleeder cap, oldest out, and the drops a frame', () => {
    const { blood, ctx, calls } = field();
    for (let i = 0; i < BloodTuning.maxBleeders * 2; i++) blood.onHit(body(), damage('bullet', 60), 0.6);
    expect(blood.bleeding).toBe(BloodTuning.maxBleeders);
    // Every wound is due well inside two seconds; no frame lets more than the budget fall.
    let most = 0;
    for (let f = 0; f < 120; f++) {
      ctx.time.tick(1 / 60);
      const before = calls.drips;
      blood.update(1 / 60);
      most = Math.max(most, calls.drips - before);
    }
    expect(most).toBeLessThanOrEqual(BloodTuning.dripsPerFrame);
    expect(calls.drips).toBeGreaterThan(BloodTuning.maxBleeders);
    // Gibs and callers share the budget: a frame lets that many fall, and the rest wait.
    const at = new THREE.Vector3();
    let fell = 0;
    for (let i = 0; i < 20; i++) if (blood.drip(at)) fell++;
    expect(fell).toBeLessThanOrEqual(BloodTuning.dripsPerFrame);
    blood.update(1 / 60);
    let next = 0;
    for (let i = 0; i < 20; i++) if (blood.drip(at)) next++;
    expect(next).toBe(BloodTuning.dripsPerFrame);
  });

  it('stop when the wound clots, or the body leaves the scene', () => {
    const { blood, ctx } = field();
    const gone = body();
    blood.onHit(gone, damage('bullet', 25), 0.25);
    blood.onHit(body(), damage('bullet', 25), 0.25);
    gone.root.removeFromParent();
    for (let f = 0; f < 60 * 2; f++) {
      ctx.time.tick(1 / 60);
      blood.update(1 / 60);
    }
    expect(blood.bleeding).toBe(1);
    for (let f = 0; f < 60 * 12; f++) {
      ctx.time.tick(1 / 60);
      blood.update(1 / 60);
    }
    expect(blood.bleeding).toBe(0);
  });
});

describe('decals', () => {
  const patcher = { apply: (m: THREE.MeshStandardMaterial) => m } as unknown as MaterialPatcher;
  const atlas = { albedo: null, surface: null } as unknown as BakedSet;
  const wall = new THREE.Vector3(1, 0, 0);
  const floor = new THREE.Vector3(0, 1, 0);
  const into = new THREE.Vector3(-6, -1, 0);

  it('stay inside the cap, the oldest recycled', () => {
    const d = new Decals(patcher, atlas);
    for (let i = 0; i < RING_CAPACITY.blood * 2; i++) d.splat(new THREE.Vector3(0, 1, i * 0.01), wall, 0.9, into);
    expect(d.live('blood')).toBe(RING_CAPACITY.blood);
  });

  it('run down walls from big stains only, and never on a floor', () => {
    const d = new Decals(patcher, atlas);
    d.run(new THREE.Vector3(), floor, 1);
    expect(d.total).toBe(0);
    d.run(new THREE.Vector3(0, 1, 0), wall, 0.4);
    expect(d.total).toBe(1);
    // Hung down the wall and facing out of it, or it is culled.
    const m = new THREE.Matrix4().fromArray(d.mesh.instanceMatrix.array as Float32Array, d.base('blood') * 16);
    const [ax, ay, az] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    m.extractBasis(ax, ay, az);
    expect(ax.normalize().y).toBeCloseTo(-1);
    expect(new THREE.Vector3().crossVectors(ax, ay).dot(wall)).toBeGreaterThan(0);
    // A drop's spot on a wall stays a spot; a splash feeds runs.
    d.splat(new THREE.Vector3(0, 1, 0), wall, 0.1, into);
    expect(d.total).toBe(2);
    d.splat(new THREE.Vector3(0, 1, 0), wall, 1, into);
    expect(d.total).toBeGreaterThan(3);
    const before = d.total;
    d.splat(new THREE.Vector3(0, 0, 0), floor, 1, new THREE.Vector3(1, -6, 0));
    expect(d.total).toBe(before + 1);
  });
});

describe('impact puffs', () => {
  it('come off a bullet or a pellet and nothing else, heavier for a heavier round', () => {
    const smg = puffOf(damage('bullet', WEAPONS.smg.damage));
    const pistol = puffOf(damage('bullet', WEAPONS.rivet.damage, WEAPONS.rivet.force));
    const rifle = puffOf(damage('bullet', WEAPONS.harrow.damage, WEAPONS.harrow.force));
    const pellet = puffOf(damage('pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force));
    const sabot = puffOf(damage('bullet', WEAPONS.sabot.damage, WEAPONS.sabot.force));
    expect(smg).toBeGreaterThan(0);
    expect(pistol).toBeGreaterThan(smg);
    expect(rifle).toBeGreaterThan(pistol);
    expect(pellet).toBeGreaterThan(rifle);
    expect(sabot).toBe(1);
    for (const t of ['explosive', 'fire', 'shock', 'slash', 'melee', 'crush', 'true'] as DamageType[]) expect(puffOf(damage(t, 50)), t).toBe(-1);
  });

  it('are one a round, on the frame of the hit', () => {
    const { blood, calls } = field();
    blood.onHit(body(), damage('bullet', 25), 0.1);
    expect(calls.puffs).toHaveLength(1);
    expect(calls.puffs[0]!.scale).toBe(1);
    // The next round on the same body, the same frame (a second gun), is its own hit.
    blood.onHit(body(), damage('bullet', 25), 0.1);
    expect(calls.puffs).toHaveLength(2);
    for (const t of ['explosive', 'fire', 'slash', 'melee'] as DamageType[]) blood.onHit(body(), damage(t, 50), 0.3);
    expect(calls.puffs).toHaveLength(2);
  });

  it('are one big one for a shotgun blast on a body, and a few small ones for its pellets', () => {
    const { blood, calls } = field();
    const man = body();
    for (let i = 0; i < 8; i++) blood.onHit(man, damage('pellet', 26, 20), 0.2);
    expect(calls.puffs).toHaveLength(1 + BloodTuning.puffPellets);
    expect(calls.puffs[0]!.scale).toBe(BloodTuning.puffBlastScale);
    for (const p of calls.puffs.slice(1)) expect(p.scale).toBe(BloodTuning.puffPelletScale);
    // A second body in the same blast has its own.
    blood.onHit(body(), damage('pellet', 26, 20), 0.2);
    expect(calls.puffs).toHaveLength(2 + BloodTuning.puffPellets);
  });
});

describe('big stains', () => {
  /** A floor at y 0 and, if asked, a wall at x = `wallAt` facing back down -x. Every big stain laid is recorded. */
  function stage(wallAt = Infinity) {
    const laid: { kind: string; at: THREE.Vector3; normal: THREE.Vector3; size: number; minor: boolean }[] = [];
    const time = { elapsed: 0 };
    const ctx = makeCtx({
      time: time as unknown as ReturnType<typeof makeCtx>['time'],
      fx: { bloodSpray() {}, bloodDrip() {}, bloodPuff() {} } as unknown as ReturnType<typeof makeCtx>['fx'],
      physics: {
        raycastInto(o: THREE.Vector3, d: THREE.Vector3, max: number, _g: number, hit: { point: THREE.Vector3; normal: THREE.Vector3; distance: number }) {
          let best = Infinity;
          if (d.y < 0 && o.y > 0) best = -o.y / d.y;
          let wall = false;
          if (d.x > 0 && o.x < wallAt && (wallAt - o.x) / d.x < best) {
            best = (wallAt - o.x) / d.x;
            wall = true;
          }
          if (!(best <= max)) return false;
          hit.point.copy(o).addScaledVector(d, best);
          hit.normal.set(wall ? -1 : 0, wall ? 0 : 1, 0);
          hit.distance = best;
          return true;
        },
      } as unknown as ReturnType<typeof makeCtx>['physics'],
      render: {
        decals: {
          add() {}, splat() {}, clear() {},
          big: (kind: string, at: THREE.Vector3, normal: THREE.Vector3, size: number, _dir?: THREE.Vector3, minor = false) =>
            laid.push({ kind, at: at.clone(), normal: normal.clone(), size, minor }),
        },
      } as unknown as ReturnType<typeof makeCtx>['render'],
    });
    const blood = new BloodField(ctx);
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        time.elapsed += 1 / 60;
        blood.update(1 / 60);
      }
    };
    return { blood, laid, run };
  }
  const chest = (x = 0, z = 0) => new THREE.Vector3(x, 1.2, z);
  const along = new THREE.Vector3(1, 0, 0);

  it('a body coming apart leaves one burst under it, in place of a dozen rays', () => {
    const { blood, laid, run } = stage();
    blood.burst(chest(), along, 2.4);
    run(0.1);
    expect(laid.map(l => l.kind)).toEqual(['burst']);
    expect(laid[0]!.at.y).toBeCloseTo(0);
    expect(laid[0]!.size).toBeCloseTo(2.4);
    expect(laid[0]!.minor).toBe(false);
    expect(blood.bigLaid).toBe(1);
  });

  it('several in one blast are one event: the second lays a ring round them all, and the rest are smaller', () => {
    const { blood, laid, run } = stage();
    blood.burst(chest(0), along, 2.4);
    blood.burst(chest(1.5), along, 2.4);
    blood.burst(chest(-1.2), along, 2.4);
    run(0.1);
    expect(laid.filter(l => l.kind === 'ring')).toHaveLength(1);
    const ring = laid.find(l => l.kind === 'ring')!;
    expect(ring.at.x).toBeCloseTo(0.75);
    expect(ring.size).toBeGreaterThan(3);
    expect(laid.filter(l => l.kind === 'burst').map(l => +l.size.toFixed(2))).toEqual([2.4, 1.8, 1.8]);
    // Later, or far away, it is a new blast.
    run(1);
    blood.burst(chest(0.5), along, 2.4);
    blood.burst(chest(30), along, 2.4);
    run(0.1);
    expect(laid.filter(l => l.kind === 'ring')).toHaveLength(1);
  });

  it('a shot through a body throws a fan on the floor past it, and a sheet on the wall behind if one is near', () => {
    const open = stage();
    open.blood.fan(chest(), along, 2);
    open.run(0.1);
    expect(open.laid.map(l => l.kind)).toEqual(['fan']);
    const walled = stage(1.5);
    walled.blood.fan(chest(), along, 2);
    walled.run(0.1);
    expect(walled.laid.map(l => l.kind).sort()).toEqual(['fan', 'sheet', 'sheet']);
    const sheet = walled.laid.find(l => l.kind === 'sheet' && Math.abs(l.at.y - 1.2) < 0.01)!;
    expect(sheet.normal.x).toBe(-1);
    // Thinner for the flight, never bigger than the fan.
    expect(sheet.size).toBeLessThan(2);
    expect(sheet.size).toBeGreaterThan(1);
  });

  it('a big floor stain that reaches a wall goes up it, since a flat decal is cut off at the corner', () => {
    const far = stage(4);
    far.blood.burst(chest(), along, 2.4);
    far.run(0.1);
    expect(far.laid.map(l => l.kind)).toEqual(['burst']);
    const near = stage(0.5);
    near.blood.burst(chest(), along, 2.4);
    near.run(0.1);
    expect(near.laid.map(l => l.kind)).toEqual(['burst', 'sheet']);
    const up = near.laid[1]!;
    expect(up.normal.x).toBe(-1);
    expect(up.at.x).toBeCloseTo(0.5);
    // Low on the wall, where the floor's blood met it, and no bigger than what was cut off.
    expect(up.at.y).toBeLessThan(0.8);
    expect(up.size).toBeLessThan(2.4);
  });

  it('every round leaves its own mark on the floor past the body, a quarter second on, with the small stains', () => {
    const { blood, laid, run } = stage();
    const char = body();
    blood.onHit(char, damage('bullet', WEAPONS.smg.damage), 0.2);
    run(0.05);
    expect(laid).toHaveLength(0);
    run(0.2);
    expect(laid.map(l => l.kind)).toEqual(['fan']);
    expect(laid[0]!.minor).toBe(true);
    const smg = laid[0]!.size;
    expect(smg).toBeGreaterThan(0.4);
    expect(smg).toBeLessThan(1.2);
    // A heavy round's is bigger; a shotgun's pellets on one body are one mark; a blast leaves its burst to the gib.
    blood.onHit(body(), damage('bullet', WEAPONS.judge.damage, WEAPONS.judge.force), 1);
    run(0.25);
    expect(laid[1]!.size).toBeGreaterThan(smg);
    const one = body();
    for (let i = 0; i < 8; i++) blood.onHit(one, damage('pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force), 0.3);
    blood.onHit(body(), damage('explosive', 150), 1);
    run(0.25);
    expect(laid).toHaveLength(3);
  });

  it('scale with the gore setting, and wait in a queue that has an end', () => {
    const { blood, laid, run } = stage();
    const full = BloodTuning.amount;
    BloodTuning.amount = 0.5;
    blood.burst(chest(), along, 2.4);
    run(0.1);
    BloodTuning.amount = full;
    expect(laid[0]!.size).toBeCloseTo(1.2);
    for (let i = 0; i < BloodTuning.maxBig * 3; i++) blood.soak(chest(i * 10), 1.5);
    run(1);
    expect(laid.length - 1).toBe(BloodTuning.maxBig);
    blood.clear();
    expect(blood.bigLaid).toBe(0);
  });
});
