/**
 * Partial heads (docs/proposals/partial-head-wounds.md): a body's own head with part of it blown away, baked as a prop that
 * stands in for the head on a partial head wound. The head is the archetype's, every edit clipped to a box round it, so it
 * matches him exactly where it is whole. The wreck is a jagged cut and the inside put back: torn flesh in layers, a broken
 * bone rim, the brain, blood, an eye and pieces of jaw hanging, the hood torn and burned.
 */
import { DETAIL_RUBBER, DETAIL_SKIN, Op, type Edit, type Mat, type Model } from '../model';
import {
  add, at, blend, capsule, cone, cut, displace, dot, ellipsoid, fbm, frameY, inter, mix, noise, norm, offset, rbox, ridged, scale,
  shell, sphere, spline, sstep, strap, sub, tube, type Shape, type V3,
} from '../sdf';
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import { headP } from './gear';
import { glow, paintedMetal, rust } from './materials';
import { B, type Sk } from './skeleton';

// ---------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------

const tint = (o: { r: number; g: number; b: number }, c: V3, t: number) => {
  o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t;
};

const meat: Mat = {
  albedo: [0.5, 0.03, 0.025], rough: 0.22, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 60, y * 60, z * 60, 3);
    const f = 0.65 + (n + 0.5) * 0.6;
    o.r *= f; o.g *= f; o.b *= f;
    // Fibres and a fleck of fat.
    tint(o, [0.75, 0.5, 0.36], sstep(0.18, 0.32, n) * 0.5);
    tint(o, [0.2, 0.0, 0.0], sstep(0.55, 0.8, ridged(x * 140, y * 40, z * 140, 2)) * 0.6);
  },
};
const skullBone: Mat = {
  albedo: [0.84, 0.77, 0.64], rough: 0.4, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 70, y * 70, z * 70, 3);
    tint(o, [0.55, 0.06, 0.04], sstep(0.05, 0.35, n) * 0.75);
  },
};
const brainMat: Mat = {
  albedo: [0.8, 0.56, 0.54], rough: 0.2, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const s = sulci(x, y, z);
    tint(o, [0.36, 0.04, 0.05], s * 0.85);
    tint(o, [0.6, 0.12, 0.1], sstep(0.1, 0.4, fbm(x * 30, y * 30, z * 30, 2)) * 0.5);
    o.rough += s * 0.1;
  },
};
const blood: Mat = {
  albedo: [0.34, 0.01, 0.006], rough: 0.14, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => tint(o, [0.16, 0.0, 0.0], sstep(0, 0.4, fbm(x * 50, y * 50, z * 50, 2)) * 0.7),
};
const charred: Mat = {
  albedo: [0.07, 0.04, 0.025], rough: 0.92, detail: DETAIL_RUBBER,
  paint: (x, y, z, o) => {
    const n = fbm(x * 45, y * 45, z * 45, 3);
    tint(o, [0.2, 0.1, 0.05], sstep(0.05, 0.35, n) * 0.7);
    tint(o, [0.38, 0.03, 0.015], sstep(0.15, 0.4, -n) * 0.8);
  },
};
const cavity: Mat = { albedo: [0.34, 0.025, 0.02], rough: 0.3, detail: DETAIL_SKIN };
const tooth: Mat = { albedo: [0.82, 0.76, 0.6], rough: 0.3, detail: DETAIL_SKIN };

