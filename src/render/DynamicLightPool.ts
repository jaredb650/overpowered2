import * as THREE from 'three';
import type { DynamicLights } from '../core/contracts';

const MAX_REQUESTS = 64;
export const MAX_LIVE_LIGHTS = 8;
const INITIAL_FIXTURE_CAP = 128;

const _p = new THREE.Vector3();
const _c = new THREE.Color();

export interface FixtureLightSpec {
  position: THREE.Vector3;
  color: THREE.ColorRepresentation;
  intensity: number;
  radius: number;
  enabled?: boolean;
}

/**
 * A fixed set of real point lights fed from a larger list of transient flash requests and
 * persistent fixture lights. The light count never changes between presets, so no shader
 * recompiles mid-fight: idle slots sit at zero colour and the patched light loop skips them.
 * The live set is re-chosen every frame by priority/brightness relative to the camera.
 *
 * `intensity` is in candela, as for a three.js PointLight and for baked lights: irradiance is
 * intensity / distance^2, faded to nothing at `radius`.
 */
export class DynamicLightPool implements DynamicLights {
  // Transient flash pool
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

  // Persistent fixture channel (parallel typed arrays -> zero per-frame allocations)
  private fixtureCap = INITIAL_FIXTURE_CAP;
  private fpx = new Float32Array(INITIAL_FIXTURE_CAP);
  private fpy = new Float32Array(INITIAL_FIXTURE_CAP);
  private fpz = new Float32Array(INITIAL_FIXTURE_CAP);
  private fcr = new Float32Array(INITIAL_FIXTURE_CAP);
  private fcg = new Float32Array(INITIAL_FIXTURE_CAP);
  private fcb = new Float32Array(INITIAL_FIXTURE_CAP);
  private fpower = new Float32Array(INITIAL_FIXTURE_CAP);
  private fradius = new Float32Array(INITIAL_FIXTURE_CAP);
  private fenabled = new Uint8Array(INITIAL_FIXTURE_CAP);
  private falive = new Uint8Array(INITIAL_FIXTURE_CAP);
  private fscore = new Float32Array(INITIAL_FIXTURE_CAP);
  private fixtureHighWater = 0;
  private nextFixtureId = 1;
  private readonly fixtureSlotById = new Map<number, number>();
  private readonly freeFixtureSlots: number[] = [];

  private lastCamX = 0;
  private lastCamY = 0;
  private lastCamZ = 0;

  private readonly worldGroup = new THREE.Group();
  private readonly viewGroup: THREE.Group | null;
  private worldLights: THREE.PointLight[] = [];
  private viewLights: THREE.PointLight[] = [];

  /** World position and radius of each live light. Read by the fog pass. */
  readonly fogPosition = Array.from({ length: MAX_LIVE_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 1));
  readonly fogColor = Array.from({ length: MAX_LIVE_LIGHTS }, () => new THREE.Vector3());
  /** Number of active packed lights (0..MAX_LIVE_LIGHTS), shared with lit shaders and fog. */
  readonly opActiveLights: THREE.IUniform<number> = { value: 0 };
  /** Total pool slots currently in the scene (0..MAX_LIVE_LIGHTS). */
  readonly opPoolLights: THREE.IUniform<number> = { value: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly viewScene?: THREE.Scene,
    initialCount = MAX_LIVE_LIGHTS,
  ) {
    this.worldGroup.name = 'dynamic-light-pool';
    this.worldGroup.matrixAutoUpdate = false;
    this.worldGroup.updateMatrix();
    this.scene.add(this.worldGroup);
    if (this.viewScene) {
      this.viewGroup = new THREE.Group();
      this.viewGroup.name = 'dynamic-light-pool-view';
      this.viewGroup.matrixAutoUpdate = false;
      this.viewGroup.updateMatrix();
      this.viewScene.add(this.viewGroup);
    } else {
      this.viewGroup = null;
    }
    this.setCount(initialCount);
  }

  /** Rebuilds the pool. Only called from setQuality, because it recompiles every lit shader. */
  setCount(count: number): void {
    const clamped = Math.max(0, Math.min(count, MAX_LIVE_LIGHTS));
    if (this.worldLights.length === clamped && (!this.viewGroup || this.viewLights.length === clamped)) return;
    for (const l of this.worldLights) this.worldGroup.remove(l);
    if (this.viewGroup) {
      for (const l of this.viewLights) this.viewGroup.remove(l);
    }
    const make = (target: THREE.Group, enableDecalLayer: boolean) => {
      const list: THREE.PointLight[] = [];
      for (let i = 0; i < clamped; i++) {
        const light = new THREE.PointLight(0x000000, 0, 1, 2);
        if (enableDecalLayer) light.layers.enable(1);
        target.add(light);
        list.push(light);
      }
      return list;
    };
    this.worldLights = make(this.worldGroup, true);
    this.viewLights = this.viewGroup ? make(this.viewGroup, false) : [];
    this.opPoolLights.value = clamped;
    if (this.opActiveLights.value > clamped) this.opActiveLights.value = clamped;
  }

