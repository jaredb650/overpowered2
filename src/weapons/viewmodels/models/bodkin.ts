/**
 * The Bodkin: Steyr ACR-inspired bullpup flechette rifle on key 1.
 *
 * Sculpted pale cool-grey polymer monocoque shell over a dark anodized inner chassis, shrouded barrel with recessed
 * ported flash hider, tall swept integrated carry-rib housing a built-in hollow low-power optic (replaced when the
 * 4x optic mod `bodkinAcog` is fitted), vertically reciprocating rising-block chamber visible through a side breech
 * window, bottom ejection chute ahead of the rear magazine well, and a translucent clear polymer bullpup magazine
 * behind the grip where stacked flechette cartridges visibly count down as rounds are fired.
 *
 * Origin near the top of the pistol grip; muzzle toward -Z.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slot, type V2 } from '../kit/shapes';
import { hexX, knurl, rail, screwX, serrations } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { OPTIC_GLOWS, acog, acogShade } from './optics';
import { TORCH, weaponLight } from './light';
import { LASER_GLOW, RIFLE_LAM_RANGE, lamSocket, weaponLam } from './laser';

/** Bore axis height above origin. */
const BORE = 0.042;
/** Top deck of the swept carry-rib bridge where either the integral optic or the 4x ACOG mounts. */
const RIB_DECK = 0.084;
/** Sight axis of the integrated low-power carry-rib optic. */
const RIB_AXIS = 0.104;
/** Longitudinal centre of the rear bullpup magazine well. */
const MAG_Z = 0.168;
/** Vertical mouth where the rear magazine emerges from the bullpup belly. */
const MAG_MOUTH_Y = -0.014;
/** Standard 24-round and extended 36-round magazine bottoms in mag part space. */
const STD_FOOT = -0.102;
const EXT_FOOT = -0.152;
const STD_TIERS = 8;
const EXT_TIERS = 12;
const TIER_STEP = 0.0102;
const TIER_TOP = -0.008;
/** Muzzle end of the recessed flash hider. */
const SHROUD_END = -0.452;
const MUZZLE = -0.494;
/** Where the 4x optic clamps onto the carry-rib rail deck. */
const OPTIC_AT = [0, RIB_DECK + 0.002, -0.04] as const;

/** Signature pale cool-grey / alabaster futuristic polymer monocoque shell. */
const SHELL_PALE: Finish = { color: 0xc5cad0, rough: 0.44, metal: 0.04, wear: 0.32 };
/** Secondary cool mid-grey polymer accent panels and carry-rib trim. */
const SHELL_TRIM: Finish = { color: 0x8f97a0, rough: 0.48, metal: 0.08, wear: 0.42 };
/** Pale brass/amber sabot casing for the stacked flechette cartridges. */
const DART_CASE: Finish = { color: 0xc4a464, rough: 0.34, metal: 0.28, wear: 0.05 };
/** High-visibility warm orange polymer magazine follower. */
const FOLLOWER: Finish = { color: 0xd9561a, rough: 0.46, metal: 0.04, wear: 0.1 };
/** Dense machined dark tungsten-carbide for the `bodkinTungsten` mod parts. */
const TUNGSTEN: Finish = { color: 0x2a2e36, rough: 0.25, metal: 0.96, wear: 0.14, kind: Kind.brushed };
/** Brushed dark titanium-alloy for the flared `bodkinMagwell` funnel. */
const MAGWELL_ALLOY: Finish = { color: 0x505660, rough: 0.32, metal: 0.84, wear: 0.38, kind: Kind.brushed };

/**
 * Dark anodized inner chassis core running beneath the pale polymer clamshell: provides crisp shadow gaps through
 * the cooling vents, frames the rising-block breech window, forms the bottom ejection chute, and anchors the barrel.
 */
function innerChassis(m: Mesher): void {
  m.use(F.anodized);
  // Central structural spine from butt to fore-end nose.
  const core = poly([
    [0.274, 0.058, 0.005], [0.274, -0.012, 0.004], [0.198, -0.014, 0.003],
    [0.138, -0.014, 0.003], [-0.075, -0.008, 0.004], [-0.368, 0.016, 0.004],
    [-0.376, 0.054, 0.004], [-0.26, 0.062, 0.006], [0.12, 0.064, 0.006],
  ], 0.002);
  m.side(core, 0.032, { bevel: 0.0014 });

  // Dark bevelled inner magazine-well lip flush with the bullpup belly.
  m.use(F.anodized);
  m.at([0, MAG_MOUTH_Y - 0.001, MAG_Z], null, () => m.top(rect(-0.0175, -0.0335, 0.0175, 0.0335, 0.003), 0.0055, {
    bevel: 0.001,
    holes: [rect(-0.0132, -0.0294, 0.0132, 0.0294, 0.0018)],
  }));

  // Bottom ejection chute recess ahead of the rear magazine well (aligned with `eject` socket).
  m.use(F.black);
  m.at([0, -0.0125, 0.085], null, () => m.box(0.02, 0.008, 0.058, 0.0012));
  m.use(F.steelDark);
  m.at([0, -0.0145, 0.085], null, () => {
    m.top(rect(-0.0135, -0.033, 0.0135, 0.033, 0.002), 0.0036, {
      bevel: 0.0008,
      holes: [rect(-0.0102, -0.028, 0.0102, 0.028, 0.0015)],
    });
  });

  // Recessed black pockets behind the side breech inspection slots and fore-end vents.
  m.use(F.black);
  m.mirror(() => {
    m.at([0.0155, 0.043, 0.082], null, () => m.box(0.006, 0.016, 0.052, 0.0008));
    m.at([0.0155, 0.044, -0.275], null, () => m.box(0.006, 0.016, 0.145, 0.001));
  });

  // Left-flank milled track for the non-reciprocating forward charging handle.
  m.use(F.black);
  m.at([-0.0185, 0.049, -0.155], null, () => m.box(0.005, 0.0075, 0.092, 0.0008));
}

