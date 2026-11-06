/** Shared surface palette. Paint callbacks add the variation that stops surfaces reading as plastic. */
import { DETAIL_CLOTH, DETAIL_METAL, DETAIL_RUBBER, DETAIL_SKIN, type Mat, type MatSample } from '../model';
import { cell, cellEdge, clamp, fbm, noise, ridged, sstep, type V3 } from '../sdf';

export const hexc = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

const tintBy = (o: MatSample, f: number) => {
  o.r *= f; o.g *= f; o.b *= f;
};

/** Painted steel with chips and streaks. */
export function paintedMetal(color: number | V3, rough = 0.5, wear = 0.8): Mat {
  return {
    albedo: typeof color === 'number' ? hexc(color) : color,
    rough, metal: 0.25, detail: DETAIL_METAL, wear,
    paint: (x, y, z, o) => {
      const n = fbm(x * 9, y * 9, z * 9, 3);
      tintBy(o, 0.86 + n * 0.3);
      const streak = noise(x * 34, y * 3.5, z * 34);
      tintBy(o, 1 - sstep(0.15, 0.6, streak) * 0.22);
      o.rough = clamp(o.rough + n * 0.2);
      // Chips through the paint show bare steel, clustered where the plate takes the most abuse.
      const zone = sstep(0.05, 0.3, fbm(x * 5 + 7, y * 5, z * 5, 2));
      const chip = fbm(x * 58 + 3, y * 58, z * 58, 3) + zone * 0.1;
      if (chip > 0.4) {
        const t = sstep(0.4, 0.44, chip) * 0.7;
        o.r += (0.17 - o.r) * t; o.g += (0.17 - o.g) * t; o.b += (0.18 - o.b) * t;
        o.metal += (1 - o.metal) * t;
        o.rough += (0.42 - o.rough) * t;
      }
    },
  };
}

export const steel: Mat = {
  albedo: [0.46, 0.48, 0.5], rough: 0.42, metal: 1, detail: DETAIL_METAL, wear: 0.5,
  paint: (x, y, z, o) => {
    const n = fbm(x * 12, y * 12, z * 12, 3);
    tintBy(o, 0.85 + n * 0.3);
    o.rough = clamp(o.rough + n * 0.25);
  },
};

export const darkSteel: Mat = {
  albedo: [0.12, 0.13, 0.145], rough: 0.5, metal: 0.9, detail: DETAIL_METAL, wear: 1,
  paint: (x, y, z, o) => {
    const n = fbm(x * 12, y * 12, z * 12, 3);
    tintBy(o, 0.8 + n * 0.5);
    o.rough = clamp(o.rough + n * 0.3);
  },
};

export const rust: Mat = {
  albedo: [0.2, 0.135, 0.105], rough: 0.85, metal: 0.25, detail: DETAIL_METAL, wear: 0.2,
  paint: (x, y, z, o) => {
    const n = fbm(x * 30, y * 30, z * 30, 4);
    tintBy(o, 0.65 + (n + 0.5) * 0.7);
    const clean = sstep(0.05, 0.22, fbm(x * 8 + 9, y * 8, z * 8, 3));
    o.r += (0.3 - o.r) * clean; o.g += (0.31 - o.g) * clean; o.b += (0.33 - o.b) * clean;
    o.metal += (0.9 - o.metal) * clean;
    o.rough += (0.5 - o.rough) * clean;
  },
};

export const rubber: Mat = {
  albedo: [0.045, 0.045, 0.05], rough: 0.62, detail: DETAIL_RUBBER,
  paint: (x, y, z, o) => tintBy(o, 0.8 + fbm(x * 16, y * 16, z * 16, 2) * 0.7),
};

export const leather = (color: number | V3 = 0x2c2420): Mat => ({
  albedo: typeof color === 'number' ? hexc(color) : color, rough: 0.58, detail: DETAIL_RUBBER, wear: 0.35,
  paint: (x, y, z, o) => {
    const n = fbm(x * 18, y * 18, z * 18, 3);
    tintBy(o, 0.75 + (n + 0.5) * 0.55);
    o.rough = clamp(o.rough - n * 0.2);
  },
});

