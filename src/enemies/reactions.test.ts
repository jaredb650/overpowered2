/** The rule that picks a reaction, at the numbers the weapon table really uses. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, type GoreRegion } from '../characters/rig';
import { DEFAULT_FORCE, type CharacterInstance, type DamageInfo, type DamageType } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { ENEMIES, LIMB_SIZE } from './data';
import { Enemy } from './Enemy';
import { chooseReaction, profileOf, type Reaction } from './reactions';

const rig = humanoidRig('test');

function body(id: EnemyId): Enemy {
  const e = new Enemy();
  e.id = id;
  e.def = ENEMIES[id];
  e.maxHealth = e.health = e.def.hp;
  e.isBoss = e.def.boss !== undefined;
  e.char = { rig } as unknown as CharacterInstance;
  for (const key in LIMB_SIZE) e.limbHp.set(key as GoreRegion, e.maxHealth * e.def.limbFrac * LIMB_SIZE[key as GoreRegion]!);
  return e;
}

const hit = (type: DamageType): DamageInfo => ({
  amount: 0, type, point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), force: 0, source: 'test',
});

/** `n` hits on one frame, as a shotgun's pellets land. Returns the last answer, which is the one that counts. */
function hits(e: Enemy, n: number, region: GoreRegion, amount: number, force: number, type: DamageType = 'bullet'): Reaction {
  const profile = profileOf(e)!;
  let r: Reaction | null = null;
  for (let i = 0; i < n; i++) r = chooseReaction(e, hit(type), profile, region, amount, force, 0);
  return r!;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('reactions', () => {
  const smg = DEFAULT_FORCE.bullet;

  it('one SMG round is a flinch, and the second on its heels is a stagger', () => {
    const e = body('trooper');
    expect(hits(e, 1, 'chest', 25, smg).level).toBe('flinch');
    expect(hits(e, 1, 'chest', 25, smg).level).toBe('stagger');
  });

  it('an arm takes what a chest cannot', () => {
    expect(hits(body('trooper'), 2, 'armL', 19, smg).level).toBe('flinch');
  });

  it('a close shotgun takes a body off its feet, where a far one does not', () => {
    expect(hits(body('riot'), 5, 'chest', 20, 18, 'pellet').level).toBe('fall');
    expect(hits(body('riot'), 1, 'chest', 20, 18, 'pellet').level).toBe('flinch');
  });

  it('a blast throws a body that a bullet of the same weight would only stagger', () => {
    expect(hits(body('warden'), 1, 'chest', 80, 60, 'explosive').level).toBe('thrown');
  });

  it('zombie types take more to shift, and get up faster', () => {
    expect(hits(body('husk'), 2, 'chest', 10, smg).level).toBe('flinch');
    expect(hits(body('trooper'), 2, 'chest', 10, smg).level).not.toBe('flinch');
    const husk = profileOf(body('husk'))!;
    const trooper = profileOf(body('trooper'))!;
    expect(husk.rise).toBeLessThan(trooper.rise / 2);
    expect(husk.lie[1]).toBeLessThan(trooper.lie[0]);
    expect(husk.pain).toBe(0);
  });

  it('a leg shot at a run trips a body the way it was going, and standing still it only hurts', () => {
    const running = body('trooper');
    running.velocity.set(0, 0, 3.8);
    const r = hits(running, 1, 'legL', 19, smg);
    expect(r.level).toBe('fall');
    expect(r.tripped).toBe(true);
    expect(hits(body('trooper'), 1, 'legL', 19, smg).level).toBe('flinch');
  });

  it('a leg that is nearly gone gives way under a body that is only standing on it', () => {
    const e = body('trooper');
    e.limbHp.set('legL', 2);
    expect(hits(e, 1, 'legL', 19, smg).level).toBe('fall');
  });

  it('a head hit that does not kill always rattles them', () => {
    expect(hits(body('brute'), 1, 'head', 10, 5).level).toBe('stagger');
  });

  it('waits out its cooldown, so an SMG cannot hold a body in place', () => {
    const e = body('trooper');
    e.reactAt = 1;
    expect(hits(e, 4, 'chest', 25, smg).level).toBe('flinch');
    expect(e.shock).toBeGreaterThan(1);
  });

  it('a body with no legs has nothing to fall off', () => {
    const e = body('trooper');
    e.maim.legs = 0;
    expect(hits(e, 6, 'chest', 25, smg).level).toBe('flinch');
  });

  it('leaves bosses and machines to the old stagger', () => {
    expect(profileOf(body('juggernaut'))).toBeNull();
    expect(profileOf(body('titan'))).toBeNull();
    expect(profileOf(body('skitter'))).toBeNull();
    expect(profileOf(body('drone'))).toBeNull();
  });
});
