/**
 * Shared hero ballistic riot shield 3D sub-assembly and animation helper for the four pistols
 * (`rivet`, `ultramag`, `judge`, `autoraffica`).
 *
 * Origin of the `shield` part sits at the exact centre of the narrow armoured viewing slit (`[0, 0, 0]`),
 * with the front ballistic strike face pointing along `-Z` and the rear padded forearm brace + angled steel
 * grip handle facing `+Z` toward the player.
 *
 * Built exclusively from bevelled `kit.ts` hard-surface profiles (`m.front`, `m.side`, `m.lathe`, `m.cyl`,
 * `m.tube`, `hexBolt`, `screw`, `rivet` — zero plain `m.box`).
 *
 * AnimState contract (zero changes to `def.ts` / `rig.ts`):
 * - `a.aim` (`0..1`): shield raise blend (`0` = carried low off to the left at hip; `1` = raised in front of
 *   the camera so the narrow armoured viewport slit frames the centre crosshair while the pistol peeks past
 *   the right firing scallop).
 * - `a.charge` (`0..1`): arm fatigue/exhaustion level (subtle arm tremor above `0.75`; sags when exhausted).
 * - `a.parry` (`0..1` when `>= 0`): crisp metallic recoil jolt straight back on blocked bullet impacts
 *   (strictly zero roll `z` or yaw twist `y` on `a.gunR`).
 */
import type { ModId } from '../../../core/gameplay';
import { clamp, lerp } from '../../../core/math';
import { bump, hold, inOut, outQuad, seg } from '../curves';
import type { Anim, ModLook, Tuple3 } from '../def';
import { hexBolt, rivet, screw } from '../kit/details';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher, type V3 } from '../kit/mesher';
import type { Model } from '../kit/model';
import { poly, rect, type V2 } from '../kit/shapes';
import { HANDS } from '../poses';

/** Sculptural tactical ballistic palette: dark ceramic-steel composite, brushed gunmetal trim, steel hardware. */
const ARMOR_PLATE: Finish = { color: 0x20252e, rough: 0.44, metal: 0.62, wear: 0.30 };
const ARMOR_APPLIQUE: Finish = { color: 0x272d38, rough: 0.40, metal: 0.72, wear: 0.34 };
const ARMOR_BEVEL: Finish = { color: 0x38404d, rough: 0.30, metal: 0.90, wear: 0.24, kind: Kind.brushed };
const ARMOR_DARK: Finish = { color: 0x15181f, rough: 0.56, metal: 0.52, wear: 0.16 };
const BOLT_STEEL: Finish = { color: 0x8e96a3, rough: 0.26, metal: 0.96, wear: 0.10, kind: Kind.brushed };

/**
 * View-space target when the shield is raised (`a.aim = 1`):
 * - `ModLook.sight` places the right-hand pistol cleanly at `[+0.218, -0.100, -0.38]`, level (`rot = [0, 0, 0]`).
 * - The shield part moves to `[-0.218, +0.100, +0.060]`, placing its narrow viewing slit `(0, 0, 0)` dead centre
 *   at view-space `[0, 0, -0.32]` while the pistol peeks clear past the right-side firing scallop.
 */
const RAISED_GUN_X = 0.218;
const RAISED_GUN_Y = -0.100;
const RAISED_GUN_Z = -0.380;

/** Rest pivot for studio turntable / `restingModel` composition (neatly beside the pistol with zero clipping). */
const SHIELD_REST: Tuple3 = [-0.215, 0.055, -0.030];

/** Lowered hip carry pose in gun space (low and off to the left so the sightline stays open while moving/shooting). */
const LOWERED_POS: Tuple3 = [-0.365, -0.065, 0.065];
const LOWERED_ROT: Tuple3 = [-0.12, 0.36, 0.08];

/** Raised combat guard pose in gun space (viewing slit dead centre on the crosshair, square to the camera). */
const RAISED_POS: Tuple3 = [-RAISED_GUN_X, -RAISED_GUN_Y, 0.060];
const RAISED_ROT: Tuple3 = [0, 0, 0];

