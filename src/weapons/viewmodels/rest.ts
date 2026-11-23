/**
 * A first-person gun model at rest (a full magazine, no shot, no reload), cloned out of the rig, with mods shown on it as they
 * are in the hands. The shop's studio (ui/backdrop/gunstage.ts) and a gun dropped on the ground (weapons/dropped.ts) draw it.
 * The clone shares the model's geometry and materials, so it costs no new build.
 */
import * as THREE from 'three';
import type { ModId, WeaponId } from '../../core/gameplay';
import { WEAPONS } from '../data';
import { Anim, ironsUp, type ViewDef } from './def';

/** The model at rest, centred in a holder; `size` is its longest side. */
export function restingModel(id: WeaponId, def: ViewDef): { root: THREE.Object3D; size: number } {
  const a = new Anim();
  a.parts = def.model.parts;
  a.model = def.model;
  a.mag = a.magSize = Math.max(1, WEAPONS[id].magSize);
  a.reserve = WEAPONS[id].reserve;
  def.model.resetParts();
  def.animate(a);
  const copy = def.model.root.clone();
  // The copy is a gun on a turntable or on the floor, not the one in the hands: it does not wear that one's blood
  // (kit/materials.ts `clean`).
  copy.traverse(o => {
    const mesh = o as THREE.Mesh;
    const clean = mesh.isMesh ? (mesh.material as THREE.Material).userData?.clean as THREE.Material | undefined : undefined;
    if (clean) mesh.material = clean;
  });
  copy.visible = true;
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  copy.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(copy);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const holder = new THREE.Group();
  copy.position.copy(centre).negate();
  holder.add(copy);
  return { root: holder, size: Math.max(size.x, size.y, size.z) };
}

/** Shows `mods` on a resting clone and hides the gun's other mods. */
export function dressModel(root: THREE.Object3D, def: ViewDef, mods: ReadonlySet<ModId>): void {
  for (const [mod, look] of Object.entries(def.mods ?? {})) {
    const on = mods.has(mod as ModId);
    const part = root.getObjectByName(look.part);
    if (part) part.visible = on;
    if (look.also) {
      if (typeof look.also === 'string') {
        const also = root.getObjectByName(look.also);
        if (also) also.visible = on;
      } else {
        for (const name of look.also) {
          const also = root.getObjectByName(name);
          if (also) also.visible = on;
        }
      }
    }
    const own = look.hides ? root.getObjectByName(look.hides) : undefined;
    if (own) own.visible = !on;
    const moved = look.moves ? root.getObjectByName(look.moves.part) : undefined;
    if (moved) moved.position.z = (moved.userData.restZ ??= moved.position.z) + (on ? look.moves!.z : 0);
    if (look.alsoMoves) {
      for (const mv of look.alsoMoves) {
        const target = root.getObjectByName(mv.part);
        if (!target) continue;
        if (mv.x !== undefined) target.position.x = (target.userData.restX ??= target.position.x) + (on ? mv.x : 0);
        if (mv.y !== undefined) target.position.y = (target.userData.restY ??= target.position.y) + (on ? mv.y : 0);
        if (mv.z !== undefined) target.position.z = (target.userData.restZ ??= target.position.z) + (on ? mv.z : 0);
      }
    }
  }
  const irons = def.irons ? root.getObjectByName(def.irons) : undefined;
  if (irons) irons.visible = ironsUp(def, mods);
}
