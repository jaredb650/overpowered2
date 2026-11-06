/**
 * First-person arms. Each arm is one SkinnedMesh in one draw call: combat sleeve, armoured bracer with a wrist
 * readout, and a reinforced glove with fifteen finger bones.
 *
 * Bind frame, for the right arm: the wrist is at the origin, fingers run along -Z, the back of the hand faces +Y,
 * the thumb is on the -X side and the elbow lies along +Z. Bind rotations are identity, so a hand socket is simply
 * "where this frame goes". The left arm is the same mesh reflected across X.
 */
import * as THREE from 'three';
import { Kit } from './kit/kit';
import type { Mesher, V3 } from './kit/mesher';
import { layerGeometry } from './kit/mesher';
import { F } from './kit/finishes';
import { bakeAo } from './kit/ao';
import { poly, rect } from './kit/shapes';
import { screw } from './kit/details';

export const UPPER_LEN = 0.3;
export const FORE_LEN = 0.27;

const B = { upper: 0, fore: 1, twist: 2, hand: 3, thumb: 4, index: 7, middle: 10, ring: 13, pinky: 16 } as const;
const BONE_COUNT = 19;

interface FingerSpec { x: number; y: number; z: number; len: readonly [number, number, number]; r: number; bone: number; splay: number; }

/** Knuckle positions and phalanx lengths of a large gloved hand. */
const FINGERS: readonly FingerSpec[] = [
  { x: -0.0315, y: -0.0015, z: -0.094, len: [0.044, 0.027, 0.023], r: 0.0108, bone: B.index, splay: -0.05 },
  { x: -0.0105, y: 0.0005, z: -0.1, len: [0.048, 0.031, 0.024], r: 0.0112, bone: B.middle, splay: -0.012 },
  { x: 0.0105, y: 0, z: -0.097, len: [0.045, 0.029, 0.024], r: 0.0106, bone: B.ring, splay: 0.03 },
  { x: 0.0305, y: -0.003, z: -0.087, len: [0.036, 0.022, 0.021], r: 0.0095, bone: B.pinky, splay: 0.08 },
];

const THUMB_BASE: V3 = [-0.03, -0.012, -0.026];
const THUMB_DIR = new THREE.Vector3(-0.56, -0.28, -0.78).normalize();
const THUMB_LEN = [0.05, 0.037, 0.031] as const;
/** Flexing the thumb folds it across the palm, around this axis. */
const THUMB_FLEX = new THREE.Vector3(0.3, -0.92, 0.22).normalize();
/** Opposition swings it under the palm. */
const THUMB_OPPOSE = new THREE.Vector3(0.82, 0.1, -0.56).normalize();

/** Per finger: base curl, middle curl, tip curl, spread. Thumb: oppose, flex, middle curl, tip curl. */
export interface HandPose {
  thumb: readonly [number, number, number, number];
  index: readonly [number, number, number, number];
  middle: readonly [number, number, number, number];
  ring: readonly [number, number, number, number];
  pinky: readonly [number, number, number, number];
}

export const POSE_SIZE = 20;

export function packPose(p: HandPose, out: Float32Array = new Float32Array(POSE_SIZE)): Float32Array {
  out.set(p.thumb, 0);
  out.set(p.index, 4);
  out.set(p.middle, 8);
  out.set(p.ring, 12);
  out.set(p.pinky, 16);
  return out;
}

function chainSkin(bones: readonly number[], origin: THREE.Vector3, dir: THREE.Vector3, joints: readonly number[], blend: number) {
  return (x: number, y: number, z: number, out: [number, number, number]) => {
    const t = (x - origin.x) * dir.x + (y - origin.y) * dir.y + (z - origin.z) * dir.z;
    let seg = 0;
    while (seg < joints.length && t > joints[seg]!) seg++;
    out[0] = bones[seg]!;
    out[1] = bones[seg]!;
    out[2] = 1;
    // Blend across the nearest joint so the glove creases instead of tearing.
    for (let j = 0; j < joints.length; j++) {
      const d = t - joints[j]!;
      if (Math.abs(d) < blend) {
        const w = 0.5 + d / (2 * blend);
        out[0] = bones[j + 1]!;
        out[1] = bones[j]!;
        out[2] = w * w * (3 - 2 * w);
        return;
      }
    }
  };
}