// The Husk's: dead flesh, dried dark and gone brown, grey and greenish, the blood thick and near black, the brain grey.
const deadMeat: Mat = {
  albedo: [0.27, 0.06, 0.04], rough: 0.5, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    meat.paint!(x, y, z, o);
    o.r *= 0.62; o.g *= 0.9; o.b *= 0.85;
    const n = fbm(x * 22 + 5, y * 22, z * 22, 3);
    tint(o, [0.2, 0.17, 0.09], sstep(0.0, 0.35, n) * 0.6);
    tint(o, [0.1, 0.13, 0.07], sstep(0.2, 0.45, -n) * 0.45);
    o.rough = 0.5;
  },
};
const deadBone: Mat = {
  albedo: [0.62, 0.55, 0.38], rough: 0.6, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 70, y * 70, z * 70, 3);
    tint(o, [0.3, 0.16, 0.06], sstep(0.05, 0.35, n) * 0.7);
  },
};
const deadBrain: Mat = {
  albedo: [0.5, 0.42, 0.42], rough: 0.32, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const s = sulci(x, y, z);
    tint(o, [0.2, 0.1, 0.1], s * 0.85);
    tint(o, [0.36, 0.38, 0.26], sstep(0.1, 0.4, fbm(x * 30, y * 30, z * 30, 2)) * 0.5);
    o.rough += s * 0.1;
  },
};
const deadBlood: Mat = {
  albedo: [0.24, 0.04, 0.018], rough: 0.36, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => tint(o, [0.12, 0.05, 0.02], sstep(0, 0.4, fbm(x * 50, y * 50, z * 50, 2)) * 0.6),
};
const crust: Mat = {
  albedo: [0.1, 0.06, 0.035], rough: 0.85, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => tint(o, [0.2, 0.17, 0.08], sstep(0.05, 0.35, fbm(x * 45, y * 45, z * 45, 3)) * 0.7),
};
/** His grey skin, peeled back: blotched yellow, green and bruise-purple. */
const deadSkin: Mat = {
  albedo: [0.5, 0.48, 0.42], rough: 0.7, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 30, y * 30, z * 30, 3);
    tint(o, [0.42, 0.44, 0.26], sstep(0.0, 0.3, n) * 0.6);
    tint(o, [0.3, 0.2, 0.26], sstep(0.1, 0.4, -n) * 0.5);
  },
};
const deadCavity: Mat = { albedo: [0.12, 0.03, 0.02], rough: 0.45, detail: DETAIL_SKIN };
const deadTooth: Mat = { albedo: [0.55, 0.47, 0.3], rough: 0.5, detail: DETAIL_SKIN };
/** The Brute's iron mask. */
const mask = paintedMetal(0x24262a, 0.55, 1);
/** An eye looking along `look`: iris and pupil painted on the white, the back of it veined red. */
const eyeOf = (c: V3, look: V3): Mat => {
  const l = norm(look);
  return {
    albedo: [0.86, 0.82, 0.76], rough: 0.1, detail: DETAIL_SKIN,
    paint: (x, y, z, o) => {
      const d = norm(sub([x, y, z], c));
      const a = dot(d, l);
      tint(o, [0.6, 0.05, 0.04], sstep(0.2, -0.6, a));
      tint(o, [0.18, 0.24, 0.16], sstep(0.84, 0.88, a));
      tint(o, [0.02, 0.02, 0.02], sstep(0.95, 0.965, a));
    },
  };
};

/** One head's palette: the flesh, and what he wears torn and turned out on the flaps. */
interface Look {
  meat: Mat; bone: Mat; brain: Mat; blood: Mat; cavity: Mat; tooth: Mat;
  /** What is burned round the hole. */
  burnt: Mat;
  /** The outside of a flap or plate: the hood, skin or iron. */
  outer: Mat;
  /** The cut face's bands, outside in: the outer layer, fat, bone, and the dark inside. */
  rim: V3; fat: V3; boneBand: V3; deep: V3;
  eye: (c: V3, look: V3) => Mat;
}

/**
 * Where one head's parts sit against the head bone, measured on that head: the outer crown and lower face (the hood's two
 * ellipsoids, or the bare head's), the skull inside them, and an outer shell worn over it all (the Brute's iron mask).
 */
interface Fit {
  hood: readonly [V3, V3]; face: readonly [V3, V3]; skull: readonly [V3, V3];
  shell?: readonly [V3, V3];
  look: Look;
  /** What hangs off the side variant: the respirator's filter, the Husk's jaw cage. */
  extra?: 'filter' | 'cage';
}

