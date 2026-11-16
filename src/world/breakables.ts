/**
 * Props that break: monitors, chairs, plants, cubicle dividers, glass, and the things in an office that go off in a shootout (copiers,
 * server racks, water coolers, extinguishers, vending machines, microwaves, a generator, a gas line). A map places them as
 * `MapSpec.breakables`; `world/objects.ts` owns this, so a bullet (`hit`), a blast (`blast`) and a chain reach them as they reach a barrel.
 *
 * Each kind is one instanced mesh per material while whole and one for its wreck, so a floor of two hundred props is a few dozen draws.
 * Colliders go up after the nav sample (`attach`), as walls do: a prop that blocks a way (glass, a divider, a rack, a copier) marks its
 * nav nodes and clears them when it goes. Explosions raise 'world:explosion' like a barrel, so Combat hurts enemies and the player and
 * throws bodies; a beat later they hurt the world objects in reach, which is the chain.
 *
 * Caps for an 8 GB machine: CHAIRS chairs tumbling at once (the oldest settles where it is), CHAIN queued blasts, one burning-wreck
 * spark every SPARK_EVERY seconds, and the flying pieces share a capped debris pool. Wrecks stay for the run.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type SurfaceKind } from '../core/contracts';
import { groups } from '../physics/Physics';
import { Debris, type DebrisMat } from './debris';
import { Geo, type Mat } from './kit/geo';
import type { BreakableSpec, BreakKind } from './map/spec';
import type { NavGraph } from './nav';

type Rgb = readonly [number, number, number];

export const BreakTuning = {
  /** Chairs tumbling at once. */
  chairs: 24,
  /** Queued chain blasts. */
  chain: 64,
  /** Seconds between sparks off any burning wreck. */
  sparkEvery: 0.4,
  /** Seconds a burnt rack keeps sparking. */
  burn: 20,
  /** Seconds before a blast reaches the next prop: a row of racks ripples instead of popping at once. */
  chainDelay: 0.14,
  /** Share of a blast that reaches a prop behind a wall. */
  throughWall: 0.15,
};

interface Boom { radius: number; damage: number; sound: string; flash: number; fire: boolean; scale: number }

interface KindDef {
  hp: number;
  /** Share of a blast's damage it takes. */
  blast: number;
  /** Collider half extents and centre height, in the prop's frame. Dividers and panes scale x by width and y by height. */
  half: readonly [number, number, number];
  cy: number;
  surface: SurfaceKind;
  /** Marks its nav nodes while it stands. */
  blocks: boolean;
  /** Keeps its collider (and its nav block) as a wreck. */
  keep: boolean;
  wreck: boolean;
  boom?: Boom;
  /** At this share of its health it starts sparking. */
  sparkAt?: number;
  sound: string;
  pitch?: number;
}

const KINDS: Record<BreakKind, KindDef> = {
  monitor: { hp: 12, blast: 1, half: [0.28, 0.22, 0.09], cy: 0.24, surface: 'metal', blocks: false, keep: false, wreck: true, sound: 'electric_zap' },
  chair: { hp: 60, blast: 0.4, half: [0.3, 0.45, 0.3], cy: 0.45, surface: 'metal', blocks: false, keep: false, wreck: false, sound: 'metal_clang', pitch: 1.4 },
  plant: { hp: 10, blast: 1, half: [0.24, 0.6, 0.24], cy: 0.6, surface: 'dirt', blocks: false, keep: false, wreck: true, sound: 'frozen_shatter', pitch: 0.7 },
  divider: { hp: 30, blast: 1, half: [0.5, 0.5, 0.035], cy: 0.5, surface: 'concrete', blocks: true, keep: false, wreck: false, sound: 'body_thud', pitch: 1.2 },
  pane: { hp: 8, blast: 2, half: [0.5, 0.5, 0.02], cy: 0, surface: 'glass', blocks: true, keep: false, wreck: false, sound: 'glass_break' },
  microwave: {
    hp: 20, blast: 1, half: [0.26, 0.16, 0.19], cy: 0.16, surface: 'metal', blocks: false, keep: true, wreck: true, sound: 'electric_zap',
    boom: { radius: 2, damage: 20, sound: 'explosion_small', flash: 18, fire: true, scale: 0.35 },
  },
  cooler: {
    hp: 20, blast: 1, half: [0.18, 0.65, 0.18], cy: 0.65, surface: 'metal', blocks: false, keep: false, wreck: true, sound: 'steam_burst',
    boom: { radius: 2.5, damage: 25, sound: 'steam_burst', flash: 0, fire: false, scale: 0 },
  },
  extinguisher: {
    hp: 15, blast: 1, half: [0.1, 0.3, 0.1], cy: 0, surface: 'metal', blocks: false, keep: false, wreck: false, sound: 'steam_burst',
    boom: { radius: 3, damage: 35, sound: 'steam_burst', flash: 0, fire: false, scale: 0 },
  },
  copier: {
    hp: 60, blast: 1, half: [0.55, 0.6, 0.4], cy: 0.6, surface: 'metal', blocks: true, keep: true, wreck: true, sound: 'electric_zap', sparkAt: 0.5,
    boom: { radius: 4.5, damage: 70, sound: 'explosion_barrel', flash: 50, fire: true, scale: 1.1 },
  },
  rack: {
    hp: 70, blast: 1, half: [0.4, 1.05, 0.5], cy: 1.05, surface: 'metal', blocks: true, keep: true, wreck: true, sound: 'electric_zap', sparkAt: 0.5,
    boom: { radius: 5, damage: 100, sound: 'explosion_barrel', flash: 60, fire: true, scale: 1.2 },
  },
  vending: {
    hp: 90, blast: 1, half: [0.5, 0.95, 0.45], cy: 0.95, surface: 'metal', blocks: true, keep: true, wreck: true, sound: 'electric_zap', sparkAt: 0.5,
    boom: { radius: 5, damage: 110, sound: 'explosion_barrel', flash: 70, fire: true, scale: 1.4 },
  },
  generator: {
    hp: 100, blast: 1, half: [1.4, 0.8, 0.7], cy: 0.8, surface: 'metal', blocks: true, keep: true, wreck: true, sound: 'metal_groan', sparkAt: 0.5,
    boom: { radius: 9, damage: 160, sound: 'explosion_tank', flash: 100, fire: true, scale: 2.2 },
  },
  gasline: {
    hp: 40, blast: 1, half: [0.22, 0.6, 0.16], cy: 0.6, surface: 'metal', blocks: false, keep: false, wreck: true, sound: 'steam_burst',
    boom: { radius: 7, damage: 120, sound: 'explosion_barrel', flash: 80, fire: true, scale: 1.4 },
  },
};

