/**
 * Live 3D studio turntable preview of the player's Distraint Frame loadout (`frameLoadout.ts`).
 *
 * Reuses the real Frame exterior builders (`StandIn` from `src/frame/cockpit.ts` and `ArmRack` from `src/frame/arms.ts`)
 * inside a self-contained Bureau hangar studio WebGLRenderer so every chassis, head, arm, shoulder (1–3), leg, engine,
 * and paint/custom livery swap updates the 3D mech live.
 *
 * Supports pointer drag-to-orbit (azimuth + elevation), scroll-wheel zoom, and subtle living idle animations
 * (hover-skirt bobbing, ignited plasma sword blades, projected energy shields, and palette-synced turntable lighting).
 *
 * All WebGL resources (renderer, PMREM environment, geometries, materials, DOM listeners) are disposed cleanly on
 * `dispose()` when leaving the loadout screen. Degrades gracefully in headless or non-WebGL environments.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { ArmRack } from '../../frame/arms';
import { StandIn } from '../../frame/cockpit';
import {
  armsOf, defaultLoadout, frameStats, normalizeLoadout, paintOf,
  type ArmKind, type FrameLoadout,
} from '../../frame/loadout';
import { resolvePalette } from '../../frame/models/palette';
import { ModelMaterials } from '../../progression/modelkit';
import type { Gun } from '../../vehicles/guns';

/** Default turntable rotation speed in radians per second. */
export const PREVIEW_TURN_SPEED = 0.35;
/** Heroic front-three-quarter starting angle (camera sits on +Z; yaw = PI faces +Z). */
const START_YAW = Math.PI - 0.44;
const DEFAULT_PITCH = 0.08;
const MIN_PITCH = -0.16;
const MAX_PITCH = 0.44;
const DEFAULT_ZOOM = 15.8;
const MIN_ZOOM = 8.2;
const MAX_ZOOM = 24.0;
const TARGET_Y = 3.45;
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

/** Dark Bureau hangar studio radial backdrop canvas texture. */
function studioBackdrop(): THREE.Texture | THREE.Color {
  if (typeof document === 'undefined') return new THREE.Color(0x070a0f);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    if (!g) return new THREE.Color(0x070a0f);
    const grad = g.createRadialGradient(128, 112, 10, 128, 128, 176);
    grad.addColorStop(0, '#1f2b38');
    grad.addColorStop(0.48, '#0d141d');
    grad.addColorStop(1, '#05070b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch {
    return new THREE.Color(0x070a0f);
  }
}

interface TurntableRig {
  group: THREE.Group;
  accentMat: THREE.MeshBasicMaterial;
}

