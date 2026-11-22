/**
 * Live 3D studio turntable preview of the player's Distraint Frame loadout (`frameLoadout.ts`).
 *
 * Reuses the real Frame exterior builders (`StandIn` from `src/frame/cockpit.ts` and `ArmRack` from `src/frame/arms.ts`)
 * inside a self-contained Bureau studio WebGLRenderer so every arm, shoulder (1–3), leg, cockpit, and engine swap
 * updates the 3D mech live. Turns slowly (~0.35 rad/s) and supports mouse/pointer drag to inspect from any angle.
 *
 * All WebGL resources (renderer, PMREM environment, geometries, materials, DOM listeners) are disposed cleanly on
 * `dispose()` when leaving the loadout screen. Degrades gracefully in headless or non-WebGL environments.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ctx } from '../../core/contracts';
import { ArmRack } from '../../frame/arms';
import { FRAME_PLACES, StandIn } from '../../frame/cockpit';
import { armsOf, defaultLoadout, frameStats, normalizeLoadout, type FrameLoadout } from '../../frame/loadout';
import { ModelMaterials } from '../../progression/modelkit';

/** Default turntable rotation speed in radians per second. */
export const PREVIEW_TURN_SPEED = 0.35;
/** Heroic front-three-quarter starting angle (camera sits on +Z; yaw = PI faces +Z). */
const START_YAW = Math.PI - 0.44;
const FOV = 34;

const _feet = new THREE.Vector3(0, 0, 0);
const _eye = new THREE.Vector3();
const _pivot = new THREE.Vector3();

/** Standalone studio materials stub so `ModelMaterials` works in an isolated preview WebGLRenderer without light-volume shaders. */
function makeStudioMaterials(): ModelMaterials {
  const stub = {
    render: {
      materials: {
        patch: <T extends THREE.MeshStandardMaterial>(m: T): T => m,
      },
    },
  } as unknown as Ctx;
  return new ModelMaterials(stub);
}

/** Dark Bureau studio radial backdrop canvas texture. */
function studioBackdrop(): THREE.Texture | THREE.Color {
  if (typeof document === 'undefined') return new THREE.Color(0x070a0f);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    if (!g) return new THREE.Color(0x070a0f);
    const grad = g.createRadialGradient(128, 118, 12, 128, 128, 168);
    grad.addColorStop(0, '#1e2833');
    grad.addColorStop(0.5, '#0d131a');
    grad.addColorStop(1, '#05070a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch {
    return new THREE.Color(0x070a0f);
  }
}