function digit(m: Mesher, base: THREE.Vector3, dir: THREE.Vector3, len: readonly [number, number, number], r: number, upHint: THREE.Vector3): void {
  const u = new THREE.Vector3().crossVectors(upHint, dir).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  // u x v = dir keeps the ring right-handed about the travel direction.
  const total = len[0] + len[1] + len[2];
  const j1 = len[0];
  const j2 = len[0] + len[1];
  const rings: V3[][] = [];
  const n = 12;
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = -0.012 + (i / steps) * (total + 0.012);
    const k = t / total;
    let rad = r * (1.03 - 0.17 * Math.max(0, k));
    // Pads swell between joints, and the leather pinches at each crease.
    const near = Math.min(Math.abs(t - j1), Math.abs(t - j2));
    rad *= 0.955 + 0.075 * Math.min(1, near / 0.0085);
    const tipStart = total - r * 1.05;
    if (t > tipStart) {
      const q = Math.min(1, (t - tipStart) / (r * 1.05));
      rad *= Math.sqrt(Math.max(0.0025, 1 - q * q));
    }
    const ring: V3[] = [];
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const cu = Math.cos(ang);
      const cv = Math.sin(ang);
      // Flatter on the back of the finger, fuller on the pad.
      const rv = rad * (cv > 0 ? 0.9 : 1.0);
      const ru = rad * 1.06;
      // Stacked creases on the back of each joint.
      const crease = cv > 0.2 ? Math.exp(-(((t - j1) / 0.0035) ** 2)) * 0.0007 + Math.exp(-(((t - j2) / 0.003) ** 2)) * 0.0006 : 0;
      ring.push([
        base.x + dir.x * t + u.x * cu * ru + v.x * cv * (rv - crease),
        base.y + dir.y * t + u.y * cu * ru + v.y * cv * (rv - crease),
        base.z + dir.z * t + u.z * cu * ru + v.z * cv * (rv - crease),
      ]);
    }
    rings.push(ring);
  }
  m.loft(rings, { capStart: false, capEnd: true });
}

function digitPlates(m: Mesher, base: THREE.Vector3, len: readonly [number, number, number], r: number): void {
  // Segmented armour on the back of the first two phalanges. Each rides its own bone through the chain skin.
  m.use(F.leatherGrey);
  m.at([base.x, base.y + r * 0.84, base.z - len[0] * 0.56], null, () => {
    m.top(poly([[-r * 0.72, -len[0] * 0.3], [r * 0.72, -len[0] * 0.3], [r * 0.82, len[0] * 0.3], [-r * 0.82, len[0] * 0.3]], 0.002), 0.002, { bevel: 0.0006 });
  });
  m.at([base.x, base.y + r * 0.72, base.z - len[0] - len[1] * 0.5], null, () => {
    m.top(poly([[-r * 0.62, -len[1] * 0.27], [r * 0.62, -len[1] * 0.27], [r * 0.7, len[1] * 0.27], [-r * 0.7, len[1] * 0.27]], 0.0018), 0.0017, { bevel: 0.0005 });
  });
}

