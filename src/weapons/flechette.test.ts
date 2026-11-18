/** Flechettes for the shotguns, API rounds for the Harrow, and the Raufoss round's numbers kept as they were. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AmmoLoad, CharacterInstance, DamageInfo } from '../core/contracts';
import type { ModId } from '../core/gameplay';
import { armourHit, dartBleed, drainDarts, ignites } from '../enemies/damage';
import { BloodField } from '../gore/blood';
import { makeCtx } from '../sandbox/harness';
import { AMMO, TUNING, WEAPONS, type ArmourClass } from './data';
import { API_GUNS, FLECHETTE_GUNS, MODS, apiOf, flechetteOf, moddedDef } from './mods';

/**
 * One blast of `pellets` of `damage` spread in turn over `plates` fresh plates of `hp`, by DamageModel's rules: ball pellets are
 * counted per plate (the first bounces, the second wrecks it, the rest find nothing), an ammo mod has its own rule. What got through.
 */
function blast(pellets: number, damage: number, plates: number, hp: number, load?: AmmoLoad): number {
  const left = new Array<number>(plates).fill(hp);
  const met = new Array<number>(plates).fill(0);
  let through = 0;
  for (let i = 0; i < pellets; i++) {
    const k = i % plates;
    if (left[k]! <= 0) {
      through += damage;
      continue;
    }
    const cls: ArmourClass = ++met[k]! >= 2 ? 'medium' : 'light';
    const hit = armourHit(cls, left[k]!, damage, damage, 1, load);
    left[k]! -= hit.wear;
    through += hit.through;
  }
  return through;
}

describe('flechettes (AMMO.flechette)', () => {
  it('fit every pellet gun, three and a half times the pellets at a quarter each, in the same cone', () => {
    expect(FLECHETTE_GUNS).toEqual(['shotgun', 'thresher', 'deuce']);
    // The Judge fires one slug, not shells of pellets.
    expect(WEAPONS.judge.pellets).toBe(1);
    const counts = { shotgun: 21, thresher: 14, deuce: 28 };
    for (const gun of FLECHETTE_GUNS) {
      const row = WEAPONS[gun];
      const def = moddedDef(gun, new Set([flechetteOf(gun)]));
      expect(def.pellets, gun).toBe(counts[gun]);
      expect(def.pellets / row.pellets, gun).toBeGreaterThanOrEqual(3);
      expect(def.damage, gun).toBeCloseTo(row.damage * AMMO.flechette.flesh, 6);
      // The pattern stays a pattern: the gun's own spread, never zero.
      expect(def.spread, gun).toBe(row.spread);
      expect(def.spread, gun).toBeGreaterThan(0);
      expect(def.load, gun).toBe('flechette');
      expect(def.tracer, gun).toBe('flechette');
      expect(MODS[flechetteOf(gun)].slot, gun).toBe('ammo');
      // A hiss over the gun's own report, which stays first (the Deuce's second barrel plays sounds[0]).
      expect(def.sounds[0], gun).toEqual(row.sounds[0]);
      expect(def.sounds.length, gun).toBe(row.sounds.length + 1);
    }
    // The pump's choke narrows the darts' cone as it does buckshot's, and still leaves one.
    const choked = moddedDef('shotgun', new Set<ModId>(['shotgunChoke', 'shotgunFlechette']));
    expect(choked.pellets).toBe(21);
    expect(choked.spread).toBe(MODS.shotgunChoke.patch.spread);
    expect(choked.spread).toBeGreaterThan(0);
  });

  it('do a little less than buckshot to a bare man, and far more to a plated one', () => {
    for (const gun of FLECHETTE_GUNS) {
      const row = WEAPONS[gun];
      const def = moddedDef(gun, new Set([flechetteOf(gun)]));
      const ball = row.pellets * row.damage;
      const darts = def.pellets * def.damage;
      // Bare: 0.8 to 1 of buckshot (0.875 by the numbers).
      expect(darts / ball, gun).toBeGreaterThan(0.8);
      expect(darts / ball, gun).toBeLessThan(1);
      // A man with four plates, each of a Brute's chest on a 300 hp body.
      const armouredBall = blast(row.pellets, row.damage, 4, 45);
      const armouredDarts = blast(def.pellets, def.damage, 4, 45, 'flechette');
      expect(armouredBall / ball, gun).toBeLessThan(0.5);
      expect(armouredDarts / darts, gun).toBeGreaterThan(0.85);
      expect(armouredDarts, gun).toBeGreaterThan(armouredBall * 2);
    }
    // One dart on a plate: most of it through, and the plate worn by all of it.
    const dart = armourHit('light', 1000, 6.5, 6.5, 1, 'flechette');
    expect(dart.through).toBeCloseTo(6.5 * AMMO.flechette.plate, 6);
    expect(dart.wear).toBe(6.5);
  });

  it('leave a share of every dart to bleed on, and it drains away over a few seconds', () => {
    expect(dartBleed('flechette', 10)).toBeCloseTo(10 * AMMO.flechette.bleed, 6);
    for (const load of [undefined, 'ap', 'hp', 'plusP', 'api'] as const) expect(dartBleed(load, 10)).toBe(0);
    // A pump blast's worth on a bare man.
    const start = dartBleed('flechette', 21 * WEAPONS.shotgun.damage * AMMO.flechette.flesh);
    let pool = start;
    let bled = 0;
    let at2s = 0;
    for (let f = 1; f <= 600; f++) {
      const d = drainDarts(pool, 1 / 60);
      pool -= d;
      bled += d;
      if (f === 120) at2s = bled;
    }
    expect(start).toBeGreaterThan(25);
    expect(at2s / start).toBeGreaterThan(0.4);
    expect(at2s / start).toBeLessThan(0.75);
    expect(pool).toBe(0);
    expect(bled).toBeCloseTo(start, 6);
  });

  it('open a dripping wound a dart, where buckshot opens one a blast', () => {
    const ctx = makeCtx({
      fx: { bloodSpray() {}, bloodDrip() {} } as unknown as ReturnType<typeof makeCtx>['fx'],
      render: { decals: { add() {}, splat() {}, clear() {} } } as unknown as ReturnType<typeof makeCtx>['render'],
    });
    const body = (): CharacterInstance => {
      const root = new THREE.Group();
      new THREE.Scene().add(root);
      const bones = [new THREE.Bone(), new THREE.Bone()];
      root.add(bones[0]!);
      bones[0]!.add(bones[1]!);
      return { root, bones, setBloodiness() {} } as unknown as CharacterInstance;
    };
    const hit = (load?: AmmoLoad): DamageInfo => ({
      type: 'pellet', amount: 6, force: 0, source: 'shotgun', point: new THREE.Vector3(0, 1.2, 0), dir: new THREE.Vector3(0, 0, -1), bone: 1, load,
    });
    const ball = new BloodField(ctx);
    const man = body();
    for (let i = 0; i < 6; i++) ball.onHit(man, hit(), 0.05);
    expect(ball.bleeding).toBe(1);
    const darts = new BloodField(ctx);
    const other = body();
    for (let i = 0; i < 12; i++) darts.onHit(other, hit('flechette'), 0.02);
    expect(darts.bleeding).toBe(12);
  });
});

