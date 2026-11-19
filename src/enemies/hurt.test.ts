/**
 * The gore update's R2, through the real damage model: a plain flinch sends a hand to the wound, with a gap, and a body
 * carries itself hurt. Gore, effects and sound are counted, not drawn.
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
import { CLUTCH } from './damage';
import { EnemyManager } from './EnemyManager';
import type { Enemy } from './Enemy';

type Anim = Record<'flinch' | 'stumble' | 'play' | 'daze' | 'guard' | 'holdWound' | 'setHurt' | 'getUp' | 'setLocomotion' | 'update', ReturnType<typeof vi.fn>>;

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim: Anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), setHurt: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
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
  const clock = manager.aiWorld;
  const spawn = (id: EnemyId): Enemy => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, -6))!;
    e.dist = 6;
    e.inView = true;
    return e;
  };
  return { manager, spawn, at: (seconds: number) => { clock.now = seconds; } };
}

const anim = (e: Enemy) => e.char.anim as unknown as Anim;
const round = (source: keyof typeof WEAPONS, region: DamageInfo['region'] = 'chest', extra: Partial<DamageInfo> = {}): DamageInfo => {
  const def = WEAPONS[source];
  return { amount: def.damage, type: def.pellets > 1 ? 'pellet' : 'bullet', point: new THREE.Vector3(0.1, 1.2, -5.8), dir: new THREE.Vector3(0, 0, -1),
    force: def.force, source, region, bone: region === 'head' ? B.head : region === 'legL' ? B.thighL : region === 'legR' ? B.thighR : B.chest, ...extra };
};

beforeEach(() => {
  // No stagger and no fall: every hit here is a plain flinch.
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
});
afterEach(() => {
  vi.restoreAllMocks();
  DevFlags.clutch = true;
});

describe('a plain flinch sends a hand to the wound', () => {
  it('a moment after the hit, for a second or two, on a body that feels', () => {
    const { manager, spawn } = world();
    const e = spawn('gunner');
    const d = round('rivet');
    manager.applyDamage(e, d);
    expect(anim(e).flinch).toHaveBeenCalledTimes(1);
    expect(anim(e).holdWound).toHaveBeenCalledTimes(1);
    const [bone, point, seconds, delay] = anim(e).holdWound.mock.calls[0]!;
    expect(bone).toBe(B.chest);
    expect(point).toBe(d.point);
    expect(delay).toBe(CLUTCH.delay);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(CLUTCH.most);
  });

  it('not again with every round of a burst, and again once the gap is over', () => {
    const { manager, spawn, at } = world();
    const e = spawn('brute');
    e.plates = [];
    for (let i = 0; i < 6; i++) {
      at(i * WEAPONS.smg.interval);
      // Kept to flinches: a stagger holds the wound by its own rule.
      e.shock = 0;
      manager.applyDamage(e, round('smg'));
    }
    expect(anim(e).flinch.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(anim(e).holdWound).toHaveBeenCalledTimes(1);
    at(CLUTCH.gap + 0.01);
    e.shock = 0;
    manager.applyDamage(e, round('smg'));
    expect(anim(e).holdWound).toHaveBeenCalledTimes(2);
  });

  it('arms up for a head hit it stands through, and nothing for a scratch, a plate or a body that feels nothing', () => {
    const { manager, spawn } = world();
    const glance = spawn('gunner');
    manager.applyDamage(glance, round('rivet', 'head', { amount: 4, force: 5, headshotMult: 2 }));
    expect(anim(glance).guard).toHaveBeenCalledTimes(1);
    expect(anim(glance).holdWound).not.toHaveBeenCalled();

    const scratch = spawn('brute');
    scratch.plates = [];
    manager.applyDamage(scratch, round('rivet', 'chest', { amount: 5 }));
    expect(anim(scratch).holdWound).not.toHaveBeenCalled();

    const plated = spawn('brute');
    manager.applyDamage(plated, round('smg'));
    expect(anim(plated).flinch).toHaveBeenCalledTimes(1);
    expect(anim(plated).holdWound).not.toHaveBeenCalled();

    const husk = spawn('husk');
    manager.applyDamage(husk, round('rivet', 'chest', { amount: 10 }));
    expect(anim(husk).flinch).toHaveBeenCalledTimes(1);
    expect(anim(husk).holdWound).not.toHaveBeenCalled();
  });

  it('on a co-op guest too, from its own copy of the hit', () => {
    const { manager, spawn } = world();
    const e = spawn('gunner');
    manager.predictDamage(e, round('rivet'));
    expect(anim(e).holdWound).toHaveBeenCalledTimes(1);
  });

  it('is off with the switch', () => {
    DevFlags.clutch = false;
    const { manager, spawn } = world();
    const e = spawn('gunner');
    manager.applyDamage(e, round('rivet'));
    expect(anim(e).holdWound).not.toHaveBeenCalled();
    expect(anim(e).setHurt).toHaveBeenLastCalledWith(0, 0);
  });
});

describe('a hurt body carries itself hurt', () => {
  it('from half its health down, and fully at a quarter', () => {
    const { manager, spawn, at } = world();
    const e = spawn('gunner');
    manager.applyDamage(e, round('rivet'));
    // 60 of 90 left.
    expect(anim(e).setHurt).toHaveBeenLastCalledWith(0, 0);
    at(2);
    e.shock = 0;
    manager.applyDamage(e, round('rivet'));
    // A third left.
    const third = anim(e).setHurt.mock.calls.at(-1)![0] as number;
    expect(third).toBeGreaterThan(0.5);
    expect(third).toBeLessThan(0.8);
    at(4);
    e.shock = 0;
    manager.applyDamage(e, round('rivet', 'chest', { amount: 10 }));
    expect(anim(e).setHurt.mock.calls.at(-1)![0]).toBe(1);
  });

  it('not a zombie, which feels nothing, though its leg still limps', () => {
    const { manager, spawn } = world();
    const e = spawn('husk');
    e.limbHp.set('legR', 1);
    manager.applyDamage(e, round('rivet', 'chest', { amount: 40 }));
    const [hurt, limp] = anim(e).setHurt.mock.calls.at(-1)! as [number, number];
    expect(hurt).toBe(0);
    expect(limp).toBeLessThan(-0.5);
  });

  it('limps on the leg its wounds have weakened, by how much', () => {
    const { manager, spawn, at } = world();
    const e = spawn('brute');
    e.plates = [];
    manager.applyDamage(e, round('rivet', 'legL', { amount: 4 }));
    expect(anim(e).setHurt).toHaveBeenLastCalledWith(0, 0);
    // Most of the left leg's pool gone: it limps on the left, which is +.
    const whole = e.limbHp.get('legL')!;
    e.limbHp.set('legL', whole * 0.2);
    at(3);
    e.shock = 0;
    manager.applyDamage(e, round('rivet', 'chest', { amount: 4 }));
    const limp = anim(e).setHurt.mock.calls.at(-1)![1] as number;
    expect(limp).toBeGreaterThan(0.4);
  });
});