/** Reflective industrial Bureau turntable plinth and calibration rings under the mech's feet. */
function buildTurntable(): TurntableRig {
  const group = new THREE.Group();
  group.name = 'frame.preview.turntable';

  // Reflective dark machined steel plinth disc beneath y = 0.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.65, 3.92, 0.18, 64),
    new THREE.MeshStandardMaterial({ color: '#141a22', metalness: 0.74, roughness: 0.30 }),
  );
  disc.position.y = -0.09;
  group.add(disc);

  // Machined inner deck inlay with subtle specular sheen.
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(2.96, 2.96, 0.02, 64),
    new THREE.MeshStandardMaterial({ color: '#0d1218', metalness: 0.82, roughness: 0.24 }),
  );
  deck.position.y = -0.004;
  group.add(deck);

  // Outer Bureau steel bevel rim ring.
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.42, 3.52, 64),
    new THREE.MeshBasicMaterial({ color: '#6b7e92', transparent: true, opacity: 0.52, side: THREE.DoubleSide }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.008;
  group.add(outerRing);

  // Inner palette-synced tactical alignment glow ring.
  const accentMat = new THREE.MeshBasicMaterial({
    color: '#ff5a14', transparent: true, opacity: 0.48, side: THREE.DoubleSide,
  });
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(2.44, 2.51, 64), accentMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.01;
  group.add(innerRing);

  // Fine center calibration hairline ring.
  const hairRing = new THREE.Mesh(
    new THREE.RingGeometry(1.52, 1.55, 48),
    new THREE.MeshBasicMaterial({ color: '#55d8ff', transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  hairRing.rotation.x = -Math.PI / 2;
  hairRing.position.y = 0.009;
  group.add(hairRing);

  // 12 radial azimuth ticks + 4 stronger cardinal markers on the turntable surface.
  const tickGeo = new THREE.BoxGeometry(0.055, 0.008, 0.38);
  const majorGeo = new THREE.BoxGeometry(0.11, 0.01, 0.48);
  const tickMat = new THREE.MeshBasicMaterial({ color: '#788ca0', transparent: true, opacity: 0.45 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const major = i % 3 === 0;
    const tick = new THREE.Mesh(major ? majorGeo : tickGeo, tickMat);
    tick.position.set(Math.sin(a) * 2.98, 0.01, Math.cos(a) * 2.98);
    tick.rotation.y = a;
    group.add(tick);
  }

  return { group, accentMat };
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
  private accentRingMat: THREE.MeshBasicMaterial | null = null;
  private loadout: FrameLoadout = defaultLoadout();
  private yaw = START_YAW;
  private orbitPitch = DEFAULT_PITCH;
  private zoom = DEFAULT_ZOOM;
  private clock = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private mounted = false;
  private lastW = 0;
  private lastH = 0;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
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
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw += dx * 0.0095;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.0055, MIN_PITCH, MAX_PITCH);
  };

  private readonly onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas?.classList.remove('dragging');
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault?.();
    this.zoom = clamp(this.zoom + e.deltaY * 0.01, MIN_ZOOM, MAX_ZOOM);
  };

  private readonly onDoubleClick = (): void => {
    this.orbitPitch = DEFAULT_PITCH;
    this.zoom = DEFAULT_ZOOM;
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

  /** Current camera orbit distance in metres. */
  get distance(): number {
    return this.zoom;
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
    this.orbitPitch = DEFAULT_PITCH;
    this.zoom = DEFAULT_ZOOM;
    this.clock = 0;
    this.dragging = false;

    this.scene.background = studioBackdrop();
    // 4-point industrial hangar studio lighting (warm key, cool cyan rim, subtle steel fill, warm deck bounce).
    const key = new THREE.DirectionalLight(0xfff2e0, 3.3);
    key.position.set(-5.8, 9.8, 8.6);
    const rim = new THREE.DirectionalLight(0x6cd0ff, 3.1);
    rim.position.set(7.8, 6.4, -8.2);
    const fill = new THREE.DirectionalLight(0x9cbce0, 0.95);
    fill.position.set(6.4, 3.6, 7.2);
    const under = new THREE.DirectionalLight(0xff9648, 0.65);
    under.position.set(1.6, -3.4, 5.4);
    const hemi = new THREE.HemisphereLight(0xa8c0d6, 0x141a22, 0.72);
    this.scene.add(key, rim, fill, under, hemi);

    const rig = buildTurntable();
    this.turntable = rig.group;
    this.accentRingMat = rig.accentMat;
    this.scene.add(this.turntable);

    this.materials = makeStudioMaterials();
    this.body = new StandIn(this.materials, this.scene);
    this.rack = new ArmRack(this.materials, this.scene);

    this.updateCamera(0);

    // Create a dedicated WebGL canvas; degrade gracefully in headless/no-WebGL environments.
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.className = 'fl-canvas';
      canvas.setAttribute('aria-label', '3D Distraint Frame preview');
      container.append(canvas);
      this.canvas = canvas;
      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      canvas.addEventListener('dblclick', this.onDoubleClick);
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
          renderer.toneMappingExposure = 1.1;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          this.renderer = renderer;
          const pmrem = new THREE.PMREMGenerator(renderer);
          const room = new RoomEnvironment();
          this.env = pmrem.fromScene(room, 0.04);
          room.dispose();
          pmrem.dispose();
          this.scene.environment = this.env.texture;
          this.scene.environmentIntensity = 0.88;
        }
      } catch {
        this.renderer = null;
      }
    }

    this.setLoadout(loadout);
    this.update(0);
  }

  /** Rebuilds/swaps the live 3D mech parts and paint livery immediately to match `loadout`. */
  setLoadout(loadout: FrameLoadout): void {
    this.loadout = normalizeLoadout(loadout);
    if (!this.body || !this.rack) return;
    const palette = resolvePalette(paintOf(this.loadout), this.loadout.customPaint);
    this.rack.setPalette(palette);
    this.body.setLoadout(this.loadout);
    if (this.accentRingMat) {
      this.accentRingMat.color.set(palette.glow);
    }
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

  private updateCamera(hoverHeight: number): void {
    const focusY = TARGET_Y + hoverHeight * 0.45;
    const horiz = Math.cos(this.orbitPitch) * this.zoom;
    const vert = Math.sin(this.orbitPitch) * this.zoom;
    this.camera.position.set(0, focusY + vert, horiz);
    this.camera.lookAt(0, focusY, 0);
  }

  private animatePreviewArm(gun: Gun, kind: ArmKind): void {
    if (kind === 'sword') {
      // Ignite plasma blade on the turntable so the glowing broadsword reads immediately.
      gun.setActive(0.85 + 0.06 * Math.sin(this.clock * 3.4), 0);
    } else if (kind === 'shield') {
      // Project faceted translucent energy barrier gently in preview.
      gun.setActive(0.65 + 0.05 * Math.sin(this.clock * 2.4), 0);
    } else {
      gun.setActive(0, 0);
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
      hoverHeight: stats.hoverHeight,
      treads: stats.gait === 'treads',
      dt,
    });
    this.updateCamera(stats.hoverHeight);
    if (this.turntable) {
      this.turntable.rotation.y = this.yaw;
    }

    const arms = armsOf(this.loadout);
    const left = this.rack.gun('left', arms.left);
    const right = this.rack.gun('right', arms.right);
    this.rack.only(left, right);
    this.animatePreviewArm(left, arms.left);
    this.animatePreviewArm(right, arms.right);

    const places = this.body.places;
    this.body.place(places.leftArm, _pivot);
    left.snap(this.yaw, -0.06);
    left.point(_pivot, this.yaw, -0.06, 0);
    this.body.place(places.rightArm, _pivot);
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
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('dblclick', this.onDoubleClick);
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
    this.accentRingMat = null;
    this.container = null;
    this.lastW = 0;
    this.lastH = 0;
  }
}