function palm(m: Mesher): void {
  m.skinFn = (_x, _y, z, o) => {
    // Glove cuff blends into the forearm's twist bone.
    if (z > -0.006) {
      const w = THREE.MathUtils.clamp((z + 0.006) / 0.03, 0, 1);
      o[0] = B.twist;
      o[1] = B.hand;
      o[2] = w * 0.8;
    } else {
      o[0] = B.hand;
      o[1] = B.hand;
      o[2] = 1;
    }
  };
  m.use(F.leather);
  const rings: V3[][] = [];
  const n = 22;
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const z = 0.022 - k * 0.135;
    // Wrist to knuckles: narrow, then the wide spread of the metacarpals, then a rounded end.
    const w = 0.03 + 0.0215 * Math.min(1, k * 1.5) - (k > 0.86 ? (k - 0.86) * 0.13 : 0);
    const h = 0.0205 + 0.0035 * Math.sin(k * Math.PI) - (k > 0.9 ? (k - 0.9) * 0.1 : 0);
    const cy = -0.0015 - 0.002 * Math.sin(k * Math.PI);
    const ring: V3[] = [];
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const e = 0.72;
      const x = Math.sign(c) * Math.pow(Math.abs(c), e) * w;
      // The back of the hand arcs over the metacarpals; the palm cups inward.
      const y = Math.sign(s) * Math.pow(Math.abs(s), e) * h * (s > 0 ? 1 : 0.9);
      ring.push([x, y + cy - (x * x) * 3.2, z]);
    }
    rings.push(ring);
  }
  // Travelling along -Z the ring direction must be reversed, so flip.
  m.loft(rings, { capStart: false, capEnd: true, flip: true });

  // Thenar pad under the thumb base.
  m.use(F.leather);
  const pad: V3[][] = [];
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    const rad = 0.0225 * Math.sin(Math.min(1, k * 1.05 + 0.08) * Math.PI) + 0.001;
    const c = new THREE.Vector3(-0.0225, -0.0145, -0.008).lerp(new THREE.Vector3(-0.036, -0.0165, -0.058), k);
    const ring: V3[] = [];
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      ring.push([c.x + Math.cos(ang) * rad * 0.82, c.y - Math.sin(ang) * rad * 0.66, c.z]);
    }
    pad.push(ring);
  }
  m.loft(pad, { capStart: true, capEnd: true });

  // Palm reinforcement: raised grip pads.
  m.use(F.polymerStipple);
  m.at([0.006, -0.0235, -0.063], null, () => m.top(poly([[-0.036, -0.03], [0.03, -0.03], [0.036, 0.026], [-0.016, 0.03]], 0.008), 0.0026, { bevel: 0.001 }));

  // Back-of-hand armour: a carbon shell with a central spine.
  m.use(F.carbon);
  m.at([0.001, 0.0225, -0.064], [0.04, 0, 0], () => {
    m.top(poly([[-0.034, 0.03], [0.032, 0.03], [0.041, -0.024], [0.03, -0.036], [-0.036, -0.036], [-0.043, -0.022]], 0.006), 0.0036, { bevel: 0.0013 });
  });
  m.use(F.leatherGrey);
  m.at([0.0, 0.02, -0.04], [0.02, 0, 0], () => m.top(poly([[-0.03, 0.019], [0.03, 0.019], [0.032, -0.008], [-0.032, -0.008]], 0.004), 0.0026, { bevel: 0.001 }));
  // Knuckle guard: one hard ridge per finger.
  for (const f of FINGERS) {
    m.use(F.anodized);
    m.at([f.x, f.y + 0.0185, f.z + 0.002], null, () => {
      m.top(poly([[-0.0088, 0.0105], [0.0088, 0.0105], [0.0098, -0.006], [0.0062, -0.0115], [-0.0062, -0.0115], [-0.0098, -0.006]], 0.002), 0.0042, { bevel: 0.0014 });
    });
  }
  // Wrist strap with a velcro tab and a metal keeper.
  m.use(F.webbing);
  const strap: V3[][] = [];
  for (let i = 0; i <= 4; i++) {
    const z = 0.0065 - (i / 4) * 0.021;
    const ring: V3[] = [];
    const bulge = i === 0 || i === 4 ? 0.0002 : 0.0016;
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2;
      ring.push([Math.cos(ang) * (0.0335 + bulge), Math.sin(ang) * (0.0232 + bulge) - 0.0012, z]);
    }
    strap.push(ring);
  }
  m.loft(strap, { flip: true });
  m.use(F.leatherGrey);
  m.at([-0.012, 0.0254, -0.0045], [0.05, 0, 0], () => m.top(rect(-0.019, -0.0085, 0.021, 0.0085, 0.0016), 0.0018, { bevel: 0.0006 }));
  m.use(F.steelDark);
  m.at([0.0165, 0.0252, -0.0045], null, () => m.top(rect(-0.004, -0.0088, 0.004, 0.0088, 0.0012), 0.0026, { bevel: 0.0008 }));
  m.skinFn = null;
}

