/**
 * A hit spoils his aim (the gore update's R3b), through the real damage model and the real aim function: who is shaken and
 * by how much, how long it lasts, what it does to a shot and to a wind-up, and that only the deciding machine does it.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import { WEAPONS } from '../weapons/data';
import { aimAtPlayer } from './attacks';
import { EnemyManager } from './EnemyManager';
import type { Enemy } from './Enemy';
import { shakenBy, SPOIL, spoiled } from './reactions';

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), setHurt: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
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
  const spawn = (id: EnemyId): Enemy => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, -10))!;
    e.dist = 10;
    e.inView = true;
    return e;
  };
  return { manager, spawn, ctx };
}

const round = (source: keyof typeof WEAPONS, region: DamageInfo['region'] = 'chest', extra: Partial<DamageInfo> = {}): DamageInfo => {
  const def = WEAPONS[source];
  return { amount: def.damage, type: def.pellets > 1 ? 'pellet' : 'bullet', point: new THREE.Vector3(0.1, 1.2, -9.8), dir: new THREE.Vector3(0, 0, -1),
    force: def.force, source, region, bone: region === 'armR' ? B.upperArmR : B.chest, ...extra };
};

afterEach(() => {
  vi.restoreAllMocks();
  DevFlags.aimspoil = true;
});

describe('a hit spoils his aim', () => {
  it('a round in the gun arm shakes him fully, one in the chest by how hard it was', () => {
    const { manager, spawn } = world();
    const arm = spawn('gunner');
    manager.applyDamage(arm, round('rivet', 'armR'));
    expect(arm.shaken).toBe(1);

    const chest = spawn('gunner');
    manager.applyDamage(chest, round('smg'));
    expect(chest.shaken).toBeGreaterThan(0.3);
    expect(chest.shaken).toBeLessThan(0.8);

    // A Brute shrugs off most of an SMG round, and a plate that stops it halves what is left.
    const brute = spawn('brute');
    manager.applyDamage(brute, round('smg'));
    expect(brute.shaken).toBeGreaterThan(0.05);
    expect(brute.shaken).toBeLessThan(0.2);
    const bare = spawn('brute');
    bare.plates = [];
    manager.applyDamage(bare, round('smg'));
    expect(bare.shaken).toBeGreaterThan(brute.shaken * 1.5);
    // The rule itself.
    expect(shakenBy(true, 0.5, 0, true)).toBe(1);
    expect(shakenBy(false, SPOIL.from, 0, false)).toBe(0);
    expect(shakenBy(false, SPOIL.from + 0.2, 0.1, false)).toBeCloseTo(0.2 * SPOIL.perSize + 0.1 * SPOIL.perShare, 6);
  });

  it('not a zombie, a machine or a boss, and not fire', () => {
    const { manager, spawn } = world();
    for (const id of ['husk', 'leaper', 'drone', 'juggernaut'] as const) {
      const e = spawn(id);
      e.plates = [];
      manager.applyDamage(e, round('rivet', 'armR', { amount: 5 }));
      expect(e.shaken, id).toBe(0);
    }
    const burning = spawn('gunner');
    manager.applyDamage(burning, round('rivet', 'armR', { type: 'fire', amount: 5 }));
    expect(burning.shaken).toBe(0);
  });

  it("is the deciding machine's alone: a co-op guest drawing its own hit shakes nothing", () => {
    const { manager, spawn } = world();
    const e = spawn('gunner');
    manager.predictDamage(e, round('rivet', 'armR'));
    expect(e.shaken).toBe(0);
  });

  it('puts back a wind-up he was in, by a fifth of a second at most however many rounds land', () => {
    const { manager, spawn } = world();
    const e = spawn('gunner');
    e.attackPhase = 'windup';
    e.attackWindup = 0.3;
    manager.applyDamage(e, round('rivet', 'chest', { amount: 4 }));
    expect(e.attackWindup).toBeGreaterThan(0.3);
    expect(e.attackWindup).toBeLessThan(0.3 + SPOIL.late);
    manager.applyDamage(e, round('rivet', 'armR', { amount: 4 }));
    manager.applyDamage(e, round('rivet', 'armR', { amount: 4 }));
    expect(e.attackWindup).toBeCloseTo(0.3 + SPOIL.late, 6);
    // Not an attack that is already firing.
    const firing = spawn('gunner');
    firing.attackPhase = 'active';
    firing.attackWindup = 0.3;
    manager.applyDamage(firing, round('rivet', 'armR', { amount: 4 }));
    expect(firing.attackWindup).toBe(0.3);
  });

  it('makes what he fires miss wider, for a third of a second', () => {
    const { manager, spawn } = world();
    const e = spawn('gunner');
    const w = manager.aiWorld;
    const from = new THREE.Vector3(0, 1.4, -10);
    const out = new THREE.Vector3();
    const straight = new THREE.Vector3().subVectors(w.player.chest, from).normalize();
    const off = () => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += aimAtPlayer(w, from, out, 80, 0, 0.3, 2, e).angleTo(straight);
      return sum / 400;
    };
    const steady = off();
    e.shaken = 1;
    const shaken = off();
    // Three times the radius and 0.05 rad on top: at 10 m that is 0.9 m and 0.5 m where it was 0.3 m.
    expect(shaken).toBeGreaterThan(steady * 3);
    expect(shaken).toBeLessThan(steady * 6);
    expect(spoiled(e, 0.3, 10)).toBeCloseTo(0.3 * SPOIL.wide + 10 * SPOIL.angle, 6);
    e.shaken = 0;
    expect(spoiled(e, 0.3, 10)).toBe(0.3);
    // Nobody is shaken for longer than `SPOIL.seconds`.
    expect(SPOIL.seconds).toBeLessThanOrEqual(0.4);
  });

  it('steadies within a third of a second', () => {
    const { manager, spawn, ctx } = world();
    const e = spawn('gunner');
    manager.applyDamage(e, round('rivet', 'armR', { amount: 4 }));
    expect(e.shaken).toBe(1);
    let frames = 0;
    while (e.shaken > 0 && frames < 120) {
      ctx.time.tick(1 / 60);
      manager.update();
      frames++;
    }
    expect(frames).toBeGreaterThan(15);
    expect(frames).toBeLessThanOrEqual(Math.ceil(SPOIL.seconds * 60) + 1);
  });

  it('is off with the switch', () => {
    DevFlags.aimspoil = false;
    const { manager, spawn } = world();
    const e = spawn('gunner');
    e.attackPhase = 'windup';
    e.attackWindup = 0.3;
    manager.applyDamage(e, round('rivet', 'armR'));
    expect(e.shaken).toBe(0);
    expect(e.attackWindup).toBe(0.3);
  });
});