/** Exported viewport slit clear-aperture bounds in shield-local XY (metres) for verification/tests. */
export const SHIELD_SLIT = {
  halfWidth: 0.078,
  halfHeight: 0.025,
  restPivot: SHIELD_REST,
  loweredPos: LOWERED_POS,
  raisedPos: RAISED_POS,
} as const;

/** Chamfered octagonal aperture outline for the narrow armoured viewing slit. */
function slitOutline(hw: number, hh: number, ch = 0.007, r = 0.0025): V2[] {
  return poly([
    [-hw + ch, -hh],
    [hw - ch, -hh],
    [hw, -hh + ch],
    [hw, hh - ch],
    [hw - ch, hh],
    [-hw + ch, hh],
    [-hw, hh - ch],
    [-hw, -hh + ch],
  ], r, 2);
}

/** Main ballistic shield outer silhouette with chamfered shoulders, tapered lower flanks, and right firing scallop. */
function shieldBodyOutline(): V2[] {
  return poly([
    [-0.120, -0.310, 0.008],
    [0.120, -0.310, 0.008],
    [0.155, -0.220, 0.008],
    [0.155, -0.112, 0.006],
    // Subtle right-side ergonomic pistol firing scallop so the pistol barrel/slide nests alongside cleanly.
    [0.138, -0.090, 0.006],
    [0.138, 0.006, 0.006],
    [0.155, 0.026, 0.006],
    [0.155, 0.068, 0.008],
    [0.112, 0.115, 0.010],
    [-0.112, 0.115, 0.010],
    [-0.155, 0.068, 0.008],
    [-0.155, -0.220, 0.008],
  ], 0.006, 3);
}

/**
 * Builds the shared ballistic riot shield as a `'shield'` part on `m` and returns its `ModLook`.
 *
 * NOTE: List `${gun}Shield` BEFORE optic mods (`${gun}Dot`, `judgeLong`) in `ViewDef.mods` so when the
 * riot shield is fitted, `rig.composeGun` uses the shield's side-peek stance instead of pulling the pistol
 * into centre-screen ADS.
 */
