/** The rule that picks a reaction, at the numbers the weapon table really uses. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, type GoreRegion } from '../characters/rig';
import { DEFAULT_FORCE, type CharacterInstance, type DamageInfo, type DamageType } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { ENEMIES, LIMB_SIZE } from './data';
import { Enemy } from './Enemy';
import { deathVelocity } from './damage';
import { MuscleTuning } from '../gore/muscles';
import { chooseReaction, HEAD_KNOCK_FORCE, profileOf, type Reaction } from './reactions';

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
  for (let i = 0; i < n; i++) r = chooseReaction(e, { ...hit(type), amount }, profile, region, amount, force, 0);
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

  it('a head hit from a real gun that does not kill puts it on the floor, and a light one rattles it', () => {
    // The owner's rule. One SMG round to a Trooper's head is 50 of its 59.5 head pool, so it lives, and goes over.
    const smgHead = hits(body('trooper'), 1, 'head', 50, smg);
    expect(smgHead.level).toBe('felled');
    expect(smgHead.strength).toBeGreaterThanOrEqual(0.5);
    expect(smgHead.knockout).toBe(false);
    expect(DEFAULT_FORCE.bullet).toBeGreaterThanOrEqual(HEAD_KNOCK_FORCE);
    // The Buzzsaw's 6 N·s and the Kiln's 1 only rattle it, cooldown or not.
    expect(hits(body('trooper'), 1, 'head', 26, 6).level).toBe('stagger');
    expect(hits(body('brute'), 1, 'head', 10, 5).level).toBe('stagger');
    const cooling = body('trooper');
    cooling.reactAt = 1;
    expect(hits(cooling, 1, 'head', 50, smg).level).toBe('felled');
  });

  it('a shotgun or a heavy round to the head that it lives through knocks it cold, cooldown or not', () => {
    for (const r of [
      hits(body('brute'), 1, 'head', 20, 18, 'pellet'),
      hits(body('husk'), 1, 'head', 20, 18, 'pellet'),
      hits(body('trooper'), 1, 'head', 120, 40),
    ]) {
      expect(r.level).toBe('felled');
      expect(r.knockout).toBe(true);
      expect(r.strength).toBeGreaterThanOrEqual(0.7);
    }
    const e = body('brute');
    e.reactAt = 1;
    expect(hits(e, 1, 'head', 20, 18, 'pellet').level).toBe('felled');
  });

  it('a light round to the head keeps the stun, and a shotgun to the chest is not a knockdown', () => {
    expect(hits(body('brute'), 1, 'head', 26, 6).level).toBe('stagger');
    expect(hits(body('brute'), 1, 'chest', 20, 18, 'pellet').level).not.toBe('felled');
    expect(hits(body('trooper'), 1, 'chest', 25, smg).level).not.toBe('felled');
  });

  it('a heavy hit to the head floors a body on its way up too, but nothing floors a body with no legs', () => {
    const rising = body('trooper');
    rising.rising = 1;
    expect(hits(rising, 1, 'head', 20, 18, 'pellet').level).toBe('felled');
    const legless = body('trooper');
    legless.maim.legs = 0;
    expect(hits(legless, 1, 'head', 20, 18, 'pellet').level).toBe('flinch');
    expect(hits(legless, 1, 'head', 50, smg).level).toBe('flinch');
  });

  it('a body on its way up is put back down by a hard hit, and one SMG round only rocks it', () => {
    // Getting up (`e.rising`), one SMG round in the chest flinches it. A shotgun at 8 m, four of its six pellets in the chest
    // (2.1 of shock against a Trooper's `fall` of 1.7), fells it at strength 0.4 or more, so it drops from the clip's pose.
    // Nothing floors a body with no legs.
    const smgChest = body('trooper');
    smgChest.rising = 1;
    expect(hits(smgChest, 1, 'chest', 25, smg).level).toBe('flinch');
    const shell = body('trooper');
    shell.rising = 1;
    const r = hits(shell, 4, 'chest', 20, 18, 'pellet');
    expect(r.level).toBe('felled');
    expect(r.strength).toBeGreaterThanOrEqual(0.4);
    expect(r.knockout).toBe(false);
    const legless = body('trooper');
    legless.rising = 1;
    legless.maim.legs = 0;
    expect(hits(legless, 6, 'chest', 20, 18, 'pellet').level).toBe('flinch');
    expect(hits(legless, 1, 'head', 20, 18, 'pellet').level).toBe('flinch');
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

describe('momentum at death', () => {
  it('keeps the reel and the knockback a body was in, and how fast it was falling', () => {
    const e = body('trooper');
    e.velocity.set(0, 0, 2);
    e.reel.set(0.3, 0, 0);
    e.push.set(0.2, 0, 0);
    const out = deathVelocity(e, new THREE.Vector3());
    expect(out.x).toBeCloseTo(0.5, 6);
    expect(out.z).toBeCloseTo(2, 6);
    e.airborne = true;
    e.verticalSpeed = -8;
    // In the air only the stride moves a body.
    expect(deathVelocity(e, new THREE.Vector3()).toArray()).toEqual([0, -8, 2]);
  });

  it('keeps no more than a modest share of a hard stagger', () => {
    // The living shed a stagger within a second, and a corpse slides on with all it is given: kept whole, an SMG kill at
    // 8 m mid-stagger landed twice as far. Enough is kept to stumble on the way it was going.
    const e = body('trooper');
    e.reel.set(3.6, 0, 0);
    e.push.set(2.3, 0, 0);
    const out = deathVelocity(e, new THREE.Vector3());
    expect(out.x).toBeGreaterThan(MuscleTuning.stumbleOnward);
    expect(out.x).toBeLessThanOrEqual(1);
    expect(out.z).toBe(0);
  });

  it('does not keep what the rounds of this frame added, which the body has not stepped with', () => {
    const e = body('trooper');
    e.reel.set(0.3, 0, 0);
    e.push.set(9.5, 0, 0);
    e.unmoved.set(9.5, 0, 0);
    e.unmovedAt = 5;
    expect(deathVelocity(e, new THREE.Vector3(), 5).x).toBeCloseTo(0.3, 6);
    // A frame later it has moved with all of it.
    expect(deathVelocity(e, new THREE.Vector3(), 5.016).x).toBeGreaterThan(MuscleTuning.stumbleOnward);
    // Cleared on the same frame, by a knockdown: nothing, and not a step back toward the gun.
    e.reel.set(0, 0, 0);
    e.push.set(0, 0, 0);
    expect(deathVelocity(e, new THREE.Vector3(), 5).x).toBe(0);
  });
});
