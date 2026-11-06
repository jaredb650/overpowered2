/** A weapon lying on the map, marked on the HUD, waiting to be walked over. The mission decides what it means. */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import { WEAPONS } from '../weapons/data';
import type { Mark } from './types';

/** Metres from the feet. */
const REACH = 1.9;
const SPIN = 1.1;
const BOB_HEIGHT = 0.9;
const COLOR = '#ffc14a';

const _v = new THREE.Vector3();

interface Rack {
  weapon: WeaponId;
  mesh: THREE.Mesh;
  unmark: () => void;
  took: () => void;
}

export class Racks {
  private readonly racks: Rack[] = [];

  constructor(private readonly ctx: Ctx) {}

  add(weapon: WeaponId, at: Mark, took: () => void): void {
    const { ctx } = this;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.26, 0.3), ctx.render.materials.world('emissiveOrange'));
    mesh.position.set(at.at[0], at.at[1] + BOB_HEIGHT, at.at[2]);
    ctx.render.scene.add(mesh);
    this.racks.push({ weapon, mesh, took, unmark: ctx.hud.marker(mesh.position, WEAPONS[weapon].name) });
  }

  update(dt: number): void {
    const { ctx } = this;
    for (let i = this.racks.length - 1; i >= 0; i--) {
      const rack = this.racks[i]!;
      rack.mesh.rotation.y += SPIN * dt;
      _v.copy(rack.mesh.position);
      _v.y -= BOB_HEIGHT;
      if (_v.distanceTo(ctx.player.position) > REACH) continue;
      this.remove(i);
      ctx.weapons.give(rack.weapon);
      ctx.weapons.switchTo(rack.weapon);
      ctx.fx.pickupSparkle(_v, COLOR);
      ctx.audio.play('pickup_generic');
      rack.took();
    }
  }

  private remove(index: number): void {
    const rack = this.racks[index]!;
    rack.unmark();
    rack.mesh.removeFromParent();
    rack.mesh.geometry.dispose();
    this.racks.splice(index, 1);
  }

  reset(): void {
    while (this.racks.length > 0) this.remove(this.racks.length - 1);
  }
}