/** Subtle dark Bureau turntable plinth and calibration rings under the mech's feet. */
function buildTurntable(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'frame.preview.turntable';

  // Matte chamfered plinth disc beneath y = 0.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.45, 3.68, 0.16, 48),
    new THREE.MeshStandardMaterial({ color: '#141920', metalness: 0.55, roughness: 0.65 }),
  );
  disc.position.y = -0.08;
  group.add(disc);

  // Outer Bureau steel trim ring.
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.16, 3.24, 64),
    new THREE.MeshBasicMaterial({ color: '#5c6c7c', transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.004;
  group.add(outerRing);

  // Inner warm amber/crimson tactical alignment ring.
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(2.36, 2.41, 64),
    new THREE.MeshBasicMaterial({ color: '#d85830', transparent: true, opacity: 0.36, side: THREE.DoubleSide }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.005;
  group.add(innerRing);

  // 12 radial azimuth ticks on the turntable surface.
  const tickGeo = new THREE.BoxGeometry(0.05, 0.006, 0.34);
  const tickMat = new THREE.MeshBasicMaterial({ color: '#6b7e90', transparent: true, opacity: 0.42 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(tickGeo, tickMat);
    tick.position.set(Math.sin(a) * 2.82, 0.006, Math.cos(a) * 2.82);
    tick.rotation.y = a;
    group.add(tick);
  }

  return group;
}

export class FramePreview {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 80);
  private renderer: THREE.WebGLRenderer | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private materials: ModelMaterials | null = null;
  private body: StandIn | null = null;
  private rack: ArmRack | null = null;
  private turntable: THREE.Group | null = null;
  private loadout: FrameLoadout = defaultLoadout();
  private yaw = START_YAW;
  private clock = 0;
  private dragging = false;
  private lastX = 0;
  private mounted = false;
  private lastW = 0;
  private lastH = 0;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.canvas?.classList.add('dragging');
    try {
      this.canvas?.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may not support capture.
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.yaw += dx * 0.0095;
  };

  private readonly onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas?.classList.remove('dragging');
  };

  /** True while mounted to a container (even in headless fallback without WebGL). */
  get isMounted(): boolean {
    return this.mounted;
  }

  /** True when a live WebGLRenderer is attached and drawing. */
  get hasWebGL(): boolean {
    return this.renderer !== null;
  }

  /** Current turntable yaw in radians. */
  get angle(): number {
    return this.yaw;
  }

  /** Current loadout built in the preview scene. */
  get currentLoadout(): FrameLoadout {
    return this.loadout;
  }

  /** Mounts the 3D studio scene and WebGL canvas into `container` and builds `loadout`. */
  mount(container: HTMLElement, loadout: FrameLoadout): void {
    if (this.mounted) {
      this.setLoadout(loadout);
      return;
    }
    this.mounted = true;
    this.container = container;
    this.yaw = START_YAW;
    this.clock = 0;
    this.dragging = false;

    this.scene.background = studioBackdrop();
    const key = new THREE.DirectionalLight(0xfff0dc, 3.1);
    key.position.set(-5.5, 9.5, 8.5);
    const rim = new THREE.DirectionalLight(0x7cc8ff, 2.7);
    rim.position.set(7.5, 6.2, -8.0);
    const under = new THREE.DirectionalLight(0xff9648, 0.55);
    under.position.set(1.8, -3.2, 5.2);
    const hemi = new THREE.HemisphereLight(0x9cb4c9, 0x151a22, 0.6);
    this.scene.add(key, rim, under, hemi);

    this.turntable = buildTurntable();
    this.scene.add(this.turntable);

    this.materials = makeStudioMaterials();
    this.body = new StandIn(this.materials, this.scene);
    this.rack = new ArmRack(this.materials, this.scene);

    this.camera.position.set(0, 4.35, 13.8);
    this.camera.lookAt(0, 3.35, 0);

    // Create a dedicated WebGL canvas; degrade gracefully in headless/no-WebGL environments.
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.className = 'fl-canvas';
      canvas.setAttribute('aria-label', '3D Distraint Frame preview');
      container.append(canvas);
      this.canvas = canvas;
      canvas.addEventListener('pointerdown', this.onPointerDown);
      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
      }

      try {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'default' })
          ?? canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'default' });
        if (gl) {
          const renderer = new THREE.WebGLRenderer({
            canvas, context: gl, antialias: true, alpha: false, powerPreference: 'default',
          });
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.08;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          this.renderer = renderer;
          const pmrem = new THREE.PMREMGenerator(renderer);
          const room = new RoomEnvironment();
          this.env = pmrem.fromScene(room, 0.04);
          room.dispose();
          pmrem.dispose();
          this.scene.environment = this.env.texture;
          this.scene.environmentIntensity = 0.82;
        }
      } catch {
        this.renderer = null;
      }
    }

    this.setLoadout(loadout);
    this.update(0);
  }

  /** Rebuilds/swaps the live 3D mech parts immediately to match `loadout`. */
  setLoadout(loadout: FrameLoadout): void {
    this.loadout = normalizeLoadout(loadout);
    if (!this.body || !this.rack) return;
    this.body.setLoadout(this.loadout);
    this.poseMech(0);
  }

  /** Advances turntable spin, handles container resizing, poses animated attachments, and renders one frame. */
  update(dt: number): void {
    if (!this.mounted) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.clock += step;
    if (!this.dragging) {
      this.yaw += step * PREVIEW_TURN_SPEED;
    }
    this.poseMech(step);
    this.resizeIfNeeded();
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private poseMech(dt: number): void {
    if (!this.body || !this.rack) return;
    const stats = frameStats(this.loadout);
    this.body.setPoseState(0, 0, 0, 0, false);
    this.body.pose(_feet, this.yaw, this.yaw, this.clock * 0.4, 0, 0, 0, false, _eye, {
      parked: false,
      jets: false,
      cracks: 0,
      flying: false,
      jetMode: false,
      hover: stats.drive === 'hover',
      treads: stats.gait === 'treads',
      dt,
    });
    if (this.turntable) {
      this.turntable.rotation.y = this.yaw;
    }

    const arms = armsOf(this.loadout);
    const left = this.rack.gun('left', arms.left);
    const right = this.rack.gun('right', arms.right);
    this.rack.only(left, right);
    this.body.place(FRAME_PLACES.rotary, _pivot);
    left.snap(this.yaw, -0.06);
    left.point(_pivot, this.yaw, -0.06, 0);
    this.body.place(FRAME_PLACES.cannon, _pivot);
    right.snap(this.yaw, -0.06);
    right.point(_pivot, this.yaw, -0.06, 0);
  }

  private resizeIfNeeded(): void {
    if (!this.renderer || !this.container) return;
    const w = Math.max(1, Math.round(this.container.clientWidth || 640));
    const h = Math.max(1, Math.round(this.container.clientHeight || 420));
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Disposes WebGLRenderer, PMREM environment, scene geometries/materials, and DOM listeners cleanly. */
  dispose(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.dragging = false;

    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.remove();
      this.canvas = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
    }

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material) materials.add(m);
        } else {
          materials.add(mesh.material);
        }
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();

    if (this.scene.background && (this.scene.background as THREE.Texture).isTexture) {
      (this.scene.background as THREE.Texture).dispose();
    }
    this.scene.background = null;
    this.scene.environment = null;
    this.scene.clear();

    if (this.env) {
      this.env.dispose();
      this.env = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.materials = null;
    this.body = null;
    this.rack = null;
    this.turntable = null;
    this.container = null;
    this.lastW = 0;
    this.lastH = 0;
  }
}
