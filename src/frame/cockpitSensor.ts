/**
 * Sensor Cockpit wall-seeing enemy outline controller (`cockpitSensor`).
 *
 * When seated in a Distraint Frame fitted with the Sensor Cockpit (`range = 70 m`), renders every alive enemy within
 * `range` through walls using the Thermal brain chip's X-ray outline pipeline (`ctx.render.highlight` with `THERMAL`
 * white-hot / warm-amber colors and visible-surface fill), with zero per-frame heap allocations.
 *
 * Also tracks marked enemy UIDs and tags highlighted meshes (`userData.sensorMarked`) cleanly, clearing every tag and
 * optional co-op teammate mark hook on `clear()` when disembarking or clearing the Frame.
 */
import type * as THREE from 'three';
import { THERMAL } from '../contracts/chips';
import type { Ctx } from '../core/contracts';

/** Share of `range` at which full white-hot intensity begins fading smoothly toward warm amber at `range`. */
const FALLOFF_SHARE = 0.8;
/** Minimum outline strength at the outer boundary of `range` so targets at 70 m stay crisp and readable. */
const EDGE_FLOOR = 0.35;

interface CoopMarkShare {
  shareSensorMarks?(uids: ReadonlySet<number>, origin: THREE.Vector3, range: number): void;
  clearSensorMarks?(): void;
}

/** Smoothstep distance attenuation from 1.0 (inside `falloffStart`) down to `EDGE_FLOOR` at `range`. */
function sensorFalloff(dist: number, falloffStart: number, range: number): number {
  if (dist <= falloffStart) return 1;
  if (dist > range) return 0;
  const span = Math.max(0.001, range - falloffStart);
  const u = (dist - falloffStart) / span;
  const smooth = 1 - u * u * (3 - 2 * u);
  return EDGE_FLOOR + (1 - EDGE_FLOOR) * smooth;
}

export class FrameCockpitSensor {
  private readonly litNear: THREE.Object3D[] = [];
  private readonly litMid: THREE.Object3D[] = [];
  private readonly litFar: THREE.Object3D[] = [];
  private readonly markedUids = new Set<number>();
  private readonly tagged = new Set<THREE.Object3D>();
  private readonly nextTagged = new Set<THREE.Object3D>();
  private lastCoopShare: CoopMarkShare | null = null;
  private activeNow = false;

  /** Currently highlighted enemy UIDs within sensor range. */
  get marked(): ReadonlySet<number> {
    return this.markedUids;
  }

  /** Number of enemies currently revealed by the Sensor Cockpit. */
  get markedCount(): number {
    return this.markedUids.size;
  }

  /** True when the Sensor Cockpit was actively scanning on the last update. */
  get active(): boolean {
    return this.activeNow;
  }

  update(ctx: Ctx, range: number, feet: THREE.Vector3, active: boolean): void {
    if (!active || range <= 0) {
      if (this.activeNow || this.tagged.size > 0 || this.markedUids.size > 0) this.clear();
      return;
    }

    const alive = ctx.enemies?.alive;
    const highlight = ctx.render?.highlight;
    if (!alive || typeof highlight !== 'function') {
      if (this.activeNow || this.tagged.size > 0 || this.markedUids.size > 0) this.clear();
      return;
    }

    this.activeNow = true;
    const { litNear, litMid, litFar, markedUids, tagged, nextTagged } = this;
    litNear.length = 0;
    litMid.length = 0;
    litFar.length = 0;
    markedUids.clear();
    nextTagged.clear();

    const r2 = range * range;
    const falloffStart = range * FALLOFF_SHARE;
    const falloff2 = falloffStart * falloffStart;
    let midFadeSum = 0;
    let farFadeSum = 0;

    for (let i = 0; i < alive.length; i++) {
      const e = alive[i]!;
      if (e.alive === false) continue;
      const mesh = e.char?.mesh;
      if (!mesh) continue;
      const d2 = e.position.distanceToSquared(feet);
      if (d2 > r2) continue;

      markedUids.add(e.uid);
      nextTagged.add(mesh);
      if (mesh.userData) mesh.userData.sensorMarked = true;

      if (d2 <= falloff2) {
        litNear.push(mesh);
      } else {
        const fade = sensorFalloff(Math.sqrt(d2), falloffStart, range);
        if (fade >= 0.65) {
          litMid.push(mesh);
          midFadeSum += fade;
        } else {
          litFar.push(mesh);
          farFadeSum += fade;
        }
      }
    }

    // Clear stale tags from meshes that left range or died.
    for (const prev of tagged) {
      if (!nextTagged.has(prev) && prev.userData) {
        delete prev.userData.sensorMarked;
      }
    }
    tagged.clear();
    for (const cur of nextTagged) tagged.add(cur);

    // Emit through-wall silhouettes using the Thermal brain chip's palette and fill.
    if (litNear.length > 0) {
      ctx.render.highlight(litNear, THERMAL.enemyColor, 1, THERMAL.visibleFill);
    }
    if (litMid.length > 0) {
      const fade = midFadeSum / litMid.length;
      ctx.render.highlight(litMid, THERMAL.enemyColor, fade, THERMAL.visibleFill * fade);
    }
    if (litFar.length > 0) {
      const fade = farFadeSum / litFar.length;
      ctx.render.highlight(litFar, THERMAL.enemyFarColor, fade, THERMAL.visibleFill * fade);
    }

    // Co-op mark sharing: forward marked enemy UIDs if the co-op world exposes a sensor mark hook.
    const coopWorld = ctx.coop?.world as unknown as CoopMarkShare | undefined;
    if (coopWorld && typeof coopWorld.shareSensorMarks === 'function') {
      this.lastCoopShare = coopWorld;
      coopWorld.shareSensorMarks(markedUids, feet, range);
    }
  }

  clear(): void {
    this.activeNow = false;
    this.litNear.length = 0;
    this.litMid.length = 0;
    this.litFar.length = 0;
    this.markedUids.clear();
    for (const mesh of this.tagged) {
      if (mesh.userData) delete mesh.userData.sensorMarked;
    }
    this.tagged.clear();
    this.nextTagged.clear();
    if (this.lastCoopShare) {
      this.lastCoopShare.clearSensorMarks?.();
      this.lastCoopShare = null;
    }
  }
}
