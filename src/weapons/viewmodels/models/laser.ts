/**
 * Tactical rail laser sight (weapons/mods.ts `<gun>Lam`): one compact low-profile laser aiming module that every rifle and
 * shotgun mounts on its rail or barrel clamp. Chamfered anodized housing, recessed steel windage/elevation turrets, rear rubber
 * activation pad, front bezel with glass optic and glowing red diode (`laser`), and a steel dovetail clamp on top (`+Y`) with
 * cross-bolt matching `light.ts` so `roll = Math.PI / 2` mounts flush on the right flank opposite the left-side weapon light.
 */
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import type { Model } from '../kit/model';
import { hexX, screwX, screwY } from '../kit/details';
import { poly } from '../kit/shapes';

/** The emitter diode's glow, for a model's `glows`: hot red, matching `billhook`, `ultramag` and `rivet`. */
export const LASER_GLOW = [0xff3020, 7] as const;

/** Top of the dovetail clamp over the laser's axis: matches `light.ts` `CLAMP_TOP` for clean mirrored mounting. */
export const LAM_CLAMP_TOP = 0.0135;

/** Emitter lens Z in the `lam` part's local frame (facing down -Z along the bore). */
export const LAM_EMIT_Z = -0.0365;

/** Reach of a rifle laser sight (metres), long enough to paint targets across outdoor lanes. */
export const RIFLE_LAM_RANGE = 100;

/** Reach of a sniper rifle laser sight (metres), for hip-fire and ACOG work on the Awl and Sabot. */
export const SNIPER_LAM_RANGE = 150;

/**
 * Part `lam` at `at` in the gun's frame, emitter facing -Z. `roll` turns it around its axis: `0` hangs under a rail,
 * `Math.PI / 2` mounts on the gun's right flank with the clamp reaching left into the gun, `-Math.PI / 2` on the left flank.
 */
export function weaponLam(m: Mesher, at: V3, roll = 0, scale = 1): void {
  m.part('lam', at, () => m.at([0, 0, 0], [0, 0, roll], () => m.scaled(scale, () => body(m))));
}

/** Registers the `lam` emitter socket on part `'lam'`, facing down -Z. */
export function lamSocket(model: Model, scale = 1): void {
  model.socket('lam', [0, 0, LAM_EMIT_Z * scale], [0, 0, 0], 'lam');
}

function body(m: Mesher): void {
  // Low-profile chamfered anodized aluminum housing pod.
  m.use(F.anodized);
  m.at([0, 0, 0], null, () => m.front(poly([
    [-0.0112, -0.0085, 0.0022], [-0.0085, -0.011, 0.002], [0.0085, -0.011, 0.002], [0.0112, -0.0085, 0.0022],
    [0.0112, 0.0062, 0.0012], [-0.0112, 0.0062, 0.0012],
  ], 0.0008), 0.06, { bevel: 0.0014 }));

  // Contrasting polymer accent plates along each side seam.
  m.use(F.polymer);
  m.mirror(() => m.at([0.0112, -0.0024, 0.002], null, () => m.box(0.0012, 0.0095, 0.042, 0.0004)));

  // Recessed windage & elevation zeroing turrets (steel slotted screws on the outer faces).
  screwY(m, 0, -0.0113, -0.006, 0.0024, F.steel);
  screwX(m, 0.0118, -0.0024, -0.008, 1, 0.0023, F.steel);
  screwX(m, -0.0118, -0.0024, -0.008, -1, 0.0023, F.steel);

  // Rear rubber activation pressure pad and knurled mode selector boss.
  m.use(F.rubber);
  m.at([0, -0.0022, 0.0315], null, () => m.box(0.0155, 0.013, 0.0034, 0.0009));
  m.use(F.steelDark);
  m.at([0.0048, -0.0022, 0.0332], null, () => m.cyl(0.0032, 0.0022, 12, 0.0004));

  // Forward laser aperture shroud, recessed black bezel, clear glass lens, and glowing red diode on the local Z axis.
  m.use(F.steelDark);
  m.at([0, 0, -0.0315], null, () => m.cyl(0.0068, 0.0052, 18, 0.0006));
  m.use(F.black);
  m.at([0, 0, -0.0344], null, () => m.cyl(0.0054, 0.0022, 16, 0.0004));
  // Secondary small dark sensor/IR eye tucked below the main red emitter.
  m.at([0, -0.0074, -0.031], null, () => m.cyl(0.0026, 0.0026, 12, 0.0003));
  m.glass(() => m.at([0, 0, -0.0356], null, () => m.cyl(0.0044, 0.0005, 16, 0)));
  m.glow('laser', () => m.at([0, 0, -0.0361], null, () => m.cyl(0.0012, 0.0003, 10, 0)));

  // Dovetail rail clamp on +Y (identical footprint to light.ts so roll = ±PI/2 seats flush on side rails).
  m.use(F.steelDark);
  m.side(poly([
    [0.019, 0.0055, 0.001], [0.019, 0.0105, 0.002], [0.0155, LAM_CLAMP_TOP, 0.001], [-0.0155, LAM_CLAMP_TOP, 0.001],
    [-0.019, 0.0105, 0.002], [-0.019, 0.0055, 0.001],
  ], 0.0006), 0.0205, { bevel: 0.0008 });
  m.use(F.black);
  m.at([0, LAM_CLAMP_TOP - 0.0004, 0], null, () => m.box(0.021, 0.0016, 0.0035, 0.0003));
  hexX(m, 0.0103, 0.0098, 0.004, 1, 0.0022);
  screwX(m, -0.0103, 0.0098, 0.004, -1, 0.0026, F.steel);
}