export function buildRiotShield(m: Mesher): ModLook {
  m.part('shield', SHIELD_REST, () => {
    const body = shieldBodyOutline();
    const slitHole = slitOutline(0.080, 0.026, 0.008, 0.002);

    // 1. Primary multi-layer ballistic ceramic/steel slab with real hollow viewing slit cutout.
    m.use(ARMOR_PLATE);
    m.at([0, 0, 0], null, () => m.front(body, 0.015, { bevel: 0.0032, holes: [slitHole], smooth: 38 }));

    // 2. Stepped laminated front ceramic strike-face applique plate on the lower glacis.
    const glacisOuter = poly([
      [-0.104, -0.286, 0.007],
      [0.104, -0.286, 0.007],
      [0.134, -0.208, 0.007],
      [0.134, -0.116, 0.006],
      [0.122, -0.098, 0.005],
      [0.122, -0.056, 0.005],
      [-0.134, -0.056, 0.006],
      [-0.134, -0.208, 0.007],
    ], 0.005, 2);
    m.use(ARMOR_APPLIQUE);
    m.at([0, 0, -0.010], null, () => m.front(glacisOuter, 0.0065, { bevel: 0.0024 }));

    // Central raised ballistic deflection spine down the lower glacis.
    m.use(ARMOR_BEVEL);
    const spine = poly([
      [-0.022, -0.272, 0.004],
      [0.022, -0.272, 0.004],
      [0.030, -0.068, 0.004],
      [-0.030, -0.068, 0.004],
    ], 0.004, 2);
    m.at([0, 0, -0.0145], null, () => m.front(spine, 0.004, { bevel: 0.0016 }));

    // 3. Heavy horizontal bevelled steel reinforcing ribs across the brow and lower glacis.
    m.use(ARMOR_BEVEL);
    const browRib = poly([
      [-0.104, 0.068, 0.003],
      [0.104, 0.068, 0.003],
      [0.092, 0.088, 0.003],
      [-0.092, 0.088, 0.003],
    ], 0.003, 2);
    m.at([0, 0, -0.0105], null, () => m.front(browRib, 0.0055, { bevel: 0.0016 }));

    const midRib = poly([
      [-0.138, -0.102, 0.003],
      [0.126, -0.102, 0.003],
      [0.126, -0.084, 0.003],
      [-0.138, -0.084, 0.003],
    ], 0.003, 2);
    m.at([0, 0, -0.014], null, () => m.front(midRib, 0.006, { bevel: 0.0018 }));

    const lowRib = poly([
      [-0.128, -0.212, 0.003],
      [0.128, -0.212, 0.003],
      [0.132, -0.194, 0.003],
      [-0.132, -0.194, 0.003],
    ], 0.003, 2);
    m.at([0, 0, -0.014], null, () => m.front(lowRib, 0.006, { bevel: 0.0018 }));

    // Subtle crimson Bureau tactical identification inlay on the upper-left brow rib.
    m.use(F.bureauRed);
    const stripe = poly([
      [-0.088, 0.074, 0.0015],
      [-0.044, 0.074, 0.0015],
      [-0.048, 0.082, 0.0015],
      [-0.084, 0.082, 0.0015],
    ], 0.001, 1);
    m.at([0, 0, -0.0138], null, () => m.front(stripe, 0.0018, { bevel: 0.0004 }));

    // Heavy left edge bumper guard and lower-right steel edge bumper rail.
    m.use(ARMOR_DARK);
    const leftRail = poly([
      [-0.158, -0.216, 0.003],
      [-0.146, -0.216, 0.002],
      [-0.146, 0.064, 0.002],
      [-0.158, 0.064, 0.003],
    ], 0.002, 2);
    m.at([0, 0, 0], null, () => m.front(leftRail, 0.020, { bevel: 0.0024 }));
    const rightLowRail = poly([
      [0.146, -0.216, 0.002],
      [0.158, -0.216, 0.003],
      [0.158, -0.114, 0.003],
      [0.146, -0.114, 0.002],
    ], 0.002, 2);
    m.at([0, 0, 0], null, () => m.front(rightLowRail, 0.020, { bevel: 0.0024 }));
    // Sculpted chamfered lip reinforcing the right firing scallop edge.
    const notchLip = poly([
      [0.132, -0.092, 0.002],
      [0.141, -0.092, 0.002],
      [0.141, 0.008, 0.002],
      [0.132, 0.008, 0.002],
    ], 0.002, 2);
    m.at([0, 0, 0], null, () => m.front(notchLip, 0.019, { bevel: 0.002 }));

    // 4. Reinforced bolted viewport bezel (front & rear) + recessed laminated ballistic glass pane.
    const bezelOuter = slitOutline(0.099, 0.043, 0.012, 0.003);
    const bezelInner = slitOutline(0.079, 0.0255, 0.007, 0.002);
    // Front bolted armoured viewport frame.
    m.use(ARMOR_BEVEL);
    m.at([0, 0, -0.0105], null, () => m.front(bezelOuter, 0.0085, { bevel: 0.0022, holes: [bezelInner], smooth: 36 }));
    // Angled top glare-deflector brow hood shielding the viewport glass from above.
    m.use(ARMOR_DARK);
    const glareHood = poly([
      [-0.088, 0.036, 0.002],
      [0.088, 0.036, 0.002],
      [0.094, 0.044, 0.002],
      [-0.094, 0.044, 0.002],
    ], 0.002, 2);
    m.at([0, 0.001, -0.017], [0.16, 0, 0], () => m.front(glareHood, 0.014, { bevel: 0.0018 }));

    // Rear viewport clamp bezel + matte rubberized interior eye-relief gasket (crisp FP framing!).
    m.use(ARMOR_BEVEL);
    m.at([0, 0, 0.009], null, () => m.front(bezelOuter, 0.006, { bevel: 0.0018, holes: [bezelInner], smooth: 36 }));
    m.use(F.rubber);
    const gasketOuter = slitOutline(0.084, 0.0305, 0.008, 0.002);
    const gasketInner = slitOutline(0.0785, 0.025, 0.007, 0.0018);
    m.at([0, 0, 0.012], null, () => m.front(gasketOuter, 0.0045, { bevel: 0.001, holes: [gasketInner], smooth: 40 }));

    // Clear tinted laminated ballistic glass pane recessed inside the viewing slit aperture.
    const glassPane = slitOutline(0.081, 0.027, 0.007, 0.0015);
    m.glass(() => m.at([0, 0, -0.001], null, () => m.front(glassPane, 0.003, { bevel: 0 })));

    // Front hex bolts clamping the ballistic glass frame & reinforcing ribs (rotated to face -Z).
    const frontBolts: readonly [number, number][] = [
      [-0.086, 0.034], [-0.032, 0.036], [0.032, 0.036], [0.086, 0.034],
      [-0.086, -0.034], [-0.032, -0.036], [0.032, -0.036], [0.086, -0.034],
    ];
    for (const [bx, by] of frontBolts) {
      m.at([bx, by, -0.0148], [0, Math.PI, 0], () => hexBolt(m, 0.0038, BOLT_STEEL));
    }
    // Lower glacis & rib structural rivets and hex bolts.
    const ribBolts: readonly [number, number, number][] = [
      [-0.118, -0.093, -0.017], [0.106, -0.093, -0.017],
      [-0.112, -0.203, -0.017], [0.112, -0.203, -0.017],
      [-0.082, -0.268, -0.0134], [0.082, -0.268, -0.0134],
    ];
    for (const [bx, by, bz] of ribBolts) {
      m.at([bx, by, bz], [0, Math.PI, 0], () => hexBolt(m, 0.0042, BOLT_STEEL));
    }
    for (const rx of [-0.068, -0.028, 0.028, 0.068]) {
      m.at([rx, -0.093, -0.0172], [0, Math.PI, 0], () => rivet(m, 0.0024, ARMOR_BEVEL));
      m.at([rx, -0.203, -0.0172], [0, Math.PI, 0], () => rivet(m, 0.0024, ARMOR_BEVEL));
    }

    // Rear viewport clamp screws (facing +Z toward the shooter for close-up FP detail).
    const rearScrews: readonly [number, number][] = [
      [-0.088, 0.033], [0, 0.0365], [0.088, 0.033],
      [-0.088, -0.033], [0, -0.0365], [0.088, -0.033],
    ];
    for (const [sx, sy] of rearScrews) {
      m.at([sx, sy, 0.0122], null, () => screw(m, 0.0028, BOLT_STEEL));
    }

    // 5. Dual front tactical LED strobe/blinder bezels recessed cleanly into the upper chamfered corners.
    m.mirror(() => {
      m.at([0.106, 0.070, -0.009], null, () => {
        m.use(ARMOR_DARK);
        m.lathe([
          [0.012, 0.002, 0],
          [0.012, -0.005],
          [0.0092, -0.007],
          [0.0076, -0.007],
          [0.0076, -0.003, 0],
        ], 18);
        m.use(F.black);
        m.lathe([[0, -0.0035, 0], [0.0075, -0.0035, 0]], 14, { chamfer: 0 });
        m.glass(() => m.at([0, 0, -0.006], null, () => m.cyl(0.0076, 0.001, 18, 0)));
      });
    });

    // 6. Rear padded forearm brace, tactical retention straps & angled tubular steel grip handle.
    // Bolted steel rear chassis mounting plate.
    m.use(ARMOR_DARK);
    const backPlate = poly([
      [-0.095, -0.242, 0.008],
      [0.056, -0.242, 0.008],
      [0.062, -0.068, 0.008],
      [-0.095, -0.068, 0.008],
    ], 0.006, 2);
    m.at([0, 0, 0.0105], null, () => m.front(backPlate, 0.0055, { bevel: 0.0016 }));
    for (const [bx, by] of [[-0.082, -0.082], [0.046, -0.082], [-0.082, -0.228], [0.046, -0.228]] as const) {
      m.at([bx, by, 0.0135], null, () => hexBolt(m, 0.0036, BOLT_STEEL));
    }

    // Ergonomic contoured neoprene forearm pad on the left-rear face.
    m.use(F.rubber);
    const padProfile = poly([
      [-0.094, -0.222, 0.012],
      [-0.036, -0.222, 0.012],
      [-0.032, -0.096, 0.012],
      [-0.094, -0.096, 0.012],
    ], 0.010, 3);
    m.at([0, 0, 0.019], null, () => m.front(padProfile, 0.014, { bevel: 0.0045, smooth: 48 }));

    // Twin arched nylon tactical forearm straps with brushed-steel quick-release buckles.
    for (const sy of [-0.125, -0.188]) {
      const strapPts: V3[] = [
        [-0.092, sy, 0.015],
        [-0.098, sy, 0.040],
        [-0.084, sy, 0.060],
        [-0.058, sy, 0.063],
        [-0.040, sy, 0.044],
        [-0.036, sy, 0.015],
      ];
      m.use(F.webbing);
      m.tube(strapPts, 0.0052, { seg: 8, samples: 16, caps: true });
      m.use(BOLT_STEEL);
      m.at([-0.068, sy, 0.063], null, () => m.front(rect(-0.010, -0.0085, 0.010, 0.0085, 0.002), 0.004, { bevel: 0.0009 }));
    }

    // Angled heavy-duty steel D-handle grip bar with machined clevis brackets & stippled rubber sleeve.
    // Upper and lower steel mounting clevises.
    m.use(ARMOR_BEVEL);
    const clevis = poly([
      [0.012, -0.010, 0.002],
      [0.052, -0.008, 0.003],
      [0.052, 0.008, 0.003],
      [0.012, 0.010, 0.002],
    ], 0.002, 2);
    m.at([0.002, -0.082, 0], null, () => m.side(clevis, 0.018, { bevel: 0.0018 }));
    m.at([0.022, -0.194, 0], null, () => m.side(clevis, 0.018, { bevel: 0.0018 }));

    // Tubular steel handle bar angled ~10° to follow the natural wrist angle of the left hand.
    const handlePts: V3[] = [
      [0.002, -0.082, 0.018],
      [0.002, -0.082, 0.052],
      [0.007, -0.100, 0.058],
      [0.017, -0.176, 0.058],
      [0.022, -0.194, 0.052],
      [0.022, -0.194, 0.018],
    ];
    m.use(ARMOR_BEVEL);
    m.tube(handlePts, 0.0072, { seg: 14, samples: 22, caps: true });

    // Ergonomic ribbed rubber grip sleeve wrapped around the central handle shaft.
    m.use(F.polymerStipple);
    m.at([0.012, -0.138, 0.058], [Math.PI / 2, 0, -0.175], () => {
      m.lathe([
        [0.0082, -0.044, 0],
        [0.0112, -0.040],
        [0.0124, -0.026],
        [0.0116, -0.014],
        [0.0126, 0.0],
        [0.0116, 0.014],
        [0.0124, 0.026],
        [0.0112, 0.040],
        [0.0082, 0.044, 0],
      ], 18, { chamfer: 0.001, smooth: 48 });
    });
  });

  // ModLook: when fitted, `rig.composeGun` smoothly shifts the pistol to the right-edge peek stance as `aim` rises.
  return {
    part: 'shield',
    sight: [-RAISED_GUN_X, -RAISED_GUN_Y, 0],
    rear: null,
    relief: -RAISED_GUN_Z,
  };
}