/**
 * Smooth, sculpted pale polymer bullpup monocoque clamshell with generous rounded bevels, Steyr-style integrated
 * full-hand trigger bow, contoured cheek rest, grooved rubber buttpad, and ventilated fore-end shrouding the barrel.
 */
function bullpupShell(m: Mesher): void {
  // Main sculpted monocoque side shells closing cleanly and flush down to the rear magwell mouth.
  const shellProfile = poly([
    [0.282, 0.064, 0.009], [0.282, -0.048, 0.009], [0.205, -0.015, 0.006],
    [0.132, -0.013, 0.004], [0.035, -0.012, 0.006],
    [-0.088, -0.008, 0.006], [-0.365, 0.014, 0.007], [-0.382, 0.028, 0.006], [-0.382, 0.054, 0.006],
    [-0.352, 0.062, 0.008], [-0.02, 0.068, 0.01], [0.16, 0.068, 0.01],
  ], 0.004);

  // Angled futuristic cooling slots along the fore-end plus the rising-block breech inspection window.
  const vent = (z: number): V2[] => poly([
    [z, 0.038], [z - 0.022, 0.038], [z - 0.028, 0.051], [z - 0.006, 0.051],
  ], 0.0022);
  const vents = [vent(-0.212), vent(-0.248), vent(-0.284), vent(-0.32)];
  const breechWin = rect(0.058, 0.035, 0.106, 0.051, 0.0035);
  const chargeSlot = slot(-0.118, 0.049, -0.194, 0.049, 0.0036, 4);

  m.use(SHELL_PALE);
  // Left clamshell (with forward charging slot, vents, and breech window).
  m.at([-0.0165, 0, 0], null, () => {
    m.side(shellProfile, 0.011, { bevel: 0.0032, smooth: 55, holes: [...vents, breechWin, chargeSlot] });
  });
  // Right clamshell (with vents and breech window, no charging slot).
  m.at([0.0165, 0, 0], null, () => {
    m.side(shellProfile, 0.011, { bevel: 0.0032, smooth: 55, holes: [...vents, breechWin] });
  });

  // Sculpted upper spine cap bridging left & right shells cleanly along the top contour.
  m.use(SHELL_PALE);
  const topCap = poly([
    [0.278, 0.066, 0.008], [0.278, 0.052], [-0.365, 0.052], [-0.376, 0.058, 0.004],
    [-0.348, 0.064, 0.006], [-0.02, 0.070, 0.008], [0.16, 0.070, 0.008],
  ], 0.003);
  m.side(topCap, 0.036, { bevel: 0.0045, smooth: 55 });

  // Sculpted lower fore-end belly fairing (rounded cradle for the left support hand).
  m.use(SHELL_PALE);
  const belly = poly([
    [-0.088, 0.018], [-0.088, -0.007, 0.005], [-0.275, 0.002, 0.006], [-0.368, 0.015, 0.005],
    [-0.378, 0.026, 0.004], [-0.35, 0.028], [-0.088, 0.024],
  ], 0.003);
  m.side(belly, 0.035, { bevel: 0.005, smooth: 55 });

  // Secondary cool mid-grey sculpted side fairings, panel seams, and fasteners.
  m.use(SHELL_TRIM);
  m.mirror(() => {
    // Contoured rear stock flank inlay.
    const inlay = poly([
      [0.264, 0.036, 0.004], [0.264, -0.024, 0.006], [0.212, -0.008, 0.004], [0.212, 0.024, 0.004],
    ], 0.003);
    m.at([0.022, 0, 0], null, () => m.side(inlay, 0.0024, { bevel: 0.0008 }));
    // Sculpted upper-flank aerodynamic ridge running from breech to fore-end.
    m.at([0.0221, 0.058, -0.035], null, () => m.box(0.0018, 0.0038, 0.255, 0.0008));
    // Fore-end lower trim rail accent.
    m.at([0.0218, 0.019, -0.215], null, () => m.box(0.0026, 0.0085, 0.195, 0.0012));
    // Side tactile thumb-rest bevel above the pistol grip.
    m.at([0.0222, 0.012, 0.015], null, () => m.box(0.003, 0.012, 0.068, 0.0015));
    // Precision recessed hex fasteners securing the monocoque clamshell.
    screwX(m, 0.0222, 0.056, 0.242, 1, 0.0021);
    screwX(m, 0.0222, 0.056, 0.032, 1, 0.0021);
    screwX(m, 0.0222, 0.056, -0.105, 1, 0.0021);
    screwX(m, 0.0222, 0.022, -0.345, 1, 0.0019);
  });

  // Recessed mini-rail pads on both fore-end flanks for the weapon light (`bodkinLight`) and laser sight (`bodkinLam`).
  m.use(F.anodized);
  m.at([-0.0205, 0.016, -0.312], [0, 0, Math.PI / 2], () => rail(m, -0.024, 0.024, 0.014, F.anodized));
  m.at([0.0205, 0.016, -0.312], [0, 0, -Math.PI / 2], () => rail(m, -0.024, 0.024, 0.014, F.anodized));

  // Ultra-thin recessed cyan chamber-status glow line on the left upper flank (CLAUDE.md: thin inset line only).
  m.use(F.black);
  m.at([-0.0222, 0.0565, 0.082], null, () => m.box(0.0012, 0.0032, 0.044, 0.0003));
  m.glow('status', () => m.at([-0.0227, 0.0565, 0.082], null, () => m.box(0.0008, 0.0014, 0.038, 0)));

  // Textured dark polymer fore-end grip pad where the left support hand rests (`gripL`).
  m.use(F.polymerStipple);
  m.at([0, -0.001, -0.228], [0.05, 0, 0], () => m.box(0.032, 0.006, 0.135, 0.0022, 0.003));
  m.use(F.polymer);
  for (let i = 0; i < 6; i++) {
    m.at([0, -0.0042 + i * 0.0008, -0.175 - i * 0.019], null, () => m.box(0.031, 0.0022, 0.0055, 0.0007));
  }

  // Contoured dark rubber cheek rest over the rear action.
  m.use(F.polymer);
  m.at([0, 0.069, 0.195], null, () => m.top(rect(-0.0165, -0.072, 0.0165, 0.072, 0.008), 0.0055, { bevel: 0.0022 }));

  // Ribbed dark rubber buttpad capping the bullpup tail.
  m.use(F.rubber);
  const butt = poly([
    [0.278, 0.068, 0.005], [0.296, 0.065, 0.006], [0.297, -0.052, 0.006], [0.278, -0.054, 0.005],
  ], 0.004);
  m.side(butt, 0.044, { bevel: 0.004, smooth: 50 });
  m.use(F.polymer);
  for (let i = 0; i < 6; i++) {
    m.at([0, 0.048 - i * 0.018, 0.2965], null, () => m.box(0.036, 0.004, 0.0028, 0.0008));
  }

  // Rear magazine release paddle (ambidextrous dark steel paddle tucked just behind the rear magwell).
  m.use(F.steelDark);
  m.at([0, -0.022, 0.204], [-0.25, 0, 0], () => m.box(0.022, 0.018, 0.009, 0.0018));

  // Subtle original serial/calibre stencil decals on the left receiver flank (no real brands/logos).
  m.at([-0.0224, 0.022, 0.095], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.038, 0.0044, 0x3b4048));
  m.at([-0.0224, 0.028, -0.145], [0, -Math.PI / 2, 0], () => m.decal('op2', 0.022, 0.0055, 0x3b4048));
}

