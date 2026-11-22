/**
 * Shoulder-Fired 105mm Howitzer (Slot 3): recoilless single-shot portable artillery with supersonic vapor rings,
 * massive finisher-grade detonation, rear venturi backblast, brass cannon casing ejection, Tier-3 structural breach,
 * Procurement unlock before wave 10, and procedural hydraulic-recoil viewmodel.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../campaign/missions';
import { survivalLoadout } from '../contracts/loadouts';
import { weaponWares } from '../contracts/shop/data';
import type { ProjectileSpec } from '../core/gameplay';
import { creditRule } from '../net/world/credit';
import { CACHE_ORDER } from '../progression/data';
import { WEAPONS as UI_WEAPONS } from '../ui/data';
import { weaponIcon } from '../ui/icons';
import { canDamageTier, damageMultiplierFor, DESTRUCTION_SOURCE_MULT } from '../world/destruction';
import { SOURCE_MULT } from '../world/structures';
import { TUNING, WEAPONS } from './data';
import { familyOfSlot } from './families';
import { makeRange, type Range } from './testkit';
import { Anim } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { howitzerDef } from './viewmodels/models/howitzer';
import { restingModel } from './viewmodels/rest';

function makeKit(): Kit {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material,
    glass: material,
    decal: material,
    decalRegions: {
      hazard: [0, 0, 1, 1],
      he: [0, 0, 1, 1],
      arrow: [0, 0, 1, 1],
      crucible: [0, 0, 1, 1],
      serial: [0, 0, 1, 1],
      warn: [0, 0, 1, 1],
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

describe('Shoulder-Fired 105mm Howitzer (Slot 3)', () => {
  let r: Range;
  let spawned: ProjectileSpec[];
  let rings: number;
  let vaporRings: number;
  let sparks: number;
  let lightFlashes: number;
  let casings: string[];
  let muzzleFlashes: string[];

  beforeEach(async () => {
    r = await makeRange();
    spawned = [];
    rings = 0;
    vaporRings = 0;
    sparks = 0;
    lightFlashes = 0;
    casings = [];
    muzzleFlashes = [];

    const origFx = r.ctx.fx;
    r.ctx.fx = new Proxy(origFx, {
      get: (t, k) => {
        if (k === 'ring') return () => { rings++; };
        if (k === 'vaporRing') return () => { vaporRings++; };
        if (k === 'sparks') return () => { sparks++; };
        if (k === 'shellCasing') return (_p: THREE.Vector3, _v: THREE.Vector3, kind: string) => { casings.push(kind); };
        if (k === 'muzzleFlash') return (_p: THREE.Vector3, _d: THREE.Vector3, kind: string) => { muzzleFlashes.push(kind); };
        return Reflect.get(t, k);
      },
    });

    const origRender = r.ctx.render;
    const lightsStub = { flash: () => { lightFlashes++; } };
    r.ctx.render = new Proxy(origRender, {
      get: (t, k) => (k === 'lights' ? lightsStub : Reflect.get(t, k)),
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

    r.weapons.give('howitzer');
    r.weapons.switchTo('howitzer');
    r.run(0.6);
    r.record.sounds.length = 0;
    spawned.length = 0;
    rings = 0;
    vaporRings = 0;
    sparks = 0;
    lightFlashes = 0;
    casings.length = 0;
    muzzleFlashes.length = 0;
  });

  it('registers on Slot 3 with 105mm ordnance stats, zero spread, side-optic ADS, and UI metadata', () => {
    expect(familyOfSlot(3)).toContain('howitzer');
    const def = WEAPONS.howitzer;
    expect(def.name).toBe('105MM HOWITZER');
    expect(def.slot).toBe(3);
    expect(def.base).toBe('rocket');
    expect(def.mode).toBe('semi');
    expect(def.round).toBe('shell');
    expect(def.magSize).toBe(1);
    expect(def.reserve).toBe(8);
    expect(def.maxReserve).toBe(16);
    expect(def.reloadTime).toBe(2.35);
    expect(def.drawTime).toBe(0.36);
    expect(def.damage).toBe(580);
    expect(def.spread).toBe(0);
    expect(def.severMult).toBe(3.5);
    expect(def.force).toBe(180);
    expect(def.casing).toBe('cannon');
    expect(def.sounds).toEqual([{ id: 'howitzer_shot', volume: 1.25 }]);
    expect(def.ads).toEqual({ zoom: 0.42, time: 0.22 });
    expect(def.slow).toBe(0.72);

    expect(TUNING.howitzer).toEqual({
      speed: 195,
      gravity: 6.5,
      damage: 580,
      blast: 680,
      radius: 13.5,
      kind: 'finisher',
      blastScale: 1.65,
      blastShake: 0.85,
      selfDamage: 0.25,
      playerPush: 18,
      size: 2.2,
      push: 6.5,
      groundPush: 0.55,
    });

    expect(UI_WEAPONS.howitzer.name).toBe('105mm Howitzer');
    expect(UI_WEAPONS.howitzer.key).toBe('3');
    expect(weaponIcon('howitzer')).toContain('<svg');
  });

  it('fires a 105mm shell with howitzer trail, finisher blast, shockwave FX, cannon casing, backblast, and shoulder shove', () => {
    r.ctx.player.velocity.set(0, 0, 0);
    r.ctx.player.forward.set(0, 0, -1);

    r.tap('fire');

    expect(spawned).toHaveLength(1);
    const p = spawned[0]!;
    expect(p.kind).toBe('shell');
    expect(p.source).toBe('howitzer');
    expect(p.trail).toBe('howitzer');
    expect(p.velocity.length()).toBeCloseTo(195, 2);
    expect(p.gravity).toBe(6.5);
    expect(p.damage).toBe(580);
    expect(p.size).toBe(2.2);
    expect(p.gib).toBe(true);
    expect(p.severMult).toBe(3.5);
    expect(p.force).toBe(180);
    expect(p.explosion).toEqual({
      radius: 13.5,
      damage: 680,
      kind: 'finisher',
      scale: 1.65,
      shake: 0.85,
      selfDamage: 0.25,
      playerPush: 18,
    });

    // Shot feedback, muzzle FX, brass cannon casing, and recoil shove.
    expect(muzzleFlashes).toEqual(['autocannon']);
    expect(casings).toEqual(['cannon']);
    expect(rings).toBeGreaterThanOrEqual(1);
    expect(vaporRings).toBeGreaterThanOrEqual(1);
    expect(sparks).toBeGreaterThanOrEqual(2); // muzzle sparks + rear backblast sparks
    expect(lightFlashes).toBeGreaterThanOrEqual(1);
    expect(r.record.sounds).toContain('howitzer_shot');
    const expectedShove = r.ctx.player.grounded
      ? TUNING.howitzer.push * TUNING.howitzer.groundPush
      : TUNING.howitzer.push;
    expect(r.ctx.player.velocity.z).toBeCloseTo(expectedShove, 2);

    // Breech is now empty; auto-reload plays bolt/shell/clang foley and chambers a fresh 105mm round.
    expect(r.weapons.ammo('howitzer').mag).toBe(0);
    r.run(2.5);
    expect(r.weapons.ammo('howitzer').mag).toBe(1);
    expect(r.weapons.ammo('howitzer').reserve).toBe(7);
    expect(r.record.sounds).toContain('reload_bolt');
    expect(r.record.sounds).toContain('reload_shell_in');
    expect(r.record.sounds).toContain('metal_clang');
  });

  it('unlocks in Procurement before round 10, appears in caches, and stays out of Mission 1 & 2 loadouts', () => {
    const crucibleWare = weaponWares('crucible').howitzer;
    const outpostWare = weaponWares('outpost').howitzer;
    expect(crucibleWare).toBeDefined();
    expect(outpostWare).toBeDefined();
    expect(crucibleWare!.price).toBe(2800);
    expect(crucibleWare!.wave).toBeLessThan(10);
    expect(outpostWare!.wave).toBeLessThan(10);
    expect(crucibleWare!.lore.length).toBeGreaterThan(40);

    expect(CACHE_ORDER).toContain('howitzer');
    for (const mission of [MISSIONS.foreclosure, MISSIONS.outpost]) {
      expect(mission).toBeDefined();
      expect(mission!.loadout.weapons).not.toContain('howitzer');
      for (const beat of mission!.beats) {
        if (beat.checkpoint) expect(beat.checkpoint.loadout.weapons).not.toContain('howitzer');
      }
    }
    expect(survivalLoadout('outpost')).not.toContain('howitzer');
    expect(survivalLoadout('crucible')).not.toContain('howitzer');
  });

  it('penetrates Tier-3 reinforced concrete, applies structure multipliers, and credits kills to player', () => {
    expect(canDamageTier(0, 'howitzer')).toBe(true);
    expect(canDamageTier(1, 'howitzer')).toBe(true);
    expect(canDamageTier(2, 'howitzer')).toBe(true);
    expect(canDamageTier(3, 'howitzer')).toBe(true);
    expect(DESTRUCTION_SOURCE_MULT.howitzer).toBe(8.0);
    expect(damageMultiplierFor(3, 'howitzer')).toBe(8.0);
    expect(SOURCE_MULT.howitzer).toBe(4.0);
    expect(creditRule('howitzer')).toBe('player');
  });

  it('builds a clean procedural viewmodel with recoil, breech reload animation, and restingModel support', () => {
    const prevDoc = globalThis.document;
    const fakeCtx = {
      fillStyle: '',
      font: '',
      textBaseline: '',
      globalAlpha: 1,
      fillRect() {},
      fillText() {},
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
    };
    try {
      const kit = makeKit();
      const def = howitzerDef(kit);
      const { model } = def;

      for (const socket of ['muzzle', 'eject', 'gripR', 'gripL', 'latch', 'shellHold', 'leverHold']) {
        expect(model.sockets[socket], `socket ${socket}`).toBeDefined();
      }
      for (const part of ['barrel', 'breech', 'shell', 'trigger', 'lever']) {
        expect(model.parts[part], `part ${part}`).toBeDefined();
      }
      expect(model.glows.reticle).toBeDefined();
      expect(model.screens.range).toBeDefined();

      // Animate fire recoil: barrel slams back cleanly along +Z.
      const a = new Anim();
      const barrel = model.parts.barrel!;
      const barrelRestZ = barrel.position.z;
      a.parts = model.parts;
      a.model = model;
      a.mag = 1;
      a.reserve = 8;
      a.draw = 1;
      a.reload = -1;
      a.sinceFire = 0.05;
      def.animate!(a);
      expect(barrel.position.z).toBeGreaterThan(barrelRestZ + 0.05);
      def.readout!(a);

      // Animate mid-reload: breech swings open and fresh 105mm shell appears.
      model.resetParts();
      a.mag = 0;
      a.sinceFire = 5;
      a.reload = 0.45;
      def.animate!(a);
      expect(model.parts.breech!.rotation.z).toBeLessThan(-1.5);
      expect(model.parts.shell!.visible).toBe(true);
      def.readout!(a);

      // Gunstage / preview helper builds cleanly without NaN or zero bounds.
      const rest = restingModel('howitzer', def);
      const box = new THREE.Box3().setFromObject(rest.root);
      const size = box.getSize(new THREE.Vector3());
      expect(size.length()).toBeGreaterThan(0.5);
    } finally {
      if (prevDoc === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDoc;
    }
  });
});