// -------------------------------------------------------------------------------------------------
// Models. Front is local +z, the foot at the origin (a pane's and an extinguisher's middle). Built from a few materials so a
// kind is one or two draws; `wreck` is the same thing burnt, broken or knocked over.
// -------------------------------------------------------------------------------------------------

type Model = (g: Geo, wreck: boolean) => void;
/** Tints are written as picked by eye (sRGB); vertex colours are linear. */
const lin = (v: number): number => v ** 2.2;
const tint = (g: Geo, r: number, gr = r, b = r): Geo => g.tint(lin(r), lin(gr), lin(b));
const B = (g: Geo, mat: Mat, c: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.015) => {
  tint(g.use(mat), c[0], c[1], c[2]);
  g.bevel((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bev);
};
const burnt = (c: Rgb, w: boolean): Rgb => (w ? [c[0] * 0.22, c[1] * 0.2, c[2] * 0.2] : c);
const PLASTIC: Rgb = [0.12, 0.13, 0.15];
const BEIGE: Rgb = [0.78, 0.76, 0.7];
const CANS: readonly Rgb[] = [[0.8, 0.1, 0.1], [0.1, 0.4, 0.8], [0.9, 0.7, 0.1], [0.2, 0.7, 0.3]];

const MODELS: Record<BreakKind, Model> = {
  monitor(g, w) {
    if (w) g.push(0, 0.02, -0.05, 0, -1.2, 0.15);
    B(g, 'plaster', PLASTIC, -0.28, 0.12, -0.03, 0.28, 0.46, 0.03);
    B(g, 'plaster', PLASTIC, -0.04, 0, -0.06, 0.04, 0.14, 0);
    B(g, 'plaster', PLASTIC, -0.14, 0, -0.12, 0.14, 0.015, 0.06, 0.005);
    if (w) { B(g, 'plaster', [0.05, 0.05, 0.06], -0.25, 0.15, 0.03, 0.25, 0.43, 0.034, 0); g.pop(); return; }
    g.use('screen').tint(1).box(0, 0.29, 0.031, 0.25, 0.14, 0.002);
  },
  chair(g) {
    B(g, 'plaster', PLASTIC, -0.26, 0.42, -0.24, 0.26, 0.5, 0.24, 0.03);
    B(g, 'plaster', PLASTIC, -0.24, 0.55, -0.28, 0.24, 1.0, -0.22, 0.03);
    B(g, 'plaster', [0.3, 0.32, 0.36], -0.03, 0.08, -0.03, 0.03, 0.42, 0.03, 0.01);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.push(Math.sin(a) * 0.14, 0.04, Math.cos(a) * 0.14, -a);
      B(g, 'plaster', [0.3, 0.32, 0.36], -0.02, -0.03, -0.14, 0.02, 0.02, 0.14, 0.005);
      g.pop();
    }
  },
  plant(g, w) {
    if (w) {
      B(g, 'plaster', [0.32, 0.22, 0.14], -0.32, 0, -0.28, 0.3, 0.08, 0.3, 0.04);
      B(g, 'plaster', [0.62, 0.32, 0.2], -0.2, 0, 0.1, 0.02, 0.12, 0.24, 0.02);
      for (let i = 0; i < 4; i++) B(g, 'plaster', [0.14, 0.34, 0.16], -0.5 + i * 0.12, 0.04, -0.1 + i * 0.05, -0.2 + i * 0.12, 0.12, 0.02 + i * 0.05, 0.04);
      return;
    }
    tint(g.use('plaster'), 0.66, 0.34, 0.2).lathe([0.16, 0, 0.22, 0.42, 0.24, 0.46, 0, 0.46], 0, 0, 0, 10, false);
    tint(g.use('plaster'), 0.12, 0.36, 0.16);
    for (const [x, y, z, r] of [[0, 0.8, 0, 0.26], [0.12, 1.02, 0.05, 0.18], [-0.1, 0.98, -0.06, 0.2], [0.02, 1.16, -0.02, 0.14]] as const) g.bevel(x, y, z, r, r * 1.1, r, r * 0.45);
    tint(g.use('plaster'), 0.3, 0.22, 0.14).box(0, 0.62, 0, 0.02, 0.18, 0.02);
  },
  divider(g) {
    // A unit panel, scaled to the run: fabric over a frame, a rail on top.
    B(g, 'plaster', [0.36, 0.42, 0.5], -0.5, 0, -0.03, 0.5, 1, 0.03, 0.01);
    B(g, 'plaster', [0.62, 0.64, 0.68], -0.5, 0.97, -0.035, 0.5, 1, 0.035, 0.004);
  },
  pane(g) {
    tint(g.use('glass'), 1).box(0, 0, 0, 0.5, 0.5, 0.012);
  },
  microwave(g, w) {
    B(g, 'plaster', burnt([0.86, 0.86, 0.84], w), -0.26, 0, -0.19, 0.26, 0.31, 0.19, 0.02);
    B(g, 'plaster', w ? [0.04, 0.03, 0.03] : [0.08, 0.09, 0.1], -0.22, 0.04, 0.19, 0.1, 0.27, 0.2, 0);
    if (!w) tint(g.use('emissiveOrange'), 0.4).box(0.17, 0.22, 0.195, 0.05, 0.02, 0.005);
  },
  cooler(g, w) {
    B(g, 'plaster', [0.88, 0.88, 0.9], -0.17, 0, -0.17, 0.17, 0.95, 0.17, 0.03);
    B(g, 'plaster', [0.2, 0.2, 0.22], -0.08, 0.7, 0.17, 0.08, 0.76, 0.2, 0.01);
    if (w) { B(g, 'plaster', [0.5, 0.7, 0.86], -0.15, 0.95, -0.12, 0.1, 1.05, 0.14, 0.03); return; }
    tint(g.use('glass'), 1).lathe([0, 0.95, 0.15, 0.97, 0.16, 1.2, 0.14, 1.3, 0.05, 1.33, 0, 1.33], 0, 0, 0, 10, true);
  },
  extinguisher(g) {
    tint(g.use('paintRed'), 1).lathe([0, -0.28, 0.09, -0.27, 0.09, 0.2, 0.06, 0.26, 0, 0.27], 0, 0, 0, 10, true);
    B(g, 'plaster', PLASTIC, -0.02, 0.24, -0.02, 0.06, 0.32, 0.02, 0.005);
    B(g, 'plaster', PLASTIC, 0.06, 0.1, -0.015, 0.09, 0.3, 0.015, 0.004);
  },
  copier(g, w) {
    B(g, 'plaster', burnt(BEIGE, w), -0.55, 0, -0.4, 0.55, 0.95, 0.4, 0.03);
    B(g, 'plaster', burnt([0.62, 0.62, 0.6], w), -0.5, 0.95, -0.38, 0.5, 1.12, 0.36, 0.02);
    B(g, 'plaster', burnt([0.9, 0.9, 0.88], w), -0.4, 1.12, -0.32, 0.3, 1.18, 0.3, 0.01);
    for (let i = 0; i < 3; i++) B(g, 'plaster', burnt([0.7, 0.7, 0.68], w), -0.5, 0.12 + i * 0.25, 0.4, 0.5, 0.33 + i * 0.25, 0.42, 0.005);
    B(g, 'plaster', burnt([0.9, 0.9, 0.86], w), 0.55, 0.6, -0.25, 0.85, 0.64, 0.25, 0.005);
    if (!w) tint(g.use('emissiveCyan'), 0.5).box(0.32, 1.13, 0.3, 0.12, 0.02, 0.05);
  },
  rack(g, w) {
    B(g, 'plaster', burnt([0.12, 0.13, 0.15], w), -0.4, 0, -0.5, 0.4, 2.1, 0.5, 0.02);
    for (let i = 0; i < 12; i++) {
      B(g, 'plaster', burnt([0.22, 0.24, 0.28], w), -0.36, 0.12 + i * 0.16, 0.48, 0.36, 0.25 + i * 0.16, 0.51, 0.004);
    }
    if (w) return;
    tint(g.use('emissiveCyan'), 0.6);
    for (let i = 0; i < 12; i++) g.box(-0.3, 0.18 + i * 0.16, 0.512, 0.02, 0.012, 0.002);
    tint(g.use('emissiveRed'), 0.6);
    for (let i = 0; i < 12; i += 3) g.box(0.28, 0.2 + i * 0.16, 0.512, 0.015, 0.012, 0.002);
  },
  vending(g, w) {
    B(g, 'plaster', burnt([0.62, 0.08, 0.1], w), -0.5, 0, -0.45, 0.5, 1.9, 0.45, 0.03);
    B(g, 'plaster', w ? [0.03, 0.03, 0.03] : [0.08, 0.09, 0.12], -0.42, 0.55, 0.45, 0.2, 1.75, 0.47, 0.005);
    if (w) return;
    g.use('emissiveDim').tint(1).box(-0.11, 1.15, 0.471, 0.3, 0.58, 0.002);
    tint(g.use('emissiveCyan'), 0.5).box(0.33, 1.4, 0.46, 0.1, 0.25, 0.012);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      B(g, 'plaster', CANS[c]!, -0.38 + c * 0.14, 0.62 + r * 0.22, 0.36, -0.28 + c * 0.14, 0.78 + r * 0.22, 0.44, 0.01);
    }
  },
  generator(g, w) {
    B(g, 'plaster', burnt([0.66, 0.6, 0.12], w), -1.4, 0.12, -0.7, 1.4, 1.5, 0.7, 0.05);
    B(g, 'plaster', burnt([0.3, 0.3, 0.32], w), -1.45, 0, -0.75, 1.45, 0.14, 0.75, 0.02);
    for (let i = 0; i < 10; i++) B(g, 'plaster', burnt([0.2, 0.2, 0.2], w), -1.2 + i * 0.22, 0.4, 0.7, -1.12 + i * 0.22, 1.2, 0.72, 0.005);
    tint(g.use('plaster'), 0.2, 0.2, 0.22).cyl(1.0, 1.5, 0, 1.0, 2.2, 0, 0.1, 0.1, 8);
    if (!w) tint(g.use('emissiveRed'), 0.8).box(-1.1, 1.3, 0.715, 0.06, 0.04, 0.005);
  },
  gasline(g, w) {
    tint(g.use('paintYellow'), w ? 0.25 : 1);
    g.cyl(0, 0, -0.06, 0, w ? 0.7 : 2.4, -0.06, 0.06, 0.06, 8);
    B(g, 'plaster', burnt([0.62, 0.64, 0.66], w), -0.2, 0.75, -0.15, 0.2, 1.15, 0.12, 0.02);
    tint(g.use('paintRed'), w ? 0.2 : 1).cyl(0, 0.5, 0, 0, 0.5, 0.16, 0.13, 0.13, 10);
    if (!w) tint(g.use('emissiveOrange'), 0.5).box(0, 1.05, 0.125, 0.08, 0.04, 0.003);
  },
};