  /** Read-only access to the real GPU point lights managed by this pool. */
  getLiveLights(): readonly THREE.PointLight[] {
    return this.worldLights;
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

  /** Registers a persistent fixture light and returns a stable handle ID. */
  addFixture(spec: FixtureLightSpec): number {
    let slot: number;
    if (this.freeFixtureSlots.length > 0) {
      slot = this.freeFixtureSlots.pop()!;
    } else {
      slot = this.fixtureHighWater++;
      if (slot >= this.fixtureCap) this.growFixtures(this.fixtureCap * 2);
    }
    const id = this.nextFixtureId++;
    this.fixtureSlotById.set(id, slot);
    _c.set(spec.color);
    this.fpx[slot] = spec.position.x;
    this.fpy[slot] = spec.position.y;
    this.fpz[slot] = spec.position.z;
    this.fcr[slot] = _c.r;
    this.fcg[slot] = _c.g;
    this.fcb[slot] = _c.b;
    this.fpower[slot] = Math.max(0, spec.intensity);
    this.fradius[slot] = Math.max(0, spec.radius);
    this.fenabled[slot] = spec.enabled === false ? 0 : 1;
    this.falive[slot] = 1;
    this.fscore[slot] = 0;
    return id;
  }

  setFixtureEnabled(id: number, enabled: boolean): void {
    const slot = this.fixtureSlotById.get(id);
    if (slot === undefined) return;
    this.fenabled[slot] = enabled ? 1 : 0;
  }

  setFixtureIntensity(id: number, intensity: number): void {
    const slot = this.fixtureSlotById.get(id);
    if (slot === undefined) return;
    this.fpower[slot] = Math.max(0, intensity);
  }

  removeFixture(id: number): void {
    const slot = this.fixtureSlotById.get(id);
    if (slot === undefined) return;
    this.fixtureSlotById.delete(id);
    this.falive[slot] = 0;
    this.fenabled[slot] = 0;
    this.fscore[slot] = 0;
    this.freeFixtureSlots.push(slot);
  }

  clearFixtures(): void {
    this.falive.fill(0, 0, this.fixtureHighWater);
    this.fenabled.fill(0, 0, this.fixtureHighWater);
    this.fscore.fill(0, 0, this.fixtureHighWater);
    this.fixtureHighWater = 0;
    this.freeFixtureSlots.length = 0;
    this.fixtureSlotById.clear();
  }

  /** Clears transient flashes only (preserving persistent world fixtures across mission restarts). */
  clear(): void {
    this.left.fill(0);
  }

  private growFixtures(nextCap: number): void {
    const growF = (src: Float32Array) => {
      const dst = new Float32Array(nextCap);
      dst.set(src);
      return dst;
    };
    const growU = (src: Uint8Array) => {
      const dst = new Uint8Array(nextCap);
      dst.set(src);
      return dst;
    };
    this.fpx = growF(this.fpx);
    this.fpy = growF(this.fpy);
    this.fpz = growF(this.fpz);
    this.fcr = growF(this.fcr);
    this.fcg = growF(this.fcg);
    this.fcb = growF(this.fcb);
    this.fpower = growF(this.fpower);
    this.fradius = growF(this.fradius);
    this.fscore = growF(this.fscore);
    this.fenabled = growU(this.fenabled);
    this.falive = growU(this.falive);
    this.fixtureCap = nextCap;
  }

  update(dt: number, cameraOrPos?: THREE.Camera | THREE.Vector3, viewCamera?: THREE.Camera): void {
    let camera: THREE.Camera | null = null;
    if (cameraOrPos) {
      if ((cameraOrPos as THREE.Camera).isCamera) {
        camera = cameraOrPos as THREE.Camera;
        this.lastCamX = camera.matrixWorld.elements[12]!;
        this.lastCamY = camera.matrixWorld.elements[13]!;
        this.lastCamZ = camera.matrixWorld.elements[14]!;
      } else {
        const v = cameraOrPos as THREE.Vector3;
        this.lastCamX = v.x;
        this.lastCamY = v.y;
        this.lastCamZ = v.z;
      }
    }
    const cx = this.lastCamX;
    const cy = this.lastCamY;
    const cz = this.lastCamZ;

    // Score transient flashes: boosted when bright/close so muzzle flashes and blasts win over distant fixtures.
    for (let i = 0; i < MAX_REQUESTS; i++) {
      if (this.left[i]! <= 0) {
        this.score[i] = 0;
        continue;
      }
      this.left[i]! -= dt;
      const t = Math.max(this.left[i]!, 0) / this.total[i]!;
      if (t <= 0) {
        this.score[i] = 0;
        continue;
      }
      const dx = this.px[i]! - cx;
      const dy = this.py[i]! - cy;
      const dz = this.pz[i]! - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      const p = this.power[i]! * t * t;
      const r = this.radius[i]! > 1 ? this.radius[i]! : 1;
      this.score[i] = (p * r * 2.5) / (1 + distSq * 0.03);
    }

    // Score enabled persistent fixtures by intensity * radius / (1 + distSq * 0.02).
    const fCount = this.fixtureHighWater;
    for (let i = 0; i < fCount; i++) {
      if (this.falive[i] === 0 || this.fenabled[i] === 0) {
        this.fscore[i] = 0;
        continue;
      }
      const p = this.fpower[i]!;
      const r = this.fradius[i]!;
      if (p <= 0 || r <= 0) {
        this.fscore[i] = 0;
        continue;
      }
      const dx = this.fpx[i]! - cx;
      const dy = this.fpy[i]! - cy;
      const dz = this.fpz[i]! - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      this.fscore[i] = (p * r) / (1 + distSq * 0.02);
    }

    const count = this.worldLights.length;
    const hasViewMirror = this.viewLights.length === count && count > 0;
    let active = 0;
    for (let slot = 0; slot < MAX_LIVE_LIGHTS; slot++) {
      let bestIsFixture = false;
      let bestIdx = -1;
      let bestScore = 0;

      if (slot < count) {
        for (let i = 0; i < MAX_REQUESTS; i++) {
          const s = this.score[i]!;
          if (s > bestScore) {
            bestScore = s;
            bestIdx = i;
            bestIsFixture = false;
          }
        }
        for (let i = 0; i < fCount; i++) {
          const s = this.fscore[i]!;
          if (s > bestScore) {
            bestScore = s;
            bestIdx = i;
            bestIsFixture = true;
          }
        }
      }

      const fogP = this.fogPosition[slot]!;
      const fogC = this.fogColor[slot]!;
      if (bestIdx < 0) {
        fogC.set(0, 0, 0);
        if (slot < count) {
          this.worldLights[slot]!.intensity = 0;
          if (hasViewMirror) this.viewLights[slot]!.intensity = 0;
        }
        continue;
      }
      active++;

      let lx: number;
      let ly: number;
      let lz: number;
      let lr: number;
      let lg: number;
      let lb: number;
      let lpower: number;
      let lradius: number;

      if (bestIsFixture) {
        this.fscore[bestIdx] = 0;
        lx = this.fpx[bestIdx]!;
        ly = this.fpy[bestIdx]!;
        lz = this.fpz[bestIdx]!;
        lr = this.fcr[bestIdx]!;
        lg = this.fcg[bestIdx]!;
        lb = this.fcb[bestIdx]!;
        lpower = this.fpower[bestIdx]!;
        lradius = this.fradius[bestIdx]!;
      } else {
        this.score[bestIdx] = 0;
        const t = Math.max(this.left[bestIdx]!, 0) / this.total[bestIdx]!;
        // Squared decay: full power on frame one, then a fast tail, like the effects it lights.
        lx = this.px[bestIdx]!;
        ly = this.py[bestIdx]!;
        lz = this.pz[bestIdx]!;
        lr = this.cr[bestIdx]!;
        lg = this.cg[bestIdx]!;
        lb = this.cb[bestIdx]!;
        lpower = this.power[bestIdx]! * t * t;
        lradius = this.radius[bestIdx]!;
      }

      const light = this.worldLights[slot]!;
      light.position.set(lx, ly, lz);
      light.color.setRGB(lr, lg, lb);
      light.intensity = lpower;
      light.distance = lradius;
      light.updateMatrixWorld();

      if (hasViewMirror) {
        // The viewmodel scene has its own coordinates. Same eye-space position, so the same lighting.
        const mirror = this.viewLights[slot]!;
        if (camera && viewCamera) {
          _p.copy(light.position).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(viewCamera.matrixWorld);
          mirror.position.copy(_p);
        } else {
          mirror.position.copy(light.position);
        }
        mirror.color.copy(light.color);
        mirror.intensity = lpower;
        mirror.distance = lradius;
        mirror.updateMatrixWorld();
      }

      fogP.set(lx, ly, lz, lradius);
      fogC.set(lr * lpower, lg * lpower, lb * lpower);
    }
    this.opActiveLights.value = active;
  }
}
