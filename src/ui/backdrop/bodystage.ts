/**
 * The shop's Implants page picture: the contractor in the lit studio, wearing the loadout, turning slowly, as the Weapons page
 * turns its gun (gunstage.ts). Drawn by the renderer in place of the world (`Renderer.backdrop`) while the page is up. The row in
 * focus is put on him in place of whatever of its class he wears, and the camera closes on that part of him: the left arm for a
 * Gun implant, the head for a Kill one, the legs for a Move one.
 *
 *   stage.active = true      puts the studio up (the contractor's model loads the first time)
 *   stage.show(fitted, id)   what he wears, and the row in focus (null: the whole loadout, the whole man)
 *   stage.update(dt)         every frame while up
 *   stage.dispose()          gives the model back
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ctx } from '../../core/contracts';
import type { Character } from '../../characters/Character';
import { dressBody, undressBody } from '../../characters/implants';
import { HumanoidBone as H } from '../../characters/rig';
import { IMPLANTS, type ImplantClass, type ImplantId } from '../../progression/implants';
import type { Backdrop } from '../../render/Renderer';

const ARCHETYPE = 'contractor';
const FOV = 26;
/** Where he stands on the screen, as a share of its width and height: right of the list and above the card, as the gun does. */
const SPOT = { x: 0.665, y: 0.36 } as const;

/** What the camera looks at for each view, in his own space, how much of the screen's height it fills, and how he turns. */
const VIEWS: Readonly<Record<ImplantClass | 'all', { at: THREE.Vector3; span: number; yaw: number; swing: number }>> = {
  // The whole man above the shop's card, which takes the bottom quarter of the screen.
  all: { at: new THREE.Vector3(0, 0.98, 0), span: 2.75, yaw: 0, swing: -1 },
  // His left arm, the one the first-person view shows, three-quarters on, so the back of the forearm faces the lens.
  gun: { at: new THREE.Vector3(0.3, 1.1, 0.02), span: 1.0, yaw: -1.2, swing: 0.45 },
  kill: { at: new THREE.Vector3(0, 1.69, 0.03), span: 0.78, yaw: 0.15, swing: 0.75 },
  // The aim sits low on the shins, which puts it high on the screen, so his boots clear the card.
  move: { at: new THREE.Vector3(0, 0.3, -0.04), span: 1.3, yaw: 1.0, swing: 0.6 },
};
/** Radians a second he turns on the whole-loadout view; the close views swing to and fro instead. */
const TURN = 0.4;
/** Seconds the camera takes to settle on a new view. */
const EASE = 0.35;

interface Library {
  load(ids: string[]): Promise<void>;
  spawn(id: string): unknown;
  plainMaterial?(id: string): Promise<THREE.Material>;
  unload?(id: string): boolean;
}

interface RendererHook {
  backdrop: Backdrop | null;
  renderer?: THREE.WebGLRenderer;
}