// -------------------------------------------------------------------------------------------------

interface Prop {
  readonly kind: BreakKind;
  readonly def: KindDef;
  readonly spec: BreakableSpec;
  readonly slot: number;
  hp: number;
  alive: boolean;
  sparking: boolean;
  burnUntil: number;
  collider: RAPIER.Collider | null;
  blocked: boolean;
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly s: THREE.Vector3;
  /** A chair tumbling: its body, how long it has been slow, and when it was thrown. */
  body: RAPIER.RigidBody | null;
  still: number;
  thrownAt: number;
}

interface Pending { at: number; c: THREE.Vector3; radius: number; damage: number; source: string }

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _h = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function meshParts(geo: Geo): { mat: Mat; geometry: THREE.BufferGeometry }[] {
  const out: { mat: Mat; geometry: THREE.BufferGeometry }[] = [];
  const byMat = new Map<Mat, { p: number[]; n: number[]; uv: number[]; c: number[]; idx: number[] }>();
  for (const b of geo.buckets.values()) {
    if (b.ni === 0) continue;
    let m = byMat.get(b.mat);
    if (!m) byMat.set(b.mat, (m = { p: [], n: [], uv: [], c: [], idx: [] }));
    const base = m.p.length / 3;
    m.p.push(...b.p.subarray(0, b.nv * 3)); m.n.push(...b.n.subarray(0, b.nv * 3)); m.uv.push(...b.uv.subarray(0, b.nv * 2)); m.c.push(...b.c.subarray(0, b.nv * 4));
    for (let i = 0; i < b.ni; i++) m.idx.push(b.idx[i]! + base);
  }
  for (const [mat, m] of byMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(m.c), 4, true));
    g.setIndex(m.idx);
    out.push({ mat, geometry: g });
  }
  return out;
}