const FLESH = {
  meat, bone: skullBone, brain: brainMat, blood, cavity, tooth, burnt: charred,
  rim: [0.03, 0.025, 0.02] as V3, fat: [0.78, 0.6, 0.4] as V3, boneBand: [0.82, 0.76, 0.62] as V3, deep: [0.3, 0.015, 0.01] as V3,
};
/** The hood, from `hood()` at `q` of its size, with the skull inside it. */
const hooded = (q: number): Pick<Fit, 'hood' | 'face' | 'skull'> => ({
  hood: [[0, 0.104, -0.008], [0.092 * q, 0.104 * q, 0.108 * q]],
  face: [[0, 0.05, 0.02], [0.078 * q, 0.092 * q, 0.084 * q]],
  skull: [[0, 0.104, -0.01], [0.08 * q, 0.091 * q, 0.097 * q]],
});

function fitFor(def: ArchetypeDef): Fit {
  switch (def.id) {
    case 'gunner':
      // The Trooper's hood without his respirator; the bucket helm is its own prop and the high collar is the body's.
      return { ...hooded(1), look: { ...FLESH, outer: charred, eye: eyeOf } };
    case 'brute':
      // A smaller hood inside a solid iron mask: the mask is what tears open and peels back.
      return {
        ...hooded(0.92), shell: [[0, 0.1, 0.02], [0.098, 0.1, 0.11]],
        look: { ...FLESH, outer: mask, rim: [0.16, 0.16, 0.17], eye: eyeOf },
      };
    case 'husk':
      // The bare head of `humanHead` (gaunt) under thin grey skin, the skull close under it; his eyes glow.
      return {
        hood: [[0, 0.106, -0.008], [0.082, 0.094, 0.098]],
        face: [[0, 0.058, 0.03], [0.058, 0.088, 0.07]],
        skull: [[0, 0.104, -0.01], [0.074, 0.086, 0.09]],
        extra: 'cage',
        look: {
          meat: deadMeat, bone: deadBone, brain: deadBrain, blood: deadBlood, cavity: deadCavity, tooth: deadTooth, burnt: crust,
          outer: deadSkin, rim: [0.42, 0.4, 0.32], fat: [0.5, 0.42, 0.24], boneBand: [0.62, 0.55, 0.38], deep: [0.08, 0.02, 0.012],
          eye: () => glow([def.accent[0], def.accent[1], def.accent[2]], 1),
        },
      };
    default:
      return { ...hooded(1), extra: 'filter', look: { ...FLESH, outer: charred, eye: eyeOf } };
  }
}

/** Brain folds: 0 on a gyrus, 1 down in a sulcus. */
function sulci(x: number, y: number, z: number): number {
  const w = noise(x * 18 + 3, y * 18, z * 18) * 0.06;
  const n = 1 - Math.abs(noise(x * 64 + w * 40, y * 52, z * 64));
  return sstep(0.82, 0.97, n);
}
const folded = (s: Shape, depth = 0.0035) => displace(s, (x, y, z) => -sulci(x, y, z) * depth + fbm(x * 30, y * 30, z * 30, 2) * 0.003, depth + 0.003);

/**
 * The face of the wound in layers by depth into the head: the hood burned black at the rim, then scalp and fat, red meat,
 * the bone of the skull, and the wet dark inside. `c`, `r` and `c2`, `r2` are the middles and radii of the hood's crown and
 * of its lower face.
 */
