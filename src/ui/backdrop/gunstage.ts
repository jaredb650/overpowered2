/**
 * The Crucible shop's picture: the gun on the row in focus, turning slowly in a lit studio, drawn by the renderer in place of
 * the world (`Renderer.backdrop`) while the menu is up, as the main menu's cabin is. The gun is the first-person model itself
 * (the rig's `allDefs`), posed at rest and cloned, so it shares the model's geometry and materials and costs no new build. A mod
 * shows on its gun as it does in the hands: its part, shown or hidden on the clone.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ctx } from '../../core/contracts';
import type { ModId, WeaponId } from '../../core/gameplay';
import type { Backdrop } from '../../render/Renderer';
import { WEAPONS } from '../../weapons/data';
import { Anim, ironsUp, type ViewDef } from '../../weapons/viewmodels/def';

interface RendererHook {
  backdrop: Backdrop | null;
  renderer?: THREE.WebGLRenderer;
}

/** Radians a second the gun turns. */
const TURN = 0.42;
/** Where the gun sits on the screen, as a share of its width and height from the top left: right of the list, above the card. */
const SPOT = { x: 0.665, y: 0.36 } as const;
/** The share of the screen's width the gun's length takes. */
const SPAN = 0.4;
const FOV = 26;

export class GunStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.01, 50);
  private readonly hook: Backdrop = { scene: this.scene, camera: this.camera, still: false };
  private readonly turntable = new THREE.Group();
  private readonly clones = new Map<WeaponId, { root: THREE.Object3D; size: number }>();
  private shown: WeaponId | null = null;
  private angle = 0;
  private env: THREE.WebGLRenderTarget | null = null;
  private on = false;

  constructor(private readonly ctx: Ctx) {
    this.scene.background = backdropTexture();
    const key = new THREE.DirectionalLight(0xfff1de, 3.2);
    key.position.set(-1.2, 1.6, 2);
    const rim = new THREE.DirectionalLight(0x8fd4ff, 2.2);
    rim.position.set(1.5, 0.8, -2);
    const under = new THREE.DirectionalLight(0xffb070, 0.5);
    under.position.set(0.4, -1.2, 1);
    this.scene.add(key, rim, under, new THREE.AmbientLight(0x9db0bd, 0.25), this.turntable);
    this.turntable.rotation.x = 0.12;
  }

  private get renderHook(): RendererHook {
    return this.ctx.render as unknown as RendererHook;
  }

  /** Puts the studio up in place of the world, or takes it down. */
  set active(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) this.environment();
    const hook = this.renderHook;
    if (on) hook.backdrop = this.hook;
    else if (hook.backdrop === this.hook) hook.backdrop = null;
  }

  /** The gun on the turntable, with `mods` fitted on it (and its other mods off). Starts side on. */
  show(id: WeaponId, mods: ReadonlySet<ModId>): void {
    const def = this.defs()[id];
    if (!def) return;
    if (this.shown !== id) {
      this.turntable.clear();
      const c = this.clone(id, def);
      this.turntable.add(c.root);
      this.shown = id;
      this.angle = 0;
      this.frame(c.size);
    }
    const root = this.clones.get(id)!.root;
    for (const [mod, look] of Object.entries(def.mods ?? {})) {
      const part = root.getObjectByName(look.part);
      if (part) part.visible = mods.has(mod as ModId);
      const own = look.hides ? root.getObjectByName(look.hides) : undefined;
      if (own) own.visible = !mods.has(mod as ModId);
      const moved = look.moves ? root.getObjectByName(look.moves.part) : undefined;
      if (moved) moved.position.z = (moved.userData.restZ ??= moved.position.z) + (mods.has(mod as ModId) ? look.moves!.z : 0);
    }
    const irons = def.irons ? root.getObjectByName(def.irons) : undefined;
    if (irons) irons.visible = ironsUp(def, mods);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.angle += dt * TURN;
    // Side on, muzzle to the right, then round.
    this.turntable.rotation.y = -Math.PI / 2 + this.angle;
    this.aspect();
  }

  private defs(): Record<string, ViewDef> {
    return (this.ctx.viewmodel as unknown as { allDefs?: Record<string, ViewDef> }).allDefs ?? {};
  }

  /** The model at rest (a full magazine, no shot, no reload), cloned once and centred on the turntable. */
  private clone(id: WeaponId, def: ViewDef): { root: THREE.Object3D; size: number } {
    const have = this.clones.get(id);
    if (have) return have;
    const a = new Anim();
    a.parts = def.model.parts;
    a.model = def.model;
    a.mag = a.magSize = Math.max(1, WEAPONS[id].magSize);
    a.reserve = WEAPONS[id].reserve;
    def.model.resetParts();
    def.animate(a);
    const copy = def.model.root.clone();
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
    const out = { root: holder, size: Math.max(size.x, size.y, size.z) };
    this.clones.set(id, out);
    return out;
  }

  /** Back far enough that the gun's length is `SPAN` of the screen's width, whatever the gun. */
  private frame(size: number): void {
    this.aspect();
    const halfW = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * this.camera.aspect;
    const dist = size / 2 / (halfW * SPAN);
    this.camera.position.set(0, size * 0.08, dist);
    this.camera.lookAt(0, 0, 0);
  }

  /** The canvas's aspect, and a lens shift that puts the gun at `SPOT` and not in the middle under the list. */
  private aspect(): void {
    const w = innerWidth, h = innerHeight;
    const c = this.camera;
    if (c.aspect !== w / h || !c.view) {
      c.aspect = w / h;
      c.setViewOffset(w, h, (0.5 - SPOT.x) * w, (0.5 - SPOT.y) * h, w, h);
    }
  }

  /** A studio's reflections, so the steel and the chrome have something in them. Made once, the first time it is shown. */
  private environment(): void {
    const renderer = this.renderHook.renderer;
    if (this.env || !renderer) return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.85;
  }
}

/** Near black at the edges, a dim steel pool behind the gun. */
function backdropTexture(): THREE.Texture | THREE.Color {
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