/**
 * Integrated contoured bullpup pistol grip with the iconic Steyr-style sweeping full-hand guard bow enclosing
 * the trigger and knuckles, plus dark stippled grip inlays.
 */
function gripAndGuard(m: Mesher): void {
  // Sculpted pale polymer grip body sweeping down from the monocoque hull.
  const front = curve([[-0.022, -0.006], [-0.022, -0.032], [-0.015, -0.058], [-0.006, -0.088], [0.002, -0.114]], 5);
  const back = curve([[0.056, -0.114], [0.048, -0.082], [0.04, -0.048], [0.036, -0.022], [0.034, -0.006]], 5);
  m.use(SHELL_PALE);
  m.side([...front, [0.005, -0.12], [0.054, -0.12], ...back], 0.033, { bevel: 0.0042, smooth: 55 });

  // Dark stippled polymer grip inlays along the flanks and backstrap for tactile contrast.
  const stippleFront = curve([[-0.015, -0.024], [-0.01, -0.056], [-0.002, -0.086], [0.004, -0.106]], 4);
  const stippleBack = curve([[0.049, -0.106], [0.042, -0.078], [0.036, -0.046], [0.032, -0.024]], 4);
  m.use(F.polymerStipple);
  m.side([...stippleFront, ...stippleBack], 0.0352, { bevel: 0.0022, smooth: 45 });

  // Dark rubberized grip heel cap.
  m.use(F.polymer);
  m.at([0, -0.122, 0.029], null, () => m.box(0.031, 0.006, 0.052, 0.0018, 0.003));

  // Sweeping Steyr ACR-inspired full-hand trigger guard bow.
  m.use(SHELL_PALE);
  const bowOut = poly([
    [-0.095, -0.005], [-0.092, -0.028, 0.01], [-0.072, -0.088, 0.018],
    [-0.044, -0.116, 0.016], [0.012, -0.118, 0.008], [0.012, -0.102],
    [-0.04, -0.102, 0.01], [-0.062, -0.078, 0.012], [-0.076, -0.024, 0.008], [-0.076, -0.005],
  ], 0.003);
  m.side(bowOut, 0.019, { bevel: 0.0028, smooth: 50 });

  // Inner dark polymer knuckle-guard liner inside the bow front.
  m.use(F.polymer);
  const bowLiner = poly([
    [-0.082, -0.018], [-0.072, -0.072, 0.01], [-0.054, -0.098, 0.008],
    [-0.046, -0.094, 0.006], [-0.064, -0.068, 0.008], [-0.074, -0.018],
  ], 0.002);
  m.side(bowLiner, 0.015, { bevel: 0.0012 });

  // Ambidextrous push-button cross-bolt safety above the trigger.
  m.use(F.steelDark);
  m.at([0, -0.002, -0.012], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.038, 12));
}

/**
 * Tall, swept futuristic carry-rib bridge rising on angled pylons with a real hollow lightening arch underneath.
 * Top deck carries a dark anodized micro-rail that seats either the integrated low-power rib optic (`ribOptic`)
 * or the shop's 4x ACOG (`bodkinAcog`).
 */