class Look {
  readonly meshes: THREE.InstancedMesh[] = [];
  constructor(root: THREE.Group, model: Model, wreck: boolean, count: number, material: (m: Mat) => THREE.Material, name: string) {
    const geo = new Geo();
    model(geo, wreck);
    for (const p of meshParts(geo)) {
      const mesh = new THREE.InstancedMesh(p.geometry, material(p.mat), count);
      mesh.name = `breakable:${name}${wreck ? ':wreck' : ''}`;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, _hide);
      root.add(mesh);
      this.meshes.push(mesh);
    }
  }
  set(i: number, m: THREE.Matrix4): void {
    for (const mesh of this.meshes) { mesh.setMatrixAt(i, m); mesh.instanceMatrix.needsUpdate = true; }
  }
  /** Bounds over every slot, so a kind that does not move can be culled as a whole. */
  fit(moves: boolean): void {
    for (const mesh of this.meshes) {
      if (moves) mesh.frustumCulled = false;
      else mesh.computeBoundingSphere();
    }
  }
}

export class Breakables {
  readonly root = new THREE.Group();
  readonly props: Prop[] = [];
  private readonly looks = new Map<BreakKind, { whole: Look; wreck: Look | null }>();
  private readonly byCollider = new Map<number, Prop>();
  private readonly moving: Prop[] = [];
  private readonly pending: Pending[] = [];
  private readonly burning: Prop[] = [];
  readonly debris: Debris;
  private nav: NavGraph | null = null;
  private attached = false;
  private time = 0;
  private nextSpark = 0;
  /** Counts for tests and the readout. */
  readonly stats = { broken: 0, booms: 0, chained: 0, dropped: 0 };

