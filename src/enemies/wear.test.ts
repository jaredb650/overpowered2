/**
 * Wear you can see (the gore update's W1), at the damage model: the skin is told how far each pool is spent, on the host
 * and on a co-op guest's copy, and telling it changes nothing a hit does. The real EnemyManager and DamageModel.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import { WearKind } from '../characters/anatomy/wear';
import type { GoreRegion } from '../characters/rig';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import { WearTuning } from './damage';
import { EnemyManager } from './EnemyManager';

/** A body that keeps what it is told of its wear, as `Character` does. */
function character(id: EnemyId) {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = new Proxy({}, { get: () => vi.fn() });
  const worn = new Map<GoreRegion, { amount: number; kind: number }>();
  return { archetype: id, rig, root, bones, severed: new Set<GoreRegion>(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod: vi.fn(), worn,
    setWear: (r: GoreRegion, spent: number, kind: number) => worn.set(r, { amount: Math.min(1, Math.max(spent, worn.get(r)?.amount ?? 0)), kind }),
    addWear: (r: GoreRegion, share: number, kind: number, most = 1) => worn.set(r, { amount: Math.min((worn.get(r)?.amount ?? 0) + share, most), kind }),
    wearOf: (r: GoreRegion) => worn.get(r)?.amount ?? 0 };
}
type Body = ReturnType<typeof character>;

function world() {
  const player = { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const gore = new Proxy({
    wound: () => false, headPellets: () => 1, knockdown: () => true, downed: () => null, handedBack: () => null, owns: () => false,
    sever: (char: Body, region: GoreRegion) => { char.severed.add(region); return { regions: [region], stump: new THREE.Vector3() }; },
  } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn()) });
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'], player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: () => {}, playOneOf: () => {}, startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const manager = new EnemyManager(ctx);
  const spawn = (id: EnemyId) => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, -6))!;
    e.dist = 6;
    e.inView = true;
    return e;
  };
  return { manager, spawn };
}

const hit = (region: GoreRegion, amount: number, type: DamageInfo['type'] = 'bullet', extra: Partial<DamageInfo> = {}): DamageInfo => ({
  amount, type, point: new THREE.Vector3(0, 1.2, -5.8), dir: new THREE.Vector3(0, 0, -1), force: 0, source: type === 'slash' ? 'sword' : 'smg',
  region, bone: region === 'head' ? B.head : region === 'armR' ? B.upperArmR : B.chest, ...extra,
});
const body = (e: { char: CharacterInstance }) => e.char as unknown as Body;

afterEach(() => { DevFlags.wear = true; });