function fingers(m: Mesher): void {
  const up = new THREE.Vector3(0, 1, 0);
  for (const f of FINGERS) {
    const base = new THREE.Vector3(f.x, f.y, f.z);
    const dir = new THREE.Vector3(Math.sin(f.splay), 0, -Math.cos(f.splay));
    const ch = chainSkin([f.bone, f.bone + 1, f.bone + 2], base, dir, [f.len[0], f.len[0] + f.len[1]], 0.0052);
    const skin = (x: number, y: number, z: number, o: [number, number, number]) => {
      ch(x, y, z, o);
      // The finger root stays with the palm, so the webbing does not lift when a finger curls.
      const t = (x - base.x) * dir.x + (z - base.z) * dir.z;
      if (t < 0.004) {
        const w = THREE.MathUtils.clamp((t + 0.008) / 0.012, 0, 1);
        o[0] = f.bone;
        o[1] = B.hand;
        o[2] = w;
      }
    };
    m.skinFn = skin;
    m.use(F.leather);
    digit(m, base, dir, f.len, f.r, up);
    digitPlates(m, base, f.len, f.r);
    m.skinFn = null;
  }
  const tb = new THREE.Vector3(...THUMB_BASE);
  m.skinFn = chainSkin([B.thumb, B.thumb + 1, B.thumb + 2], tb, THUMB_DIR, [THUMB_LEN[0], THUMB_LEN[0] + THUMB_LEN[1]], 0.0068);
  m.use(F.leather);
  digit(m, tb, THUMB_DIR, THUMB_LEN, 0.0132, new THREE.Vector3(0.55, 0.8, -0.15).normalize());
  m.skinFn = null;
}

function sleeve(m: Mesher): void {
  const zw = 0.024;
  const zEnd = FORE_LEN + UPPER_LEN;
  const L = FORE_LEN;
  m.skinFn = (_x, _y, z, o) => {
    if (z < 0.05) { o[0] = B.twist; o[1] = B.hand; o[2] = THREE.MathUtils.clamp((z - 0.01) / 0.04, 0, 1) * 0.8 + 0.2; }
    else if (z < L * 0.5) { const w = (z - 0.05) / (L * 0.5 - 0.05); o[0] = B.twist; o[1] = B.twist; o[2] = 1; void w; }
    else if (z < L - 0.05) { const w = (z - L * 0.5) / (L * 0.5 - 0.05); o[0] = B.fore; o[1] = B.twist; o[2] = w; }
    else if (z < L + 0.05) { const w = (z - (L - 0.05)) / 0.1; o[0] = B.upper; o[1] = B.fore; o[2] = w; }
    else { o[0] = B.upper; o[1] = B.upper; o[2] = 1; }
  };
  m.use(F.fabric);
  const n = 22;
  const steps = 46;
  const rings: V3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const z = zw + k * (zEnd - zw);
    const f = Math.min(1, (z - zw) / L);
    const rx = 0.0335 + 0.0215 * Math.sin(Math.min(1, f * 1.15) * Math.PI / 2) + (z > L ? (z - L) * 0.05 : 0);
    const ry = 0.0265 + 0.0235 * Math.sin(Math.min(1, f * 1.15) * Math.PI / 2) + (z > L ? (z - L) * 0.05 : 0);
    const ring: V3[] = [];
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      // Fabric bunches near the wrist and the elbow, spiralling a little because sleeves twist.
      const nearWrist = Math.exp(-(((z - zw) / 0.05) ** 2));
      const nearElbow = Math.exp(-(((z - L) / 0.06) ** 2));
      const fold = Math.sin(z * 150 + ang * 2 + Math.sin(ang * 3) * 1.2) * 0.0019 * nearWrist
        + Math.sin(z * 120 - ang * 3) * 0.0028 * nearElbow
        + Math.sin(z * 50 + ang * 1.5) * 0.0008;
      ring.push([Math.cos(ang) * (rx + fold), Math.sin(ang) * (ry + fold), z]);
    }
    rings.push(ring);
  }
  m.loft(rings, { capStart: true });
  // Elastic cuff.
  m.use(F.fabricDark);
  const cuff: V3[][] = [];
  for (let i = 0; i <= 8; i++) {
    const z = 0.016 + (i / 8) * 0.026;
    const ring: V3[] = [];
    const r = 0.0014 * Math.sin((i / 8) * Math.PI) + (i % 2 === 0 ? 0.0003 : 0);
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      ring.push([Math.cos(ang) * (0.0352 + r), Math.sin(ang) * (0.0282 + r), z]);
    }
    cuff.push(ring);
  }
  m.loft(cuff);
  m.skinFn = null;
}