describe('API rounds (AMMO.api)', () => {
  it('are the gun\'s AP round, traced red, in the ammo slot, and fit the Harrow', () => {
    expect(API_GUNS).toContain('harrow');
    for (const gun of API_GUNS) {
      const ap = moddedDef(gun, new Set([`${gun}Ap` as ModId]));
      const api = moddedDef(gun, new Set([apiOf(gun)]));
      expect(api.load, gun).toBe('api');
      expect(api.tracer, gun).toBe('api');
      expect(api.damage, gun).toBe(ap.damage);
      expect(api.penetration, gun).toBe(ap.penetration);
      expect(MODS[apiOf(gun)].slot, gun).toBe('ammo');
      // Through a plate as AP goes.
      expect(armourHit('medium', 1000, api.damage, api.damage, 1, 'api')).toEqual(armourHit('medium', 1000, ap.damage, ap.damage, 1, 'ap'));
    }
  });

  it('set a man alight about one time in eight, and nothing else ever does', () => {
    expect(AMMO.api.ignite).toBeGreaterThanOrEqual(0.1);
    expect(AMMO.api.ignite).toBeLessThanOrEqual(0.15);
    expect(AMMO.api.burn).toBeGreaterThan(0);
    let lit = 0;
    for (let i = 0; i < 1000; i++) if (ignites('api', (i + 0.5) / 1000)) lit++;
    expect(lit / 1000).toBeCloseTo(AMMO.api.ignite, 2);
    for (const load of [undefined, 'ap', 'hp', 'plusP', 'flechette'] as const) expect(ignites(load, 0)).toBe(false);
  });
});

describe('Raufoss rounds keep their numbers', () => {
  it('as they were before the look was redone', () => {
    expect(TUNING.raufoss).toEqual({
      direct: 1.25, burst: { radius: 1.3, damage: 22, sound: 'raufoss_detonation' },
      pellets: 4, share: 0.4, cone: 0.09, range: 30, wall: 1.2, force: 14,
    });
    expect(MODS.raufoss.patch).toEqual({ raufoss: true });
    expect(WEAPONS.piledriver.altAmmo).toEqual({ label: 'RAUFOSS', hold: 0.3 });
    expect(WEAPONS.piledriver.damage).toBe(90);
  });
});
