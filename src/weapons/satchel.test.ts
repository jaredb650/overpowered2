/**
 * Demolition Satchel Charges (Slot 3): throw-and-stick canvas demolition packs with remote RMB clacker detonation,
 * massive structural blast damage (`source: 'satchel'`, radius 10.5 m, damage 420), and pack + clacker viewmodel.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExplosionSpec, ProjectileSpec } from '../core/gameplay';
import { WEAPONS as UI_WEAPONS } from '../ui/data';
import { weaponIcon } from '../ui/icons';
import { TUNING, WEAPONS } from './data';
import { familyOfSlot } from './families';
import { makeRange, type Range } from './testkit';
import { Anim } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { satchelDef } from './viewmodels/models/satchel';
import { restingModel } from './viewmodels/rest';

function makeKit(): Kit {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material,
    glass: material,
    decal: material,
    decalRegions: {
      optic4x: [0, 0, 1, 1],
      crucible: [0, 0, 1, 1],
      serial: [0, 0, 1, 1],
      hazard: [0, 0, 1, 1],
    },
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  return new Kit(mats);
}

describe('Satchel Charges (Slot 3 demolition weapon)', () => {
  let r: Range;
  let spawned: ProjectileSpec[];
  let explodedSpecs: ExplosionSpec[];
  let worldBlasts: { center: THREE.Vector3; radius: number; damage: number; source: string }[];
  let muzzleFlashes: number;

  beforeEach(async () => {
    r = await makeRange();
    spawned = [];
    explodedSpecs = [];
    worldBlasts = [];
    muzzleFlashes = 0;

    r.ctx.world = {
      objects: {
        damageExplosivesInRadius(center: THREE.Vector3, radius: number, amount: number, source: string) {
          worldBlasts.push({ center: center.clone(), radius, damage: amount, source });
        },
        damageExplosive() { return false; },
      },
    } as unknown as typeof r.ctx.world;

    const origFx = r.ctx.fx;
    r.ctx.fx = new Proxy(origFx, {
      get: (t, k) => k === 'muzzleFlash' ? () => { muzzleFlashes++; } : Reflect.get(t, k),
    });

    const origSpawn = r.combat.spawnProjectile.bind(r.combat);
    r.combat.spawnProjectile = (spec: ProjectileSpec) => {
      spawned.push({
        ...spec,
        origin: spec.origin.clone(),
        velocity: spec.velocity.clone(),
        explosion: spec.explosion ? { ...spec.explosion } : undefined,
      });
      origSpawn(spec);
    };

    const origExplode = r.combat.explode.bind(r.combat);
    r.combat.explode = (position: THREE.Vector3, spec: ExplosionSpec) => {
      explodedSpecs.push({ ...spec });
      origExplode(position, spec);
    };

    r.weapons.give('satchel');
    r.weapons.switchTo('satchel');
    r.run(0.6);
    r.record.sounds.length = 0;
    r.record.blasts.length = 0;
    r.record.explosions = 0;
    spawned.length = 0;
    explodedSpecs.length = 0;
    worldBlasts.length = 0;
    muzzleFlashes = 0;
  });

  it('lives on Slot 3 as SATCHEL CHARGE with heavy lobbed sticky ballistics and UI icon/metadata', () => {
    expect(familyOfSlot(3)).toContain('satchel');
    expect(WEAPONS.satchel.name).toBe('SATCHEL CHARGE');
    expect(WEAPONS.satchel.slot).toBe(3);
    expect(WEAPONS.satchel.base).toBe('rocket');
    expect(WEAPONS.satchel.mode).toBe('semi');
    expect(WEAPONS.satchel.round).toBe('grenade');
    expect(WEAPONS.satchel.magSize).toBe(4);
    expect(WEAPONS.satchel.reserve).toBe(12);
    expect(WEAPONS.satchel.grenade).toEqual({ speed: 19, gravity: 22, life: 14, radius: 10.5, blast: 420 });
    expect(UI_WEAPONS.satchel.name).toBe('Satchel Charge');
    expect(weaponIcon('satchel')).toContain('<svg');

    // Works cleanly with campaign loadouts and weapon racks (`give`).
    r.weapons.setLoadout(['smg', 'satchel'], 2);
    expect(r.weapons.owned.has('satchel')).toBe(true);
    r.weapons.switchTo('satchel');
    r.run(0.4);
    expect(r.weapons.ammoMode).toBe('TOSS');
  });

  it('tosses always-sticky satchel charges without muzzle flash, sticks with thud + warning beep, counts planted charges, and detonates all on RMB with source satchel', () => {
    r.wall(-7, 1);

    // Toss first satchel charge onto the wall.
    r.tap('fire');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.sticky).toBe(true);
    expect(spawned[0]!.source).toBe('satchel');
    expect(spawned[0]!.gravity).toBe(22);
    expect(spawned[0]!.explosion?.radius).toBe(10.5);
    expect(spawned[0]!.explosion?.damage).toBe(420);
    expect(spawned[0]!.explosion?.kind).toBe('barrel');
    expect(muzzleFlashes).toBe(0);
    expect(r.record.sounds).toContain('grenade_throw');
    expect(r.weapons.ammo('satchel').mag).toBe(3);

    // Wait for it to fly and stick to the wall.
    r.run(0.6);
    expect(r.record.explosions).toBe(0);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    expect(r.weapons.ammoMode).toBe('RMB DETONATE · 1');
    expect(r.record.sounds).toContain('body_thud');
    expect(r.record.sounds).toContain('mgl_stick');
    expect(r.record.sounds).toContain('stake_beep');

    // Toss a second satchel after cooldown.
    r.run(0.45);
    r.tap('fire');
    r.run(0.6);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(2);
    expect(r.weapons.ammoMode).toBe('RMB DETONATE · 2');
    expect(r.record.explosions).toBe(0);

    // Periodic soft warning beep triggers while satchels sit armed.
    const beepsBefore = r.record.sounds.filter(s => s === 'stake_beep').length;
    r.run(TUNING.satchel.beepInterval + 0.1);
    const beepsAfter = r.record.sounds.filter(s => s === 'stake_beep').length;
    expect(beepsAfter).toBeGreaterThan(beepsBefore);

    // Remote RMB clacker detonates all planted satchels with source: 'satchel', radius: 10.5, damage: 420.
    r.record.sounds.length = 0;
    r.record.blasts.length = 0;
    r.record.explosions = 0;
    explodedSpecs.length = 0;
    worldBlasts.length = 0;

    r.tap('aim');
    r.run(0.1);

    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.weapons.ammoMode).toBe('TOSS');
    expect(r.record.sounds).toContain('mgl_detonate');
    expect(r.record.explosions).toBe(2);
    expect(explodedSpecs).toHaveLength(2);
    for (const spec of explodedSpecs) {
      expect(spec.source).toBe('satchel');
      expect(spec.radius).toBe(10.5);
      expect(spec.damage).toBe(420);
      expect(spec.kind).toBe('barrel');
    }
    // Demolition blast reaches world.objects.damageExplosivesInRadius with source: 'satchel'!
    expect(worldBlasts).toHaveLength(2);
    for (const wb of worldBlasts) {
      expect(wb.source).toBe('satchel');
      expect(wb.radius).toBe(10.5);
      expect(wb.damage).toBe(420);
    }
  });

  it('keeps planted satchels armed across weapon switches, detonates on death/part, and clears silently on reset', () => {
    r.wall(-7, 1);

    // Plant one satchel, switch away to SMG and back — satchel stays armed until RMB clacker!
    r.tap('fire');
    r.run(0.6);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);

    r.weapons.switchTo('smg');
    r.run(0.3);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    expect(r.record.explosions).toBe(0);

    r.weapons.switchTo('satchel');
    r.run(0.4);
    expect(r.weapons.ammoMode).toBe('RMB DETONATE · 1');
    r.tap('aim');
    r.run(0.05);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // player:died auto-detonates planted satchels.
    r.run(0.5);
    r.tap('fire');
    r.run(0.6);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    r.record.explosions = 0;
    r.ctx.events.emit('player:died', { source: 'test' });
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // part('satchel') auto-detonates planted satchels.
    r.run(0.5);
    r.tap('fire');
    r.run(0.6);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    r.record.explosions = 0;
    r.weapons.part('satchel');
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // reset() clears planted satchels silently with zero explosions.
    r.weapons.give('satchel');
    r.weapons.switchTo('satchel');
    r.run(0.5);
    r.tap('fire');
    r.run(0.6);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    r.record.explosions = 0;
    r.weapons.reset();
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.record.explosions).toBe(0);
  });

  it('keeps the clacker in hand after tossing the final satchel so RMB can still detonate it', () => {
    r.wall(-7, 1);
    const ammo = r.weapons.ammo('satchel');
    ammo.mag = 1;
    ammo.reserve = 0;

    r.tap('fire');
    r.run(0.7);
    expect(r.weapons.current).toBe('satchel');
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    expect(r.weapons.ammoMode).toBe('RMB DETONATE · 1');

    r.tap('aim');
    r.run(0.05);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(0);
    expect(r.record.explosions).toBe(1);
  });

  it('sticks to a live enemy, tracks movement, detaches on death, and detonates at their last position', () => {
    const enemy = r.enemies.add(0, -6, 500);

    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);
    expect(r.record.explosions).toBe(0);

    enemy.position.set(5, 0, -9);
    r.run(0.1);
    expect(r.combat.projectiles.stickyCount('satchel')).toBe(1);

    enemy.alive = false;
    r.run(0.1);
    enemy.position.set(45, 0, -45);
    r.run(0.05);

    r.tap('aim');
    r.run(0.05);
    expect(r.record.explosions).toBe(1);
    const blastPos = r.record.blasts[0]!;
    expect(Math.hypot(blastPos.x - 5, blastPos.z - (-9))).toBeLessThan(2.5);
  });

  it('builds a demolition satchel pack + clacker viewmodel with throw, clacker squeeze, empty-pack hide, and restingModel support', () => {
    const def = satchelDef(makeKit());
    for (const part of ['pack', 'clacker', 'clackerLever']) {
      expect(def.model.parts[part]).toBeDefined();
    }
    expect(def.model.glows.packLed).toBeDefined();
    expect(def.model.glows.clackerLed).toBeDefined();

    const runClip = (opts: Partial<Anim>) => {
      const anim = new Anim();
      anim.model = def.model;
      anim.parts = def.model.parts;
      anim.mag = 4;
      anim.magSize = 4;
      Object.assign(anim, opts);
      def.model.resetParts();
      def.animate(anim);
    };

    // Idle with charges: pack visible, lever at rest.
    runClip({ sinceFire: 5, mag: 4, charge: 0 });
    expect(def.model.parts.pack!.visible).toBe(true);
    const restLeverZ = def.model.parts.clackerLever!.rotation.z;

    // Empty mag: pack hidden while clacker remains ready.
    runClip({ sinceFire: 5, mag: 0, charge: 1 });
    expect(def.model.parts.pack!.visible).toBe(false);
    expect(def.model.parts.clacker!.visible).toBe(true);

    // RMB clacker squeeze (`strength < 0.5`): clacker lever pivots sharply.
    runClip({ sinceFire: 0.08, strength: 0.35, mag: 3, charge: 1 });
    expect(Math.abs(def.model.parts.clackerLever!.rotation.z - restLeverZ)).toBeGreaterThan(0.1);

    // Resting model clone for racks/shop turntable works cleanly.
    const rest = restingModel('satchel', def);
    expect(rest.size).toBeGreaterThan(0.1);
  });
});