function bracer(m: Mesher): void {
  // Rides the twist bone so it stays flat on the arm through wrist roll.
  m.skinFn = (_x, _y, _z, o) => { o[0] = B.twist; o[1] = B.twist; o[2] = 1; };
  const lay = (z: number, y: number, tilt: number, fn: () => void) => m.at([0, y, z], [tilt, 0, 0], fn);
  m.use(F.anodized);
  // Main dorsal plate.
  lay(0.125, 0.0475, -0.1, () => {
    m.top(poly([[-0.03, 0.078], [0.03, 0.078], [0.036, 0.0], [0.028, -0.07], [-0.028, -0.07], [-0.036, 0.0]], 0.006), 0.0048, { bevel: 0.0016 });
  });
  m.use(F.anodizedGrey);
  lay(0.13, 0.0505, -0.1, () => {
    m.top(poly([[-0.022, 0.058], [0.022, 0.058], [0.026, 0.004], [0.019, -0.012], [-0.019, -0.012], [-0.026, 0.004]], 0.004), 0.0022, { bevel: 0.0008 });
  });
  // Worn on the inside of the wrist, the way soldiers wear watches: with the left hand cradling a handguard the
  // palm side is what faces the shooter.
  if (m.skinSide < 0) {
    m.at([0, -0.0325, 0.074], [Math.PI + 0.26, 0, 0], () => {
      m.use(F.polymer);
      m.top(poly([[-0.024, 0.023], [0.024, 0.023], [0.026, -0.023], [-0.026, -0.023]], 0.004), 0.0072, { bevel: 0.0018 });
      m.use(F.black);
      m.at([0, 0.0034, 0], null, () => m.top(rect(-0.0192, -0.0158, 0.0192, 0.0158, 0.0012), 0.0012, { bevel: 0 }));
      m.at([0, 0.0046, 0], [-Math.PI / 2, 0, 0], () => m.screen('wrist', 0.0368, 0.0292));
      for (const k of [-1, 1] as const) {
        m.at([k * 0.0232, 0.0028, 0.018], [-Math.PI / 2, 0, 0], () => screw(m, 0.0014));
        m.at([k * 0.0232, 0.0028, -0.018], [-Math.PI / 2, 0, 0], () => screw(m, 0.0014));
      }
    });
  }
  // Side rails and retaining straps.
  m.use(F.polymerGrey);
  m.mirror(() => {
    m.at([0.0465, 0.021, 0.14], [0, 0, -0.62], () => m.box(0.0048, 0.024, 0.11, 0.0014, 0.003));
  });
  m.use(F.webbing);
  for (const z of [0.09, 0.185]) {
    const f = (z - 0.024) / FORE_LEN;
    const rx = 0.0335 + 0.0215 * Math.sin(Math.min(1, f * 1.15) * Math.PI / 2) + 0.0016;
    const ry = 0.0265 + 0.0235 * Math.sin(Math.min(1, f * 1.15) * Math.PI / 2) + 0.0016;
    const band: V3[][] = [];
    for (let i = 0; i <= 3; i++) {
      const zz = z - 0.0115 + (i / 3) * 0.023;
      const ring: V3[] = [];
      const b = i === 0 || i === 3 ? 0 : 0.0011;
      for (let a = 0; a < 22; a++) {
        const ang = (a / 22) * Math.PI * 2;
        ring.push([Math.cos(ang) * (rx + b), Math.sin(ang) * (ry + b), zz]);
      }
      band.push(ring);
    }
    m.loft(band);
  }
  m.skinFn = null;
}

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _axis = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _rx = new THREE.Vector3(1, 0, 0);
const _ry = new THREE.Vector3(0, 1, 0);

