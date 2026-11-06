/**
 * The main menu runs over a live flight through the map: slow dollies with hard cuts between them, built from the
 * map's own zones so it stays correct if the layout changes. The camera is left alone once a run starts.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { smoothstep } from '../../core/math';

interface Shot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  lookTo: THREE.Vector3;
  seconds: number;
}

const SHOT_SECONDS = 11;
const FLY_FOV = 62;

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Flythrough {
  active = true;
  private shots: Shot[] | null = null;
  private index = 0;
  private t = 0;

  constructor(private readonly ctx: Ctx) {}

  /** One shot per zone, sweeping across it from above with the eye on its far side. */
  private build(): Shot[] {
    const shots: Shot[] = [];
    const zones = this.ctx.world.zones;
    if (!Array.isArray(zones) || zones.length === 0) return shots;
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    zones.forEach((zone, i) => {
      zone.bounds.getCenter(centre);
      zone.bounds.getSize(size);
      const span = Math.min(size.x, size.z);
      if (!Number.isFinite(span) || span <= 0) return;
      const a = i * 2.1;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const height = Math.min(zone.bounds.max.y, zone.bounds.min.y + 34);
      shots.push({
        from: new THREE.Vector3(centre.x + dx * span * 0.42, height, centre.z + dz * span * 0.42),
        to: new THREE.Vector3(centre.x + dx * span * 0.18 - dz * span * 0.22, height - 8, centre.z + dz * span * 0.18 + dx * span * 0.22),
        lookFrom: new THREE.Vector3(centre.x - dx * span * 0.1, zone.bounds.min.y + 6, centre.z - dz * span * 0.1),
        lookTo: new THREE.Vector3(centre.x - dx * span * 0.3 + dz * span * 0.1, zone.bounds.min.y + 10, centre.z - dz * span * 0.3 - dx * span * 0.1),
        seconds: SHOT_SECONDS,
      });
    });
    return shots;
  }

  update(dt: number): void {
    if (!this.active) return;
    const camera = this.ctx.render.camera;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (!this.shots) {
      const built = this.build();
      if (built.length === 0) return;
      this.shots = built;
    }
    const shot = this.shots[this.index]!;
    this.t += dt;
    if (this.t >= shot.seconds) {
      this.t = 0;
      this.index = (this.index + 1) % this.shots.length;
    }
    const u = smoothstep(0, 1, this.t / shot.seconds) * 0.35 + (this.t / shot.seconds) * 0.65;
    _pos.lerpVectors(shot.from, shot.to, u);
    _look.lerpVectors(shot.lookFrom, shot.lookTo, u);
    camera.position.copy(_pos);
    camera.lookAt(_look);
    if (camera.fov !== FLY_FOV) {
      camera.fov = FLY_FOV;
      camera.updateProjectionMatrix();
    }
  }
}