const _at = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class BodyStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 50);
  private readonly hook: Backdrop = { scene: this.scene, camera: this.camera, still: false };
  private readonly turntable = new THREE.Group();
  private body: Character | null = null;
  private loading: Promise<void> | null = null;
  private worn: ImplantId[] = [];
  private view: ImplantClass | 'all' = 'all';
  private angle = 0;
  private clock = 0;
  /** The camera's eased aim and span. */
  private readonly aim = VIEWS.all.at.clone();
  private span = VIEWS.all.span;
  private yaw = 0;
  /** Holds him at this yaw instead of turning, for a still. */
  holdYaw: number | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private on = false;
  private disposed = false;

  constructor(private readonly ctx: Ctx) {
    this.scene.background = studioBackground();
    const key = new THREE.DirectionalLight(0xfff1de, 3);
    key.position.set(-1.4, 2.2, 2.4);
    const rim = new THREE.DirectionalLight(0x8fd4ff, 2.6);
    rim.position.set(1.8, 1.2, -2.2);
    const under = new THREE.DirectionalLight(0xffb070, 0.45);
    under.position.set(0.4, -1, 1.2);
    this.scene.add(key, rim, under, new THREE.AmbientLight(0x9db0bd, 0.35), this.turntable);
  }

  private get renderHook(): RendererHook {
    return this.ctx.render as unknown as RendererHook;
  }

  private get lib(): Library {
    return this.ctx.characters as unknown as Library;
  }

  /** Puts the studio up in place of the world, or takes it down. */
  set active(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.environment();
      this.loading ??= this.load();
    }
    const hook = this.renderHook;
    if (on) hook.backdrop = this.hook;
    else if (hook.backdrop === this.hook) hook.backdrop = null;
  }

  get ready(): boolean {
    return this.body !== null;
  }

  /** He wears `fitted`, with `preview` put on in place of whatever of its class he has on. */
  show(fitted: Iterable<ImplantId>, preview: ImplantId | null = null): void {
    const worn = [...fitted];
    if (preview) {
      const cls = IMPLANTS[preview].class;
      for (let i = worn.length - 1; i >= 0; i--) if (IMPLANTS[worn[i]!].class === cls) worn.splice(i, 1);
      worn.push(preview);
    }
    this.worn = worn;
    const view = preview ? IMPLANTS[preview].class : 'all';
    if (view !== this.view) {
      this.view = view;
      this.clock = 0;
    }
    if (this.body) dressBody(this.body, worn);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.clock += dt;
    const v = VIEWS[this.view];
    const k = 1 - Math.exp(-dt / EASE);
    this.aim.lerp(v.at, k);
    this.span += (v.span - this.span) * k;
    // The whole man turns round; a close view swings him to and fro about the side that shows the part.
    if (v.swing < 0) this.angle += dt * TURN;
    const target = v.swing < 0 ? this.angle : v.yaw + Math.sin(this.clock * 0.5) * v.swing;
    this.yaw += (target - this.yaw) * (v.swing < 0 ? 1 : k);
    if (v.swing >= 0) this.angle = this.yaw;
    if (this.holdYaw !== null) this.yaw = this.holdYaw;
    this.turntable.rotation.y = this.yaw;
    this.place();
  }

  private place(): void {
    const w = innerWidth, h = innerHeight;
    const c = this.camera;
    if (c.aspect !== w / h || !c.view) {
      c.aspect = w / h;
      // A lens shift puts him at SPOT, not in the middle under the list.
      c.setViewOffset(w, h, (0.5 - SPOT.x) * w, (0.5 - SPOT.y) * h, w, h);
    }
    const dist = this.span / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // The aim is on him, so it turns with him: the camera follows the part as he swings.
    _at.copy(this.aim).applyAxisAngle(_up, this.yaw);
    c.position.set(_at.x, _at.y + this.span * 0.06, _at.z + dist);
    c.lookAt(_at);
  }

  private async load(): Promise<void> {
    const lib = this.lib;
    try {
      await lib.load([ARCHETYPE]);
      const material = await lib.plainMaterial?.(ARCHETYPE);
      if (this.disposed) return;
      const body = lib.spawn(ARCHETYPE) as Character;
      if (material) body.mesh.material = material;
      body.mesh.frustumCulled = false;
      body.mesh.castShadow = false;
      pose(body);
      dressBody(body, this.worn);
      this.turntable.add(body.root);
      this.body = body;
    } catch (e) {
      console.warn('[shop] the contractor did not load; the implants page shows no body', e);
    }
  }

  /** A studio's reflections, so the steel and the glass have something in them. Made once. */
  private environment(): void {
    const renderer = this.renderHook.renderer;
    if (this.env || !renderer) return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.7;
  }

  dispose(): void {
    this.active = false;
    this.disposed = true;
    if (this.body) {
      undressBody(this.body);
      this.body.mesh.material = this.body.a.material;
      this.body.release();
      this.lib.unload?.(ARCHETYPE);
      this.body = null;
    }
    this.env?.dispose();
    this.env = null;
  }
}

/** Standing easy: arms a little off the body and bent at the elbow, the left forearm turned to show its back. */
function pose(body: Character): void {
  const b = body.bones;
  const q = (i: number, x: number, y: number, z: number) => b[i]!.quaternion.setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
  q(H.upperArmR, 0.05, 0, -0.12);
  q(H.upperArmL, 0.05, 0, 0.12);
  q(H.foreArmR, -0.42, 0, 0);
  q(H.foreArmL, -0.42, 0, 0);
  q(H.handL, 0, 0.2, 0);
  q(H.head, 0.06, 0, 0);
  q(H.thighL, 0, 0, 0.04);
  q(H.thighR, 0, 0, -0.04);
  body.root.updateMatrixWorld(true);
}

/** Near black at the edges, a dim steel pool behind him. */
function studioBackground(): THREE.Texture | THREE.Color {
  if (typeof document === 'undefined') return new THREE.Color(0x07090c);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 144;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(256 * SPOT.x, 144 * SPOT.y, 4, 256 * SPOT.x, 144 * SPOT.y, 190);
  grad.addColorStop(0, '#26313b');
  grad.addColorStop(0.45, '#10161c');
  grad.addColorStop(1, '#040507');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 144);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