  constructor(
    private readonly ctx: Ctx,
    specs: readonly BreakableSpec[],
    material: (m: Mat) => THREE.Material,
    /** Hurts every world object in a radius: Objects.damageExplosivesInRadius. */
    private readonly onBlast: (center: THREE.Vector3, radius: number, damage: number, source: string) => void,
  ) {
    this.root.name = 'breakables';
    this.debris = new Debris(ctx, material, ['plaster', 'glass', 'dirt', 'steelDark']);
    this.root.add(this.debris.root);
    const counts = new Map<BreakKind, number>();
    for (const s of specs) {
      const slot = counts.get(s.kind) ?? 0;
      counts.set(s.kind, slot + 1);
      const def = KINDS[s.kind];
      const q = new THREE.Quaternion().setFromEuler(_e.set(s.flat ? -Math.PI / 2 : 0, s.yaw, 0, 'YXZ'));
      const sc = new THREE.Vector3(s.w ?? 1, s.h ?? 1, 1);
      this.props.push({
        kind: s.kind, def, spec: s, slot, hp: def.hp, alive: true, sparking: false, burnUntil: 0, collider: null, blocked: false,
        p: new THREE.Vector3(s.x, s.y, s.z), q, s: sc, body: null, still: 0, thrownAt: 0,
      });
    }
    for (const [kind, n] of counts) {
      const def = KINDS[kind];
      const whole = new Look(this.root, MODELS[kind], false, n, material, kind);
      const wreck = def.wreck ? new Look(this.root, MODELS[kind], true, n, material, kind) : null;
      this.looks.set(kind, { whole, wreck });
    }
    for (const p of this.props) this.show(p);
    // Wrecks start hidden, so their bounds are unknown: they are never culled. Nothing whole moves but a chair.
    for (const [kind, l] of this.looks) { l.whole.fit(kind === 'chair'); l.wreck?.fit(true); }
    if (specs.length) ctx.physics.radialListeners?.add((c, r, s) => this.shove(c, r, s));
  }

  get count(): number {
    return this.props.length;
  }

  /** Colliders and nav blocks go up after the nav sample, so the floor under a prop stays on the graph. */
  attach(nav: NavGraph | null): void {
    if (this.attached) return;
    this.attached = true;
    this.nav = nav;
    for (const p of this.props) this.stand(p);
  }

  private show(p: Prop): void {
    const l = this.looks.get(p.kind)!;
    _m.compose(p.p, p.q, p.s);
    l.whole.set(p.slot, p.alive ? _m : _hide);
    if (l.wreck) l.wreck.set(p.slot, p.alive ? _hide : _m);
  }

  /** The prop's collider where it stands now, and its nav block. */
  private stand(p: Prop): void {
    const d = p.def;
    _h.set(d.half[0] * p.s.x, d.half[1] * p.s.y, d.half[2]);
    _v.set(0, d.cy * p.s.y, 0).applyQuaternion(p.q).add(p.p);
    p.collider = this.ctx.physics.addStaticBox(_v, _h, p.q, d.surface);
    this.byCollider.set(p.collider.handle, p);
    if (d.blocks && !p.blocked && this.nav) {
      const ux = Math.cos(p.spec.yaw), uz = -Math.sin(p.spec.yaw);
      const flat = p.spec.flat === true;
      // A pane in a wall blocks the cells either side of its line; anything else its footprint and a margin.
      const depth = p.kind === 'pane' ? 0.75 : _h.z + 0.4;
      if (!flat) this.nav.setBlocked(_v.x, _v.z, p.p.y - (p.kind === 'pane' ? _h.y : 0), ux, uz, _h.x + 0.3, depth, true);
      p.blocked = !flat;
    }
  }

  private unstand(p: Prop, clearNav: boolean): void {
    if (p.collider) {
      this.byCollider.delete(p.collider.handle);
      this.ctx.physics.world.removeCollider(p.collider, false);
      p.collider = null;
    }
    if (clearNav && p.blocked && this.nav) {
      const d = p.def;
      _h.set(d.half[0] * p.s.x, d.half[1] * p.s.y, d.half[2]);
      _v.set(0, d.cy * p.s.y, 0).applyQuaternion(p.q).add(p.p);
      const depth = p.kind === 'pane' ? 0.75 : _h.z + 0.4;
      this.nav.setBlocked(_v.x, _v.z, p.p.y - (p.kind === 'pane' ? _h.y : 0), Math.cos(p.spec.yaw), -Math.sin(p.spec.yaw), _h.x + 0.3, depth, false);
      p.blocked = false;
    }
  }