function carryRib(m: Mesher): void {
  // Structural swept bridge in pale polymer with an arched lightening cutout underneath.
  m.use(SHELL_PALE);
  const outer = poly([
    [0.096, 0.065, 0.004], [0.056, RIB_DECK, 0.006], [-0.218, RIB_DECK, 0.006],
    [-0.278, 0.061, 0.006], [-0.242, 0.059], [0.072, 0.062],
  ], 0.003);
  const arch = poly([
    [0.046, 0.066, 0.004], [0.022, 0.0755, 0.004], [-0.188, 0.0755, 0.004], [-0.222, 0.063, 0.004],
  ], 0.003);
  m.side(outer, 0.026, { bevel: 0.0026, smooth: 45, holes: [arch] });

  // Side accent grooves on the carry-rib bridge flanks.
  m.use(SHELL_TRIM);
  m.mirror(() => {
    m.at([0.0132, 0.0795, -0.082], null, () => m.box(0.0016, 0.0036, 0.245, 0.0006));
  });

  // Low-profile dark anodized mounting rail flush along the top of the carry-rib bridge.
  m.at([0, RIB_DECK - 0.002, 0], null, () => rail(m, 0.035, -0.185, 0.0195, F.anodized));

  // Built-in low-power integrated carry-rib optic (shown by default via `ViewDef.irons`; hidden when `bodkinAcog` is fitted).
  // Designed with a wide, short optical viewing aperture (`r = 0.0155`, length `0.092 m`) inside sculpted tapered pale
  // fairings so the side silhouette reads as the iconic long ACR carry-rib optic while ADS gives a huge, bright,
  // unobstructed sight picture with zero tunnel occlusion.
  m.part('ribOptic', [0, 0, 0], () => {
    const boreR = 0.0158;
    const podProf = poly([
      [-0.0205, RIB_DECK], [0.0205, RIB_DECK], [0.0225, RIB_AXIS - 0.003, 0.004],
      [0.0185, RIB_AXIS + 0.0205, 0.006], [-0.0185, RIB_AXIS + 0.0205, 0.006], [-0.0225, RIB_AXIS - 0.003, 0.004],
    ], 0.003);
    const boreHole = circle(0, RIB_AXIS, boreR + 0.0008, 32);

    // Main central hollow optical pod (short enough for wide open ADS field of view).
    m.use(SHELL_PALE);
    m.at([0, 0, -0.068], null, () => m.front(podProf, 0.092, { bevel: 0.0022, smooth: 50, holes: [boreHole] }));

    // Low-profile sculpted front & rear fairing skirts along the rib deck below the bore line (keep the iconic long
    // Steyr ACR carry-rib silhouette in side/hip views while staying completely below the ADS viewing aperture!).
    m.use(SHELL_PALE);
    m.side(poly([
      [0.042, RIB_DECK], [0.015, RIB_DECK + 0.007, 0.003], [-0.022, RIB_DECK + 0.007], [-0.022, RIB_DECK],
    ], 0.002), 0.028, { bevel: 0.0018 });
    m.side(poly([
      [-0.114, RIB_DECK], [-0.114, RIB_DECK + 0.007], [-0.175, RIB_DECK + 0.006, 0.003], [-0.205, RIB_DECK],
    ], 0.002), 0.028, { bevel: 0.0018 });

    // Cool mid-grey side accent ribs and subtle top backup-sight rails flanking the pod crown.
    m.use(SHELL_TRIM);
    m.mirror(() => {
      m.at([0.0218, RIB_AXIS - 0.002, -0.068], null, () => m.box(0.0018, 0.0055, 0.084, 0.0007));
      m.at([0.0055, RIB_AXIS + 0.0215, -0.068], null, () => m.box(0.0024, 0.002, 0.082, 0.0006));
    });

    // Dark anodized thin-walled inner optical ring and rear rubber eye cushion.
    m.use(F.anodized);
    m.at([0, RIB_AXIS, -0.068], null, () => m.pipe(boreR + 0.0012, boreR - 0.0006, 0.096, 36));
    m.use(F.rubber);
    m.at([0, RIB_AXIS, -0.019], null, () => m.pipe(boreR + 0.0026, boreR - 0.0004, 0.007, 36));
    // Crisp low-profile windage & elevation adjustment turrets.
    m.use(F.steelDark);
    m.at([0.0228, RIB_AXIS, -0.064], [0, Math.PI / 2, 0], () => knurl(m, 0.0046, 0.003, F.steelDark, 14, 0.0004));
    m.at([0, RIB_AXIS + 0.022, -0.064], [Math.PI / 2, 0, 0], () => knurl(m, 0.0046, 0.003, F.steelDark, 14, 0.0004));

    // Single crisp clear front optical glass lens.
    m.glass(() => {
      m.at([0, RIB_AXIS, -0.106], null, () => m.cyl(boreR - 0.0006, 0.0006, 32, 0));
    });

    // Crisp illuminated aiming reticle: warm amber-red central flechette pip + fine open horizontal & drop ticks.
    m.glow('reticle', () => {
      m.at([0, RIB_AXIS, -0.088], null, () => {
        m.cyl(0.00062, 0.0002, 14, 0);
        m.at([-0.0046, 0, 0], null, () => m.box(0.0034, 0.00032, 0.0002, 0));
        m.at([0.0046, 0, 0], null, () => m.box(0.0034, 0.00032, 0.0002, 0));
        m.at([0, -0.0046, 0], null, () => m.box(0.00032, 0.0034, 0.0002, 0));
      });
    });
  });
}

/**
 * Full-length shrouded barrel covered nearly to the muzzle, terminating in a sleek recessed 4-port flash hider.
 */
function barrelAndShroud(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    // Inner precision flechette barrel (visible through the fore-end vents).
    m.use(F.barrel);
    m.lathe([[0.0092, -0.12, 0], [0.0092, -0.375], [0.0086, SHROUD_END, 0]], 20);

    // Outer dark anodized fluted shroud projecting out of the pale polymer nose.
    m.use(F.anodized);
    m.lathe([
      [0.0142, -0.368, 0], [0.0142, -0.382], [0.0128, -0.39], [0.0128, SHROUD_END + 0.006],
      [0.0114, SHROUD_END], [0.009, SHROUD_END, 0],
    ], 24);
    // Longitudinal heat-dissipation flutes along the exposed shroud sleeve.
    m.use(F.steelDark);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      m.at([Math.cos(a) * 0.0126, Math.sin(a) * 0.0126, -0.422], [0, 0, a], () => {
        m.box(0.0014, 0.0024, 0.052, 0.0004);
      });
    }

    // Sleek recessed ported flash hider at the muzzle.
    m.use(F.barrelBlack);
    m.lathe([
      [0.009, SHROUD_END + 0.002, 0], [0.0114, SHROUD_END - 0.002], [0.0114, MUZZLE + 0.005],
      [0.0102, MUZZLE], [0.0056, MUZZLE, 0],
    ], 22);
    // Four symmetrical radial flash-hider slots + deep dark bore.
    m.use(F.black);
    for (const a of [-1.15, -0.42, 0.42, 1.15]) {
      m.at([Math.sin(a) * 0.0112, Math.cos(a) * 0.0112, (SHROUD_END + MUZZLE) / 2], [0, 0, -a], () => {
        m.box(0.0024, 0.0014, 0.024, 0);
      });
    }
    m.lathe([[0.0056, MUZZLE + 0.0004, 0], [0.0048, MUZZLE + 0.028, 0], [0, MUZZLE + 0.03, 0]], 14);
  });
}

/**
 * One staggered double-column row of Steyr ACR-style flechette cartridges (sabot casing + gleaming steel dart tip)
 * inside the clear polymer magazine.
 */
