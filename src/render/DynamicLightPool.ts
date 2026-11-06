import * as THREE from 'three';
import type { DynamicLights } from '../core/contracts';

const MAX_REQUESTS = 64;
export const MAX_LIVE_LIGHTS = 8;

const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * A fixed set of real point lights fed from a larger list of requests. The light count never changes
 * between presets, so no shader recompiles mid-fight: idle slots sit at zero colour and the patched
 * light loop skips them. The live set is re-chosen every frame by brightness at the camera.
 *
 * `intensity` is in candela, as for a three.js PointLight and for baked lights: irradiance is
 * intensity / distance^2, faded to nothing at `radius`.
 */
export class DynamicLightPool implements DynamicLights {
  private readonly px = new Float32Array(MAX_REQUESTS);
  private readonly py = new Float32Array(MAX_REQUESTS);
  private readonly pz = new Float32Array(MAX_REQUESTS);
  private readonly cr = new Float32Array(MAX_REQUESTS);
  private readonly cg = new Float32Array(MAX_REQUESTS);
  private readonly cb = new Float32Array(MAX_REQUESTS);
  private readonly power = new Float32Array(MAX_REQUESTS);
  private readonly radius = new Float32Array(MAX_REQUESTS);
  private readonly left = new Float32Array(MAX_REQUESTS);
  private readonly total = new Float32Array(MAX_REQUESTS);
  private readonly score = new Float32Array(MAX_REQUESTS);
  private cursor = 0;

  private worldLights: THREE.PointLight[] = [];
  private viewLights: THREE.PointLight[] = [];

  /** World position and radius of each live light. Read by the fog pass. */
  readonly fogPosition = Array.from({ length: MAX_LIVE_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 1));
  readonly fogColor = Array.from({ length: MAX_LIVE_LIGHTS }, () => new THREE.Vector3());

  constructor(private readonly scene: THREE.Scene, private readonly viewScene: THREE.Scene) {}

  /** Rebuilds the pool. Only called from setQuality, because it recompiles every lit shader. */
  setCount(count: number): void {
    for (const l of this.worldLights) this.scene.remove(l);
    for (const l of this.viewLights) this.viewScene.remove(l);
    const make = (target: THREE.Scene) => {
      const list: THREE.PointLight[] = [];
      for (let i = 0; i < count; i++) {
        const light = new THREE.PointLight(0x000000, 0, 1, 2);
        target.add(light);
        list.push(light);
      }
      return list;
    };
    this.worldLights = make(this.scene);
    this.viewLights = make(this.viewScene);
  }

  flash(position: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, radius: number, seconds: number): void {
    // A flash peaks on its first frame, so replacing the dimmest slot keeps every event's first frame.
    let i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_REQUESTS;
    if (this.left[i]! > 0) {
      let best = Infinity;
      for (let j = 0; j < MAX_REQUESTS; j++) {
        const v = this.left[j]! <= 0 ? -1 : this.power[j]! * this.left[j]! / this.total[j]!;
        if (v < best) {
          best = v;
          i = j;
        }
      }
    }
    _c.set(color);
    this.px[i] = position.x;
    this.py[i] = position.y;
    this.pz[i] = position.z;
    this.cr[i] = _c.r;
    this.cg[i] = _c.g;
    this.cb[i] = _c.b;
    this.power[i] = intensity;
    this.radius[i] = radius;
    this.left[i] = this.total[i] = Math.max(seconds, 1e-3);
  }

  clear(): void {
    this.left.fill(0);
  }

  update(dt: number, camera: THREE.Camera, viewCamera: THREE.Camera): void {
    const cx = camera.matrixWorld.elements[12]!;
    const cy = camera.matrixWorld.elements[13]!;
    const cz = camera.matrixWorld.elements[14]!;
    for (let i = 0; i < MAX_REQUESTS; i++) {
      if (this.left[i]! <= 0) {
        this.score[i] = 0;
        continue;
      }
      this.left[i]! -= dt;
      const t = Math.max(this.left[i]!, 0) / this.total[i]!;
      const dx = this.px[i]! - cx;
      const dy = this.py[i]! - cy;
      const dz = this.pz[i]! - cz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      this.score[i] = this.power[i]! * t * t / (1 + dist2);
    }
    const count = this.worldLights.length;
    for (let slot = 0; slot < MAX_LIVE_LIGHTS; slot++) {
      let best = -1;
      let bestScore = 0;
      if (slot < count) {
        for (let i = 0; i < MAX_REQUESTS; i++) {
          if (this.score[i]! > bestScore) {
            bestScore = this.score[i]!;
            best = i;
          }
        }
      }
      const fogP = this.fogPosition[slot]!;
      const fogC = this.fogColor[slot]!;
      if (best < 0) {
        fogC.set(0, 0, 0);
        if (slot < count) {
          this.worldLights[slot]!.intensity = 0;
          this.viewLights[slot]!.intensity = 0;
        }
        continue;
      }
      this.score[best] = 0;
      const t = Math.max(this.left[best]!, 0) / this.total[best]!;
      // Squared decay: full power on frame one, then a fast tail, like the effects it lights.
      const power = this.power[best]! * t * t;
      const r = this.radius[best]!;
      const light = this.worldLights[slot]!;
      light.position.set(this.px[best]!, this.py[best]!, this.pz[best]!);
      light.color.setRGB(this.cr[best]!, this.cg[best]!, this.cb[best]!);
      light.intensity = power;
      light.distance = r;
      light.updateMatrixWorld();

      // The viewmodel scene has its own coordinates. Same eye-space position, so the same lighting.
      const mirror = this.viewLights[slot]!;
      _p.copy(light.position).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(viewCamera.matrixWorld);
      mirror.position.copy(_p);
      mirror.color.copy(light.color);
      mirror.intensity = power;
      mirror.distance = r;
      mirror.updateMatrixWorld();

      fogP.set(light.position.x, light.position.y, light.position.z, r);
      fogC.set(light.color.r * power, light.color.g * power, light.color.b * power);
    }
  }
}