export const cloth = (color: number | V3, dirt = 0.5): Mat => ({
  albedo: typeof color === 'number' ? hexc(color) : color, rough: 0.9, detail: DETAIL_CLOTH,
  paint: (x, y, z, o) => {
    const n = fbm(x * 7, y * 7, z * 7, 4);
    tintBy(o, 0.82 + n * 0.5);
    const g = sstep(0.0, 0.4, fbm(x * 15 + 4, y * 5, z * 15, 3)) * dirt;
    o.r += (0.09 - o.r) * g * 0.6; o.g += (0.08 - o.g) * g * 0.6; o.b += (0.07 - o.b) * g * 0.6;
  },
});

export const bone: Mat = {
  albedo: [0.72, 0.66, 0.54], rough: 0.5, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 40, y * 40, z * 40, 3);
    tintBy(o, 0.8 + n * 0.5);
  },
};

export const glass: Mat = { albedo: [0.02, 0.025, 0.03], rough: 0.08, metal: 0.4, detail: DETAIL_METAL };

export const glow = (color: number | V3, strength = 1): Mat => ({
  albedo: typeof color === 'number' ? hexc(color) : color, rough: 0.35, emissive: strength, detail: DETAIL_METAL,
});

export const hazard = (a: number, b: number, width = 0.05): Mat => ({
  albedo: hexc(a), rough: 0.5, metal: 0.2, detail: DETAIL_METAL, wear: 1,
  paint: (x, y, z, o) => {
    const band = Math.floor((x + y + z * 0.3) / width) & 1;
    if (band) {
      const c = hexc(b);
      o.r = c[0]; o.g = c[1]; o.b = c[2];
    }
    const n = fbm(x * 14, y * 14, z * 14, 3);
    tintBy(o, 0.75 + n * 0.6);
  },
});

/** Pale, bruised human skin with mottling and vein webs. */
export const skin = (base: V3 = [0.58, 0.5, 0.46]): Mat => ({
  albedo: base, rough: 0.55, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const m = fbm(x * 6, y * 6, z * 6, 4);
    tintBy(o, 0.88 + m * 0.4);
    const bruise = sstep(0.12, 0.4, fbm(x * 3.5 + 8, y * 3.5, z * 3.5, 3));
    o.r += (0.3 - o.r) * bruise * 0.45; o.g += (0.2 - o.g) * bruise * 0.5; o.b += (0.27 - o.b) * bruise * 0.4;
    const vein = ridged(x * 13, y * 7, z * 13, 3);
    const v = sstep(0.62, 0.8, vein) * 0.34;
    o.r += (0.25 - o.r) * v; o.g += (0.28 - o.g) * v; o.b += (0.4 - o.b) * v;
  },
});

/** Raw striated muscle. Fibres run along `axis`, so limbs and torso get different grain. */
export const muscle = (axis: V3 = [0, 1, 0]): Mat => {
  const [ax, ay, az] = axis;
  return {
    albedo: [0.42, 0.075, 0.07], rough: 0.32, detail: DETAIL_SKIN,
    paint: (x, y, z, o) => {
      const along = x * ax + y * ay + z * az;
      const fx = x - along * ax, fy = y - along * ay, fz = z - along * az;
      const fibre = noise(fx * 190, fy * 190 + along * 11, fz * 190);
      tintBy(o, 0.72 + fibre * 0.45 + 0.28);
      const tendon = sstep(0.2, 0.5, fbm(x * 9, y * 3, z * 9, 3));
      o.r += (0.62 - o.r) * tendon * 0.55; o.g += (0.48 - o.g) * tendon * 0.55; o.b += (0.42 - o.b) * tendon * 0.55;
      o.rough += (0.42 - o.rough) * tendon;
    },
  };
};

export const scales = (color: number | V3): Mat => ({
  albedo: typeof color === 'number' ? hexc(color) : color, rough: 0.4, detail: DETAIL_RUBBER,
  paint: (x, y, z, o) => {
    const f1 = cell(x * 60, y * 60, z * 60);
    tintBy(o, 0.7 + sstep(0, 0.12, cellEdge(f1)) * 0.5);
  },
});
