/**
 * The weapon light (weapons/mods.ts `<gun>Light`): one compact tactical light every rifle, shotgun and pistol mounts. A squared
 * polymer body with chamfered corners, a finned anodized head round a chrome reflector, the LED (glow `torch`) behind a glass lens,
 * ambidextrous paddles and a rubber pad at the tail, and a steel rail clamp on top with its cross bolt. What it throws is the rig's
 * one spotlight (rig.ts `updateLight`), not this.
 */
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { hexX, screwX } from '../kit/details';
import { poly } from '../kit/shapes';

/** The LED's glow, for a model's `glows`: warm white, bright enough to bloom. */
export const TORCH = [0xfff3dc, 9] as const;

/** The top of the clamp over the light's axis: hang it under a surface at y by putting the axis at y - CLAMP_TOP. */
export const CLAMP_TOP = 0.0135;

/**
 * Part `light` at `at` in the gun's frame, the lens to -Z. `roll` turns it round its own axis: 0 hangs it under its clamp, -PI/2
 * puts it on the gun's left side with the clamp reaching right to the gun.
 */
export function weaponLight(m: Mesher, at: V3, roll = 0, scale = 1): void {
  m.part('light', at, () => m.at([0, 0, 0], [0, 0, roll], () => m.scaled(scale, () => body(m))));
}

function body(m: Mesher): void {
  // The body, square with chamfered corners, from the head's collar back to the tail.
  m.use(F.polymer);
  m.at([0, 0, 0.005], null, () => m.front(poly([
    [-0.0115, -0.0082, 0.003], [-0.0082, -0.0116, 0.002], [0.0082, -0.0116, 0.002], [0.0115, -0.0082, 0.003],
    [0.0115, 0.006, 0.001], [-0.0115, 0.006, 0.001],
  ], 0.0008), 0.05, { bevel: 0.0014 }));
  // A recessed seam down each flank.
  m.use(F.black);
  m.mirror(() => m.at([0.0113, -0.002, 0.008], null, () => m.box(0.0008, 0.0012, 0.034, 0.0002)));
  // The head: a finned collar stepping out to the bezel, in anodized aluminium.
  m.use(F.anodized);
  m.lathe([
    [0, -0.019, 0], [0.0104, -0.019], [0.0108, -0.021], [0.0124, -0.0245], [0.0124, -0.0385], [0.0117, -0.0405],
    [0.0099, -0.0405, 0], [0.0099, -0.0392, 0], [0, -0.0392, 0],
  ], 28);
  m.use(F.black);
  for (const z of [-0.0275, -0.031, -0.0345]) m.at([0, 0, z], null, () => m.pipe(0.0126, 0.0118, 0.0009, 28));
  // Reflector, LED and lens: the LED is the only light-coloured thing on the gun.
  m.use(F.chrome);
  m.at([0, 0, -0.0389], null, () => m.cyl(0.0098, 0.0008, 24, 0));
  m.glow('torch', () => m.at([0, 0, -0.0395], null, () => m.cyl(0.0034, 0.0006, 16, 0)));
  m.glow('torch', () => m.at([0, 0, -0.0394], null, () => m.pipe(0.0094, 0.0088, 0.0003, 28)));
  m.glass(() => m.at([0, 0, -0.04], null, () => m.cyl(0.0099, 0.0005, 24, 0)));
  // Tail: a rubber pressure pad and a paddle each side.
  m.use(F.rubber);
  m.at([0, -0.003, 0.031], null, () => m.box(0.017, 0.012, 0.003, 0.001));
  m.use(F.polymerGrey);
  m.mirror(() => m.at([0.0125, -0.0035, 0.026], null, () => m.side(poly([
    [0.008, -0.004, 0.002], [0.008, 0.003, 0.002], [-0.006, 0.0045, 0.002], [-0.0075, -0.002, 0.002],
  ], 0.0006), 0.0024, { bevel: 0.0006 })));
  // The clamp: a dovetail shoe over the body, its cross bolt one side and the thumb nut the other.
  m.use(F.steelDark);
  m.side(poly([
    [0.019, 0.0055, 0.001], [0.019, 0.0105, 0.002], [0.0155, CLAMP_TOP, 0.001], [-0.0155, CLAMP_TOP, 0.001],
    [-0.019, 0.0105, 0.002], [-0.019, 0.0055, 0.001],
  ], 0.0006), 0.0205, { bevel: 0.0008 });
  m.use(F.black);
  m.at([0, CLAMP_TOP - 0.0004, 0], null, () => m.box(0.021, 0.0016, 0.0035, 0.0003));
  hexX(m, 0.0103, 0.0098, 0.004, 1, 0.0022);
  screwX(m, -0.0103, 0.0098, 0.004, -1, 0.0026, F.steel);
}
