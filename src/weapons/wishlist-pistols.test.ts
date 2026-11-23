/** Lane D (Weapons Wishlist — Pistols part 1): open reflex optic, Ultramag, Rivet remodel + 5 mods, Judge barrel & comp. */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { Anim, type ViewDef } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { openReflex } from './viewmodels/models/optics';
import { pistolBackHalf } from './viewmodels/models/rivet';
import { dressModel, restingModel } from './viewmodels/rest';

let kit: Kit;
let defs: Record<string, ViewDef>;

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
    }),
  });
  const material = new THREE.MeshStandardMaterial();
  kit = new Kit({
    hard: material, glass: material, decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
  defs = buildDefs(kit);
});

afterAll(() => vi.unstubAllGlobals());

function isDescendantOf(child: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = child.parent; p; p = p.parent) {
    if (p === ancestor) return true;
  }
  return false;
}

describe('Wishlist Lane D — Pistols part 1', () => {
  it('exports the shared low-profile open reflex sight and Rivet back-half helper', () => {
    expect(typeof openReflex).toBe('function');
    expect(typeof pistolBackHalf).toBe('function');
  });

  it('produces finite positions and normals on every mesh of rivet, ultramag, and judge', () => {
    for (const id of ['rivet', 'rivetLeft', 'ultramag', 'ultramagLeft', 'judge'] as const) {
      defs[id]!.model.root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const attrName of ['position', 'normal'] as const) {
          const attr = mesh.geometry.getAttribute(attrName);
          if (!attr) continue;
          for (let i = 0; i < attr.array.length; i++) {
            expect(Number.isFinite(attr.array[i]), `${id}.${o.parent?.name}.${attrName}[${i}]`).toBe(true);
          }
        }
      });
    }
  });

  describe('Ultramag (low-profile open reflex + flared magwell)', () => {
    it('wires ultramagDot and ultramagMagwell with slide-mounted open reflex on both akimbo hands', () => {
      for (const id of ['ultramag', 'ultramagLeft'] as const) {
        const def = defs[id]!;
        const { parts } = def.model;
        expect(def.mods?.ultramagDot, id).toBeDefined();
        expect(def.mods?.ultramagDot?.part, id).toBe('rmr');
        expect(def.mods?.ultramagDot?.sight, id).toBeDefined();
        expect(def.mods?.ultramagMagwell, id).toBeDefined();
        expect(def.mods?.ultramagMagwell?.part, id).toBe('magwell');
        expect(parts.rmr, id).toBeDefined();
        expect(parts.slide, id).toBeDefined();
        expect(parts.magwell, id).toBeDefined();
        // Reflex sight rides on the reciprocating slide so it tracks recoil and akimbo cleanly.
        expect(isDescendantOf(parts.rmr!, parts.slide!), id).toBe(true);
        // Dot sightline sits clear above the iron sight line for an unobstructed ADS picture (left akimbo gun has sight: null).
        if (def.sight) expect(def.mods!.ultramagDot!.sight![1]).toBeGreaterThan(def.sight[1]);
      }
    });

    it('toggles rmr and magwell cleanly in dressModel', () => {
      const def = defs.ultramag!;
      const { root } = restingModel('ultramag', def);
      dressModel(root, def, new Set<ModId>());
      expect(root.getObjectByName('rmr')?.visible).toBe(false);
      expect(root.getObjectByName('magwell')?.visible).toBe(false);

      dressModel(root, def, new Set<ModId>(['ultramagDot', 'ultramagMagwell']));
      expect(root.getObjectByName('rmr')?.visible).toBe(true);
      expect(root.getObjectByName('magwell')?.visible).toBe(true);
    });
  });

  describe('Rivet remodel + 5 new mods', () => {
    it('exposes the remodeled Beretta-family parts and all 7 mods on both hands', () => {
      const expectedMods: readonly ModId[] = [
        'rivetMag', 'rivetLight', 'rivetComp', 'rivetCan', 'rivetDot', 'rivetLam', 'rivetMagwell',
      ];
      for (const id of ['rivet', 'rivetLeft'] as const) {
        const def = defs[id]!;
        const { parts, sockets } = def.model;

        for (const modId of expectedMods) {
          expect(def.mods?.[modId], `${id}.${modId}`).toBeDefined();
          expect(parts[def.mods![modId]!.part], `${id}.part.${modId}`).toBeDefined();
        }
        expect(parts.slide, id).toBeDefined();
        expect(parts.hammer, id).toBeDefined();
        expect(parts.trigger, id).toBeDefined();
        expect(parts.magStd, id).toBeDefined();
        expect(parts.magExt, id).toBeDefined();

        // Low-profile reflex rides the reciprocating slide.
        expect(isDescendantOf(parts.rmr!, parts.slide!), id).toBe(true);
        expect(def.mods!.rivetDot!.sight).toBeDefined();
        if (def.sight) expect(def.mods!.rivetDot!.sight![1]).toBeGreaterThan(def.sight[1]);

        // LAM socket is wired for lam.ts and parented to the lam part so visibility hides the beam when unfitted.
        expect(def.mods!.rivetLam!.laser).toBe('laser');
        expect(sockets.laser, id).toBeDefined();
        expect(isDescendantOf(sockets.laser!, parts.lam!), id).toBe(true);

        // Muzzle sockets for compensator and suppressor sit ahead of the bare muzzle along -Z.
        expect(def.mods!.rivetComp!.muzzle).toBe('muzzleComp');
        expect(def.mods!.rivetCan!.muzzle).toBe('muzzleCan');
        expect(sockets.muzzle, id).toBeDefined();
        expect(sockets.muzzleComp, id).toBeDefined();
        expect(sockets.muzzleCan, id).toBeDefined();
        def.model.root.updateMatrixWorld(true);
        const mBase = sockets.muzzle!.getWorldPosition(new THREE.Vector3());
        const mComp = sockets.muzzleComp!.getWorldPosition(new THREE.Vector3());
        const mCan = sockets.muzzleCan!.getWorldPosition(new THREE.Vector3());
        expect(mComp.z).toBeLessThan(mBase.z - 0.02);
        expect(mCan.z).toBeLessThan(mComp.z - 0.05);
      }
    });

    it('animates the exposed ring hammer cleanly without rolling the pistol on fire', () => {
      const def = defs.rivet!;
      const a = new Anim();
      a.parts = def.model.parts;
      a.model = def.model;
      a.mag = 12;
      a.magSize = 15;

      // Idle: hammer cocked back cleanly.
      a.sinceFire = 1;
      def.model.resetParts();
      def.animate(a);
      const idleHammer = def.model.parts.hammer!.rotation.x;

      // Peak of shot: slide cycles, hammer drops forward, zero roll twist.
      a.sinceFire = 0.015;
      a.gunR.set(0, 0, 0);
      def.model.resetParts();
      def.animate(a);
      expect(def.model.parts.hammer!.rotation.x).not.toBeCloseTo(idleHammer, 2);
      expect(a.gunR.z).toBe(0);
    });

    it('toggles all 7 mods cleanly in dressModel', () => {
      const def = defs.rivet!;
      const { root } = restingModel('rivet', def);
      dressModel(root, def, new Set<ModId>());
      expect(root.getObjectByName('magStd')?.visible).toBe(true);
      expect(root.getObjectByName('magExt')?.visible).toBe(false);
      for (const name of ['comp', 'can', 'rmr', 'lam', 'magwell', 'light']) {
        expect(root.getObjectByName(name)?.visible, name).toBe(false);
      }

      dressModel(root, def, new Set<ModId>(['rivetMag', 'rivetComp', 'rivetDot', 'rivetLam', 'rivetMagwell', 'rivetLight']));
      expect(root.getObjectByName('magStd')?.visible).toBe(false);
      expect(root.getObjectByName('magExt')?.visible).toBe(true);
      for (const name of ['comp', 'rmr', 'lam', 'magwell', 'light']) {
        expect(root.getObjectByName(name)?.visible, name).toBe(true);
      }
      expect(root.getObjectByName('can')?.visible).toBe(false);
    });
  });

  describe('Judge (extended barrel + ported compensator)', () => {
    it('wires judgeLong and judgeComp with comp shifting cleanly onto the extended barrel', () => {
      const def = defs.judge!;
      const { parts, sockets } = def.model;
      expect(def.mods?.judgeLong).toBeDefined();
      expect(def.mods?.judgeComp).toBeDefined();
      expect(def.mods!.judgeLong!.part).toBe('barrelLong');
      expect(def.mods!.judgeLong!.hides).toBe('barrelStd');
      expect(def.mods!.judgeLong!.muzzle).toBe('muzzleLong');
      expect(def.mods!.judgeLong!.moves?.part).toBe('comp');
      expect(def.mods!.judgeLong!.moves!.z).toBeLessThan(-0.05);

      expect(def.mods!.judgeComp!.part).toBe('comp');
      expect(def.mods!.judgeComp!.muzzle).toBe('muzzleComp');
      expect(parts.barrelStd).toBeDefined();
      expect(parts.barrelLong).toBeDefined();
      expect(parts.comp).toBeDefined();
      expect(sockets.muzzle).toBeDefined();
      expect(sockets.muzzleLong).toBeDefined();
      expect(sockets.muzzleComp).toBeDefined();

      // muzzleComp is parented to comp so moving comp forward moves the active muzzle with it.
      expect(isDescendantOf(sockets.muzzleComp!, parts.comp!)).toBe(true);

      // judgeComp must precede judgeLong in mods so rig.look(def, 'muzzle') picks muzzleComp when both are fitted.
      const keys = Object.keys(def.mods!);
      expect(keys.indexOf('judgeComp')).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf('judgeLong')).toBeGreaterThan(keys.indexOf('judgeComp'));
    });

    it('hides standard barrel and shifts compensator + muzzleComp forward when both are fitted', () => {
      const def = defs.judge!;
      const { root } = restingModel('judge', def);

      // Base state
      dressModel(root, def, new Set<ModId>());
      expect(root.getObjectByName('barrelStd')?.visible).toBe(true);
      expect(root.getObjectByName('barrelLong')?.visible).toBe(false);
      expect(root.getObjectByName('comp')?.visible).toBe(false);

      // Standard barrel + comp
      dressModel(root, def, new Set<ModId>(['judgeComp']));
      const comp = root.getObjectByName('comp')!;
      const stdCompZ = comp.position.z;
      expect(comp.visible).toBe(true);
      expect(root.getObjectByName('barrelStd')?.visible).toBe(true);

      // Extended barrel + comp
      dressModel(root, def, new Set<ModId>(['judgeLong', 'judgeComp']));
      expect(root.getObjectByName('barrelStd')?.visible).toBe(false);
      expect(root.getObjectByName('barrelLong')?.visible).toBe(true);
      expect(comp.visible).toBe(true);
      expect(comp.position.z).toBeCloseTo(stdCompZ + def.mods!.judgeLong!.moves!.z, 6);

      root.updateMatrixWorld(true);
      const mLong = root.getObjectByName('muzzleLong')!.getWorldPosition(new THREE.Vector3());
      const mComp = root.getObjectByName('muzzleComp')!.getWorldPosition(new THREE.Vector3());
      expect(mComp.z).toBeLessThan(mLong.z - 0.02);

      // Removing judgeLong restores comp to standard barrel position
      dressModel(root, def, new Set<ModId>(['judgeComp']));
      expect(comp.position.z).toBeCloseTo(stdCompZ, 6);
    });
  });
});