function flechetteRow(m: Mesher, y: number, idx: number): void {
  const xOff = idx % 2 === 0 ? -0.0028 : 0.0028;
  for (const side of [-1, 1] as const) {
    const x = side * 0.0044 + xOff * 0.35;
    const yy = y + (side > 0 ? 0.0014 : -0.0014);
    m.at([x, yy, 0], null, () => {
      // Translucent-amber/brass cylindrical sabot case.
      m.use(DART_CASE);
      m.lathe([
        [0, 0.0225, 0], [0.0038, 0.0225], [0.0038, -0.011], [0.003, -0.014], [0.0016, -0.014, 0],
      ], 10, { chamfer: 0.0002 });
      // Gleaming steel flechette dart needle protruding from the sabot mouth.
      m.use(F.chrome);
      m.lathe([
        [0.0016, -0.013, 0], [0.0015, -0.019], [0.0004, -0.0235], [0, -0.024, 0],
      ], 8, { chamfer: 0 });
    });
  }
}

/**
 * Builds one translucent clear polymer bullpup rear magazine (either 24-rd `magStd` or 36-rd `magExt`), complete
 * with structural spine ribs, clear glass sidewalls, individually toggleable flechette cartridge tiers, a rising
 * high-visibility orange follower, a stretching coil spring, and a dark tungsten ammo-ID wrap for `bodkinTungsten`.
 */
function clearMagBody(
  m: Mesher,
  foot: number,
  tiers: number,
  tierPrefix: string,
  followerName: string,
  springName: string,
  tungstenName: string,
  ext: boolean,
): void {
  const topY = 0.034;
  const h = topY - foot;
  const midY = (topY + foot) / 2;

  // Front and rear structural polymer spine rails leaving the wide flanks completely transparent.
  m.use(SHELL_TRIM);
  m.at([0, midY, -0.0268], null, () => m.box(0.0246, h, 0.0042, 0.001));
  m.at([0, midY, 0.0268], null, () => m.box(0.0246, h, 0.0042, 0.001));

  // Upper feed-lip collar (steel lips seated inside the bullpup receiver).
  m.use(F.steelDark);
  m.mirror(() => m.at([0.0102, topY + 0.002, 0], null, () => m.box(0.0026, 0.007, 0.048, 0.0006)));
  m.use(SHELL_TRIM);
  m.at([0, 0.016, 0], null, () => m.top(rect(-0.0124, -0.0285, 0.0124, 0.0285, 0.0018), 0.03, {
    bevel: 0.0008,
    holes: [rect(-0.0098, -0.0245, 0.0098, 0.0245, 0.001)],
  }));

  // Moulded horizontal waffle/capacity reinforcement ribs framing the clear polymer flanks.
  m.use(SHELL_TRIM);
  m.mirror(() => {
    for (let y = -0.024; y > foot + 0.016; y -= 0.028) {
      m.at([0.0123, y, 0], null, () => m.box(0.0012, 0.0024, 0.052, 0.0004));
    }
  });

  // Sculpted dark polymer floorplate (standard) or flared rubberized tactical bumper pad (36-rd extended).
  if (ext) {
    m.use(F.anodized);
    m.at([0, foot - 0.005, 0], null, () => m.side(poly([
      [-0.031, 0.006], [0.031, 0.006], [0.033, -0.006, 0.003], [-0.033, -0.006, 0.003],
    ], 0.0015), 0.0295, { bevel: 0.0016 }));
    m.use(F.rubber);
    m.at([0, foot - 0.0125, 0], null, () => m.box(0.027, 0.0042, 0.062, 0.0014, 0.002));
    // Tactile grip ribs around the lower extended collar.
    m.use(F.polymer);
    for (let i = 0; i < 3; i++) {
      m.at([0, foot + 0.012 + i * 0.0085, 0], null, () => m.top(rect(-0.0134, -0.0298, 0.0134, 0.0298, 0.002), 0.0032, {
        bevel: 0.0006,
        holes: [rect(-0.0108, -0.0255, 0.0108, 0.0255, 0.001)],
      }));
    }
  } else {
    m.use(F.polymer);
    m.at([0, foot - 0.004, 0], null, () => m.box(0.028, 0.008, 0.061, 0.0016, 0.0024));
    m.use(F.rubber);
    m.at([0, foot - 0.0085, 0], null, () => m.box(0.025, 0.0025, 0.056, 0.0008));
  }

  // Individually toggleable stacked flechette cartridge tiers inside the clear window (each tier = 1 burst of 3!).
  for (let i = 0; i < tiers; i++) {
    const y = TIER_TOP - i * TIER_STEP;
    m.part(`${tierPrefix}${i}`, [0, 0, 0], () => flechetteRow(m, y, i));
  }

  // High-visibility orange follower plate that rises tightly beneath the lowest remaining dart tier.
  const followerRestY = TIER_TOP - tiers * TIER_STEP - 0.002;
  m.part(followerName, [0, followerRestY, 0], () => {
    m.use(FOLLOWER);
    m.box(0.019, 0.0068, 0.047, 0.0012);
    m.use(F.polymer);
    m.at([0, -0.0035, 0], null, () => m.box(0.016, 0.003, 0.042, 0.0006));
  });

  // Anchored steel zig-zag magazine spring below the follower; scales smoothly upward in `animate(a)` as rounds empty.
  const springFloorY = foot + 0.004;
  m.part(springName, [0, springFloorY, 0], () => {
    m.use(F.steel);
    const pts: [number, number, number][] = [];
    const coils = ext ? 7 : 5;
    for (let i = 0; i <= coils; i++) {
      const t = i / coils;
      const z = (i % 2 === 0 ? -1 : 1) * 0.016;
      pts.push([0, t * 0.008, z]);
    }
    m.tube(pts, 0.0011, { seg: 6, straight: true, caps: true });
  });

  // Visual cue for `bodkinTungsten` on the magazine: machined dark-tungsten sabot witness collar & dark tips marker.
  m.part(tungstenName, [0, 0, 0], () => {
    m.use(TUNGSTEN);
    const bandY = foot + 0.008;
    m.at([0, bandY, 0], null, () => m.top(rect(-0.0135, -0.0295, 0.0135, 0.0295, 0.0018), 0.0075, {
      bevel: 0.0007,
      holes: [rect(-0.0112, -0.0258, 0.0112, 0.0258, 0.001)],
    }));
    // Thin copper-bronze ordnance ring contrasting against the dark tungsten collar.
    m.use(F.copper);
    m.mirror(() => m.at([0.0136, bandY, 0], null, () => m.box(0.0008, 0.0022, 0.048, 0.0002)));
    // Dark tungsten-tipped top witness darts visible right below the magwell lip.
    for (let i = 0; i < 3; i++) {
      const y = TIER_TOP - i * TIER_STEP;
      m.at([0, y, -0.019], null, () => {
        m.use(TUNGSTEN);
        m.mirror(() => m.at([0.0044, 0, 0], null, () => m.lathe([[0.002, 0.005, 0], [0.0018, -0.001], [0.0005, -0.0055], [0, -0.006, 0]], 8, { chamfer: 0 })));
      });
    }
  });

  // Translucent smoky-clear polymer sidewalls (`mats.glass`, renderOrder 2, depthWrite false).
  m.glass(() => {
    const wallH = h - 0.016;
    const wallY = (topY - 0.012 + foot + 0.004) / 2;
    m.mirror(() => {
      m.at([0.0118, wallY, 0], null, () => m.box(0.0012, wallH, 0.049, 0.0004));
    });
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, MAG_MOUTH_Y, MAG_Z], () => {
    m.part('magStd', [0, 0, 0], () => {
      clearMagBody(m, STD_FOOT, STD_TIERS, 'dartStd', 'followerStd', 'springStd', 'tungstenMagStd', false);
    });
    m.part('magExt', [0, 0, 0], () => {
      clearMagBody(m, EXT_FOOT, EXT_TIERS, 'dartExt', 'followerExt', 'springExt', 'tungstenMagExt', true);
    });
  });
}

