/** Extended magazines (SMG 45, Rivet 22, the Piledriver's 100-round box) and the Gimlet's short barrel: the numbers, and the look. */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { WEAPONS } from './data';
import { MODS, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import type { ViewDef } from './viewmodels/def';
import { gimletDef } from './viewmodels/models/gimlet';
import { smgDefs } from './viewmodels/models/smg';
import { rivetDef } from './viewmodels/models/rivet';
import { piledriverDef } from './viewmodels/models/piledriver';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(id: WeaponId): void {
  r.weapons.give(id);
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

function fit(id: ModId, on = true): void {
  r.weapons.grantMod(id);
  r.weapons.fitMod(id, on);
}

describe('extended magazines', () => {
  const MAGS: readonly [ModId, WeaponId, number][] = [['smgMag', 'smg', 45], ['rivetMag', 'rivet', 22], ['piledriverBox', 'piledriver', 100]];

  it('hold more, in a mag slot, and change nothing else', () => {
    expect(WEAPONS.piledriver.magSize).toBe(50);
    for (const [mod, gun, size] of MAGS) {
      expect(MODS[mod].slot).toBe('mag');
      const d = moddedDef(gun, new Set([mod]));
      expect(d.magSize).toBe(size);
      expect({ ...d, magSize: WEAPONS[gun].magSize }).toEqual(WEAPONS[gun]);
    }
  });

  it('a reload fills the bigger magazine, and taking it off gives the extra back to the reserve', () => {
    for (const [mod, gun, size] of MAGS) {
      r.reset();
      draw(gun);
      const a = r.weapons.ammo(gun);
      fit(mod);
      expect(a.magSize).toBe(size);
      a.mag = 1;
      const total = a.mag + a.reserve;
      r.tap('reload');
      r.run(WEAPONS[gun].reloadTime + 0.3);
      expect(a.mag, gun).toBe(size);
      fit(mod, false);
      expect(a.mag).toBe(WEAPONS[gun].magSize);
      expect(a.mag + a.reserve).toBe(total);
    }
  });

  it('the SMG fires all 45 on one magazine', () => {
    draw('smg');
    fit('smgMag');
    r.tap('reload');
    r.run(WEAPONS.smg.reloadTime + 0.3);
    r.input.simulate('fire', true);
    r.run(45 * WEAPONS.smg.interval + 0.4);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('smg').mag).toBe(0);
  });
});

describe('the Gimlet short barrel', () => {
  it('is 15% faster in the barrel slot, and stacks with the issued can and the launcher', () => {
    expect(MODS.gimletShort.slot).toBe('barrel');
    const d = moddedDef('gimlet', new Set<ModId>(['gimletAcog', 'gimletCan', 'gimletGl', 'gimletShort']));
    expect(60 / d.interval).toBeCloseTo(920, 0);
    expect(d.muzzle).toBe('suppressed');
    expect(d.launcher).toBe(true);
    expect(d.sounds[0]!.id).toBe('gimlet_suppressed_shot');

    fit('gimletGl');
    fit('gimletShort');
    expect([...r.weapons.fitted].sort()).toEqual(['gimletAcog', 'gimletCan', 'gimletGl', 'gimletShort', 'smgLight']);
  });

  /** Rounds the Gimlet puts out in a second of held fire. */
  function second(): number {
    draw('gimlet');
    const a = r.weapons.ammo('gimlet');
    a.mag = 30;
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    return 30 - a.mag;
  }

  it('puts out more rounds a second', () => {
    const long = second();
    r.reset();
    fit('gimletShort');
    expect(second()).toBeGreaterThan(long);
  });
});

describe('the look', () => {
  let kit: Kit;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    // The SMG's ammo readout draws on a canvas.
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }),
    });
    const material = new THREE.MeshStandardMaterial();
    kit = new Kit({
      hard: material, glass: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
      glow(color: number) {
        const glow = new THREE.MeshBasicMaterial({ color });
        glow.userData.base = glow.color.clone();
        return glow;
      },
    } as unknown as VmMaterials);
  });

  /** World-space extent of a part, at rest. */
  function size(def: ViewDef, part: string): THREE.Vector3 {
    def.model.resetParts();
    def.model.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(def.model.parts[part]!).getSize(new THREE.Vector3());
  }

  it('each extended magazine is its own part, longer or bigger than the one it hides', () => {
    const smg = smgDefs(kit).right;
    expect(smg.mods!.smgMag).toEqual({ part: 'magExt', hides: 'magStd' });
    expect(size(smg, 'magExt').y).toBeGreaterThan(size(smg, 'magStd').y + 0.05);
    const rivet = rivetDef(kit);
    expect(size(rivet, 'magExt').y).toBeGreaterThan(size(rivet, 'magStd').y + 0.03);
    const pd = piledriverDef(kit);
    const big = size(pd, 'boxExt'), small = size(pd, 'boxStd');
    expect(big.y * big.z).toBeGreaterThan(small.y * small.z * 1.8);
  });

  it('the can moves back onto the short barrel, its mouth the muzzle, and the short muzzle is level with the launcher\'s', () => {
    const def = gimletDef(kit);
    const m = def.model;
    const look = def.mods!.gimletShort!;
    expect(look.hides).toBe('barrel');
    const can = m.parts.can!;
    const at = (s: string) => {
      m.root.updateMatrixWorld(true);
      return m.sockets[s]!.getWorldPosition(new THREE.Vector3()).z;
    };
    m.resetParts();
    const longCan = at('muzzleCan');
    can.position.z += look.moves!.z;
    const shortCan = at('muzzleCan');
    expect(shortCan - longCan).toBeCloseTo(look.moves!.z, 5);
    // The can's mouth still well ahead of the short barrel's own, and the short muzzle within 1.5 cm of the launcher's.
    expect(shortCan).toBeLessThan(at('muzzleShort') - 0.12);
    expect(Math.abs(at('muzzleShort') - at('muzzle1'))).toBeLessThan(0.015);
    expect(at('muzzleShort')).toBeGreaterThan(at('muzzle') + 0.08);
  });
});
