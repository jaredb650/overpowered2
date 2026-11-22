/** Tests for the Mech Shotgun arm weapon plugin, pure tube clock, pellet spread, falloff, co-op playback, and 3D model. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, PlayOptions, SurfaceKind } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { rangeFalloff } from '../../weapons/Combat';
import { SHOTGUN_ARM } from '../models/shotgun';
import { dispatchArmRemoteNews } from './registry';
import { MechShotgunArmGun, SHOTGUN, SHOTGUN_PLUGIN, ShotgunTube, fillPelletCone } from './shotgun';
import type { Arm, ArmUpdateContext, Sight } from './types';

const DT = 1 / 60;
const DEG = Math.PI / 180;

interface RecordedRay {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  spec: ShotSpec;
}

function makeHarness() {
  const rays: RecordedRay[] = [];
  const sounds: { id: string; opts?: PlayOptions }[] = [];
  const flashes: { kind: string; pos: THREE.Vector3 }[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const impacts: { pos: THREE.Vector3; surface: SurfaceKind }[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  const recoils: number[] = [];
  const kicks: { pitch: number; yaw: number }[] = [];
  const traumas: number[] = [];
  let worldHitDist: number | null = null;

  const ctx = {
    audio: {
      play: (id: string, opts?: PlayOptions) => sounds.push({ id, opts: opts ? { ...opts } : undefined }),
    },
    camera: {
      addTrauma: (amount: number) => traumas.push(amount),
      kick: (pitch: number, yaw: number) => kicks.push({ pitch, yaw }),
    },
    combat: {
      fireRay: (origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec) => {
        rays.push({ origin: origin.clone(), dir: dir.clone(), spec: { ...spec } });
        return { hitEnemy: false, headshot: false, killed: false, kills: 0, end: origin.clone().addScaledVector(dir, 50) };
      },
    },
    fx: {
      muzzleFlash: (pos: THREE.Vector3, _dir: THREE.Vector3, kind: string) => flashes.push({ kind, pos: pos.clone() }),
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => tracers.push({ from: from.clone(), to: to.clone(), kind }),
      impact: (pos: THREE.Vector3, _n: THREE.Vector3, surface: SurfaceKind) => impacts.push({ pos: pos.clone(), surface }),
      ring: () => undefined,
      sparks: () => undefined,
      smoke: () => undefined,
      shellCasing: () => undefined,
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
        if (worldHitDist === null || worldHitDist > maxDist) return null;
        return {
          point: origin.clone().addScaledVector(dir, worldHitDist),
          normal: new THREE.Vector3(0, 0, 1),
          distance: worldHitDist,
          surface: 'concrete' as SurfaceKind,
          collider: null,
        };
      },
      raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, _mask: number, out: { point: THREE.Vector3; normal: THREE.Vector3; distance: number; surface: SurfaceKind }) => {
        if (worldHitDist === null || worldHitDist > maxDist) return false;
        out.point.copy(origin).addScaledVector(dir, worldHitDist);
        out.normal.set(0, 0, 1);
        out.distance = worldHitDist;
        out.surface = 'concrete';
        return true;
      },
    },
    render: {
      lights: { flash: () => undefined },
    },
  } as unknown as Ctx;

  const rounds = {
    flash: () => undefined,
  } as unknown as Ac130Rounds;

  const arm: Arm = {
    muzzle: out => out.set(1.75, 4.1, -4.1),
    bore: out => out.set(0, 0, -1),
    turn: () => undefined,
    recoil: metres => recoils.push(metres),
  };

  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 5.2, -0.9) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 5.2, -40),
    range: 40,
  };

  const makeUpdate = (over: Partial<ArmUpdateContext> = {}): ArmUpdateContext => ({
    ctx,
    rounds,
    arm,
    side: 'right',
    button: 'RMB',
    cycleKey: '2',
    sight,
    held: false,
    pressed: false,
    cyclePressed: false,
    reloadPressed: false,
    recoilMult: 1,
    onShell: null,
    onNews: (kind, values) => news.push({ kind, values: [...values] }),
    ...over,
  });

  const setWorldHitDist = (d: number | null) => {
    worldHitDist = d;
  };

  return { ctx, rays, sounds, flashes, tracers, impacts, news, recoils, kicks, traumas, makeUpdate, setWorldHitDist };
}

describe('ShotgunTube clock', () => {
  it('holds 6 shells and enforces 0.42 s semi-auto cadence', () => {
    const tube = new ShotgunTube();
    expect(tube.shells).toBe(6);
    expect(tube.ready).toBe(true);
    expect(tube.progress).toBe(-1);

    // Fires immediately on first pull, then blocks until 0.42 s has elapsed.
    expect(tube.fire()).toBe(true);
    expect(tube.shells).toBe(5);
    expect(tube.ready).toBe(false);
    expect(tube.fire()).toBe(false);

    tube.update(0.41);
    expect(tube.ready).toBe(false);
    expect(tube.fire()).toBe(false);

    tube.update(0.015);
    expect(tube.ready).toBe(true);
    expect(tube.fire()).toBe(true);
    expect(tube.shells).toBe(4);
  });

  it('auto-reloads shell-by-shell at 0.45 s each when empty until full (6 shells)', () => {
    const tube = new ShotgunTube();
    // Spend all 6 shells.
    for (let i = 0; i < 6; i++) {
      expect(tube.fire()).toBe(true);
      if (i < 5) tube.update(SHOTGUN.interval);
    }
    expect(tube.shells).toBe(0);
    expect(tube.reloading).toBe(true);
    expect(tube.progress).toBeCloseTo(0, 3);

    // Halfway through first shell insertion (~0.225 s): still 0 shells, progress ~0.5.
    expect(tube.update(0.225)).toBe(0);
    expect(tube.shells).toBe(0);
    expect(tube.progress).toBeCloseTo(0.5, 2);

    // At 0.45 s: 1st shell clicks in.
    expect(tube.update(0.225)).toBe(1);
    expect(tube.shells).toBe(1);
    expect(tube.reloading).toBe(true);

    // Remaining 5 shells load over 5 * 0.45 = 2.25 s.
    let insertedTotal = 1;
    let elapsed = 0.45;
    while (tube.reloading && elapsed < 4) {
      insertedTotal += tube.update(DT);
      elapsed += DT;
    }
    expect(insertedTotal).toBe(6);
    expect(tube.shells).toBe(6);
    expect(tube.reloading).toBe(false);
    expect(tube.progress).toBe(-1);
    expect(elapsed).toBeCloseTo(6 * SHOTGUN.reloadPerShell, 1);
  });

  it('immediately interrupts reload when firing with >= 1 shell loaded', () => {
    const tube = new ShotgunTube();
    for (let i = 0; i < 6; i++) {
      tube.fire();
      if (i < 5) tube.update(SHOTGUN.interval);
    }
    expect(tube.shells).toBe(0);
    expect(tube.reloading).toBe(true);
    // Cannot interrupt while empty.
    expect(tube.fire()).toBe(false);

    // Wait for 2 shells to insert (0.90 s).
    tube.update(0.91);
    expect(tube.shells).toBe(2);
    expect(tube.reloading).toBe(true);

    // Firing cancels reload and shoots immediately.
    expect(tube.fire()).toBe(true);
    expect(tube.shells).toBe(1);
    expect(tube.reloading).toBe(false);
    expect(tube.progress).toBe(-1);
  });

  it('supports manual partial reload and reset()', () => {
    const tube = new ShotgunTube();
    expect(tube.startReload()).toBe(false); // full tube ignores manual reload

    tube.fire();
    tube.update(SHOTGUN.interval);
    tube.fire();
    expect(tube.shells).toBe(4);
    expect(tube.reloading).toBe(false);

    expect(tube.startReload()).toBe(true);
    expect(tube.reloading).toBe(true);
    expect(tube.startReload()).toBe(false); // already reloading

    tube.update(0.45);
    expect(tube.shells).toBe(5);
    expect(tube.reloading).toBe(true);

    tube.reset();
    expect(tube.shells).toBe(6);
    expect(tube.reloading).toBe(false);
    expect(tube.ready).toBe(true);
    expect(tube.progress).toBe(-1);
  });
});

describe('Mech Shotgun arm weapon plugin', () => {
  it('fires 26 heavy pellets through Combat.fireRay within a ~5.5° cone with 85 close damage, falloff past 25 m, and 8–10 tracers', () => {
    const h = makeHarness();
    const gun = SHOTGUN_PLUGIN.create(h.ctx) as MechShotgunArmGun;
    expect(gun.kind).toBe('shotgun');

    gun.update(DT, h.makeUpdate({ pressed: true }));

    expect(h.rays.length).toBe(26);
    const aim = new THREE.Vector3(0, 0, -1);
    let maxAngleDeg = 0;
    let minAngleDeg = 90;
    let tracerCount = 0;

    for (const r of h.rays) {
      expect(r.dir.length()).toBeCloseTo(1, 5);
      const angleDeg = Math.acos(Math.min(1, Math.max(-1, r.dir.dot(aim)))) / DEG;
      if (angleDeg > maxAngleDeg) maxAngleDeg = angleDeg;
      if (angleDeg < minAngleDeg) minAngleDeg = angleDeg;
      expect(angleDeg).toBeLessThanOrEqual(5.5 + 1e-4);

      expect(r.spec.damage).toBe(85);
      expect(r.spec.type).toBe('pellet');
      expect(r.spec.source).toBe('frame_shotgun');
      expect(r.spec.force).toBeGreaterThanOrEqual(150);
      expect(r.spec.severMult).toBeGreaterThanOrEqual(4);
      expect(r.spec.falloff).toBeDefined();
      if (r.spec.tracer) tracerCount++;
    }

    // Spread is genuinely preserved (core near center, outer ring spanning out toward 5.5°).
    expect(minAngleDeg).toBeLessThan(1.2);
    expect(maxAngleDeg).toBeGreaterThan(4.2);
    expect(maxAngleDeg).toBeLessThanOrEqual(5.5 + 1e-4);
    expect(tracerCount).toBeGreaterThanOrEqual(8);
    expect(tracerCount).toBeLessThanOrEqual(10);

    // Damage holds at 85 up to 25 m and tapers smoothly past 25 m.
    const falloff = h.rays[0]!.spec.falloff!;
    expect(85 * rangeFalloff(falloff, 5)).toBe(85);
    expect(85 * rangeFalloff(falloff, 25)).toBe(85);
    const midDmg = 85 * rangeFalloff(falloff, 55);
    const farDmg = 85 * rangeFalloff(falloff, 90);
    expect(midDmg).toBeLessThan(85);
    expect(midDmg).toBeGreaterThan(farDmg);
    expect(farDmg).toBeGreaterThan(0);

    // Recoil slide, view recoil kick, muzzle blast, and co-op news all triggered.
    expect(h.recoils).toEqual([SHOTGUN.recoilSlide]);
    expect(h.kicks.length).toBe(1);
    expect(h.traumas.length).toBe(1);
    expect(h.flashes.some(f => f.kind === 'shotgun')).toBe(true);
    expect(h.news.length).toBe(1);
    expect(h.news[0]!.kind).toBe('shotgun');
    expect(h.news[0]!.values.length).toBe(6);
  });

  it('scales view recoil kick by u.recoilMult (zero on Spider Legs)', () => {
    const h = makeHarness();
    const gun = SHOTGUN_PLUGIN.create(h.ctx);
    gun.update(DT, h.makeUpdate({ pressed: true, recoilMult: 0 }));
    expect(h.rays.length).toBe(26);
    expect(h.recoils.length).toBe(1);
    expect(h.kicks.length).toBe(0);
    expect(h.traumas.length).toBe(0);
  });

  it('fires on held-semi cadence (0.42 s) and updates HUD row accurately during firing & shell-by-shell reload', () => {
    const h = makeHarness();
    const gun = SHOTGUN_PLUGIN.create(h.ctx);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    gun.fillRow(row, 'LMB', '1');
    expect(row.name).toBe('LMB MECH SHOTGUN');
    expect(row.ammo).toBe(6);
    expect(row.max).toBe(6);
    expect(row.reload).toBe(-1);

    // Hold trigger across 2.2 s: should fire all 6 shells at ~0.42 s intervals (5 * 0.42 = 2.10 s).
    const shotTimes: number[] = [];
    for (let t = 0; t < 2.25; t += DT) {
      const before = h.rays.length;
      gun.update(DT, h.makeUpdate({ held: true }));
      if (h.rays.length > before) shotTimes.push(t);
    }
    expect(shotTimes.length).toBe(6);
    for (let i = 1; i < shotTimes.length; i++) {
      expect(shotTimes[i]! - shotTimes[i - 1]!).toBeGreaterThanOrEqual(SHOTGUN.interval - 1e-4);
    }

    // Empty tube: HUD reports 0/6 and active reload progress.
    gun.fillRow(row, 'RMB', '2');
    expect(row.name).toBe('RMB MECH SHOTGUN');
    expect(row.ammo).toBe(0);
    expect(row.max).toBe(6);
    expect(row.reload).toBeGreaterThanOrEqual(0);
    expect(row.reload).toBeLessThanOrEqual(1);

    // Dry click while empty plays weapon_dry without firing.
    const raysBefore = h.rays.length;
    gun.update(DT, h.makeUpdate({ pressed: true }));
    expect(h.rays.length).toBe(raysBefore);
    expect(h.sounds.some(s => s.id === 'weapon_dry')).toBe(true);

    // Advance 0.50 s without holding trigger: 1 shell inserts with crisp reload click, then pressing fire interrupts reload!
    h.sounds.length = 0;
    gun.update(0.5, h.makeUpdate());
    expect(h.sounds.some(s => s.id === 'reload_shell_in')).toBe(true);
    gun.fillRow(row, 'RMB', '2');
    expect(row.ammo).toBe(1);
    expect(row.reload).toBeGreaterThanOrEqual(0);

    // Firing interrupts reload immediately.
    gun.update(DT, h.makeUpdate({ pressed: true }));
    expect(h.rays.length).toBe(raysBefore + 26);
  });

  it('triggers manual reload on reloadPressed when partial and resets cleanly on reset()', () => {
    const h = makeHarness();
    const gun = SHOTGUN_PLUGIN.create(h.ctx);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    // Fire 2 shells (4 remaining).
    gun.update(DT, h.makeUpdate({ pressed: true }));
    gun.update(SHOTGUN.interval, h.makeUpdate());
    gun.update(DT, h.makeUpdate({ pressed: true }));
    gun.fillRow(row, 'RMB', '2');
    expect(row.ammo).toBe(4);
    expect(row.reload).toBe(-1);

    // Tap R: starts shell-by-shell reload.
    gun.update(DT, h.makeUpdate({ reloadPressed: true }));
    gun.fillRow(row, 'RMB', '2');
    expect(row.reload).toBeGreaterThanOrEqual(0);

    // Step 0.45 s: 5th shell loads.
    gun.update(0.45, h.makeUpdate());
    gun.fillRow(row, 'RMB', '2');
    expect(row.ammo).toBe(5);

    // Reset restores full 6 shells and clears reload.
    gun.reset();
    gun.fillRow(row, 'RMB', '2');
    expect(row.ammo).toBe(6);
    expect(row.reload).toBe(-1);
  });

  it('renders muzzle blast, 3D audio, impacts, and pooled tracer cone in co-op remoteNews', () => {
    const h = makeHarness();
    h.setWorldHitDist(18);
    const handled = dispatchArmRemoteNews(h.ctx, 'shotgun', [2, 4, -3, 0, 0, -1]);
    expect(handled).toBe(true);
    expect(h.flashes.some(f => f.kind === 'shotgun')).toBe(true);
    expect(h.sounds.some(s => s.id === 'dbshotgun_shot' && s.opts?.position !== undefined)).toBe(true);
    expect(h.tracers.length).toBeGreaterThanOrEqual(8);
    expect(h.tracers.length).toBeLessThanOrEqual(10);
    expect(h.impacts.length).toBe(h.tracers.length);
  });

  it('fills stratified pellet cones uniformly for arbitrary aim orientations', () => {
    const out = Array.from({ length: SHOTGUN.pellets }, () => new THREE.Vector3());
    for (const aim of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, -0.3, 0.7).normalize()]) {
      fillPelletCone(aim, SHOTGUN.spread, out);
      for (const p of out) {
        expect(p.length()).toBeCloseTo(1, 5);
        const angle = Math.acos(Math.min(1, Math.max(-1, p.dot(aim))));
        expect(angle).toBeLessThanOrEqual(SHOTGUN.spread + 1e-5);
      }
    }
  });

  it('builds valid SHOTGUN_ARM 3D model geometry for both static receiver and recoiling barrel assemblies', () => {
    const fixed = new ModelBuilder();
    SHOTGUN_ARM.build(fixed);
    const moving = new ModelBuilder();
    SHOTGUN_ARM.moving(moving);

    const fixedSolid = fixed.solidGeometry();
    const fixedGlow = fixed.glowGeometry();
    const movingSolid = moving.solidGeometry();

    expect(fixedSolid).not.toBeNull();
    expect(fixedGlow).not.toBeNull();
    expect(movingSolid).not.toBeNull();
    expect(fixedSolid!.getAttribute('position').count).toBeGreaterThan(500);
    expect(movingSolid!.getAttribute('position').count).toBeGreaterThan(100);
    for (const geo of [fixedSolid!, fixedGlow!, movingSolid!]) {
      const pos = geo.getAttribute('position').array as Float32Array;
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
    }
    expect(SHOTGUN_ARM.muzzle[2]).toBeLessThan(-2.5);
  });
});
