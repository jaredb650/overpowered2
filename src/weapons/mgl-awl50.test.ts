/**
 * Milkor MGL (Slot 3 revolving 40mm grenade launcher), its Sticky Bomb shop mod (`mglSticky`),
 * and the Awl `.50 Cal` conversion mod (`awl50`), including viewmodel part nesting with `awlBarrel`.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FireNote, ModId, ProjectileSpec } from '../core/gameplay';
import { lookup } from '../audio/catalog';
import { MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { CACHE_ORDER } from '../progression/data';
import { WEAPONS } from './data';
import { familyOfSlot } from './families';
import { AWL_BARREL, GREASE, MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';
import { Watcher, plainNote, type Shooter } from './watch';
import { Anim } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { awlDef } from './viewmodels/models/awl';
import { mglDef } from './viewmodels/models/mgl';
import { dressModel } from './viewmodels/rest';

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

describe('Milkor MGL & Sticky Bomb mod', () => {
  let r: Range;
  let callouts: string[];
  let spawned: ProjectileSpec[];

  beforeEach(async () => {
    r = await makeRange();
    callouts = [];
    spawned = [];
    r.ctx.hud = {
      hitMarker() {},
      feed() {},
      callout: (text: string) => callouts.push(text),
    } as unknown as typeof r.ctx.hud;
    const origSpawn = r.combat.spawnProjectile.bind(r.combat);
    r.combat.spawnProjectile = (spec: ProjectileSpec) => {
      spawned.push({ ...spec, origin: spec.origin.clone(), velocity: spec.velocity.clone() });
      origSpawn(spec);
    };
    r.weapons.give('mgl');
    r.weapons.switchTo('mgl');
    r.run(0.6);
    callouts.length = 0;
    r.record.sounds.length = 0;
    r.record.blasts.length = 0;
    r.record.explosions = 0;
    spawned.length = 0;
  });

  function holdR(seconds = 0.35): void {
    r.input.simulate('reload', true);
    r.run(seconds);
    r.input.simulate('reload', false);
    r.run(1 / 60);
  }

  function tapR(): void {
    r.input.simulate('reload', true);
    r.run(0.05);
    r.input.simulate('reload', false);
    r.run(1 / 60);
  }

  function fitSticky(): void {
    r.weapons.grantMod('mglSticky');
    expect(r.weapons.fitMod('mglSticky', true)).toBe(true);
  }

  it('lives on Slot 3 with 6-round drum, procurement entry, and fires 40mm HE grenades with mgl_shot', () => {
    expect(familyOfSlot(3)).toContain('mgl');
    expect(WEAPONS.mgl.slot).toBe(3);
    expect(WEAPONS.mgl.magSize).toBe(6);
    expect(WEAPONS.mgl.reserve).toBe(18);
    expect(WEAPONS.mgl.maxReserve).toBe(30);
    expect(WEAPON_WARES.mgl!.price).toBeGreaterThan(0);
    expect(CACHE_ORDER).toContain('mgl');
    expect(MOD_WARES.mglSticky.price).toBeGreaterThan(0);
    expect(MODS.mglSticky.slot).toBeUndefined();

    r.tap('fire');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.sticky).toBeFalsy();
    expect(spawned[0]!.explosion?.kind).toBe('grenade');
    expect(spawned[0]!.explosion?.damage).toBe(WEAPONS.mgl.grenade!.blast);
    expect(spawned[0]!.explosion?.radius).toBe(WEAPONS.mgl.grenade!.radius);
    expect(r.record.sounds).toContain('mgl_shot');
    expect(r.weapons.ammo('mgl').mag).toBe(5);
  });

  it('toggles HE / STICKY on hold R while preserving tap R reload', () => {
    fitSticky();
    expect(r.weapons.ammoMode).toBe('HE');

    holdR();
    expect(r.weapons.ammoMode).toBe('STICKY');
    expect(callouts.at(-1)).toBe('STICKY');

    // Fire one round, then tap R to reload without leaving STICKY mode.
    r.tap('fire');
    expect(r.weapons.ammo('mgl').mag).toBe(5);
    tapR();
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.ammoMode).toBe('STICKY');
    r.run(WEAPONS.mgl.reloadTime + 0.1);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('mgl').mag).toBe(6);

    // Hold R again toggles back to HE (while reporting the 1 sticky that landed on the floor).
    holdR();
    expect(r.weapons.ammoMode).toBe('HE · 1');
    expect(callouts.at(-1)).toBe('HE');
  });

  it('sticks to world surfaces, displays planted count, detonates all on RMB, and suppresses ADS zoom on detonate click', () => {
    r.wall(-12, 1);
    fitSticky();
    holdR(); // STICKY mode

    // Plant two sticky charges on the wall.
    r.tap('fire');
    r.run(0.45);
    r.tap('fire');
    r.run(0.45);

    expect(r.record.sounds.filter(s => s === 'mgl_stick').length).toBe(2);
    expect(r.record.explosions).toBe(0);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(2);
    expect(r.weapons.ammoMode).toBe('STICKY · 2');

    // Toggle back to HE: planted stickies remain tracked and shown on HUD (`HE · 2`).
    holdR();
    expect(r.weapons.ammoMode).toBe('HE · 2');

    // Right-click detonates all planted stickies AND suppresses ADS zoom on that click.
    r.record.sounds.length = 0;
    r.record.blasts.length = 0;
    r.record.explosions = 0;
    r.input.simulate('aim', true);
    r.run(0.1);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.sounds).toContain('mgl_detonate');
    expect(r.record.explosions).toBe(2);
    expect(r.weapons.aim).toBe(0);
    expect(r.weapons.ammoMode).toBe('HE');

    // Release aim, then right-click again with 0 stickies: normal ADS zoom engages.
    r.input.simulate('aim', false);
    r.run(0.05);
    r.input.simulate('aim', true);
    r.run(0.35);
    expect(r.weapons.aim).toBeGreaterThan(0.9);
  });

  it('sticks to a live enemy, tracks its movement, safely detaches on death, and detonates at its position', () => {
    const enemy = r.enemies.add(0, -10, 500);
    fitSticky();
    holdR(); // STICKY

    r.tap('fire');
    r.run(0.35);

    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    expect(r.record.sounds).toContain('mgl_stick');
    expect(r.record.explosions).toBe(0);

    // Move the living enemy sideways; the sticky must ride along with it.
    enemy.position.set(6, 0, -14);
    r.run(0.1);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);

    // Kill the enemy: sticky detaches cleanly at its last position and stays valid.
    enemy.alive = false;
    r.run(0.1);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);

    // Now move the dead body away; detached sticky remains where the enemy died.
    enemy.position.set(40, 0, -40);
    r.run(0.05);

    // Detonate via RMB: blast lands near (6, *, -14), not at (40, *, -40).
    r.tap('aim');
    r.run(0.05);
    expect(r.record.explosions).toBe(1);
    const blastPos = r.record.blasts[0]!;
    expect(Math.hypot(blastPos.x - 6, blastPos.z - (-14))).toBeLessThan(2.5);
  });

  it('auto-detonates planted stickies on switch, drop/sell, holster, and player death, but clears silently on reset', () => {
    r.wall(-12, 1);
    fitSticky();
    holdR();

    // 1. Weapon switch away from mgl auto-detonates.
    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    r.record.explosions = 0;
    r.weapons.switchTo('smg');
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // 2. Holstering while holding mgl auto-detonates.
    r.weapons.switchTo('mgl');
    r.run(0.5);
    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    r.record.explosions = 0;
    r.weapons.setHolstered(true);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.explosions).toBe(1);
    r.weapons.setHolstered(false);
    r.run(0.5);

    // 3. player:died auto-detonates.
    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    r.record.explosions = 0;
    r.ctx.events.emit('player:died', { source: 'test' });
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // 4. part('mgl') (drop/sell) auto-detonates.
    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    r.record.explosions = 0;
    r.weapons.part('mgl');
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.explosions).toBe(1);

    // 5. reset() clears stickies silently with zero explosions.
    r.weapons.give('mgl');
    r.weapons.switchTo('mgl');
    fitSticky();
    r.run(0.5);
    holdR();
    r.tap('fire');
    r.run(0.45);
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(1);
    r.record.explosions = 0;
    r.weapons.reset();
    expect(r.combat.projectiles.stickyCount('mgl')).toBe(0);
    expect(r.record.explosions).toBe(0);
  });

  it('has a revolving 6-chamber MGL viewmodel with swing-open reload and stickyPod mod part', () => {
    const def = mglDef(makeKit());
    for (const part of ['drum', 'yoke', 'trigger', 'stickyPod']) {
      expect(def.model.parts[part]).toBeDefined();
    }
    expect(def.mods!.mglSticky!.part).toBe('stickyPod');

    // Dress without sticky mod: stickyPod hidden.
    dressModel(def.model.root, def, new Set());
    expect(def.model.parts.stickyPod!.visible).toBe(false);
    // Dress with sticky mod: stickyPod visible.
    dressModel(def.model.root, def, new Set<ModId>(['mglSticky']));
    expect(def.model.parts.stickyPod!.visible).toBe(true);

    // Drum rotates 60 degrees (PI / 3) per shot as shots increments from 0 to 1.
    const step = (shots: number, reload = -1) => {
      const anim = new Anim();
      anim.model = def.model;
      anim.parts = def.model.parts;
      anim.sinceFire = 0.25;
      anim.shots = shots;
      anim.mag = Math.max(0, 6 - shots);
      anim.magSize = 6;
      anim.reload = reload;
      def.model.resetParts();
      def.animate(anim);
    };
    step(0);
    const rot0 = def.model.parts.drum!.rotation.z;
    step(1);
    const rot1 = def.model.parts.drum!.rotation.z;
    expect(Math.abs(rot1 - rot0)).toBeCloseTo(Math.PI / 3, 2);

    // Yoke swings open during reload.
    step(6, 0.5);
    expect(Math.abs(def.model.parts.yoke!.rotation.z)).toBeGreaterThan(0.5);
  });
});

describe('Awl .50 Cal conversion mod (awl50)', () => {
  let r: Range;

  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    r.weapons.give('awl');
    r.weapons.switchTo('awl');
    r.run(0.5);
    r.record.sounds.length = 0;
  });

  function fit(id: ModId, on = true): void {
    r.weapons.grantMod(id);
    r.weapons.fitMod(id, on);
  }

  it('is listed in Procurement, has no slot conflict, and stacks with awlBarrel, awlCan, awlBolt, and ammo mods', () => {
    expect(MOD_WARES.awl50.price).toBeGreaterThan(0);
    expect(MOD_WARES.awl50.lore.length).toBeGreaterThan(40);
    expect(MOD_ORDER).toContain('awl50');
    expect(MODS.awl50.slot).toBeUndefined();

    // Base .50 Cal stats: +75% damage (180 -> 315), 4-round mag, cannon casing, heavy armour piercing, 1.15x cycle.
    const cal50 = moddedDef('awl', new Set<ModId>(['awl50']));
    expect(cal50.damage).toBe(315);
    expect(cal50.magSize).toBe(4);
    expect(cal50.casing).toBe('cannon');
    expect(cal50.armour).toBe('heavy');
    expect(cal50.armorPiercing).toBe(true);
    expect(cal50.penetration).toBeCloseTo(WEAPONS.awl.penetration + 0.8, 3);
    expect(cal50.cycleTime).toBeCloseTo(WEAPONS.awl.cycleTime! * 1.15, 2);
    expect(cal50.sounds[0]!.id).toBe('awl50_shot');

    // Stacks with awlBarrel (Extended barrel): both remain fitted and penetration combines.
    fit('awl50');
    fit('awlBarrel');
    expect(r.weapons.fitted.has('awl50')).toBe(true);
    expect(r.weapons.fitted.has('awlBarrel')).toBe(true);
    const stacked = moddedDef('awl', r.weapons.fitted);
    expect(stacked.damage).toBe(315);
    expect(stacked.tracer).toBe('scoutLong');
    expect(stacked.penetration).toBeCloseTo(WEAPONS.awl.penetration + 0.8 + AWL_BARREL.penetration, 3);

    // Fires awl50_shot when unsuppressed; awlCan + awl50 switches to awl50_suppressed_shot.
    r.record.sounds.length = 0;
    r.tap('fire');
    expect(r.record.sounds).toContain('awl50_shot');

    r.run(1.5);
    fit('awlCan');
    expect(r.weapons.fitted.has('awl50')).toBe(true);
    expect(r.weapons.fitted.has('awlBarrel')).toBe(true);
    expect(r.weapons.fitted.has('awlCan')).toBe(true);
    r.record.sounds.length = 0;
    r.tap('fire');
    expect(r.record.sounds).toContain('awl50_suppressed_shot');
    expect(r.record.sounds).not.toContain('awl50_shot');
    expect(r.record.sounds).not.toContain('awl_suppressed_shot');

    // Removing awl50 while keeping awlCan restores the standard suppressed scout shot.
    const plainCan = moddedDef('awl', new Set<ModId>(['awlCan']));
    expect(plainCan.sounds[0]!.id).toBe('awl_suppressed_shot');

    // Stacks with awlBolt (GREASE * 1.15) and awlHp (HP disables penetration/AP while keeping damage boost).
    const greased50 = moddedDef('awl', new Set<ModId>(['awl50', 'awlBolt']));
    expect(greased50.cycleTime).toBeCloseTo(WEAPONS.awl.cycleTime! * GREASE * 1.15, 2);
    const hp50 = moddedDef('awl', new Set<ModId>(['awl50', 'awlHp']));
    expect(hp50.penetration).toBe(0);
    expect(hp50.armorPiercing).toBeUndefined();
    expect(hp50.damage).toBeGreaterThan(315);
  });

  it('switches chunky .50 Cal viewmodel parts cleanly for both standard and extended barrels', () => {
    const def = awlDef(makeKit());
    for (const part of ['cal50Kit', 'cal50BrakeStd', 'cal50Long', 'cal50Bolt', 'cal50Mag']) {
      expect(def.model.parts[part]).toBeDefined();
    }
    expect(def.model.parts.cal50BrakeStd!.parent).toBe(def.model.parts.crown);
    expect(def.model.parts.cal50Long!.parent).toBe(def.model.parts.longBarrel);
    expect(def.model.parts.cal50Bolt!.parent).toBe(def.model.parts.bolt);
    expect(def.model.parts.cal50Mag!.parent).toBe(def.model.parts.mag);

    const worldVisible = (name: string): boolean => {
      let cur: THREE.Object3D | null = def.model.parts[name]!;
      while (cur) {
        if (!cur.visible) return false;
        cur = cur.parent;
      }
      return true;
    };

    // 1. Plain Awl: no .50 Cal parts visible.
    dressModel(def.model.root, def, new Set());
    expect(worldVisible('cal50Kit')).toBe(false);
    expect(worldVisible('cal50BrakeStd')).toBe(false);
    expect(worldVisible('cal50Long')).toBe(false);
    expect(worldVisible('cal50Bolt')).toBe(false);
    expect(worldVisible('cal50Mag')).toBe(false);

    // 2. awl50 alone (standard barrel): standard .50 tank brake visible, extended .50 barrel hidden.
    dressModel(def.model.root, def, new Set<ModId>(['awl50']));
    expect(worldVisible('cal50Kit')).toBe(true);
    expect(worldVisible('cal50BrakeStd')).toBe(true);
    expect(worldVisible('cal50Long')).toBe(false);
    expect(worldVisible('cal50Bolt')).toBe(true);
    expect(worldVisible('cal50Mag')).toBe(true);

    // 3. awl50 + awlBarrel (extended barrel): standard brake hidden, heavy extended .50 barrel + 3-chamber brake visible!
    dressModel(def.model.root, def, new Set<ModId>(['awl50', 'awlBarrel']));
    expect(worldVisible('cal50Kit')).toBe(true);
    expect(worldVisible('cal50BrakeStd')).toBe(false);
    expect(worldVisible('cal50Long')).toBe(true);
    expect(worldVisible('cal50Bolt')).toBe(true);
    expect(worldVisible('cal50Mag')).toBe(true);

    // 4. awlBarrel alone: extended standard barrel visible, .50 parts hidden.
    dressModel(def.model.root, def, new Set<ModId>(['awlBarrel']));
    expect(worldVisible('longBarrel')).toBe(true);
    expect(worldVisible('cal50Kit')).toBe(false);
    expect(worldVisible('cal50Long')).toBe(false);

    // 5. Bolt pose runs at 1.15x deliberate cycle speed when awl50 is fitted.
    const anim = new Anim();
    anim.model = def.model;
    anim.parts = def.model.parts;
    anim.sinceFire = 0.3 * 1.15;
    anim.mods = new Set<ModId>(['awl50']);
    def.model.resetParts();
    def.animate(anim);
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(1.12);
    expect(def.model.parts.bolt!.position.z).toBeCloseTo(0.14);
  });

  it('registers mgl_shot and awl50_suppressed_shot as gun samples and plays them for remote co-op shooters', () => {
    const mglSample = lookup('mgl_shot');
    expect(mglSample?.kind).toBe('sample');
    expect(mglSample?.file).toBe('guns/mgl_shot.mp3');

    const awl50CanSample = lookup('awl50_suppressed_shot');
    expect(awl50CanSample?.kind).toBe('sample');
    expect(awl50CanSample?.file).toBe('guns/awl50_suppressed_shot.mp3');

    const at = new THREE.Vector3(0, 1, 0);
    const shooter: Shooter = {
      eye: at.clone(),
      forward: new THREE.Vector3(0, 0, -1),
      velocity: new THREE.Vector3(),
      seat: 1,
      muzzle: (out: THREE.Vector3) => out.copy(at).add(new THREE.Vector3(0.2, -0.2, -0.5)),
      gesture() {},
    };
    const watcher = new Watcher(r.ctx, shooter);

    // Remote MGL plays mgl_shot.
    watcher.hold('mgl', []);
    r.record.sounds.length = 0;
    watcher.fire('mgl', at, new THREE.Vector3(0, 0, -1), plainNote({ to: new THREE.Vector3() } as FireNote));
    expect(r.record.sounds).toContain('mgl_shot');

    // Remote AWL + awl50 + awlCan plays awl50_suppressed_shot.
    watcher.hold('awl', ['awl50', 'awlCan']);
    r.record.sounds.length = 0;
    watcher.fire('awl', at, new THREE.Vector3(0, 0, -1), { ...plainNote({ to: new THREE.Vector3() } as FireNote), rays: 1 });
    expect(r.record.sounds).toContain('awl50_suppressed_shot');
    expect(r.record.sounds).not.toContain('awl50_shot');
    expect(r.record.sounds).not.toContain('awl_suppressed_shot');

    // Remote plain AWL + awlCan keeps awl_suppressed_shot.
    watcher.hold('awl', ['awlCan']);
    r.record.sounds.length = 0;
    watcher.fire('awl', at, new THREE.Vector3(0, 0, -1), { ...plainNote({ to: new THREE.Vector3() } as FireNote), rays: 1 });
    expect(r.record.sounds).toContain('awl_suppressed_shot');
  });
});