describe('wear follows the pools proportionally by weapon class', () => {
  it('shows an arm torn through 1:1 with its pool under heavy fire until it comes off', () => {
    const { manager, spawn } = world();
    const e = spawn('trooper');
    const whole = e.limbHp.get('armR')!;
    const seen: number[] = [];
    for (let i = 0; i < 12 && !e.char.severed.has('armR'); i++) {
      manager.applyDamage(e, hit('armR', 8, 'pellet', { source: 'shotgun' }));
      const left = e.limbHp.get('armR');
      seen.push(body(e).wearOf('armR'));
      if (left !== undefined) expect(seen.at(-1)).toBeCloseTo(1 - left / whole, 5);
    }
    expect(e.char.severed.has('armR')).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    expect(seen.at(-1)).toBe(1);
    expect(body(e).worn.get('armR')!.kind).toBe(WearKind.tear);
    // The other arm is untouched.
    expect(body(e).wearOf('armL')).toBe(0);
  });

  it('keeps 9mm/small-arms torso hits free of region-wide skin flaying while ramping limb wear near severing', () => {
    const { manager, spawn } = world();
    const torso = spawn('trooper');
    manager.applyDamage(torso, hit('chest', 25, 'bullet', { source: 'rivet' }));
    expect(body(torso).wearOf('chest')).toBe(0);
    manager.applyDamage(torso, hit('chest', 25, 'bullet', { source: 'smg' }));
    expect(body(torso).wearOf('chest')).toBe(0);
    // First SMG arm hit stays subtle, then ramps sharply as the limb approaches severing.
    const arm = spawn('trooper');
    manager.applyDamage(arm, hit('armR', 8, 'bullet', { source: 'smg' }));
    const early = body(arm).wearOf('armR');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.12);
    for (let i = 0; i < 12 && !arm.char.severed.has('armR'); i++) {
      manager.applyDamage(arm, hit('armR', 8, 'bullet', { source: 'smg' }));
    }
    expect(arm.char.severed.has('armR')).toBe(true);
    expect(body(arm).wearOf('armR')).toBeGreaterThan(0.7);
  });

  it('changes nothing a hit does: the same rounds take the same pools and the same limb with it off', () => {
    const run = (on: boolean) => {
      DevFlags.wear = on;
      const { manager, spawn } = world();
      const e = spawn('trooper');
      const log: (number | undefined)[] = [];
      for (let i = 0; i < 8; i++) {
        manager.applyDamage(e, hit(i % 2 ? 'armR' : 'chest', 7, 'pellet', { source: 'shotgun' }));
        log.push(e.limbHp.get('armR'), e.health, e.char.severed.size);
      }
      return { log, worn: body(e).worn.size };
    };
    const off = run(false), on = run(true);
    expect(on.log).toEqual(off.log);
    expect(off.worn).toBe(0);
    expect(on.worn).toBeGreaterThan(0);
  });

  it('does not flay a limb one blow takes off whole', () => {
    const { manager, spawn } = world();
    const e = spawn('trooper');
    manager.applyDamage(e, hit('armR', 60, 'slash', { severMult: 3 }));
    expect(e.char.severed.has('armR')).toBe(true);
    expect(body(e).wearOf('armR')).toBeCloseTo(WearTuning.step);
    expect(body(e).worn.get('armR')!.kind).toBe(WearKind.cut);
  });

  it('wears the trunk under blasts and heavy weapons, and stops short of bare', () => {
    const { manager, spawn } = world();
    const e = spawn('trooper');
    const before = e.health;
    manager.applyDamage(e, hit('chest', 10, 'explosive', { source: 'rocket' }));
    expect(body(e).wearOf('chest')).toBeCloseTo((before - e.health) / e.maxHealth * WearTuning.trunk * 0.6, 5);
    expect(body(e).wearOf('abdomen')).toBeCloseTo((before - e.health) / e.maxHealth * WearTuning.trunk * 0.6, 5);
    e.health = e.maxHealth = 1e6;
    for (let i = 0; i < 40; i++) manager.applyDamage(e, hit('chest', 1e5, 'pellet', { source: 'shotgun' }));
    expect(body(e).wearOf('chest')).toBeLessThanOrEqual(WearTuning.trunkMost);
  });

  it('shows fire as no wear of its own: the char is fire\'s to draw', () => {
    const { manager, spawn } = world();
    const e = spawn('trooper');
    manager.applyDamage(e, hit('chest', 10, 'fire'));
    expect(body(e).wearOf('chest')).toBe(0);
  });

  it('prevents a single shot or same-frame shotgun blast from completely skinning a head', () => {
    const { manager, spawn } = world();
    const heavy = spawn('trooper');
    heavy.health = heavy.maxHealth = 1000;
    manager.applyDamage(heavy, hit('head', 220, 'bullet', { source: 'awl' }));
    expect(body(heavy).wearOf('head')).toBeLessThanOrEqual(WearTuning.headStep + 1e-6);
    expect(body(heavy).wearOf('head')).toBeLessThan(0.5);

    // Multiple shotgun pellets hitting the head on the same frame share the per-frame head wear cap.
    const pellets = spawn('trooper');
    pellets.health = pellets.maxHealth = 1000;
    for (let i = 0; i < 8; i++) manager.applyDamage(pellets, hit('head', 26, 'pellet', { source: 'shotgun' }));
    expect(body(pellets).wearOf('head')).toBeLessThanOrEqual(WearTuning.headStep + 1e-6);
  });
});

describe('a co-op guest wears its own copy', () => {
  it('from its own count of the limb pools, and from a count of its own for the head', () => {
    const { manager, spawn } = world();
    const e = spawn('trooper');
    const whole = e.limbHp.get('armR')!, head = e.limbHp.get('head')!;
    manager.predictDamage(e, hit('armR', 8, 'pellet', { source: 'shotgun' }));
    expect(body(e).wearOf('armR')).toBeCloseTo(1 - e.limbHp.get('armR')! / whole, 5);
    expect(body(e).wearOf('armR')).toBeGreaterThan(0);
    const res = manager.predictDamage(e, hit('head', 5, 'pellet', { source: 'shotgun' }));
    // The head's pool is the host's: the guest's copy of it is not spent, only the skin is told.
    expect(e.limbHp.get('head')).toBe(head);
    expect(body(e).wearOf('head')).toBeCloseTo(res.dealt / head, 5);
    expect(e.health).toBe(e.maxHealth);
  });
});
