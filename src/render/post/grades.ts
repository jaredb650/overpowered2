import type { GradeName } from '../../core/contracts';

/** One colour grade. Applied after tone mapping, in display-linear space. */
export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
  /** Added before the gain, so it lifts blacks. */
  lift: [number, number, number];
  gain: [number, number, number];
  /** Tints shadows and highlights separately. 0.5 grey is neutral. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Keeps one hue while the rest desaturates: 0 off, 1 full. Uses `keepHue` as the kept colour. */
  isolate: number;
  keepHue: [number, number, number];
  vignette: number;
  vignetteTint: [number, number, number];
  /** Coloured glow creeping in from the screen edge, the perk's calling card. */
  edgeGlow: number;
  bloom: number;
  grain: number;
}

const base: Grade = {
  exposure: 1,
  contrast: 1.08,
  saturation: 0.97,
  lift: [0, 0.001, 0.003],
  gain: [0.99, 1, 1.02],
  shadowTint: [0.46, 0.5, 0.58],
  highlightTint: [0.51, 0.5, 0.49],
  isolate: 0,
  keepHue: [1, 0, 0],
  vignette: 0.26,
  vignetteTint: [0, 0.005, 0.015],
  edgeGlow: 0,
  bloom: 1,
  grain: 0.022,
};

export const GRADES: Record<GradeName, Grade> = {
  default: base,
  // Hot orange: the world goes to embers, shadows stay red rather than black.
  hellfire: {
    ...base,
    exposure: 1.1, contrast: 1.16, saturation: 1.28,
    lift: [0.016, 0.003, 0], gain: [1.34, 0.86, 0.46],
    shadowTint: [0.66, 0.42, 0.3], highlightTint: [0.6, 0.5, 0.36],
    vignette: 0.42, vignetteTint: [0.12, 0.02, 0], edgeGlow: 0.42, bloom: 1.45, grain: 0.03,
  },
  // Blood red: red is the only hue left and everything else collapses toward it.
  berserk: {
    ...base,
    exposure: 1.05, contrast: 1.24, saturation: 1.2,
    lift: [0.02, 0, 0.002], gain: [1.42, 0.5, 0.46],
    shadowTint: [0.68, 0.32, 0.34], highlightTint: [0.62, 0.42, 0.42],
    isolate: 0.8, keepHue: [1, 0.02, 0.02],
    vignette: 0.55, vignetteTint: [0.16, 0, 0.005], edgeGlow: 0.55, bloom: 1.3, grain: 0.035,
  },
  // Cold, drained and crisp. Blacks lift, contrast returns in the mids, nothing is warm.
  slowmo: {
    ...base,
    exposure: 1.02, contrast: 1.22, saturation: 0.38,
    lift: [0.012, 0.022, 0.04], gain: [0.84, 0.99, 1.26],
    shadowTint: [0.4, 0.5, 0.68], highlightTint: [0.46, 0.51, 0.6],
    isolate: 0, vignette: 0.34, vignetteTint: [0, 0.01, 0.04], edgeGlow: 0.14, bloom: 1.1, grain: 0.03,
  },
  // Crimson: wine in the shadows, pink-white highlights. Softer than Berserk and it keeps its other hues.
  bloodthirst: {
    ...base,
    exposure: 1.03, contrast: 1.12, saturation: 1.15,
    lift: [0.014, 0, 0.006], gain: [1.2, 0.76, 0.84],
    shadowTint: [0.62, 0.38, 0.46], highlightTint: [0.58, 0.47, 0.5],
    isolate: 0.3, keepHue: [0.95, 0.03, 0.14],
    vignette: 0.42, vignetteTint: [0.1, 0, 0.03], edgeGlow: 0.34, bloom: 1.2, grain: 0.028,
  },
  // Toxic green: acid highlights over bruised, slightly purple shadows.
  adrenaline: {
    ...base,
    exposure: 1.1, contrast: 1.18, saturation: 1.3,
    lift: [0.002, 0.012, 0], gain: [0.82, 1.3, 0.62],
    shadowTint: [0.46, 0.56, 0.44], highlightTint: [0.47, 0.6, 0.36],
    vignette: 0.34, vignetteTint: [0.01, 0.07, 0], edgeGlow: 0.36, bloom: 1.25, grain: 0.03,
  },
  // Electric white-cyan: overexposed, high key, everything humming.
  overdrive: {
    ...base,
    exposure: 1.3, contrast: 1.12, saturation: 1.02,
    lift: [0.008, 0.024, 0.032], gain: [0.96, 1.2, 1.32],
    shadowTint: [0.4, 0.54, 0.62], highlightTint: [0.47, 0.54, 0.56],
    vignette: 0.2, vignetteTint: [0, 0.05, 0.08], edgeGlow: 0.42, bloom: 1.7, grain: 0.025,
  },
  // Drained: colour gone, contrast flat, the screen closing in.
  death: {
    ...base,
    exposure: 0.74, contrast: 0.9, saturation: 0.1,
    lift: [0.008, 0.007, 0.007], gain: [0.94, 0.9, 0.9],
    shadowTint: [0.5, 0.5, 0.5], highlightTint: [0.52, 0.5, 0.5],
    isolate: 0.55, keepHue: [0.8, 0.03, 0.03],
    vignette: 0.88, vignetteTint: [0.01, 0, 0], edgeGlow: 0, bloom: 0.6, grain: 0.05,
  },
};

export const GRADE_ORDER: readonly GradeName[] = ['default', 'hellfire', 'berserk', 'slowmo', 'bloodthirst', 'adrenaline', 'overdrive', 'death'];

function lerp3(out: [number, number, number], a: readonly number[], b: readonly number[], t: number): void {
  out[0] = a[0]! + (b[0]! - a[0]!) * t;
  out[1] = a[1]! + (b[1]! - a[1]!) * t;
  out[2] = a[2]! + (b[2]! - a[2]!) * t;
}

export function cloneGrade(g: Grade): Grade {
  return {
    ...g,
    lift: [...g.lift], gain: [...g.gain], shadowTint: [...g.shadowTint], highlightTint: [...g.highlightTint],
    keepHue: [...g.keepHue], vignetteTint: [...g.vignetteTint],
  };
}

export function lerpGrade(out: Grade, a: Grade, b: Grade, t: number): void {
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  out.contrast = a.contrast + (b.contrast - a.contrast) * t;
  out.saturation = a.saturation + (b.saturation - a.saturation) * t;
  out.isolate = a.isolate + (b.isolate - a.isolate) * t;
  out.vignette = a.vignette + (b.vignette - a.vignette) * t;
  out.edgeGlow = a.edgeGlow + (b.edgeGlow - a.edgeGlow) * t;
  out.bloom = a.bloom + (b.bloom - a.bloom) * t;
  out.grain = a.grain + (b.grain - a.grain) * t;
  lerp3(out.lift, a.lift, b.lift, t);
  lerp3(out.gain, a.gain, b.gain, t);
  lerp3(out.shadowTint, a.shadowTint, b.shadowTint, t);
  lerp3(out.highlightTint, a.highlightTint, b.highlightTint, t);
  lerp3(out.keepHue, a.keepHue, b.keepHue, t);
  lerp3(out.vignetteTint, a.vignetteTint, b.vignetteTint, t);
}