function lookAlong(dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): void {
  // The bone's -Z runs down the limb.
  _z.copy(dir).negate().normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  out.setFromRotationMatrix(_m);
}

export class Arm {
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  /** Live readout on the wrist computer. Left arm only. */
  readonly screen: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; texture: THREE.CanvasTexture } | null = null;
  /** Current finger pose, written by the rig. */
  readonly pose = new Float32Array(POSE_SIZE);
  private readonly mirror: 1 | -1;

  constructor(kit: Kit, readonly side: 1 | -1) {
    this.mirror = side;
    const m = kit.mesher();
    const build = () => {
      sleeve(m);
      palm(m);
      fingers(m);
      bracer(m);
    };
    if (side > 0) build();
    else {
      m.skinSide = -1;
      m.reflected(build);
    }
    bakeAo(m.tree, 0.9);

    const hard = m.tree.layers.get('hard')!;
    const geo = layerGeometry(hard, false);
    const mesh = new THREE.SkinnedMesh(geo, kit.mats.hard);
    mesh.frustumCulled = false;
    mesh.name = side > 0 ? 'armR' : 'armL';
    this.mesh = mesh;

    const bone = (name: string, x: number, y: number, z: number, parent?: THREE.Bone) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      (parent ?? this.mesh).add(b);
      this.bones.push(b);
      return b;
    };
    const s = side;
    bone('upper', 0, 0, FORE_LEN + UPPER_LEN * 0 + 0);
    bone('fore', 0, 0, FORE_LEN);
    bone('twist', 0, 0, FORE_LEN * 0.5);
    const hand = bone('hand', 0, 0, 0);
    // Thumb chain.
    const t0 = new THREE.Vector3(...THUMB_BASE);
    const t1 = t0.clone().addScaledVector(THUMB_DIR, THUMB_LEN[0]);
    const t2 = t1.clone().addScaledVector(THUMB_DIR, THUMB_LEN[1]);
    const tb0 = bone('thumb0', t0.x * s, t0.y, t0.z, hand);
    const tb1 = bone('thumb1', (t1.x - t0.x) * s, t1.y - t0.y, t1.z - t0.z, tb0);
    bone('thumb2', (t2.x - t1.x) * s, t2.y - t1.y, t2.z - t1.z, tb1);
    for (const f of FINGERS) {
      const dx = Math.sin(f.splay);
      const dz = -Math.cos(f.splay);
      const b0 = bone('f0', f.x * s, f.y, f.z, hand);
      const b1 = bone('f1', dx * f.len[0] * s, 0, dz * f.len[0], b0);
      bone('f2', dx * f.len[1] * s, 0, dz * f.len[1], b1);
    }
    this.mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    if (this.bones.length !== BONE_COUNT) throw new Error('arm bone count');

    if (side < 0) {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 120;
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      this.screen = { canvas: c, g: c.getContext('2d')!, texture };
      const mat = new THREE.MeshBasicMaterial({ map: texture });
      mat.color.multiplyScalar(1.8);
      const sm = new THREE.SkinnedMesh(layerGeometry(m.tree.layers.get('screen:wrist')!, true), mat);
      sm.frustumCulled = false;
      sm.bind(skeleton, new THREE.Matrix4());
      this.mesh.add(sm);
    }
  }

  /** Writes finger rotations from the pose array. */
  applyPose(): void {
    const p = this.pose;
    const s = this.mirror;
    const b = this.bones;
    // A reflected rotation has its axis mirrored and its angle negated.
    const rot = (ax: THREE.Vector3, ang: number, q: THREE.Quaternion) => {
      _axis.set(ax.x * s, ax.y, ax.z);
      q.setFromAxisAngle(_axis, ang * s);
    };
    // Thumb: opposition then flex at the base, plain flex beyond.
    rot(THUMB_OPPOSE, p[0]!, _q0);
    rot(THUMB_FLEX, p[1]!, _q1);
    b[B.thumb]!.quaternion.multiplyQuaternions(_q0, _q1);
    rot(THUMB_FLEX, p[2]!, b[B.thumb + 1]!.quaternion);
    rot(THUMB_FLEX, p[3]!, b[B.thumb + 2]!.quaternion);
    for (let f = 0; f < 4; f++) {
      const bi = B.index + f * 3;
      const o = 4 + f * 4;
      _q0.setFromAxisAngle(_rx, -p[o]!);
      _q1.setFromAxisAngle(_ry, -p[o + 3]! * s);
      b[bi]!.quaternion.multiplyQuaternions(_q1, _q0);
      b[bi + 1]!.quaternion.setFromAxisAngle(_rx, -p[o + 1]!);
      b[bi + 2]!.quaternion.setFromAxisAngle(_rx, -p[o + 2]!);
    }
  }

  /**
   * Two-bone IK from a shoulder to a wrist target. When the target is out of reach the shoulder slides toward it
   * rather than stretching the forearm; the shoulder is off-screen so the player never sees it move.
   */
  solve(wrist: THREE.Vector3, wristQ: THREE.Quaternion, shoulder: THREE.Vector3, pole: THREE.Vector3): void {
    const hand = this.bones[B.hand]!;
    hand.position.copy(wrist);
    hand.quaternion.copy(wristQ);

    _a.subVectors(wrist, shoulder);
    let d = _a.length();
    const reach = (UPPER_LEN + FORE_LEN) * 0.985;
    const s = _b.copy(shoulder);
    if (d > reach) {
      s.addScaledVector(_a, 1 - reach / d);
      _a.subVectors(wrist, s);
      d = reach;
    }
    const dir = _a.normalize();
    const a = (UPPER_LEN * UPPER_LEN - FORE_LEN * FORE_LEN + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, UPPER_LEN * UPPER_LEN - a * a));
    // Perpendicular component of the pole gives the elbow's bend direction.
    _x.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    _e.copy(s).addScaledVector(dir, a).addScaledVector(_x, h);

    // Forearm runs elbow to wrist. Its roll follows the hand so the sleeve twists rather than shears.
    const fore = this.bones[B.fore]!;
    const twist = this.bones[B.twist]!;
    const upper = this.bones[B.upper]!;
    _y.subVectors(wrist, _e).normalize();
    const forearmDir = _a.copy(_y);
    const handUp = _b.set(0, 1, 0).applyQuaternion(wristQ);
    const up = _x.copy(handUp).addScaledVector(forearmDir, -handUp.dot(forearmDir)).normalize();
    const twistUp = _t.copy(up);
    lookAlong(forearmDir, twistUp, twist.quaternion);
    fore.position.copy(_e);
    twist.position.copy(_e).lerp(wrist, 0.5);
    // Elbow keeps a neutral roll: half the hand's twist, which is how a real radius and ulna share it.
    const neutral = _n.set(0, 1, 0);
    neutral.addScaledVector(forearmDir, -neutral.dot(forearmDir)).normalize();
    neutral.lerp(twistUp, 0.5).normalize();
    lookAlong(forearmDir, neutral, fore.quaternion);

    upper.position.copy(_e);
    const upperDir = _t.subVectors(_e, s).normalize();
    lookAlong(upperDir, neutral, upper.quaternion);
  }
}