/**
 * Registers the left-hand shield grip socket (`shieldGripL`) parented to the `'shield'` part.
 * Keeps each pistol's `gripL` (`HANDS.pistolSupport`) completely untouched so `hands.test.ts` stays green.
 */
export function attachRiotShieldHand(model: Model): void {
  model.hand('shieldGripL', [0.004, -0.138, 0.062], [-0.18, 0.98, 0], [0.38, 0.06, -0.92], 'shield');
}

/**
 * Animates the riot shield part and left-arm grip in a pistol's `clip(a)` whenever `modId` is fitted.
 *
 * - Lowered (`a.aim = 0`): carried low and angled off to the left side out of the centre sightline.
 * - Raised (`a.aim = 1`): slides smoothly up to frame the crosshair cleanly through the narrow viewport slit.
 * - Fatigue (`a.charge` `0..1`): subtle tremor above `0.75`, exhausted sag as fatigue nears/hits `1.0`.
 * - Impact (`a.parry >= 0`): crisp straight-back metallic recoil jolt with zero gun roll or yaw twist.
 * - Reload (`a.reload >= 0`): dips shield clear of the pistol while the left hand loads the fresh magazine.
 */
export function animateRiotShield(a: Anim, modId: ModId): void {
  if (!a.mods?.has(modId)) return;
  const shield = a.parts.shield;
  if (!shield) return;

  const reload = a.reload;
  const reloadDrop = reload >= 0 ? hold(reload, 0.0, 0.12, 0.78, 0.92) : 0;
  const drawDrop = a.draw < 1 ? 1 - outQuad(clamp(a.draw)) : 0;

  // Raise blend [0..1]: suppressed cleanly during reloads and weapon draw.
  const raise = inOut(clamp(a.aim)) * (1 - reloadDrop) * (1 - drawDrop);

  // Fatigue tremor above 0.75 and exhausted sag when full fatigue forces the arm down.
  const fatigue = clamp(a.charge);
  const strain = seg(fatigue, 0.75, 1.0);
  const exhaustedSag = seg(fatigue, 0.96, 1.0);
  const tremorX = strain > 0 ? Math.sin(a.time * 42) * 0.0032 * strain * (0.35 + 0.65 * raise) : 0;
  const tremorY = strain > 0 ? Math.cos(a.time * 53 + 1.1) * 0.0026 * strain * (0.35 + 0.65 * raise) : 0;

  // Crisp metallic bullet-impact recoil jolt on the shield (never rolls or twists the gun).
  const impact = a.parry >= 0 ? bump(a.parry, 0.0, 0.85) : 0;

  const px = lerp(LOWERED_POS[0], RAISED_POS[0], raise) - reloadDrop * 0.10 + tremorX;
  const py = lerp(LOWERED_POS[1], RAISED_POS[1], raise) - reloadDrop * 0.18 - exhaustedSag * 0.055 + tremorY;
  const pz = lerp(LOWERED_POS[2], RAISED_POS[2], raise) + impact * 0.036;

  const rx = lerp(LOWERED_ROT[0], RAISED_ROT[0], raise) - reloadDrop * 0.35 - exhaustedSag * 0.16 + impact * 0.055;
  const ry = lerp(LOWERED_ROT[1], RAISED_ROT[1], raise) + reloadDrop * 0.25;
  const rz = lerp(LOWERED_ROT[2], RAISED_ROT[2], raise) + reloadDrop * 0.12;

  shield.position.set(px, py, pz);
  shield.rotation.set(rx, ry, rz);

  // Left hand grips the rear shield handle whenever not mid-reload, and returns smoothly as reload ends.
  const h = a.left;
  h.base = 'shieldGripL';
  if (reload < 0) {
    h.shape(HANDS.foregrip, 1);
  } else {
    const back = inOut(seg(reload, 0.78, 0.94));
    h.to('shieldGripL', back);
    h.shape(HANDS.foregrip, back);
  }
}
