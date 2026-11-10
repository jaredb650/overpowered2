/**
 * The main menu's background: the contractor in the Packmule's open door at dusk, with a cigar. Owned by the HUD,
 * drawn by the renderer in place of the world (`Renderer.backdrop`), so while it is up the map costs nothing.
 *
 *   want(true)   builds it the first time (the contractor's model loads on request), then shows it
 *   want(false)  hides it and keeps it, for a trip to a screen that shows the map
 *   dispose()    frees all of it, the contractor's model included. The HUD calls this when a run starts
 *
 * The camera sits aft in the cabin looking forward, so the door and the sky are on the left of the picture, where the
 * menu has the least text, and the subject is placed in the gap between the menu list and the Council's notice by
 * shifting the lens, not by turning the camera, so the framing holds from 4:3 to ultrawide.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../../core/contracts';
import type { Character } from '../../characters/Character';
import type { Backdrop } from '../../render/Renderer';
import { Cabin, sunThroughDoor } from './cabin';
import { Outside } from './outside';
import { SmokeRhythm, type BackdropMode, type SmokerPose } from './rhythm';
import { Smoke } from './smoke';
import { Smoker } from './smoker';

const ARCHETYPE = 'contractor';
/** Vertical field of view: long enough to flatten the cabin a little, as a lens across a cabin would. */
const FOV = 40;
/** Where the camera rests, and what it looks at: between his face and his knee. */
const EYE = new THREE.Vector3(-0.62, -0.16, -1.92);
const AIM = new THREE.Vector3(0.9, -0.42, 1.28);
const FADE_IN = 1.4;
/** The cabin under the menu music. Quiet: it is a room tone, not an engine. */
const CABIN_SOUND = { id: 'heli_rotor_loop', volume: 0.07, pitch: 0.78, fade: 2.5 } as const;
/** In rem, from base.css: where the menu list ends on the left, the notice begins on the right, and the wordmark begins below. */
const FREE = { left: 20, right: 53.4, bottom: 25 } as const;
/** In rem, from screens.css: half the height of the splash's centred wordmark and its subtitle. */
const SPLASH_HALF = 10.5;
/** Seconds the view takes to tilt from the splash's framing to the menu's. */
const SETTLE = 1.6;

/** Which screen's text the subject has to keep out of. */
export type BackdropLayout = 'menu' | 'splash';

/** What the library offers beyond the contract. */
interface Library {
  load(ids: string[]): Promise<void>;
  spawn(id: string): unknown;
  sockets(id: string): Record<string, { pos: readonly number[] }>;
  plainMaterial?(id: string): Promise<THREE.Material>;
  unload?(id: string): boolean;
}

interface RendererHook {
  backdrop: Backdrop | null;
  renderer?: THREE.WebGLRenderer;
  dynamicResolution?: { scale: number };
}

const _tip = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _out = new THREE.Vector3();
const _aim = new THREE.Vector3();

export interface BackdropStats {
  built: boolean;
  shown: boolean;
  still: boolean;
  body: boolean;
  smoke: number;
  drags: number;
  ember: number;
  objects: number;
}

