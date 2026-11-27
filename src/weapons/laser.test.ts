/** Laser sight mods across all rifles and shotguns: data, shop wares, ADS snap, viewmodel geometry, and barrel-swap shifts. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MOD_WARES } from '../contracts/shop/data';
import { WEAPONS } from './data';
import { LAM_GUNS, MODS, MOD_ORDER, lamOf, moddedDef } from './mods';
import { REMOTE_MODS } from './watch';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { RIFLE_LAM_RANGE, SNIPER_LAM_RANGE } from './viewmodels/models/laser';
import { dressModel } from './viewmodels/rest';

const RIFLES = ['gimlet', 'harrow', 'shear', 'bodkin', 'flail'] as const;
const SNIPERS = ['awl', 'sabot'] as const;
const SHOTGUNS = ['shotgun', 'thresher', 'deuce', 'billhook'] as const;

function buildAllDefs() {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }),
  });
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material,
    decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow: (c: number) => new THREE.MeshBasicMaterial({ color: c }),
  } as unknown as VmMaterials;
  const defs = buildDefs(new Kit(mats));
  vi.unstubAllGlobals();
  return defs;
}

describe('rifle and shotgun laser sights', () => {
  it('covers every rifle and shotgun in the arsenal', () => {
    expect([...LAM_GUNS].sort()).toEqual([...RIFLES, ...SNIPERS, ...SHOTGUNS].sort());
  });

  it('registers mod definitions, unique order entries, shop wares, and remote watcher entries', () => {
    const orderSet = new Set(MOD_ORDER);
    expect(orderSet.size).toBe(MOD_ORDER.length);
    for (const gun of LAM_GUNS) {
      const id = lamOf(gun);
      const mod = MODS[id];
      expect(mod, id).toBeDefined();
      expect(mod.weapon, id).toBe(gun);
      expect(mod.slot, `${id} should not occupy a mod slot`).toBeUndefined();
      expect(orderSet.has(id), `${id} in MOD_ORDER`).toBe(true);
      const ware = MOD_WARES[id];
      expect(ware, `${id} in MOD_WARES`).toBeDefined();
      expect(ware.price, `${id} price`).toBeGreaterThan(0);
      expect(ware.lore.length, `${id} lore`).toBeGreaterThan(40);
      expect(REMOTE_MODS[id], `${id} in REMOTE_MODS`).toBeDefined();
    }
  });

  it('speeds up ADS by 30% on ADS-capable guns and leaves non-ADS guns intact', () => {
    for (const gun of LAM_GUNS) {
      const id = lamOf(gun);
      const base = WEAPONS[gun];
      const fitted = moddedDef(gun, new Set([id]));
      if (base.ads) {
        expect(fitted.ads?.time, gun).toBeCloseTo(base.ads.time * 0.7, 6);
      } else {
        expect(fitted.ads, gun).toBeUndefined();
      }
    }
    // Awl gains 3D ADS when fitted with awlAcog; pairing awlLam speeds up that ACOG ADS.
    const awlWithAcog = moddedDef('awl', new Set(['awlAcog']));
    const awlWithAcogAndLam = moddedDef('awl', new Set(['awlAcog', 'awlLam']));
    expect(awlWithAcog.ads).toBeDefined();
    expect(awlWithAcogAndLam.ads?.time).toBeCloseTo(awlWithAcog.ads!.time * 0.7, 6);
  });

  it('mounts a lam part and emitter socket on every rifle and shotgun viewmodel without colliding with weaponLight', () => {
    const defs = buildAllDefs();
    for (const gun of LAM_GUNS) {
      const id = lamOf(gun);
      const def = defs[gun]!;
      const look = def.mods?.[id];
      expect(look?.part, `${gun} part`).toBe('lam');
      expect(look?.laser, `${gun} laser socket`).toBe('lam');
      expect(def.model.parts.lam, `${gun} model.parts.lam`).toBeDefined();
      expect(def.model.sockets.lam, `${gun} model.sockets.lam`).toBeDefined();

      if ((RIFLES as readonly string[]).includes(gun)) {
        expect(look?.laserRange, `${gun} rifle range`).toBe(RIFLE_LAM_RANGE);
      } else if ((SNIPERS as readonly string[]).includes(gun)) {
        expect(look?.laserRange, `${gun} sniper range`).toBe(SNIPER_LAM_RANGE);
      }

      // If the weapon also has a light part, ensure the laser and light do not sit on top of each other.
      const light = def.model.parts.light;
      const lam = def.model.parts.lam!;
      if (light) {
        const dist = light.position.distanceTo(lam.position);
        expect(dist, `${gun} lam vs light separation`).toBeGreaterThan(0.03);
      }
    }
  });

  it('shifts the laser cleanly alongside barrel and shroud swaps via alsoMoves and resets when removed', () => {
    const defs = buildAllDefs();

    // Breacher shotgun: sawed-off shifts lam back +0.072 alongside light.
    const sg = defs.shotgun!;
    const sgBaseZ = sg.model.parts.lam!.position.z;
    dressModel(sg.model.root, sg, new Set(['shotgunLam', 'shotgunSawedOff']));
    expect(sg.model.parts.lam!.visible).toBe(true);
    expect(sg.model.parts.lam!.position.z).toBeCloseTo(sgBaseZ + 0.072, 6);
    dressModel(sg.model.root, sg, new Set(['shotgunLam']));
    expect(sg.model.parts.lam!.position.z).toBeCloseTo(sgBaseZ, 6);

    // Deuce: long barrels shift lam forward -0.14 alongside light.
    const deuce = defs.deuce!;
    const deuceBaseZ = deuce.model.parts.lam!.position.z;
    dressModel(deuce.model.root, deuce, new Set(['deuceLam', 'deuceLong']));
    expect(deuce.model.parts.lam!.visible).toBe(true);
    expect(deuce.model.parts.lam!.position.z).toBeCloseTo(deuceBaseZ - 0.14, 6);
    dressModel(deuce.model.root, deuce, new Set(['deuceLam']));
    expect(deuce.model.parts.lam!.position.z).toBeCloseTo(deuceBaseZ, 6);

    // Flail: heavy barrel shroud shifts lam outboard +0.0115 along X.
    const flail = defs.flail!;
    const flailBaseX = flail.model.parts.lam!.position.x;
    dressModel(flail.model.root, flail, new Set(['flailLam', 'flailHeavy']));
    expect(flail.model.parts.lam!.visible).toBe(true);
    expect(flail.model.parts.lam!.position.x).toBeCloseTo(flailBaseX + 0.0115, 6);
    dressModel(flail.model.root, flail, new Set(['flailLam']));
    expect(flail.model.parts.lam!.position.x).toBeCloseTo(flailBaseX, 6);
  });
});
