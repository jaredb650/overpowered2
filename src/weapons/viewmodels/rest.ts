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
    const part = root.getObjectByName(look.part);
    if (part) part.visible = mods.has(mod as ModId);
    const also = look.also ? root.getObjectByName(look.also) : undefined;
    if (also) also.visible = mods.has(mod as ModId);
    const own = look.hides ? root.getObjectByName(look.hides) : undefined;
    if (own) own.visible = !mods.has(mod as ModId);
    const moved = look.moves ? root.getObjectByName(look.moves.part) : undefined;
    if (moved) moved.position.z = (moved.userData.restZ ??= moved.position.z) + (mods.has(mod as ModId) ? look.moves!.z : 0);
  }
  const irons = def.irons ? root.getObjectByName(def.irons) : undefined;
  if (irons) irons.visible = ironsUp(def, mods);
}
