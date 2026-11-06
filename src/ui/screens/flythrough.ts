/**
 * The main menu runs over a live flight through the map: slow dollies with hard cuts between them.
 *
 * The Crucible's cuts are framed by hand, because the map looks best from low down with sky in the shot, which no rule
 * over zone bounds finds. A map without its own cuts gets one dolly per zone. The world is paused here, so the cost
 * is one render; Game.ts draws the menu at half rate on top of that.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { smoothstep } from '../../core/math';

interface Shot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  lookTo: THREE.Vector3;
}

type P = readonly [number, number, number];
const v = (p: P) => new THREE.Vector3(...p);
const cut = (from: P, to: P, lookFrom: P, lookTo: P): Shot => ({ from: v(from), to: v(to), lookFrom: v(lookFrom), lookTo: v(lookTo) });

/** Cold and warm alternate, and wide shots break up the close ones. Keyed by map id. */
const CUTS: Readonly<Record<string, readonly Shot[]>> = {
  crucible: [
    cut([0, 2.2, 70], [0, 2.5, 57], [0, 18, 0], [0, 21, 0]),
    cut([-20, -3, -100], [-9, -2.2, -99], [30, 4, -120], [36, 6, -120]),
    cut([-16, 22, 150], [16, 23, 147], [0, 16, 0], [0, 17, 0]),
    cut([31, -6.5, 29], [25, -6.5, 34], [0, 28, 0], [0, 31, 0]),
    cut([150, 16.5, 48], [150, 16.5, 22], [140, 15, -60], [141, 15, -72]),
    cut([62, 36, 12], [55, 38, -16], [0, 16, 0], [0, 15, 0]),
    cut([-105, -4.5, -62], [-105, -4.5, -52], [-105, -3, 60], [-104, -3, 60]),
    cut([42, 5, 42], [53, 5.6, 53], [110, 12, 110], [112, 13, 112]),
  ],
};

const SHOT_SECONDS = 11;
const FLY_FOV = 62;

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Flythrough {
  active = true;
  private shots: readonly Shot[] | null = null;
  private index = 0;
  private t = 0;

  constructor(private readonly ctx: Ctx) {}

  private build(): readonly Shot[] {
    const id = (this.ctx.world as unknown as { def?: { id?: string } }).def?.id;
    return (id && CUTS[id]) || this.zoneShots();
  }

  /** One shot per zone, sweeping across it with the eye on its far side. */
  private zoneShots(): Shot[] {
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
    this.t += dt;
    if (this.t >= SHOT_SECONDS) {
      this.t = 0;
      this.index = (this.index + 1) % this.shots.length;
    }
    const shot = this.shots[this.index]!;
    const k = this.t / SHOT_SECONDS;
    const u = smoothstep(0, 1, k) * 0.35 + k * 0.65;
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