const woundFace = (P: ReturnType<typeof headP>, fit: Fit): Mat => {
  const L = fit.look;
  const c = P(...fit.hood[0]), r = fit.hood[1], c2 = P(...fit.face[0]), r2 = fit.face[1];
  const sc = fit.shell && P(...fit.shell[0]), sr = fit.shell?.[1];
  return {
    albedo: [0.5, 0.03, 0.025], rough: 0.2, detail: DETAIL_SKIN,
    paint: (x, y, z, o) => {
      const q = Math.min(
        Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]),
        Math.hypot((x - c2[0]) / r2[0], (y - c2[1]) / r2[1], (z - c2[2]) / r2[2]),
      ) + fbm(x * 70, y * 70, z * 70, 2) * 0.05;
      L.meat.paint!(x, y, z, o);
      tint(o, L.boneBand, sstep(0.74, 0.77, q) * (1 - sstep(0.81, 0.84, q)));
      tint(o, L.fat, sstep(0.88, 0.9, q) * (1 - sstep(0.92, 0.94, q)) * 0.8);
      tint(o, L.rim, sstep(0.93, 0.97, q));
      tint(o, L.deep, 1 - sstep(0.62, 0.7, q));
      if (sc && sr) {
        // Torn iron round the outside, bright where it sheared.
        const qs = Math.hypot((x - sc[0]) / sr[0], (y - sc[1]) / sr[1], (z - sc[2]) / sr[2]);
        tint(o, [0.12, 0.12, 0.13], sstep(0.84, 0.87, qs));
        tint(o, [0.55, 0.52, 0.48], sstep(0.91, 0.96, qs) * 0.9);
      }
    },
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Everything past a torn surface: the plane through `c` facing along `n`, broken up by `amp` of noise at `freq` per meter,
 * inside `box`. Negative in what is gone.
 */
function torn(c: V3, n: V3, amp: number, freq: number, seed: number, box: Shape): Shape {
  const [nx, ny, nz] = norm(n);
  const [cx, cy, cz] = c;
  const f = (x: number, y: number, z: number) => {
    const jag = fbm(x * freq + seed, y * freq, z * freq, 3) * amp + (ridged(x * freq * 2.4, y * freq * 2.4 + seed, z * freq * 2.4, 2) - 0.45) * amp * 0.7;
    return jag - ((x - cx) * nx + (y - cy) * ny + (z - cz) * nz);
  };
  return inter({ f, lo: box.lo, hi: box.hi }, box);
}

/**
 * A flap of hood torn loose at `a` on the rim and folded back down over the outside of the head, `out` being outward there:
 * the burned hood underneath, its torn meat side turned out.
 */
function flap(m: Model, L: Look, a: V3, out: V3, w: number, l: number): void {
  const o = norm(out);
  const path = (k: number): V3[] => [a, add(a, add(scale(o, 0.006 + k), [0, 0.012, 0])), add(a, add(scale(o, 0.016 + k), [0, 0.004, 0])), add(a, add(scale(o, 0.02 + k), [0, -l, 0]))];
  // A strap runs on past its ends along them; the tube round its line stops it there.
  const layer = (k: number, wide: number, thick: number) => inter(strap(path(k), wide, thick, o), tube(path(k), wide * 0.55));
  m.add(layer(0, w, 0.003), L.outer, 0);
  m.add(layer(0.0026, w * 0.86, 0.002), L.meat, 0);
}

/** A shape moved by `d`. */
function moved(s: Shape, d: V3): Shape {
  const f = s.f;
  return { f: (x, y, z) => f(x - d[0], y - d[1], z - d[2]), lo: add(s.lo, d), hi: add(s.hi, d) };
}

/** A hanging strand of tissue down a polyline, thick where it tore loose and thin at its end. */
const strand = (pts: V3[], r: number) => tube(spline(pts, 10), t => r * (1 - t * 0.65));

/**
 * A plate of the skull with the hood still on it, broken out and swung open on its hinge at the rim like a petal: it stands
 * up off the wound, scalp outside and bloody bone inside. Authored as a cap of a sphere the skull's size, its outside along
 * +Y, then laid `h` long from the hinge, up and a little out along `radial`.
 */