/**
 * Mechanical mod parts visible both in first-person and on the shop studio turntable:
 * - `bodkinBurst5` (`burstCam`): ambidextrous machined billet 5-round burst ratchet/cam selector housing on both flanks.
 * - `bodkinTungsten` (`tungstenMuzzle`, `tungstenBreech`): dark-tungsten fluted muzzle collar & breech reinforcement plate.
 * - `bodkinMagwell` (`magwell`): CNC-machined flared titanium-alloy magwell funnel around the rear bullpup well.
 */
function modParts(m: Mesher): void {
  // Ambidextrous 5-round burst mechanical cam / selector housing (`bodkinBurst5`), readable from both FP and shop studio.
  m.part('burstCam', [0, 0, 0], () => {
    m.mirror(() => {
      m.use(F.anodized);
      m.at([0.0232, 0.022, 0.026], null, () => {
        m.side(poly([
          [0.022, 0.012, 0.003], [0.022, -0.01, 0.003], [-0.02, -0.012, 0.003], [-0.026, 0.002, 0.003], [-0.018, 0.013, 0.003],
        ], 0.002), 0.0052, { bevel: 0.0011 });
      });
      // Exposed steel mechanical burst-ratchet drum + knurled cap.
      m.at([0.0264, 0.023, 0.022], [0, Math.PI / 2, 0], () => {
        knurl(m, 0.0072, 0.0034, F.steel, 10, 0.0006);
      });
      m.use(F.steelDark);
      m.at([0.0282, 0.023, 0.022], [0, Math.PI / 2, 0], () => m.cyl(0.0044, 0.0018, 12));
      // Selector lever arm pointing toward the 5-burst notch.
      m.at([0.0278, 0.027, 0.011], [0.35, 0, 0], () => m.box(0.0028, 0.0038, 0.016, 0.0007));
      // Machined 5-notch index ridge in warm brass accent.
      m.use(F.brass);
      for (let i = 0; i < 5; i++) {
        m.at([0.026, 0.0155, 0.036 - i * 0.0036], null, () => m.box(0.0012, 0.0032, 0.0014, 0.0002));
      }
      hexX(m, 0.0258, 0.0305, 0.041, 1, 0.0016);
      hexX(m, 0.0258, 0.0145, 0.007, 1, 0.0016);
    });
  });

  // Full-auto sear pack & selector housing (`bodkinAuto`), mutually exclusive with `bodkinBurst5`.
  m.part('autoSear', [0, 0, 0], () => {
    m.mirror(() => {
      m.use(F.steelDark);
      m.at([0.0232, 0.022, 0.026], null, () => {
        m.side(poly([
          [0.024, 0.012, 0.003], [0.024, -0.011, 0.003], [-0.022, -0.012, 0.003], [-0.026, 0.004, 0.003], [-0.016, 0.013, 0.003],
        ], 0.002), 0.0052, { bevel: 0.0011 });
      });
      // Exposed steel auto-sear pivot & swept full-auto selector lever with red firing indicator bar.
      m.use(F.steel);
      m.at([0.0264, 0.023, 0.022], [0, Math.PI / 2, 0], () => m.cyl(0.0064, 0.0034, 14, 0.0006));
      m.use(F.anodized);
      m.at([0.0278, 0.022, 0.01], [-0.08, 0, 0], () => m.box(0.003, 0.0042, 0.018, 0.0008));
      m.use(F.bureauRed);
      m.at([0.0261, 0.0155, 0.028], null, () => m.box(0.0012, 0.0034, 0.022, 0.0002));
      hexX(m, 0.0258, 0.0305, 0.041, 1, 0.0016);
      hexX(m, 0.0258, 0.0145, 0.007, 1, 0.0016);
    });
  });

  // Tungsten darts heavy muzzle collar (`bodkinTungsten`).
  m.part('tungstenMuzzle', [0, BORE, 0], () => {
    m.use(TUNGSTEN);
    // Heavy fluted tungsten reinforcement collar over the barrel shroud & muzzle brake crown.
    m.lathe([
      [0.013, -0.415, 0], [0.0156, -0.418], [0.0158, -0.456], [0.0142, -0.464],
      [0.0138, -0.486], [0.012, MUZZLE + 0.001], [0.0108, MUZZLE + 0.001, 0],
    ], 24);
    // Machined high-pressure relief ribs & warm copper thermal band.
    m.use(F.copper);
    m.at([0, 0, -0.436], null, () => m.cyl(0.0161, 0.0038, 24));
    m.use(F.black);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      m.at([Math.cos(a) * 0.0154, Math.sin(a) * 0.0154, -0.448], [0, 0, a], () => {
        m.box(0.0016, 0.0026, 0.018, 0);
      });
    }
  });

  // Tungsten breech reinforcement surround (`bodkinTungsten` `also`).
  m.part('tungstenBreech', [0, 0, 0], () => {
    m.mirror(() => {
      m.use(TUNGSTEN);
      m.at([0.0226, 0, 0], null, () => {
        m.side(
          poly([[0.114, 0.056, 0.003], [0.114, 0.029, 0.003], [0.05, 0.029, 0.003], [0.05, 0.056, 0.003]], 0.002),
          0.0034,
          { bevel: 0.001, holes: [rect(0.057, 0.0345, 0.107, 0.0515, 0.003)] },
        );
      });
      m.use(F.copper);
      m.at([0.0243, 0.0312, 0.082], null, () => m.box(0.0008, 0.0016, 0.048, 0.0002));
      screwX(m, 0.0244, 0.053, 0.11, 1, 0.0015);
      screwX(m, 0.0244, 0.053, 0.054, 1, 0.0015);
    });
  });

  // Flared CNC-machined alloy magwell funnel around the rear bullpup magazine well (`bodkinMagwell`).
  m.part('magwell', [0, MAG_MOUTH_Y, MAG_Z], () => {
    m.use(MAGWELL_ALLOY);
    // Upper collar hugging the pale polymer stock belly.
    m.at([0, -0.002, 0], null, () => m.top(rect(-0.0195, -0.0355, 0.0195, 0.0355, 0.004), 0.012, {
      bevel: 0.0016,
      holes: [rect(-0.0138, -0.030, 0.0138, 0.030, 0.002)],
    }));
    // Flared lower guide funnel mouth with generous bevelled chamfers.
    m.at([0, -0.012, 0], null, () => m.top(rect(-0.0245, -0.0405, 0.0245, 0.0405, 0.0055), 0.010, {
      bevel: 0.0022,
      holes: [rect(-0.0145, -0.0308, 0.0145, 0.0308, 0.0025)],
    }));
    // Machined side ribs & recessed mounting bolts.
    m.use(F.steelDark);
    m.mirror(() => {
      m.at([0.0215, -0.004, 0], null, () => m.box(0.0028, 0.005, 0.044, 0.0008));
      hexX(m, 0.0212, -0.002, 0.026, 1, 0.0018);
      hexX(m, 0.0212, -0.002, -0.026, 1, 0.0018);
    });
  });
}