  isProp(collider: RAPIER.Collider | null): boolean {
    return !!collider && this.byCollider.has(collider.handle);
  }

  /** A round, a blade or a flame on one prop. True if it was one. */
  hit(collider: RAPIER.Collider | null, amount: number, source: string): boolean {
    const p = collider ? this.byCollider.get(collider.handle) : undefined;
    if (!p) return false;
    if (p.kind === 'chair') {
      // Away from whoever is shooting: the player, near enough for anyone else.
      _w.subVectors(p.p, this.ctx.player?.position ?? p.p).setY(0);
      if (_w.lengthSq() < 1e-4) _w.set(0, 0, 1);
      _w.normalize().multiplyScalar(Math.min(9, 2 + amount * 0.18)).setY(1.5 + Math.min(4, amount * 0.06));
      this.knock(p, _w);
    }
    this.hurt(p, amount, source);
    return true;
  }

  /**
   * A blast: every prop in reach takes its share. A wall between them takes most of it, so a gas main outside does not set off the
   * server room through the wall.
   */
  blast(center: THREE.Vector3, radius: number, amount: number, source: string): void {
    for (const p of this.props) {
      if (!p.alive) continue;
      const d = p.p.distanceTo(center) - 0.4;
      if (d > radius) continue;
      const share = this.behindWall(p, center) ? BreakTuning.throughWall : 1;
      this.hurt(p, amount * (1 - (Math.max(0, d) / radius) * 0.6) * p.def.blast * share, source);
    }
  }

  /** True if something solid that is not this prop stands between it and `from`. */
  private behindWall(p: Prop, from: THREE.Vector3): boolean {
    _v.set(0, p.def.cy * p.s.y, 0).applyQuaternion(p.q).add(p.p);
    _w.subVectors(_v, from);
    const len = _w.length();
    if (len < 0.5) return false;
    _w.divideScalar(len);
    const hit = this.ctx.physics.raycast(from, _w, len - 0.3, CG.World);
    if (!hit || !hit.collider) return false;
    const other = this.byCollider.get(hit.collider.handle);
    // Another prop in the way still counts as open air: a row of racks goes off down the row.
    return !other;
  }

  /** Physics.radialImpulse's listener: chairs at rest in a blast are thrown out of it. */
  private shove(center: THREE.Vector3, radius: number, strength: number): void {
    if (strength <= 0) return;
    for (const p of this.props) {
      if (p.kind !== 'chair' || !p.alive || p.body) continue;
      const d = p.p.distanceTo(center);
      if (d > radius) continue;
      const speed = Math.min(14, strength * 0.12 * (1 - d / radius));
      if (speed < 1) continue;
      _w.subVectors(p.p, center).setY(0).normalize().multiplyScalar(speed);
      _w.y = speed * 0.6;
      this.knock(p, _w);
    }
  }

  private hurt(p: Prop, amount: number, source: string): void {
    if (!p.alive || amount <= 0) return;
    p.hp -= amount;
    const d = p.def;
    if (p.hp > 0) {
      if (d.sparkAt && !p.sparking && p.hp < d.hp * d.sparkAt) {
        p.sparking = true;
        p.burnUntil = this.time + 30;
        this.burning.push(p);
        this.sparks(p, 14);
        this.ctx.audio.play('electric_zap', { position: _v.copy(p.p).setY(p.p.y + d.cy), volume: 0.7 });
      }
      return;
    }
    this.breakProp(p, source);
  }

  private breakProp(p: Prop, source: string): void {
    const { ctx } = this;
    const d = p.def;
    p.alive = false;
    this.stats.broken++;
    if (p.body) this.settle(p);
    if (!d.keep) this.unstand(p, true);
    this.show(p);
    const c = _v.set(0, d.cy * p.s.y, 0).applyQuaternion(p.q).add(p.p).clone();
    ctx.audio.play(d.sound, { position: c, pitch: d.pitch, pitchJitter: 0.08 });
    this.shatter(p, c);
    if (d.boom) this.boom(p, c, d.boom, source);
    if (d.boom?.fire || p.kind === 'monitor') {
      p.burnUntil = this.time + (p.kind === 'rack' ? BreakTuning.burn : p.kind === 'monitor' ? 3 : 8);
      if (!this.burning.includes(p)) this.burning.push(p);
    }
  }