function plate(m: Model, L: Look, hinge: V3, radial: V3, w: number, h: number, seed: number): void {
  const R = 0.088;
  const r = norm([radial[0], 0, radial[2]]);
  const out = norm([r[0] * 0.85, -0.5, r[2] * 0.85]);
  const away = norm([r[0] * 0.5, 0.85, r[2] * 0.5]);
  const outline = displace(ellipsoid([0, R, 0], [w, 0.03, h]), (x, y, z) => (fbm(x * 60 + seed, y * 60, z * 60, 2) + 0.2) * 0.012, 0.012);
  const fr = frameY(add(hinge, scale(away, h * 0.85)), out, away);
  const boneShell = inter(shell(sphere([0, 0, 0], R), 0.007), outline);
  const hood = inter(shell(sphere([0, 0, 0], R + 0.008), 0.004), offset(outline, -0.003));
  m.add(at(fr, moved(boneShell, [0, -R, 0])), L.bone, 0);
  m.add(at(fr, moved(hood, [0, -R, 0])), L.outer, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// The head alone
// ---------------------------------------------------------------------------------------------------------------------

/** The box a head is cut out of, in the head bone's space: from the top of the neck to over the crown, snout and all. */
const HEAD_LO: V3 = [-0.17, -0.04, -0.17];
const HEAD_HI: V3 = [0.17, 0.27, 0.23];

/** Copies the edits on the head and neck that reach the head's box into `out`, every solid one clipped to it. */
export function headOnly(src: readonly Edit[], sk: Sk, out: Edit[]): Shape {
  const lo = add(sk.pos[B.head]!, HEAD_LO), hi = add(sk.pos[B.head]!, HEAD_HI);
  const box = rbox(mix(lo, hi, 0.5), scale(sub(hi, lo), 0.5), 0.004);
  for (const e of src) {
    if (e.hi[0] < lo[0] || e.hi[1] < lo[1] || e.hi[2] < lo[2] || e.lo[0] > hi[0] || e.lo[1] > hi[1] || e.lo[2] > hi[2]) continue;
    if (e.op !== Op.Add) {
      out.push(e);
      continue;
    }
    // Only what the head and neck carry: gear on the chest (straps, a radio's antenna) stays on the body.
    if (e.bone !== B.head && e.bone !== B.neck && e.bone !== -1) continue;
    out.push({
      ...e,
      shape: inter(e.shape, box),
      lo: [Math.max(e.lo[0], lo[0] - 0.01), Math.max(e.lo[1], lo[1] - 0.01), Math.max(e.lo[2], lo[2] - 0.01)],
      hi: [Math.min(e.hi[0], hi[0] + 0.01), Math.min(e.hi[1], hi[1] + 0.01), Math.min(e.hi[2], hi[2] + 0.01)],
    });
  }
  return box;
}

/**
 * The common wreck: burn and blood round the wound, the cut faced in layers, the skull's broken rim proud of the flesh with
 * splinters off it, the hollow skull and the brain in it, swollen out over the break by `bulge`.
 */
function wreck(m: Model, sk: Sk, box: Shape, fit: Fit, c: V3, n: V3, o: { amp: number; bulge: number; seed: number }): void {
  const P = headP(sk);
  const L = fit.look;
  const [SKULL_C, SKULL_R] = fit.skull;
  const k = SKULL_R[0] / 0.08;
  const N = norm(n);
  const gone = torn(c, N, o.amp, 26, o.seed, box);
  const g = gone.f;
  // Burned black for a couple of centimetres round the hole, then blood run down from it.
  m.paint({ f: (x, y, z) => g(x, y, z) - 0.008 - fbm(x * 40, y * 40, z * 40, 2) * 0.01, lo: box.lo, hi: box.hi }, L.burnt, 0.004);
  m.paint({
    f: (x, y, z) => {
      const d = g(x, y, z);
      // Wet at the rim, and in thin runs down from it.
      const run = 1 - Math.abs(noise(x * 110, y * 9, z * 110));
      return Math.min(d - 0.006, Math.max(d - 0.05, (0.9 - run) * 0.03));
    },
    lo: box.lo, hi: box.hi,
  }, L.blood, 0.003);
  m.cut(gone, { mat: woundFace(P, fit) });

  const skullC = P(...SKULL_C);
  const skull = shell(ellipsoid(skullC, SKULL_R), 0.011);
  // The bone breaks on its own line, a few millimetres proud of the flesh, in sharper teeth.
  const boneGone = torn(add(c, scale(N, 0.009)), N, o.amp * 0.8, 44, o.seed + 17, box);
  m.add(cut(skull, boneGone), L.bone, 0);
  for (let i = 0; i < 13; i++) {
    // Splinters off the rim, pointing out of the wound.
    const a = (i / 13) * Math.PI * 2 + o.seed;
    const u = norm(sub([Math.cos(a), Math.sin(a) * 0.9, Math.sin(a * 1.7)], scale(N, dot(N, [Math.cos(a), Math.sin(a) * 0.9, Math.sin(a * 1.7)]))));
    const base = add(skullC, [u[0] * SKULL_R[0], u[1] * SKULL_R[1], u[2] * SKULL_R[2]]);
    const onRim = sub(base, scale(N, dot(sub(base, c), N)));
    const tip = add(onRim, add(scale(N, 0.016 + (i % 3) * 0.008), scale(u, 0.006)));
    m.add(cone(onRim, tip, 0.005, 0.0008), L.bone, 0);
  }

  m.cut(ellipsoid(skullC, [SKULL_R[0] - 0.007, SKULL_R[1] - 0.007, SKULL_R[2] - 0.007]), { mat: L.cavity });
  const brain = folded(blend(0.02,
    ellipsoid(add(skullC, [0, -0.004 * k, 0.004 * k]), [SKULL_R[0] - 0.014, SKULL_R[1] - 0.017, SKULL_R[2] - 0.015]),
    ellipsoid(add(skullC, [0, -0.03 * k, -0.045 * k]), [0.05 * k, 0.035 * k, 0.04 * k])));
  m.add(cut(brain, torn(add(c, scale(N, o.bulge)), N, o.amp * 1.3, 18, o.seed + 31, box)), L.brain, 0);
}

/** Moves a model built on the body so the head bone is its origin, as a prop on the `head` socket is mounted. */
export function toHead(edits: readonly Edit[], sk: Sk, m: Model): void {
  const [hx, hy, hz] = sk.pos[B.head]!;
  const back = (v: V3): V3 => [v[0] - hx, v[1] - hy, v[2] - hz];
  for (const e of edits) {
    const { f, lo, hi } = e.shape;
    const paint = e.mat?.paint;
    m.edits.push({
      ...e,
      shape: { f: (x, y, z) => f(x + hx, y + hy, z + hz), lo: back(lo), hi: back(hi) },
      // Paint is placed in world space: sample it where the part was, so the wear and chips land where they did.
      mat: e.mat && paint ? { ...e.mat, paint: (x, y, z, o) => paint(x + hx, y + hy, z + hz, o) } : e.mat,
      lo: back(e.lo),
      hi: back(e.hi),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The two wrecks
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The side of the head blown away, on +X (his left): skull and face sheared off on a slant that takes more of the crown than
 * the jaw, the brain open and spilling down the side, the eye hanging on its nerve and the broken half of the jaw hanging
 * with its teeth, the snout's filter dangling on its hose.
 */
export function sideBlown(m: Model, sk: Sk, box: Shape, def: ArchetypeDef): void {
  const P = headP(sk);
  const fit = fitFor(def);
  const L = fit.look;
  const N = norm([1, 0.4, 0.12]);
  const c = P(0.02, 0.095, 0);
  wreck(m, sk, box, fit, c, N, { amp: 0.018, bulge: 0.004, seed: 3.1 });
  /** A point on the cut at height y and depth z, `out` beyond it. */
  const rim = (y: number, z: number, out = 0): V3 => {
    const p = P(0, y, z);
    const x = c[0] + (-(p[1] - c[1]) * N[1] - (p[2] - c[2]) * N[2]) / N[0];
    return [x + out, p[1], p[2]];
  };
  // Brain sliding out of the hole and down the side of what is left.
  m.add(folded(blend(0.016,
    ellipsoid(rim(0.12, -0.02, 0.01), [0.022, 0.03, 0.034]),
    ellipsoid(rim(0.075, -0.035, 0.014), [0.018, 0.03, 0.024]),
    ellipsoid(rim(0.035, -0.03, 0.012), [0.014, 0.022, 0.017]),
    ellipsoid(rim(0.0, -0.025, 0.012), [0.009, 0.016, 0.01]))), L.brain, 0);
  // Blood pooled in the lip of the cavity and run over the edge.
  m.add(inter(ellipsoid(rim(0.06, 0.0, -0.01), [0.03, 0.012, 0.06]), ellipsoid(P(...fit.skull[0]), sub(fit.skull[1], [0, 0.001, 0.001]))), L.blood, 0);
  m.add(strand([rim(0.055, 0.03, 0.002), rim(0.03, 0.035, 0.008), rim(-0.01, 0.03, 0.006)], 0.005), L.blood, 0);
  // The eye, out of its socket on the optic nerve, hanging against the cheek.
  const eye = rim(-0.02, 0.1, 0.016);
  m.add(strand([P(0.024, 0.088, 0.07), rim(0.07, 0.1, 0.006), rim(0.03, 0.108, 0.014), add(eye, [0, 0.012, 0])], 0.004), L.meat, 0);
  m.add(sphere(eye, 0.0145), L.eye(eye, [0.5, -0.3, 0.8]), 0);
  // The broken half of the jaw, hanging from torn muscle, its teeth up.
  const j0 = rim(0.01, 0.075, -0.004), j1 = rim(-0.035, 0.065, 0.02), j2 = rim(-0.07, 0.035, 0.03);
  m.add(tube(spline([j0, j1, j2], 8), 0.011), L.bone, 0);
  for (let i = 0; i < 5; i++) {
    const t = mix(j0, j1, 0.15 + i * 0.17);
    m.add(rbox(add(t, [-0.004, 0.009, 0.002]), [0.0035, 0.005, 0.003], 0.0015), L.tooth, 0);
  }
  m.add(strand([rim(0.03, 0.06, 0.0), j1, add(j2, [0.004, -0.01, 0])], 0.006), L.meat, 0, { k: 0.006 });
  m.add(strand([rim(0.02, 0.09, 0.0), add(j1, [-0.004, 0.0, 0.012])], 0.004), L.meat, 0, { k: 0.004 });
  if (fit.extra === 'filter') {
    // The snout's filter, torn off, hanging on its hose.
    const can = rim(-0.08, 0.1, 0.03);
    m.add(tube(spline([P(0.03, 0.01, 0.12), rim(-0.02, 0.125, 0.02), add(can, [0, 0.02, 0])], 10), 0.005, { ribs: 260, ribDepth: 0.001 }), charred, 0);
    m.add(capsule(add(can, [0, 0.014, 0.006]), add(can, [0.004, -0.012, 0.0]), 0.016), charred, 0);
  } else if (fit.extra === 'cage') {
    // The iron jaw cage's bar, torn from its bolt and bent down with the jaw.
    m.add(tube(spline([P(0.03, -0.038, 0.1), rim(-0.03, 0.08, 0.012), add(j2, [0.01, -0.008, 0.01])], 10), 0.0062), rust, 0);
  }
  // Ragged tissue hanging off the rim.
  for (const [y, z, l] of [[0.16, -0.06, 0.04], [0.13, 0.04, 0.05], [0.09, -0.08, 0.06], [0.05, 0.06, 0.035], [0.11, -0.01, 0.03]] as const) {
    const a = rim(y, z, 0.002);
    m.add(strand([a, add(a, [0.012, -l * 0.5, 0.004]), add(a, [0.014, -l, 0.0])], 0.0045), L.meat, 0, { k: 0.004 });
  }
  // Torn hood flaps peeled down over the break.
  for (const [y, z] of [[0.18, -0.03], [0.1, -0.1]] as const) {
    const a = rim(y, z, -0.004);
    flap(m, L, a, N, 0.03, 0.035);
  }
}

/**
 * The crown and the upper face blown open: the cut runs from under the eyes in front to high on the back of the head, so the
 * jaw and snout are left. Plates of the skull, hood still on them, swing open round the rim, scalp flaps peeled back, the
 * brain burst up out of the bowl and slumped over the front, an eye hanging over the snout.
 */
export function topBlown(m: Model, sk: Sk, box: Shape, def: ArchetypeDef): void {
  const P = headP(sk);
  const fit = fitFor(def);
  const L = fit.look;
  const N = norm([0.12, 1, 0.55]);
  const c = P(0, 0.108, 0);
  wreck(m, sk, box, fit, c, N, { amp: 0.022, bulge: 0.0, seed: 8.3 });
  /** A point on the cut over (x, z), `up` above it. */
  const rim = (x: number, z: number, up = 0): V3 => {
    const p = P(x, 0, z);
    const y = c[1] + (-(p[0] - c[0]) * N[0] - (p[2] - c[2]) * N[2]) / N[1];
    return [p[0], y + up, p[2]];
  };
  // Skull plates broken out and swung open, like petals.
  const plates: [number, number, number, number, number][] = [[-0.07, -0.04, 0.03, 0.026, 1], [0.06, -0.06, 0.028, 0.03, 2], [0.0, -0.095, 0.03, 0.024, 3], [-0.06, 0.05, 0.022, 0.02, 4]];
  for (const [x, z, w, h, s] of plates) {
    const out = norm([x * 10, 0.6, z * 10]);
    const hingeAt = add(rim(x, z, -0.004), scale(norm([x, 0, z]), 0.004));
    plate(m, L, hingeAt, out, w, h, s * 7.7);
  }
  // Brain burst up out of the bowl: lumps on top and one slumped over the front rim.
  m.add(folded(blend(0.014,
    ellipsoid(rim(0.0, 0.02, 0.012), [0.034, 0.02, 0.034]),
    ellipsoid(rim(0.02, 0.07, 0.008), [0.026, 0.018, 0.022]),
    ellipsoid(rim(0.015, 0.1, -0.02), [0.018, 0.026, 0.014]))), L.brain, 0);
  m.add(folded(ellipsoid(rim(-0.035, -0.02, 0.022), [0.02, 0.016, 0.024])), L.brain, 0);
  // Blood in the bowl's low front lip, and running down the snout.
  m.add(ellipsoid(rim(-0.02, 0.085, -0.004), [0.03, 0.008, 0.016]), L.blood, 0);
  for (const x of [-0.025, 0.012, 0.04]) m.add(strand([rim(x, 0.1, -0.006), add(rim(x, 0.12, -0.03), [0, 0, 0.004]), add(rim(x, 0.12, -0.06), [0.003, 0, 0])], 0.004), L.blood, 0);
  // An eye out over the snout on its nerve.
  const eye = add(rim(0.04, 0.13, -0.055), [0.006, 0, 0]);
  m.add(strand([rim(0.034, 0.075, -0.005), rim(0.04, 0.125, -0.02), add(eye, [0, 0.012, 0])], 0.0038), L.meat, 0);
  m.add(sphere(eye, 0.0145), L.eye(eye, [0.2, -0.4, 0.9]), 0);
  // Scalp flaps peeled back down the sides and the back.
  for (const [x, z] of [[0.085, 0.0], [-0.085, -0.03], [0.03, -0.1]] as const) {
    flap(m, L, rim(x * 0.92, z * 0.92, -0.002), [x, 0, z], 0.03, 0.03);
  }
  // Ragged tissue over the front.
  for (const [x, l] of [[-0.05, 0.035], [0.0, 0.05], [0.05, 0.03]] as const) {
    const a = rim(x, 0.09, 0.0);
    m.add(strand([a, add(a, [0, -l * 0.4, 0.014]), add(a, [0.004, -l, 0.016])], 0.004), L.meat, 0, { k: 0.004 });
  }
}
