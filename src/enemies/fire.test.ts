/**
 * Fire and the enemies (the gore update, F1 and F3): char rises with fire damage taken, a death by fire is charred however
 * fast it was, and the corpse is handed to gore still burning. The real EnemyManager and DamageModel, with gore counted
 * instead of drawn.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import type { GoreRegion } from '../characters/rig';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import { EnemyManager } from './EnemyManager';

type Burnt = CharacterInstance & { burn: number };

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
  const char = { archetype: id, rig, root, bones, severed: new Set(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod: vi.fn(), setFrost: vi.fn(),
    burn: 0, setBurn(amount: number) { char.burn = amount; }, setEmber: vi.fn() };
  return char as unknown as CharacterInstance;
}

/** A world with one real enemy manager in it, and a gore that writes down the order it was called in. */
function world() {
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const calls: string[] = [];
  const note = (name: string) => vi.fn(() => { calls.push(name); });
  const gore = {
    wound: vi.fn(() => false), headPellets: vi.fn(() => 1),
    sever: vi.fn((char: CharacterInstance, region: GoreRegion) => { (char.severed as Set<GoreRegion>).add(region); return { regions: [region], stump: new THREE.Vector3() }; }),
    knockdown: vi.fn(() => true), downed: vi.fn(() => null), handedBack: vi.fn(() => null), rouse: vi.fn(),
    ragdoll: note('ragdoll'), collapse: note('collapse'), headshot: note('headshot'), gib: note('gib'), slice: note('slice'), blowOut: vi.fn(),
    vaporize: note('vaporize'), owns: () => false, alight: note('alight'), burnOn: note('burnOn'),
  };
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'], player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: () => {}, playOneOf: () => {}, startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const manager = new EnemyManager(ctx);
  const spawn = (id: EnemyId, z = -6) => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, z))!;
    e.dist = Math.abs(z);
    e.inView = true;
    return e;
  };
  return { ctx, manager, gore, calls, spawn };
}

/** One bite of the Kiln's stream: 9, as weapons/Flames deals it. */
const bite = (amount = 9): DamageInfo => ({ amount, type: 'fire', point: new THREE.Vector3(0, 1.2, -5.8), dir: new THREE.Vector3(0, 0, -1), force: 1, source: 'kiln', region: 'chest', bone: B.chest });
const round = (amount: number): DamageInfo => ({ amount, type: 'bullet', point: new THREE.Vector3(0, 1.2, -5.8), dir: new THREE.Vector3(0, 0, -1), force: 5, source: 'smg', region: 'chest', bone: B.chest });

afterEach(() => { DevFlags.fire = true; });

describe('fire chars by the damage it does', () => {
  it('each bite blackens the skin by its share of the body, with no time passing', () => {
    const { manager, spawn } = world();
    const e = spawn('husk');
    const char = e.char as Burnt;
    manager.applyDamage(e, bite());
    const one = char.burn;
    expect(one).toBeCloseTo((9 / e.maxHealth) * 0.7, 5);
    manager.applyDamage(e, bite());
    expect(char.burn).toBeCloseTo(one * 2, 5);
    expect(e.charred).toBe(char.burn);
  });

  it('a man the flamethrower kills in a quarter of a second is charred, and his corpse is handed over still burning', () => {
    const { manager, gore, calls, spawn } = world();
    const e = spawn('husk');
    const char = e.char as Burnt;
    let bites = 0;
    while (e.alive && bites < 40) {
      manager.applyDamage(e, bite());
      bites++;
    }
    expect(e.alive).toBe(false);
    // 30 bites a second: dead well inside half a second.
    expect(bites).toBeLessThan(15);
    expect(char.burn).toBeGreaterThanOrEqual(0.85);
    expect(char.burn).toBeLessThan(1);
    expect(gore.burnOn).toHaveBeenCalledTimes(1);
    // Before the death is picked, so what that death throws off burns too.
    expect(calls[0]).toBe('burnOn');
    expect(calls.length).toBeGreaterThan(1);
  });

  it('a burning man killed by a bullet burns on, with the char he had', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('husk');
    manager.afflict(e, 'burn', 4);
    manager.applyDamage(e, round(9999));
    expect(e.alive).toBe(false);
    expect(gore.burnOn).toHaveBeenCalledTimes(1);
    expect((e.char as Burnt).burn).toBeLessThan(0.85);
  });

  it('a man who was never on fire does not', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('husk');
    manager.applyDamage(e, round(9999));
    expect(e.alive).toBe(false);
    expect(gore.burnOn).not.toHaveBeenCalled();
    expect((e.char as Burnt).burn).toBe(0);
  });

  it('what is built to burn does not char, but its corpse still burns', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('burner');
    manager.afflict(e, 'burn', 4);
    manager.applyDamage(e, bite());
    expect((e.char as Burnt).burn).toBe(0);
    manager.applyDamage(e, round(99999));
    expect(gore.burnOn).toHaveBeenCalledWith(e.char, true);
  });

  it('a guest shown a fire hit chars its copy the same, and takes no health', () => {
    const { manager, spawn } = world();
    const e = spawn('husk');
    manager.predictDamage(e, bite());
    expect((e.char as Burnt).burn).toBeCloseTo((9 / e.maxHealth) * 0.7, 5);
    expect(e.health).toBe(e.maxHealth);
  });

  it('with the switch off fire is as it was: no char from damage, nothing handed on', () => {
    DevFlags.fire = false;
    const { manager, gore, spawn } = world();
    const e = spawn('husk');
    manager.applyDamage(e, bite());
    expect((e.char as Burnt).burn).toBe(0);
    while (e.alive) manager.applyDamage(e, bite());
    expect(gore.burnOn).not.toHaveBeenCalled();
  });
});
