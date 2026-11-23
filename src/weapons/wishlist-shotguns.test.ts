/**
 * Lane B (Shotguns): Billhook SPAS-12 hero viewmodel + mods, Pump Sawed-Off & Greased Bolt visuals/timing,
 * Deuce Long Barrel (dual & quad nesting + muzzle sockets), and Dragon's Breath FX + wall scorch + co-op watcher.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { FireNote, ModId } from '../core/gameplay';
import { AMMO, WEAPONS } from './data';
import { GREASE, MODS, moddedDef } from './mods';
import { isWeaponSuppressed } from '../enemies/outpost/acoustics';
import { makeRange } from './testkit';
import { Watcher, plainNote, type Shooter } from './watch';
import { Anim, ironsUp } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { billhookDef } from './viewmodels/models/billhook';
import { deuceDef } from './viewmodels/models/deuce';
import { shotgunDef } from './viewmodels/models/shotgun';
import { dressModel, restingModel } from './viewmodels/rest';
import { dragonBreath } from '../fx/recipes/dragon';
import type { FxCore } from '../fx/core';

function makeKit(): Kit {
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        clearRect() {},
        fillText() {},
      }),
    }),
  });
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material,
    glass: material,
    decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  return new Kit(mats);
}

describe('Billhook SPAS-12 hero viewmodel and mods', () => {
  it('builds with all iconic parts, sockets, reflex sight hiding rear irons, extended tube, and non-overlapping light + laser', () => {
    const def = billhookDef(makeKit());
    const { root } = restingModel('billhook', def);

    // Base resting state: rear iron sight and standard tube cap visible; mod parts hidden.
    dressModel(root, def, new Set());
    expect(ironsUp(def, new Set())).toBe(true);
    expect(root.getObjectByName('rearSight')!.visible).toBe(true);
    expect(root.getObjectByName('tubeCap')!.visible).toBe(true);
    expect(root.getObjectByName('tubeExt')!.visible).toBe(false);
    expect(root.getObjectByName('rmr')!.visible).toBe(false);
    expect(root.getObjectByName('rmrBase')!.visible).toBe(false);
    expect(root.getObjectByName('lam')!.visible).toBe(false);
    expect(root.getObjectByName('light')!.visible).toBe(false);

    // All hardware mods stacked together: reflex hides rearSight, extended tube hides tubeCap, lam & light both visible on opposite flanks.
    const all = new Set<ModId>(['billhookDot', 'billhookTube', 'billhookLam', 'billhookLight']);
    dressModel(root, def, all);
    expect(ironsUp(def, all)).toBe(false);
    expect(root.getObjectByName('rearSight')!.visible).toBe(false);
    expect(root.getObjectByName('rmr')!.visible).toBe(true);
    expect(root.getObjectByName('rmrBase')!.visible).toBe(true);
    expect(root.getObjectByName('tubeCap')!.visible).toBe(false);
    expect(root.getObjectByName('tubeExt')!.visible).toBe(true);
    expect(root.getObjectByName('lam')!.visible).toBe(true);
    expect(root.getObjectByName('light')!.visible).toBe(true);

    // Light sits on -X and laser on +X so they never collide.
    expect(def.model.parts.light!.position.x).toBeLessThan(0);
    expect(def.model.parts.lam!.position.x).toBeGreaterThan(0);
    expect(def.mods!.billhookLam!.laser).toBe('lam');
    expect(def.model.sockets.lam).toBeDefined();
    expect(def.mods!.billhookDot!.sight).toBeDefined();
    expect(def.mods!.billhookDot!.rear).toBeNull();
  });

  it('cycles semi-auto bolt cleanly on fire and feeds shells + racks bolt during reload', () => {
    const def = billhookDef(makeKit());
    const a = new Anim();
    a.parts = def.model.parts;
    a.model = def.model;
    a.mag = a.magSize = WEAPONS.billhook.magSize;

    def.model.resetParts();
    const restZ = a.parts.bolt!.position.z;

    // Mid-shot semi-auto bolt blowback.
    a.sinceFire = 0.06;
    def.animate(a);
    expect(a.parts.bolt!.position.z).toBeGreaterThan(restZ + 0.03);

    // Settled before next 0.26 s semi-auto shot.
    def.model.resetParts();
    a.sinceFire = 0.2;
    def.animate(a);
    expect(a.parts.bolt!.position.z).toBeCloseTo(restZ, 5);

    // Shell visible during shell-insert window, then bolt racked at 0.89.
    def.model.resetParts();
    a.sinceFire = 5;
    a.reload = 0.22;
    def.animate(a);
    expect(a.parts.shell!.visible).toBe(true);

    def.model.resetParts();
    a.reload = 0.89;
    def.animate(a);
    expect(a.parts.bolt!.position.z).toBeGreaterThan(restZ + 0.03);
  });

  it('keeps the reflex sight window unobstructed from the aimed eye and stays within triangle budget', () => {
    const def = billhookDef(makeKit());
    expect(def.model.triangles).toBeGreaterThan(4000);
    expect(def.model.triangles).toBeLessThan(35000);

    // Dress with billhookDot fitted (hiding rearSight) and raycast through the reflex dot from the aimed eye.
    def.model.resetParts();
    def.model.parts.rearSight!.visible = false;
    def.model.parts.rmr!.visible = true;
    def.model.parts.rmrBase!.visible = true;
    def.model.parts.lam!.visible = false;
    def.model.parts.light!.visible = false;
    def.model.parts.tubeExt!.visible = false;
    def.model.parts.shell!.visible = false;
    def.model.root.updateMatrixWorld(true);

    const dot = def.mods!.billhookDot!;
    const [sx, sy, sz] = dot.sight!;
    const eye = new THREE.Vector3(sx, sy, sz + dot.relief!);
    const target = new THREE.Vector3(sx, sy, sz - 1);
    const ray = new THREE.Raycaster(eye, target.sub(eye).normalize());
    const hits = ray.intersectObject(def.model.root, true).filter(h => {
      let o: THREE.Object3D | null = h.object;
      while (o) { if (!o.visible) return false; o = o.parent; }
      const mat = (h.object as THREE.Mesh).material as THREE.Material;
      // Ignore the reflex glass lens and the glowing dot itself.
      return !mat.userData?.base && h.distance < dot.relief! + 1 && Math.abs(h.point.z - sz) > 0.005;
    });
    expect(hits.length).toBe(0);
  });
});

describe('Pump Shotgun sawed-off and greased bolt', () => {
  it('swaps barrelFull cleanly for sawedOff without fighting shotgunChoke and shifts light back onto the clamp', () => {
    const def = shotgunDef(makeKit());
    const { root } = restingModel('shotgun', def);
    const lightRestZ = root.getObjectByName('light')!.position.z;

    // Plain gun.
    dressModel(root, def, new Set());
    expect(root.getObjectByName('barrelFull')!.visible).toBe(true);
    expect(root.getObjectByName('breacher')!.visible).toBe(true);
    expect(root.getObjectByName('sawedOff')!.visible).toBe(false);
    expect(root.getObjectByName('choke')!.visible).toBe(false);

    // Choke fitted: hides breacher only, keeps barrelFull visible.
    dressModel(root, def, new Set<ModId>(['shotgunChoke']));
    expect(root.getObjectByName('barrelFull')!.visible).toBe(true);
    expect(root.getObjectByName('breacher')!.visible).toBe(false);
    expect(root.getObjectByName('choke')!.visible).toBe(true);
    expect(root.getObjectByName('sawedOff')!.visible).toBe(false);

    // Sawed-off + light + greased bolt fitted: hides barrelFull, shows sawedOff & chrome bolt/bars, shifts light back.
    dressModel(root, def, new Set<ModId>(['shotgunSawedOff', 'shotgunLight', 'shotgunBolt']));
    expect(root.getObjectByName('barrelFull')!.visible).toBe(false);
    expect(root.getObjectByName('sawedOff')!.visible).toBe(true);
    expect(root.getObjectByName('greaseBolt')!.visible).toBe(true);
    expect(root.getObjectByName('greaseBars')!.visible).toBe(true);
    expect(root.getObjectByName('light')!.position.z).toBeGreaterThan(lightRestZ + 0.05);
    expect(def.model.sockets.muzzleSawed!.position.z).toBeGreaterThan(def.model.sockets.muzzle!.position.z + 0.2);

    // Switching back to choke cleanly restores barrelFull and hides sawedOff.
    dressModel(root, def, new Set<ModId>(['shotgunChoke']));
    expect(root.getObjectByName('barrelFull')!.visible).toBe(true);
    expect(root.getObjectByName('breacher')!.visible).toBe(false);
    expect(root.getObjectByName('sawedOff')!.visible).toBe(false);
  });

  it('accelerates the pump rack animation by GREASE when shotgunBolt is fitted', () => {
    const def = shotgunDef(makeKit());
    const a = new Anim();
    a.parts = def.model.parts;
    a.model = def.model;
    const restZ = def.model.parts.pump!.position.z;

    // At 0.21 s after firing: greased bolt (0.21 / 0.75 = 0.28 s) is fully racked back; stock (0.21 s) is only halfway.
    def.model.resetParts();
    a.sinceFire = 0.21;
    a.mods = new Set<ModId>();
    def.animate(a);
    const stockTravel = a.parts.pump!.position.z - restZ;

    def.model.resetParts();
    a.sinceFire = 0.21;
    a.mods = new Set<ModId>(['shotgunBolt']);
    def.animate(a);
    const greasedTravel = a.parts.pump!.position.z - restZ;

    expect(GREASE).toBe(0.75);
    expect(greasedTravel).toBeGreaterThan(stockTravel + 0.02);
    expect(greasedTravel).toBeCloseTo(0.088, 3);

    // At 0.38 s after firing: greased bolt is already home (0.38 / 0.75 = 0.506 > 0.48), while stock is still racking.
    def.model.resetParts();
    a.sinceFire = 0.38;
    a.mods = new Set<ModId>(['shotgunBolt']);
    def.animate(a);
    expect(a.parts.pump!.position.z).toBeCloseTo(restZ, 5);
  });

  it('mounts the oversized suppressor on full, sawn-off, and choke barrels without colliding slots or blocking sights', async () => {
    // Muzzle slot is separate from barrel slot so shotgunCan stacks freely with shotgunSawedOff and shotgunChoke.
    expect(MODS.shotgunCan.slot).toBe('muzzle');
    expect(MODS.shotgunSawedOff.slot).toBe('barrel');

    const r = await makeRange();
    r.weapons.give('shotgun');
    r.weapons.switchTo('shotgun');
    r.weapons.grantMod('shotgunSawedOff');
    r.weapons.grantMod('shotgunCan');
    r.weapons.fitMod('shotgunSawedOff', true);
    r.weapons.fitMod('shotgunCan', true);
    expect(r.weapons.fitted.has('shotgunSawedOff')).toBe(true);
    expect(r.weapons.fitted.has('shotgunCan')).toBe(true);

    const both = moddedDef('shotgun', r.weapons.fitted);
    expect(both.muzzle).toBe('suppressed');
    expect(both.sounds[0]!.id).toBe('pump_shotgun_suppressed_shot');
    expect(both.magSize).toBe(4);
    expect(both.spread).toBe(0.085);
    expect(isWeaponSuppressed('shotgun', r.weapons.fitted)).toBe(true);

    // Pairing flechettes with the suppressor keeps the suppressed shot sound and layers the flechette hiss over it.
    const flechetteCan = moddedDef('shotgun', new Set<ModId>(['shotgunCan', 'shotgunFlechette']));
    expect(flechetteCan.sounds.map(s => s.id)).toEqual(['pump_shotgun_suppressed_shot', 'bullet_flyby']);

    const def = shotgunDef(makeKit());
    const { root } = restingModel('shotgun', def);
    const can = root.getObjectByName('can')!;
    const canRestZ = can.position.z;

    // Oversized silhouette: > 320 mm long, > 55 mm wide, > 65 mm tall, while staying below both sight beads in gun space.
    def.model.root.updateMatrixWorld(true);
    const gunCanBox = new THREE.Box3().setFromObject(def.model.parts.can!);
    const size = gunCanBox.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(0.32);
    expect(size.x).toBeGreaterThan(0.055);
    expect(size.y).toBeGreaterThan(0.065);
    // Top of the eccentric can stays below both full (0.058) and sawn-off (0.054) sight beads.
    expect(gunCanBox.max.y).toBeLessThan(0.052);

    const muzzleCan = root.getObjectByName('muzzleCan')!;
    dressModel(root, def, new Set<ModId>(['shotgunCan']));
    expect(can.visible).toBe(true);
    expect(root.getObjectByName('breacher')!.visible).toBe(false);
    root.updateMatrixWorld(true);
    const muzzleCanFullZ = new THREE.Vector3().setFromMatrixPosition(muzzleCan.matrixWorld).z;

    // Paired with sawn-off: shifts back onto the cut crown, and muzzleCan rides along as a child of can.
    dressModel(root, def, new Set<ModId>(['shotgunSawedOff', 'shotgunCan']));
    expect(can.visible).toBe(true);
    expect(root.getObjectByName('sawedOff')!.visible).toBe(true);
    expect(root.getObjectByName('barrelFull')!.visible).toBe(false);
    expect(can.position.z).toBeCloseTo(canRestZ + 0.178, 5);
    root.updateMatrixWorld(true);
    const muzzleCanSawedZ = new THREE.Vector3().setFromMatrixPosition(muzzleCan.matrixWorld).z;
    expect(muzzleCanSawedZ).toBeCloseTo(muzzleCanFullZ + 0.178, 4);

    // Paired with choke: shifts forward onto the choke tip, and muzzleCan rides along.
    dressModel(root, def, new Set<ModId>(['shotgunChoke', 'shotgunCan']));
    expect(can.visible).toBe(true);
    expect(root.getObjectByName('choke')!.visible).toBe(true);
    expect(can.position.z).toBeCloseTo(canRestZ - 0.118, 5);
    root.updateMatrixWorld(true);
    const muzzleCanChokeZ = new THREE.Vector3().setFromMatrixPosition(muzzleCan.matrixWorld).z;
    expect(muzzleCanChokeZ).toBeCloseTo(muzzleCanFullZ - 0.118, 4);
  });
});

describe('Deuce long barrel (dual and quad)', () => {
  it('composes all 4 combinations of deuceQuad and deuceLong cleanly in dressModel and updates all 4 muzzle sockets', () => {
    const def = deuceDef(makeKit());
    const { root } = restingModel('deuce', def);

    // Helper: is an object effectively visible (itself and every ancestor visible)?
    const shown = (name: string): boolean => {
      let o = root.getObjectByName(name);
      if (!o) return false;
      for (; o; o = o.parent ?? undefined) if (!o.visible) return false;
      return true;
    };

    // 1. Plain short double.
    dressModel(root, def, new Set());
    expect(shown('shortTips')).toBe(true);
    expect(shown('longTips')).toBe(false);
    expect(shown('quad')).toBe(false);
    expect(shown('quadShort')).toBe(false);
    expect(shown('quadLong')).toBe(false);

    // 2. Long double.
    dressModel(root, def, new Set<ModId>(['deuceLong']));
    expect(shown('shortTips')).toBe(false);
    expect(shown('longTips')).toBe(true);
    expect(shown('quad')).toBe(false);
    expect(shown('quadShort')).toBe(false);
    expect(shown('quadLong')).toBe(false);

    // 3. Short quad.
    dressModel(root, def, new Set<ModId>(['deuceQuad']));
    expect(shown('shortTips')).toBe(true);
    expect(shown('longTips')).toBe(false);
    expect(shown('quad')).toBe(true);
    expect(shown('quadShort')).toBe(true);
    expect(shown('quadLong')).toBe(false);

    // 4. Long quad.
    dressModel(root, def, new Set<ModId>(['deuceQuad', 'deuceLong']));
    expect(shown('shortTips')).toBe(false);
    expect(shown('longTips')).toBe(true);
    expect(shown('quad')).toBe(true);
    expect(shown('quadShort')).toBe(false);
    expect(shown('quadLong')).toBe(true);

    // All 4 muzzle sockets move forward to LONG_MUZZLE when deuceLong is fitted and return when removed.
    const a = new Anim();
    a.parts = def.model.parts;
    a.model = def.model;
    a.mods = new Set<ModId>(['deuceLong']);
    def.animate(a);
    for (const s of ['muzzle', 'muzzle1', 'muzzle2', 'muzzle3'] as const) {
      expect(def.model.sockets[s]!.position.z, s).toBeLessThan(-0.68);
    }
    a.mods = new Set<ModId>();
    def.animate(a);
    for (const s of ['muzzle', 'muzzle1', 'muzzle2', 'muzzle3'] as const) {
      expect(def.model.sockets[s]!.position.z, s).toBeGreaterThan(-0.5);
    }
  });
});

describe("Dragon's breath FX, wall scorch, and co-op playback", () => {
  it('triggers dragonBreath on local fire, co-op watch, and adds wall scorch + sparks on dragon hits', async () => {
    const r = await makeRange();
    const dragonCalls: Array<{ pos: THREE.Vector3; dir: THREE.Vector3 }> = [];
    const sparkColors: number[] = [];
    const baseFx = r.ctx.fx;
    r.ctx.fx = new Proxy(baseFx, {
      get(target, prop) {
        if (prop === 'dragonBreath') return (pos: THREE.Vector3, dir: THREE.Vector3) => dragonCalls.push({ pos: pos.clone(), dir: dir.clone() });
        if (prop === 'sparks') {
          return (pos: THREE.Vector3, dir: THREE.Vector3, count: number, color?: THREE.ColorRepresentation) => {
            if (typeof color === 'number') sparkColors.push(color);
            target.sparks(pos, dir, count, color);
          };
        }
        return Reflect.get(target, prop);
      },
    });

    // Place a wall straight ahead at z = -8 so pellets hit world geometry.
    r.wall(-8, 1);

    // Equip Billhook with Dragon's breath and fire once.
    r.weapons.give('billhook');
    r.weapons.switchTo('billhook');
    r.run(0.6);
    r.weapons.grantMod('billhookDragon');
    expect(r.weapons.fitMod('billhookDragon', true)).toBe(true);

    r.tap('fire');

    expect(dragonCalls.length).toBe(1);
    expect(r.record.decals.filter(d => d.kind === 'scorch').length).toBeGreaterThanOrEqual(1);
    expect(sparkColors).toContain(0xff9a28);

    // Co-op Watcher sees Dragon's breath when a teammate fires Thresher with thresherDragon.
    const shooter: Shooter = {
      seat: 1,
      eye: new THREE.Vector3(2, 1.6, 0),
      forward: new THREE.Vector3(0, 0, -1),
      velocity: new THREE.Vector3(),
      muzzle: out => out.set(2, 1.5, -0.5),
      gesture() {},
    };
    const watcher = new Watcher(r.ctx, shooter);
    watcher.hold('thresher', ['thresherDragon']);
    const before = dragonCalls.length;
    watcher.fire('thresher', shooter.eye, shooter.forward, { ...plainNote({ to: new THREE.Vector3() } as FireNote), rays: 4, cone: 0.05 });
    expect(dragonCalls.length).toBe(before + 1);
  });

  it('emits fire puffs, bouncing floor sparks, flashes, and room lights in dragonBreath recipe', () => {
    const lightsFlash = vi.fn();
    const star = vi.fn();
    const petal = vi.fn();
    const smokeAdd = vi.fn();
    const smokeBegin = vi.fn();
    const streakAdd = vi.fn();
    const streakRestitutions: number[] = [];
    const streakBegin = vi.fn((...args: unknown[]) => {
      streakRestitutions.push(args[9] as number);
      return { setLife: vi.fn(), add: streakAdd };
    });

    const core = {
      birth: 1,
      now: 1,
      floorAt: () => 0,
      ctx: { render: { lights: { flash: lightsFlash } } },
      flashes: { star, petal },
      smoke: { begin: smokeBegin, add: smokeAdd },
      streaks: { begin: streakBegin },
    } as unknown as FxCore;

    dragonBreath(core, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -1));

    expect(lightsFlash).toHaveBeenCalledTimes(2);
    expect(star).toHaveBeenCalledTimes(1);
    expect(petal).toHaveBeenCalledTimes(3);
    // Fire tongue (16) + glow (3) + trailing smoke (5) = 24 puffs.
    expect(smokeAdd).toHaveBeenCalledTimes(24);
    // White (26) + amber (24) + orange (22) + embers (18) = 90 bouncing/drifting sparks.
    expect(streakAdd).toHaveBeenCalledTimes(90);
    expect(streakRestitutions.every(r => r > 0.2)).toBe(true);
    expect(AMMO.dragon.burn).toBe(4.5);
    expect(moddedDef('thresher', new Set<ModId>(['thresherDragon'])).load).toBe('dragon');
  });
});

describe('Shell-by-shell exact-count shotgun reload', () => {
  it('inserts only the missing shells on the pump shotgun, skips the pump rack when non-empty, and allows fire-to-interrupt', async () => {
    const r = await makeRange();
    r.reset();
    r.weapons.give('shotgun');
    r.weapons.switchTo('shotgun');
    r.run(0.6);
    expect(r.weapons.ammo('shotgun').mag).toBe(6);

    // Fire 1 shell (5/6): reloading inserts exactly 1 shell with no pump rack, much faster than an empty reload.
    r.tap('fire');
    r.run(0.7);
    expect(r.weapons.ammo('shotgun').mag).toBe(5);
    r.record.sounds.length = 0;
    r.tap('reload');
    expect(r.weapons.reloading).toBe(true);
    r.run(0.8);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('shotgun').mag).toBe(6);
    expect(r.record.sounds.filter(s => s === 'shotgun_shell_in')).toHaveLength(1);
    expect(r.record.sounds).not.toContain('pump_rack_back');
    expect(r.record.sounds).not.toContain('pump_rack_forward');

    // Empty the magazine (0/6): reloading inserts shells one by one and firing mid-reload interrupts cleanly.
    for (let i = 0; i < 6; i++) {
      r.tap('fire');
      if (i < 5) r.run(0.65);
    }
    expect(r.weapons.ammo('shotgun').mag).toBe(0);
    r.record.sounds.length = 0;
    if (!r.weapons.reloading) r.tap('reload');
    expect(r.weapons.reloading).toBe(true);
    r.run(0.9);
    const midMag = r.weapons.ammo('shotgun').mag;
    expect(midMag).toBeGreaterThanOrEqual(2);
    expect(midMag).toBeLessThan(6);
    r.tap('fire');
    // Interrupting a reload has a brief recovery/rack delay (no instant 0-frame fire).
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.ammo('shotgun').mag).toBe(midMag);
    r.run(0.42);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('shotgun').mag).toBe(midMag - 1);

    // Drain to 0/6 and let a full empty reload finish: inserts all 6 shells + between-shot pump rack.
    const left = r.weapons.ammo('shotgun').mag;
    for (let i = 0; i < left; i++) {
      r.run(0.65);
      r.tap('fire');
    }
    expect(r.weapons.ammo('shotgun').mag).toBe(0);
    r.record.sounds.length = 0;
    if (!r.weapons.reloading) r.tap('reload');
    r.run(2.5);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('shotgun').mag).toBe(6);
    expect(r.record.sounds.filter(s => s === 'shotgun_shell_in')).toHaveLength(6);
    expect(r.record.sounds).toContain('pump_rack_back');
    expect(r.record.sounds).toContain('pump_rack_forward');
  });

  it('inserts exact missing shells on the Billhook (2 spent -> 2 shells, empty -> 8 shells + bolt release)', async () => {
    const r = await makeRange();
    r.reset();
    r.weapons.give('billhook');
    r.weapons.switchTo('billhook');
    r.run(0.6);
    expect(r.weapons.ammo('billhook').mag).toBe(8);

    // Fire 2 shells (6/8) -> exactly 2 shell-in cues, no bolt release.
    r.tap('fire');
    r.run(0.35);
    r.tap('fire');
    r.run(0.35);
    expect(r.weapons.ammo('billhook').mag).toBe(6);
    r.record.sounds.length = 0;
    r.tap('reload');
    r.run(1.0);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('billhook').mag).toBe(8);
    expect(r.record.sounds.filter(s => s === 'shotgun_shell_in')).toHaveLength(2);
    expect(r.record.sounds).not.toContain('billhook_bolt_release');

    // Empty all 8 shells -> exactly 8 shell-in cues + billhook_bolt_release.
    for (let i = 0; i < 8; i++) {
      r.tap('fire');
      if (i < 7) r.run(0.35);
    }
    expect(r.weapons.ammo('billhook').mag).toBe(0);
    r.record.sounds.length = 0;
    if (!r.weapons.reloading) r.tap('reload');
    r.run(2.6);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('billhook').mag).toBe(8);
    expect(r.record.sounds.filter(s => s === 'shotgun_shell_in')).toHaveLength(8);
    expect(r.record.sounds).toContain('billhook_bolt_release');
  });

  it('plays tactical mag-only vs empty bolt-release/rack foley on Gimlet and Harrow', async () => {
    const r = await makeRange();
    r.reset();
    r.weapons.give('gimlet');
    r.weapons.switchTo('gimlet');
    r.run(0.4);
    // Tactical reload (round in chamber): mag out + mag in only, no bolt release.
    r.tap('fire');
    r.run(0.15);
    r.record.sounds.length = 0;
    r.tap('reload');
    r.run(1.0);
    expect(r.record.sounds).toContain('gimlet_mag_out');
    expect(r.record.sounds).toContain('gimlet_mag_in');
    expect(r.record.sounds).not.toContain('gimlet_bolt_release');
    // Empty reload: plays gimlet_bolt_release (drops locked bolt via bolt release button).
    r.weapons.ammo('gimlet').mag = 0;
    r.record.sounds.length = 0;
    r.tap('reload');
    r.run(1.3);
    expect(r.record.sounds).toContain('gimlet_mag_out');
    expect(r.record.sounds).toContain('gimlet_mag_in');
    expect(r.record.sounds).toContain('gimlet_bolt_release');

    r.weapons.give('harrow');
    r.weapons.switchTo('harrow');
    r.run(0.4);
    // Tactical reload: mag out + mag in only, no bolt rack.
    r.tap('fire');
    r.run(0.15);
    r.record.sounds.length = 0;
    r.tap('reload');
    r.run(1.2);
    expect(r.record.sounds).toContain('harrow_mag_out');
    expect(r.record.sounds).toContain('harrow_mag_in');
    expect(r.record.sounds).not.toContain('harrow_rack_bolt');
    // Empty reload: plays harrow_rack_bolt.
    r.weapons.ammo('harrow').mag = 0;
    r.record.sounds.length = 0;
    r.tap('reload');
    r.run(1.6);
    expect(r.record.sounds).toContain('harrow_mag_out');
    expect(r.record.sounds).toContain('harrow_mag_in');
    expect(r.record.sounds).toContain('harrow_rack_bolt');
  });

  it('plays deuce_open, deuce_shell_in, and deuce_close during a Deuce break-action reload', async () => {
    const r = await makeRange();
    r.reset();
    r.weapons.give('deuce');
    r.weapons.switchTo('deuce');
    r.run(0.5);
    r.tap('fire');
    r.run(0.35);
    r.tap('fire');
    r.run(0.1);
    r.record.sounds.length = 0;
    if (!r.weapons.reloading) r.tap('reload');
    r.run(1.5);
    expect(r.weapons.reloading).toBe(false);
    expect(r.record.sounds).toContain('deuce_open');
    expect(r.record.sounds).toContain('deuce_shell_in');
    expect(r.record.sounds).toContain('deuce_close');
  });

  it('offers the pistol reflex sight on every shotgun (Pump, Thresher, Deuce, Billhook)', async () => {
    const { thresherDef } = await import('./viewmodels/models/thresher');
    const kit = makeKit();
    const checks = [
      ['shotgunDot', 'shotgun', shotgunDef(kit)],
      ['thresherDot', 'thresher', thresherDef(kit)],
      ['deuceDot', 'deuce', deuceDef(kit)],
      ['billhookDot', 'billhook', billhookDef(kit)],
    ] as const;
    for (const [modId, weapon, def] of checks) {
      expect(MODS[modId].weapon, modId).toBe(weapon);
      expect(MODS[modId].slot, modId).toBe('sight');
      const look = def.mods?.[modId];
      expect(look, modId).toBeDefined();
      expect(look!.part, modId).toBe('rmr');
      if (weapon === 'deuce') {
        expect(moddedDef('deuce', new Set<ModId>(['deuceDot'])).spread).toBeCloseTo(WEAPONS.deuce.spread * 0.88, 6);
      } else {
        expect(look!.sight, modId).toBeDefined();
        expect(look!.rear, modId).toBeNull();
      }
      expect(def.model.parts.rmr, modId).toBeDefined();
      const { root } = restingModel(weapon, def);
      dressModel(root, def, new Set<ModId>([modId]));
      expect(root.getObjectByName('rmr')!.visible, modId).toBe(true);
    }
  });
});


