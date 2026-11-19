/**
 * Who gets a struck part on physics (the gore update's R3), through the real damage model: which part by where the round
 * landed, and the budget (the nearest few in view). The part itself is tested on the animator (`sway.test.ts` beside it).
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import { WEAPONS } from '../weapons/data';
import { SWAY } from './damage';
import { EnemyManager } from './EnemyManager';
import type { Enemy } from './Enemy';

interface Anim { sway: ReturnType<typeof vi.fn>; swaying: boolean; flinch: ReturnType<typeof vi.fn> }

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), setHurt: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn(),
    swaying: false, sway: vi.fn(function (this: { swaying: boolean }) { this.swaying = true; }) };
  return { archetype: id, rig, root, bones, severed: new Set(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod: vi.fn() } as unknown as CharacterInstance;
}

function world() {
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const gore = {
    wound: vi.fn(() => false), headPellets: vi.fn(() => 1), sever: vi.fn(() => null), knockdown: vi.fn(() => false), downed: vi.fn(() => null),
    handedBack: vi.fn(() => null), rouse: vi.fn(), ragdoll: vi.fn(), collapse: vi.fn(), headshot: vi.fn(), gib: vi.fn(), slice: vi.fn(), blowOut: vi.fn(), vaporize: vi.fn(), owns: () => false,
  };
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'], player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: () => {}, playOneOf: () => {}, startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const manager = new EnemyManager(ctx);
  const spawn = (id: EnemyId, dist = 8): Enemy => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, -dist))!;
    e.dist = dist;
    e.inView = true;
    e.lod = 0;
    e.health = e.maxHealth = 1e5;
    for (const region of e.limbHp.keys()) e.limbHp.set(region, 1e6);
    return e;
  };
  return { manager, spawn };
}

const anim = (e: Enemy) => e.char.anim as unknown as Anim;
const round = (region: DamageInfo['region'], bone: number): DamageInfo => ({
  amount: WEAPONS.smg.damage, type: 'bullet', point: new THREE.Vector3(0.1, 1.2, -7.8), dir: new THREE.Vector3(0, 0, -1), force: 20, source: 'smg', region, bone,
});

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
});
afterEach(() => {
  vi.restoreAllMocks();
  DevFlags.sway = true;
});

describe('the struck part goes onto physics', () => {
  it('the arm for an arm, the head for a head, the upper body for the trunk, and for a leg at half size', () => {
    const { manager, spawn } = world();
    const cases = [['armL', B.upperArmL, 'armL'], ['forearmR', B.foreArmR, 'armR'], ['chest', B.chest, 'trunk'], ['abdomen', B.spine, 'trunk'], ['legL', B.thighL, 'trunk']] as const;
    for (const [region, bone, part] of cases) {
      const e = spawn('brute');
      e.plates = [];
      manager.applyDamage(e, round(region, bone));
      expect(anim(e).sway, region).toHaveBeenCalledTimes(1);
      const [got, dir, size] = anim(e).sway.mock.calls[0]! as [string, THREE.Vector3, number];
      expect(got, region).toBe(part);
      expect(dir.z).toBe(-1);
      // The flinch's own size, which the animator scales by build as it does a flinch.
      const flinch = anim(e).flinch.mock.calls[0]![2] as number;
      expect(size, region).toBeCloseTo(region === 'legL' ? flinch * SWAY.legShare : flinch, 6);
    }
  });

  it('only for the nearest few in view, and everyone else keeps the flinch', () => {
    const { manager, spawn } = world();
    const far = spawn('gunner', SWAY.range + 2);
    manager.applyDamage(far, round('chest', B.chest));
    const unseen = spawn('gunner');
    unseen.inView = false;
    manager.applyDamage(unseen, round('chest', B.chest));
    const coarse = spawn('gunner');
    coarse.lod = 1;
    manager.applyDamage(coarse, round('chest', B.chest));
    for (const e of [far, unseen, coarse]) {
      expect(anim(e).flinch).toHaveBeenCalledTimes(1);
      expect(anim(e).sway).not.toHaveBeenCalled();
    }
    // Eight at once. The ninth keeps its springs, until one of the eight is done.
    const crowd = Array.from({ length: SWAY.max + 1 }, () => spawn('gunner'));
    for (const e of crowd) manager.applyDamage(e, round('chest', B.chest));
    expect(crowd.filter(e => anim(e).sway.mock.calls.length > 0)).toHaveLength(SWAY.max);
    expect(manager.model.swayCount).toBe(SWAY.max);
    expect(anim(crowd[SWAY.max]!).sway).not.toHaveBeenCalled();
    // A body already on it is loosened again by its next round, whatever the count.
    crowd[0]!.shock = 0;
    manager.applyDamage(crowd[0]!, round('armL', B.upperArmL));
    expect(anim(crowd[0]!).sway).toHaveBeenCalledTimes(2);
    anim(crowd[3]!).swaying = false;
    crowd[SWAY.max]!.shock = 0;
    manager.applyDamage(crowd[SWAY.max]!, round('chest', B.chest));
    expect(anim(crowd[SWAY.max]!).sway).toHaveBeenCalledTimes(1);
  });

  it('on a co-op guest from its own copy of the hit, and not at all with the switch off or for fire', () => {
    const { manager, spawn } = world();
    const guest = spawn('gunner');
    manager.predictDamage(guest, round('chest', B.chest));
    expect(anim(guest).sway).toHaveBeenCalledTimes(1);
    const burning = spawn('gunner');
    manager.applyDamage(burning, { ...round('chest', B.chest), type: 'fire', amount: 3 });
    expect(anim(burning).sway).not.toHaveBeenCalled();
    DevFlags.sway = false;
    const off = spawn('gunner');
    manager.applyDamage(off, round('chest', B.chest));
    expect(anim(off).flinch).toHaveBeenCalledTimes(1);
    expect(anim(off).sway).not.toHaveBeenCalled();
  });
});