export class MenuBackdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 9000);
  readonly rhythm = new SmokeRhythm();
  /** Holds parts of the pose, for checks that need a drag or a look on a chosen frame. */
  poseOverride: Partial<SmokerPose> | null = null;
  private readonly hook: Backdrop;
  private cabin: Cabin | null = null;
  private outside: Outside | null = null;
  private smoke: Smoke | null = null;
  private smoker: Smoker | null = null;
  private body: Character | null = null;
  private emberLight: THREE.PointLight | null = null;
  private fade: THREE.Mesh | null = null;
  /** The sky's reflection. The target, not its texture, is what frees the GPU memory. */
  private env: THREE.WebGLRenderTarget | null = null;
  private building: Promise<void> | null = null;
  /** Bumped by dispose, so a build that finishes afterwards throws its result away. */
  private generation = 0;
  private shown = false;
  private still = false;
  private clock = 0;
  private fadeClock = 0;
  private sound: LoopHandle | null = null;
  private soundRetry = 0;
  private readonly sway = new THREE.Vector2();
  /** 0 framed for the splash, 1 for the menu, eased between. */
  private layoutMix = 1;
  private layoutTarget = 1;
  private readonly owned: { dispose(): void }[] = [];

  constructor(private readonly ctx: Ctx) {
    this.hook = { scene: this.scene, camera: this.camera, still: false };
  }

  private get lib(): Library {
    return this.ctx.characters as unknown as Library;
  }

  private get renderHook(): RendererHook {
    return this.ctx.render as unknown as RendererHook;
  }

  get built(): boolean {
    return this.cabin !== null;
  }

  /**
   * Call every frame. `on` is whether the screen wants it, `mode` how (from `backdropMode`), `sound` whether the cabin
   * may be heard (after the first click, when audio is allowed). `layout` is whose text to keep clear of.
   */
  update(dt: number, on: boolean, mode: BackdropMode, sound: boolean, layout: BackdropLayout = 'menu'): void {
    const want = on && mode !== 'map';
    if (want && !this.built) this.build();
    if (want !== this.shown) {
      this.shown = want;
      this.renderHook.backdrop = want && this.built ? this.hook : null;
    }
    if (!want) {
      this.stopSound();
      return;
    }
    this.still = mode === 'still';
    this.layoutTarget = layout === 'splash' ? 0 : 1;
    // The first frame takes the layout as it is; after that a change is a slow tilt of the view, or a cut when still.
    if (this.clock === 0 || this.still) this.layoutMix = this.layoutTarget;
    // Held moving until the body is in and the fade is done, so the frame the renderer keeps is the finished one.
    this.hook.still = this.still && this.smoker !== null && !(this.fade?.visible ?? false);
    if (!this.built) return;
    this.renderHook.backdrop = this.hook;
    this.updateSound(sound, dt);
    this.frame(this.still ? 0 : dt);
  }

  /** Synchronous for everything but the contractor, who arrives when his model has loaded. */
  private build(): void {
    const gen = this.generation;
    this.cabin = new Cabin();
    this.outside = new Outside();
    this.smoke = new Smoke();
    this.emberLight = new THREE.PointLight(0xff6a24, 0, 1.4, 2);
    const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false });
    const fadeGeo = new THREE.PlaneGeometry(2, 2);
    this.fade = new THREE.Mesh(fadeGeo, fadeMat);
    this.fade.renderOrder = 100;
    this.fade.frustumCulled = false;
    this.fade.position.set(0, 0, -0.06);
    this.fade.scale.setScalar(0.2);
    this.camera.add(this.fade);
    this.owned.push(fadeMat, fadeGeo);
    this.scene.add(this.outside.root, this.cabin.root, this.smoke.points, this.emberLight, this.camera);
    this.environment();
    this.fadeClock = 0;
    this.building = this.loadBody(gen);
  }

  /** A small reflection of the dusk sky, so metal and the cigar's band have something to show. */
  private environment(): void {
    const renderer = this.renderHook.renderer;
    if (!renderer || !this.outside) return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = new THREE.Scene();
    sky.add(this.outside.root);
    this.env = pmrem.fromScene(sky, 0, 1, 8000, { size: 64 });
    pmrem.dispose();
    this.scene.add(this.outside.root);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.55;
  }

  private async loadBody(gen: number): Promise<void> {
    const lib = this.lib;
    try {
      await lib.load([ARCHETYPE]);
      const material = await lib.plainMaterial?.(ARCHETYPE);
      if (gen !== this.generation) {
        lib.unload?.(ARCHETYPE);
        return;
      }
      const body = lib.spawn(ARCHETYPE) as Character;
      if (material) body.mesh.material = sunThroughDoor(material);
      body.mesh.frustumCulled = false;
      body.mesh.castShadow = false;
      this.body = body;
      const mouth = lib.sockets(ARCHETYPE).mouth?.pos;
      this.smoker = new Smoker(body, mouth ? [mouth[0]!, mouth[1]!, mouth[2]!] : null);
      this.scene.add(body.root, this.smoker.cigar);
      // Smoke already in the air when the menu appears, and the first frame posed.
      this.smoker.update(this.rhythm.pose, 0, this.sway);
      for (let i = 0; i < 90; i++) this.stepSmoke(1 / 30);
      this.fadeClock = 0;
    } catch (e) {
      console.warn('[menu] the contractor did not load; the cabin shows without him', e);
    } finally {
      this.building = null;
    }
  }

  private stepSmoke(dt: number): void {
    if (!this.smoker || !this.smoke) return;
    const p = this.rhythm.pose;
    this.smoker.tip(_tip);
    this.smoker.breath(_mouth, _out);
    this.smoke.update(dt, _tip, p.ember, _mouth, _out, p.exhale);
  }

  private frame(dt: number): void {
    this.clock += dt;
    const step = dt / SETTLE;
    this.layoutMix += Math.max(-step, Math.min(step, this.layoutTarget - this.layoutMix));
    const t = this.clock;
    const still = this.still;
    if (still) this.rhythm.freeze();
    else this.rhythm.update(dt);
    const p = this.rhythm.pose;
    if (this.poseOverride) Object.assign(p, this.poseOverride);

    // The airframe's slow wander, and a buzz from the rotor. The cabin is the camera's frame, so the world rolls.
    this.sway.set(
      still ? 0.012 : Math.sin(t * 0.43) * 0.018 + Math.sin(t * 1.13 + 2) * 0.006,
      still ? -0.004 : Math.sin(t * 0.31 + 1) * 0.01 + Math.sin(t * 0.97) * 0.004,
    );
    this.outside!.root.rotation.set(-this.sway.y, 0, -this.sway.x);
    this.outside!.update(still ? 40 : t + 40);
    this.cabin!.update(t, dt, this.sway, still);

    if (this.smoker) {
      this.smoker.update(p, t, this.sway);
      if (!still) this.stepSmoke(dt);
      this.smoker.tip(_tip);
      this.emberLight!.position.copy(_tip);
      this.emberLight!.intensity = 0.004 + p.ember * 0.028 + (still ? 0 : Math.random() * 0.002);
    }
    this.placeCamera(t, still);

    if (this.fade) {
      this.fadeClock += still ? 1 : dt;
      const ready = this.smoker !== null || this.building === null;
      const a = ready ? Math.max(0, 1 - this.fadeClock / FADE_IN) : 1;
      (this.fade.material as THREE.MeshBasicMaterial).opacity = a;
      this.fade.visible = a > 0.001;
    }
  }

  /** A slow drift with a little handheld life, then a lens shift that puts the subject between the menu's text. */
  private placeCamera(t: number, still: boolean): void {
    const c = this.camera;
    // The page's size, not the canvas's: the menu's layout is in CSS pixels. Node has neither, for the tests.
    const w = Math.max(1, globalThis.innerWidth ?? 1440);
    const h = Math.max(1, globalThis.innerHeight ?? 900);
    const drift = still ? 0 : 1;
    c.position.set(
      EYE.x + Math.sin(t * 0.09) * 0.16 * drift,
      EYE.y + Math.sin(t * 0.13 + 1) * 0.05 * drift,
      EYE.z + Math.sin(t * 0.07 + 2) * 0.1 * drift,
    );
    _aim.copy(AIM);
    _aim.x += Math.sin(t * 0.11) * 0.05 * drift;
    c.up.set(0, 1, 0);
    c.lookAt(_aim);
    if (!still) {
      // Handheld: two slow sines and a faint fast one per axis.
      c.rotateX(Math.sin(t * 0.83) * 0.0035 + Math.sin(t * 2.3 + 1) * 0.0012);
      c.rotateY(Math.sin(t * 0.61 + 2) * 0.004 + Math.sin(t * 1.9) * 0.0011);
      c.rotateZ(Math.sin(t * 0.47 + 3) * 0.004 + this.sway.x * 0.2);
    }
    c.aspect = w / h;
    c.fov = FOV;
    c.updateProjectionMatrix();
    const m = smoothstep01(this.layoutMix);
    const a = framing(w, h, 'splash');
    const b = framing(w, h, 'menu');
    const shift = { x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m };
    c.projectionMatrix.elements[8] = shift.x;
    c.projectionMatrix.elements[9] = shift.y;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.updateMatrixWorld();
    if (this.smoke) {
      // Points are sized in the pixels of the target they are drawn into: the drawing buffer at the dynamic resolution.
      const r = this.renderHook.renderer;
      const ph = r ? r.domElement.height * (this.renderHook.dynamicResolution?.scale ?? 1) : h;
      this.smoke.setScale(ph / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    }
  }

  /** Asks again each second until it plays: the loop is synthesised on first request, so the first ask can come back empty. */
  private updateSound(allowed: boolean, dt: number): void {
    const audio = this.ctx.audio;
    if (this.sound && !this.sound.alive) this.sound = null;
    if (!allowed || this.sound) return;
    this.soundRetry -= dt;
    if (this.soundRetry > 0) return;
    this.soundRetry = 1;
    if (typeof audio?.startLoop !== 'function' || !(audio.has?.(CABIN_SOUND.id) ?? false)) return;
    this.sound = audio.startLoop(CABIN_SOUND.id, { volume: CABIN_SOUND.volume, pitch: CABIN_SOUND.pitch, fadeIn: CABIN_SOUND.fade, unaffectedByTime: true });
  }

  private stopSound(): void {
    this.sound?.stop(0.6);
    this.sound = null;
    this.soundRetry = 0;
  }

  /** Frees everything, the contractor's model too. Safe to call twice, and while the model is still loading. */
  dispose(): void {
    this.generation++;
    this.stopSound();
    if (this.renderHook.backdrop === this.hook) this.renderHook.backdrop = null;
    this.shown = false;
    if (!this.built) return;
    this.scene.clear();
    this.camera.clear();
    this.cabin!.dispose();
    this.outside!.dispose();
    this.smoke!.dispose();
    this.smoker?.dispose();
    this.emberLight!.dispose();
    this.env?.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    if (this.body) {
      this.body.mesh.material = this.body.a.material;
      this.body.release();
      this.lib.unload?.(ARCHETYPE);
    }
    this.scene.environment = null;
    this.cabin = this.outside = this.smoke = this.smoker = this.body = this.emberLight = this.fade = this.env = null;
    this.clock = 0;
  }

  stats(): BackdropStats {
    let objects = 0;
    this.scene.traverse(() => { objects++; });
    return {
      built: this.built,
      shown: this.shown,
      still: this.still,
      body: this.body !== null,
      smoke: this.smoke?.live() ?? 0,
      drags: this.rhythm.drags,
      ember: Number(this.rhythm.pose.ember.toFixed(3)),
      objects,
    };
  }
}

const smoothstep01 = (t: number) => t * t * (3 - 2 * t);

/**
 * Lens shift, in normalised device units, that puts the camera's aim at the middle of the gap the menu leaves: between
 * the end of the list and the start of the notice, and above the wordmark. On the splash the wordmark sits across the
 * middle of the screen, so the aim goes higher, to keep his head, chest and the cigar hand above it. The aim is between
 * his face and his knee: his head is about 0.14 of the screen's height above it, the resting hand 0.07 below. Pure,
 * for the test.
 */
export function framing(width: number, height: number, layout: BackdropLayout = 'menu'): { x: number; y: number } {
  const rem = Math.min(width / 120, height / 67.5);
  const left = FREE.left * rem;
  const right = Math.max(left + 1, width - FREE.right * rem);
  const cx = (left + right) / 2;
  const top = Math.max(1, height - FREE.bottom * rem);
  const cy = layout === 'splash'
    ? Math.max(0.2 * height, height / 2 - SPLASH_HALF * rem - 0.09 * height)
    : top * 0.62;
  // A point at the centre of the view lands at -shift on screen.
  return { x: -(cx / width * 2 - 1), y: -(1 - cy / height * 2) };
}