  /** What each kind throws when it goes. */
  private shatter(p: Prop, c: THREE.Vector3): void {
    const fx = this.ctx.fx;
    switch (p.kind) {
      case 'monitor':
        this.sparks(p, 16);
        this.pieces('glass', c, 4, 0.06, [1, 1, 1], 3);
        this.pieces('plaster', c, 3, 0.07, PLASTIC, 3);
        break;
      case 'chair':
        this.pieces('plaster', c, 4, 0.14, PLASTIC, 4);
        this.pieces('steelDark', c, 3, 0.1, [0.5, 0.5, 0.5], 4);
        break;
      case 'plant':
        fx.chips(c, 0x4a3424, 26);
        fx.impact(c, UP, 'dirt', 1.2);
        this.pieces('plaster', c, 5, 0.08, [0.66, 0.34, 0.2], 4);
        this.pieces('dirt', c, 4, 0.07, [0.5, 0.4, 0.3], 3);
        break;
      case 'divider': {
        const w = p.s.x, h = p.s.y;
        const along = _w.set(1, 0, 0).applyQuaternion(p.q);
        const parts = Math.max(1, Math.round(w / 0.8));
        for (let i = 0; i < parts; i++) {
          const at = c.clone().addScaledVector(along, ((i + 0.5) / parts - 0.5) * w);
          this.piece('plaster', at, p.q, _h.set(w / parts / 2 - 0.02, h / 2, 0.03), 3, [0.36, 0.42, 0.5]);
        }
        break;
      }
      case 'pane': {
        const area = p.s.x * p.s.y;
        const normal = _w.set(0, 0, 1).applyQuaternion(p.q);
        fx.impact(c, normal, 'glass', 1.4);
        fx.impact(c.clone().addScaledVector(normal, -0.05), normal.clone().negate(), 'glass', 1.4);
        this.pieces('glass', c, Math.min(12, Math.ceil(area * 3)), Math.min(0.18, 0.05 + area * 0.02), [1, 1, 1], 2.5, p.s.x * 0.4, p.s.y * 0.4);
        break;
      }
      case 'cooler':
        fx.smoke(c, 0xdfe8ee, 1.6, 1.5);
        fx.chips(c, 0x9fd4ff, 30);
        this.pieces('glass', c.clone().setY(c.y + 0.6), 5, 0.08, [0.7, 0.85, 1], 4);
        break;
      case 'extinguisher':
        // A white cloud that hangs: cover for a few seconds, from whoever shot it.
        for (let i = 0; i < 6; i++) {
          _w.set((Math.random() - 0.5) * 3, 0.2 + Math.random() * 1.2, (Math.random() - 0.5) * 3).add(c);
          fx.smoke(_w, 0xeef2f4, 2.6 + Math.random(), 6 + Math.random() * 2);
        }
        this.pieces('plaster', c, 3, 0.07, [0.7, 0.08, 0.08], 6);
        break;
      case 'copier':
        fx.chips(c, 0xf4f4ee, 50);
        fx.smoke(c, 0x202022, 2.2, 3);
        this.pieces('plaster', c.clone().setY(c.y + 0.6), 10, 0.12, [0.95, 0.95, 0.92], 6, 0.3, 0.02);
        break;
      case 'vending':
        fx.chips(c, 0xc02020, 30);
        this.pieces('plaster', c, 10, 0.06, [0.8, 0.12, 0.1], 7);
        this.pieces('glass', c, 4, 0.1, [1, 1, 1], 5);
        break;
      case 'rack':
        this.sparks(p, 30);
        this.pieces('steelDark', c, 5, 0.12, [0.3, 0.3, 0.32], 6);
        break;
      case 'generator':
        this.pieces('steelDark', c, 8, 0.2, [0.5, 0.46, 0.1], 9);
        break;
      case 'gasline':
        this.pieces('steelDark', c, 4, 0.08, [0.8, 0.7, 0.1], 7);
        break;
      case 'microwave':
        this.sparks(p, 20);
        this.pieces('glass', c, 3, 0.06, [1, 1, 1], 4);
        break;
    }
  }

  private boom(p: Prop, c: THREE.Vector3, b: Boom, source: string): void {
    const { fx, render, audio, camera, events, player } = this.ctx;
    this.stats.booms++;
    if (b.fire) {
      fx.explosion(c, { radius: b.radius, kind: 'barrel', scale: b.scale });
      render.lights.flash(c, 0xff8a30, b.flash, b.radius * 2.4, 0.3 + b.scale * 0.15);
      render.decals?.add('scorch', _w.copy(p.p), UP, b.radius * 0.5);
    } else {
      fx.ring(c, UP, 0xdfeeff, b.radius * 1.2);
    }
    audio.play(b.sound, { position: c });
    if (player?.position instanceof THREE.Vector3) {
      const d = player.position.distanceTo(c);
      camera.addTrauma(Math.max(0, 1 - d / (b.radius * 4)) * Math.min(0.9, 0.2 + b.scale * 0.4));
    }
    // Combat hurts the enemies and the player and throws bodies, chairs and debris from this.
    events.emit('world:explosion', { position: c, radius: b.radius, damage: b.damage, kind: b.scale > 1.8 ? 'tank' : 'barrel', source });
    // The other world objects in reach go a beat later, so a row ripples.
    if (this.pending.length >= BreakTuning.chain) { this.pending.shift(); this.stats.dropped++; }
    this.pending.push({ at: this.time + BreakTuning.chainDelay, c, radius: b.radius, damage: b.damage, source });
  }