interface Built {
  model: Model;
  mods: ViewDef['mods'];
}

function buildBodkin(kit: Kit): Built {
  const m = kit.mesher();
  m.bevel = 0.0014;
  innerChassis(m);
  bullpupShell(m);
  gripAndGuard(m);
  carryRib(m);
  barrelAndShroud(m);
  magazine(m);
  modParts(m);
  const scope = acog(m, OPTIC_AT);

  // Vertically reciprocating rising-block chamber (Steyr ACR signature action), visible through the breech window.
  m.part('chamber', [0, 0.043, 0.082], () => {
    m.use(F.steel);
    m.box(0.035, 0.014, 0.044, 0.0012);
    m.use(F.steelDark);
    m.mirror(() => {
      m.at([0.0178, 0, 0], null, () => serrations(m, 5, 0.005, 0.0007, 0.01, 0.001, F.steelDark));
    });
  });

  // Non-reciprocating forward bullpup charging handle on the left fore-end flank.
  m.part('charge', [-0.021, 0.049, -0.184], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.006, 0.0055, 0.014, 0.0008));
    m.at([-0.007, 0, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0048, 0.014, F.anodized, 14, 0.0005));
    m.use(F.steelDark);
    m.at([-0.0145, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0054, 0.0022, 14));
  });

  // Crisp straight-match bullpup trigger inside the sweeping guard bow.
  m.part('trigger', [0, -0.008, -0.042], () => {
    m.use(F.steelDark);
    m.side(poly([
      [-0.0038, 0.002], [0.0038, 0.002], [0.0032, -0.023, 0.0015], [-0.0018, -0.024, 0.0015], [-0.0038, -0.008, 0.002],
    ], 0.001), 0.0068, { bevel: 0.0007 });
  });

  // Weapon light and laser sight (`bodkinLight`, `bodkinLam`), tucked low on opposite fore-end rails
  // well below the 4x ACOG sight circle.
  weaponLight(m, [-0.0355, 0.016, -0.312], -Math.PI / 2);
  weaponLam(m, [0.0355, 0.016, -0.312], Math.PI / 2);

  const model = new Model(m, kit.mats, {
    glows: { reticle: [0xff4a1c, 7], status: [0x2ff0d0, 4], torch: TORCH, laser: LASER_GLOW, ...OPTIC_GLOWS },
  });
  acogShade(model);
  lamSocket(model);

  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  model.socket('eject', [0, -0.018, 0.085]);

  // Ergonomic firing hand on the bullpup pistol grip, and shared handguard support frame on the smooth fore-end.
  model.hand('gripR', [0.018, -0.056, 0.014], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.001, -0.006, -0.228]);

  // Reload sockets for the left hand: natural palm-inward grasp on the rear bullpup magazine, and crisp side pinch on the handle.
  model.grasp('magHold', [-0.016, -0.056, -0.004], [0.92, 0.35, 0.12], [0.22, -0.15, -0.96], 'mag');
  model.grasp('chargeHold', [-0.018, -0.008, 0.004], [0.95, 0.26, -0.15], [0.2, 0.12, -0.97], 'charge');

  const mods: ViewDef['mods'] = {
    bodkinAcog: scope,
    bodkinMag: { part: 'magExt', hides: 'magStd' },
    bodkinBurst5: { part: 'burstCam' },
    bodkinAuto: { part: 'autoSear' },
    bodkinTungsten: { part: 'tungstenMuzzle', also: ['tungstenBreech', 'tungstenMagStd', 'tungstenMagExt'] },
    bodkinLight: { part: 'light' },
    bodkinLam: { part: 'lam', laser: 'lam', laserRange: RIFLE_LAM_RANGE },
    bodkinMagwell: { part: 'magwell' },
  };
  return { model, mods };
}

