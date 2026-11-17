/** The akimbo mod's left-hand guns (models/index.ts `leftOf`, smg.ts `smgLeft`): every mod the right gun shows, and a mirrored grip. */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModId } from '../../../core/gameplay';
import { MODS } from '../../mods';
import { type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { autorafficaDef } from './autoraffica';
import { leftOf } from './index';
import { judgeDef } from './judge';
import { rivetDef } from './rivet';
import { smgDefs } from './smg';
import { ultramagDef } from './ultramag';

let pairs: [ViewDef, ViewDef][];

beforeAll(() => {
  // The SMG's and the Autoraffica's round counters draw on a canvas: a stand-in that draws nothing.
  const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 1 }) : () => {}), set: () => true });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number) { const g = new THREE.MeshBasicMaterial({ color }); g.userData.base = g.color.clone(); return g; },
  } as unknown as VmMaterials;
  const kit = new Kit(mats);
  const smg = smgDefs(kit);
  pairs = [[smg.right, smg.left], ...[rivetDef, ultramagDef, judgeDef, autorafficaDef].map(f => [f(kit), leftOf(f(kit))] as [ViewDef, ViewDef])];
});

describe('the left-hand gun', () => {
  it('carries every mod the right one shows, the SMG\'s long magazine, mag tape and stock among them', () => {
    for (const [right, left] of pairs) {
      expect(left.mods, left.id).toEqual(right.mods);
      for (const [id, look] of Object.entries(left.mods ?? {})) {
        expect(MODS[id as ModId].weapon, id).toBe(right.id);
        expect(left.model.root.getObjectByName(look.part), `${left.id} ${look.part}`).toBeTruthy();
      }
    }
    const smgMods = Object.keys(pairs[0]![1].mods ?? {});
    expect(smgMods).toEqual(expect.arrayContaining(['smgMag', 'smgTape', 'smgStock', 'suppressor', 'smgLight']));
  });

  it('sits on the left, held by the left hand on the right hand\'s grip mirrored, with no sights to aim', () => {
    for (const [right, left] of pairs.slice(1)) {
      expect(left.id).toBe(`${right.id}Left`);
      expect(left.pos[0]).toBeLessThan(0);
      expect(left.right).toBeNull();
      expect(left.left!.socket).toBe('gripAk');
      expect(left.sight).toBeUndefined();
      const r = left.model.sockets.gripR!, l = left.model.sockets.gripAk!;
      expect(l.position.x).toBeCloseTo(-r.position.x);
      expect(l.position.y).toBeCloseTo(r.position.y);
      // The mirror of a hand is the other hand: its thumb side points the other way across the gun.
      const side = (o: THREE.Object3D) => new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
      expect(side(l).y).toBeCloseTo(-side(r).y);
    }
  });
});