  private sparks(p: Prop, count: number): void {
    _v.set(0, p.def.cy * p.s.y * 1.4, 0).applyQuaternion(p.q).add(p.p);
    _w.set(0, 0.4, 1).applyQuaternion(p.q).normalize();
    this.ctx.fx.sparks(_v, _w, count, 0xbfe8ff);
  }

  private pieces(mat: DebrisMat, c: THREE.Vector3, n: number, size: number, tint: Rgb, speed: number, spreadX = 0.2, spreadY = 0.2): void {
    for (let i = 0; i < n; i++) {
      _w.set((Math.random() - 0.5) * spreadX * 2, (Math.random() - 0.5) * spreadY * 2, (Math.random() - 0.5) * 0.4).add(c);
      _q.setFromEuler(_e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      _h.set(size * (0.6 + Math.random() * 0.8), size * (0.3 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.8));
      this.piece(mat, _w, _q, _h, speed, tint);
    }
  }

  private piece(mat: DebrisMat, at: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, speed: number, tint: Rgb): void {
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
    this.debris.throw(mat, at.clone(), q.clone(), half.clone(), v, 8, [lin(tint[0]), lin(tint[1]), lin(tint[2])]);
  }

  /** A chair takes a hit: it becomes a body, and tumbles until it settles. */
  private knock(p: Prop, vel: THREE.Vector3): void {
    const { R, world } = this.ctx.physics;
    if (!p.body) {
      if (this.moving.length >= BreakTuning.chairs) this.settle(this.moving[0]!);
      this.unstand(p, false);
      _v.set(0, p.def.cy, 0).applyQuaternion(p.q).add(p.p);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y, _v.z).setRotation(p.q).setLinearDamping(0.2).setAngularDamping(0.8),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(p.def.half[0], p.def.half[1], p.def.half[2]).setDensity(220).setFriction(0.7).setRestitution(0.25)
          .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris)),
        body,
      );
      p.body = body;
      p.still = 0;
      p.thrownAt = this.time;
      this.moving.push(p);
    }
    p.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    p.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    this.ctx.audio.play('body_thud', { position: p.p, pitch: 1.5, volume: 0.6, pitchJitter: 0.1 });
  }

  /** A tumbling chair stops where it is: its body goes, a static collider stands in its place. */
  private settle(p: Prop): void {
    if (!p.body) return;
    const t = p.body.translation(), r = p.body.rotation();
    p.q.set(r.x, r.y, r.z, r.w);
    p.p.set(t.x, t.y, t.z).sub(_w.set(0, p.def.cy, 0).applyQuaternion(p.q));
    this.ctx.physics.world.removeRigidBody(p.body);
    p.body = null;
    const at = this.moving.indexOf(p);
    if (at >= 0) this.moving.splice(at, 1);
    this.show(p);
    if (p.alive) this.stand(p);
  }

  update(dt: number): void {
    if (!this.props.length) return;
    this.time += dt;
    this.debris.update(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i]!;
      if (this.time < b.at) continue;
      this.pending.splice(i, 1);
      this.stats.chained++;
      this.onBlast(b.c, b.radius, b.damage, b.source);
    }
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const p = this.moving[i]!;
      const body = p.body!;
      const t = body.translation(), r = body.rotation(), v = body.linvel();
      p.q.set(r.x, r.y, r.z, r.w);
      p.p.set(t.x, t.y, t.z).sub(_w.set(0, p.def.cy, 0).applyQuaternion(p.q));
      this.show(p);
      p.still = v.x * v.x + v.y * v.y + v.z * v.z < 0.09 ? p.still + dt : 0;
      if (t.y < -20) { p.alive = false; this.ctx.physics.world.removeRigidBody(body); p.body = null; this.moving.splice(i, 1); this.show(p); }
      else if (p.still > 0.5 || this.time - p.thrownAt > 6) this.settle(p);
    }
    if (this.time >= this.nextSpark && this.burning.length) {
      this.nextSpark = this.time + BreakTuning.sparkEvery;
      for (let i = this.burning.length - 1; i >= 0; i--) if (this.time > this.burning[i]!.burnUntil) this.burning.splice(i, 1);
      const p = this.burning[Math.floor(Math.random() * this.burning.length)];
      if (p) {
        this.sparks(p, 6);
        if (Math.random() < 0.3) this.ctx.audio.play('electric_zap', { position: p.p, volume: 0.35, pitchJitter: 0.2 });
      }
    }
  }

  reset(): void {
    this.pending.length = 0;
    this.burning.length = 0;
    for (const p of [...this.moving]) this.settle(p);
    for (const p of this.props) {
      this.unstand(p, true);
      p.hp = p.def.hp;
      p.alive = true;
      p.sparking = false;
      p.p.set(p.spec.x, p.spec.y, p.spec.z);
      p.q.setFromEuler(_e.set(p.spec.flat ? -Math.PI / 2 : 0, p.spec.yaw, 0, 'YXZ'));
      this.show(p);
      if (this.attached) this.stand(p);
    }
    this.debris.clear();
  }
}