/** Updates one clear magazine's stacked dart rows, rising orange follower, and stretching spring for fraction `f`. */
function updateClearMag(
  P: Record<string, { visible: boolean; position: { y: number }; scale: { y: number } }>,
  prefix: string,
  tiers: number,
  followerKey: string,
  springKey: string,
  foot: number,
  f: number,
): void {
  const shown = Math.ceil(f * tiers);
  for (let i = 0; i < tiers; i++) {
    const tier = P[`${prefix}${i}`];
    if (tier) tier.visible = i < shown;
  }
  const emptySteps = tiers - shown;
  const rise = emptySteps * TIER_STEP;
  const follower = P[followerKey];
  if (follower) follower.position.y += rise;
  const spring = P[springKey];
  if (spring) {
    const restGap = (TIER_TOP - tiers * TIER_STEP - 0.004) - (foot + 0.004);
    const currentH = Math.max(0.006, restGap + rise);
    spring.scale.y = currentH / 0.008;
  }
}

function clip(a: Anim): void {
  const P = a.parts;

  // Crisp 1200 RPM burst trigger pull and rising-block chamber vertical pulse.
  const cycle = 0.044;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  P.chamber!.position.y += Math.sin(c * Math.PI) * 0.0075;
  pullTrigger(a, 0.052, 0.28);

  // Subtle glow drives (reticle crisp and steady; side chamber pip pulses faintly on firing).
  a.glow('reticle', 1);
  a.glow('status', 0.8 + (1 - c) * 0.6);

  // Clear rear magazine: stacked flechette cartridges visibly count down; fresh mag enters full mid-reload.
  const p = a.reload;
  const empty = a.reloadFromEmpty || a.mag <= 0;
  const shownFill = p > (empty ? 0.36 : 0.4) ? 1 : fill(a);
  updateClearMag(P, 'dartStd', STD_TIERS, 'followerStd', 'springStd', STD_FOOT, shownFill);
  updateClearMag(P, 'dartExt', EXT_TIERS, 'followerExt', 'springExt', EXT_FOOT, shownFill);

  // Clean draw lift with ZERO roll or twisting.
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.065;
    a.gunR.x -= k * 0.38;
  }

  if (p < 0) return;

  // Bullpup rear-magazine reload: full empty reload racks forward charging handle; tactical reload swaps mag only.
  // Strictly ZERO roll (gunR.z === 0) and ZERO yaw twist (gunR.y === 0).
  const out = empty ? seg(p, 0.05, 0.22) : seg(p, 0.06, 0.26);
  const inn = empty ? seg(p, 0.40, 0.555) : seg(p, 0.44, 0.62);
  const away = inQuad(out) * (1 - outCubic(inn));
  const mag = P.mag!;
  mag.position.y -= away * 0.30;
  mag.position.z += away * 0.015;
  if (empty ? p > 0.24 && p < 0.37 : p > 0.28 && p < 0.41) mag.visible = false;

  const seat = empty ? (p >= 0.55 ? thud(seg(p, 0.55, 0.67)) : 0) : (p >= 0.62 ? thud(seg(p, 0.62, 0.76)) : 0);
  const rack = empty ? bump(p, 0.76, 0.90) : 0;
  P.charge!.position.z += rack * 0.066;
  P.chamber!.position.y += rack * 0.006;

  const present = hold(p, 0.0, 0.14, empty ? 0.88 : 0.78, 1);
  // Zero roll (gunR.z untouched), zero yaw twist (gunR.y untouched).
  a.gunR.x += present * 0.14 + seat * 0.045 - rack * 0.03;
  a.gunP.x -= present * 0.025;
  a.gunP.y += present * 0.042 + seat * 0.012;
  a.gunP.z -= present * 0.095 - rack * 0.012;

  const h = a.left;
  h.fingerRate = 38;
  if (empty) {
    h.to('magHold', inOut(seg(p, 0.0, 0.07)));
    h.to('pouchL', inOut(seg(p, 0.21, 0.32)));
    h.to('magHold', inOut(seg(p, 0.38, 0.47)));
    h.to('chargeHold', inOut(seg(p, 0.66, 0.75)));
    h.to('gripL', inOut(seg(p, 0.91, 1)));
    h.shape(HANDS.cup, hold(p, 0.02, 0.07, 0.58, 0.64));
    h.shape(HANDS.pinch, hold(p, 0.71, 0.76, 0.89, 0.94));
  } else {
    h.to('magHold', inOut(seg(p, 0.0, 0.08)));
    h.to('pouchL', inOut(seg(p, 0.25, 0.38)));
    h.to('magHold', inOut(seg(p, 0.43, 0.54)));
    h.to('gripL', inOut(seg(p, 0.72, 0.96)));
    h.shape(HANDS.cup, hold(p, 0.02, 0.08, 0.66, 0.74));
  }
}

export function bodkinDef(kit: Kit): ViewDef {
  const { model, mods } = buildBodkin(kit);
  return {
    id: 'bodkin',
    model,
    pos: [0.135, -0.118, -0.41],
    rot: [0.02, 0.075, 0],
    // Base ADS through the wide-aperture integrated carry-rib optic (level eye line onto the floating reticle pip).
    sight: [0, RIB_AXIS, -0.088],
    rear: [0, RIB_AXIS, -0.018],
    relief: 0.21,
    recoil: { back: 0.022, lift: 0.004, pitch: 0.022, yaw: 0.003, roll: 0.004, omega: 52, zeta: 0.65 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.018,
    mods,
    irons: 'ribOptic',
    animate: clip,
  };
}
