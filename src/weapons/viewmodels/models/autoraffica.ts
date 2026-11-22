/**
 * The Autoraffica: an all-black heavy machine pistol built on an open-top Beretta-style service frame with a long,
 * squared, ventilated barrel shroud and deep finned under-barrel counterweight. Three large rectangular side ports
 * and angled front vents expose the dark barrel inside; top gas slots vent heat ahead of the open slide; tall
 * squared target sights with subtle green tritium dots line up level in ADS; a recessed optical sensor eye sits in
 * the front face of the weight block below the muzzle; an exposed ring hammer, squared hooked trigger guard,
 * folded foregrip bar, and extended magazine finish the silhouette. Origin at the top of the grip.
 *
 * Smart aim (weapons.smartAim, eased into `a.smart`, `a.lock`, `a.lockYaw`, `a.lockPitch` by the rig): when active
 * and tracking a painted head, the muzzle turns crisply onto the target in yaw and pitch with zero roll/twist.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, poly, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, round } from './common';
import { TORCH, weaponLight } from './light';

const BORE = 0.036;
const SLIDE_Z = 0;
const SLIDE_TRAVEL = 0.032;

/** Squared ventilated barrel shroud: starts right ahead of the slide and extends far forward like an Auto-9 compensator. */
const CAN_BACK = -0.048;
const CAN_FRONT = -0.322;
const CAN_TOP = 0.0495;
const CAN_HALF = 0.0176;
/** Lower boundary of the upper ventilated shroud band; below this sits the deep squared finned weight block. */
const BAND_Y = 0.0205;
/** Under-barrel counterweight block: chunky, squared, horizontal underside (not a tapered boat keel). */
const WEIGHT_BACK = -0.076;
const WEIGHT_FRONT = -0.306;
const WEIGHT_BOT = -0.018;
const WEIGHT_CORE_HALF = 0.0132;
const MUZZLE = CAN_FRONT - 0.012;

/**
 * Tall, squared target sights: rear sight block on the slide tail and tall squared front post near the shroud nose.
 * Both tops sit cleanly on `SIGHT_Y`, so ADS presents a level, crisp three-dot sight picture.
 */
const SIGHT_Y = 0.067;
const FRONT_Z = CAN_FRONT + 0.024;
const REAR_Z = 0.052;

/** All-black material palette with disciplined roughness & metallic contrast so bevels and vents read cleanly. */
const SHROUD_MATTE: Finish = { color: 0x22262d, rough: 0.42, metal: 0.88, wear: 0.10 };
const SLIDE_SATIN: Finish = { color: 0x2c313a, rough: 0.28, metal: 0.94, wear: 0.08 };
const STEEL_CHARCOAL: Finish = { color: 0x3b414c, rough: 0.32, metal: 0.93, wear: 0.07 };
const FRAME_ANODIZED: Finish = { color: 0x1a1d23, rough: 0.50, metal: 0.74, wear: 0.07 };
const GRIP_CHECKER: Finish = { ...F.polymerStipple, color: 0x16181d, rough: 0.84, wear: 0.05 };

function frame(m: Mesher): void {
  m.use(FRAME_ANODIZED);
  // Dust cover & main alloy receiver rail running cleanly into the shroud junction.
  m.side(poly([
    [0.065, 0.002], [0.067, 0.0188, 0.002], [-0.052, 0.0188, 0.002], [-0.054, -0.005, 0.002], [-0.028, -0.009, 0.003],
  ], 0.002), 0.0244, { bevel: 0.0014 });
  // Sculpted Beretta-style beavertail tang over the web of the hand, clearing the ring hammer.
  m.side(poly([
    [0.058, 0.004], [0.081, 0.0045, 0.006], [0.094, 0.011, 0.005], [0.096, 0.017, 0.003], [0.09, 0.0198, 0.003], [0.075, 0.0178, 0.005], [0.062, 0.0188],
  ], 0.002), 0.022, { bevel: 0.0022, smooth: 50 });

  // Controls: slide stop, takedown latch, mag release button, frame cross-pins, and 93R burst selector lever on left.
  m.use(STEEL_CHARCOAL);
  m.at([-0.013, 0.0122, 0.012], null, () => m.side(poly([[0.026, -0.0025], [0.024, 0.0025, 0.001], [-0.012, 0.003, 0.0015], [-0.014, -0.002, 0.001]], 0.0005), 0.0024, { bevel: 0.0006 }));
  m.at([-0.0128, 0.0082, -0.032], null, () => m.side(poly([[0.0045, -0.0042], [0.0045, 0.0042, 0.002], [-0.0065, 0.0032, 0.002], [-0.0065, -0.0022]], 0.0005), 0.0022, { bevel: 0.0005 }));
  m.at([-0.014, -0.022, 0.026], [0, 0, Math.PI / 2], () => m.cyl(0.0036, 0.003, 12));
  m.at([-0.016, 0.0045, 0.05], [0.46, 0, 0], () => m.box(0.003, 0.004, 0.022, 0.0008));
  m.use(F.bureauRed);
  m.at([-0.0175, 0.0006, 0.041], null, () => m.box(0.0006, 0.0024, 0.0024, 0.0002));
  m.mirror(() => {
    screwX(m, 0.0126, 0.007, 0.046, 1, 0.0018, STEEL_CHARCOAL);
    screwX(m, 0.0126, 0.0065, -0.008, 1, 0.0015, STEEL_CHARCOAL);
  });

  // Sculpted Beretta-style grip: raked front strap, curved back strap into the beavertail, subtle heel flare.
  const front = curve([[0.022, -0.01], [0.025, -0.036], [0.029, -0.062], [0.034, -0.09], [0.04, -0.118]], 5);
  const back = curve([[0.097, -0.12], [0.095, -0.09], [0.088, -0.052], [0.077, -0.018], [0.07, 0.004], [0.062, 0.014]], 6);
  const outline: V2[] = [...front, [0.042, -0.124], [0.098, -0.125], ...back];
  m.use(FRAME_ANODIZED);
  m.side(outline, 0.03, { bevel: 0.0042, smooth: 46 });
  // Front-strap vertical serrations for grip texture.
  m.use(F.black);
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    m.at([0, -0.028 - t * 0.072, 0.024 + t * 0.013], [0.18, 0, 0], () => m.box(0.014, 0.006, 0.0012, 0.0003));
  }

  // Checkered black grip panels (no logos/text) with machined border recess and two slotted screws per side.
  m.use(GRIP_CHECKER);
  m.mirror(() => {
    m.at([0.0153, 0, 0], null, () => m.side(poly([
      [0.032, -0.015, 0.005], [0.071, -0.011, 0.007], [0.089, -0.113, 0.005], [0.045, -0.117, 0.005],
    ], 0.003), 0.0026, { bevel: 0.0009 }));
    // Subtle machined checkering ribs across each panel.
    for (let i = 0; i < 5; i++) {
      const y = -0.042 - i * 0.013;
      const z = 0.055 + i * 0.0032;
      m.at([0.0168, y, z], [0.18, 0, 0], () => m.box(0.0008, 0.0018, 0.03, 0.0003));
    }
    screwX(m, 0.0169, -0.028, 0.058, 1, 0.0022, STEEL_CHARCOAL);
    screwX(m, 0.0169, -0.104, 0.07, 1, 0.0022, STEEL_CHARCOAL);
  });

  // Folded-forward 93R foregrip hinge tucked cleanly into the junction behind the counterweight block.
  m.use(STEEL_CHARCOAL);
  m.at([0, -0.0075, -0.054], [Math.PI / 2, 0, 0], () => m.cyl(0.003, 0.017, 14));
  m.use(FRAME_ANODIZED);
  m.side(poly([
    [-0.052, -0.006], [-0.073, -0.014, 0.002], [-0.076, -0.019, 0.0015], [-0.07, -0.02, 0.0015], [-0.051, -0.011],
  ], 0.001), 0.0145, { bevel: 0.0011 });

  // Beretta 93R squared/elongated trigger guard with front support-finger hook.
  m.use(FRAME_ANODIZED);
  m.side(poly([
    [-0.034, -0.0055], [-0.052, -0.010, 0.004], [-0.056, -0.034, 0.003], [-0.065, -0.045, 0.0025], [-0.061, -0.050, 0.002],
    [-0.047, -0.048, 0.004], [0.012, -0.047, 0.009], [0.032, -0.016, 0.005], [0.032, -0.0055],
  ], 0.002), 0.0114, {
    bevel: 0.0012,
    holes: [poly([[-0.034, -0.0115], [-0.045, -0.015, 0.0035], [-0.047, -0.036, 0.005], [0.01, -0.04, 0.008], [0.025, -0.014, 0.004]], 0.002)],
  });
}

/**
 * The Auto-9 barrel shroud & counterweight (all black, no logos/text):
 * - Long, tall, blocky matte-black barrel compensator flush with the slide top, cut through with 3 big slanted
 *   side ports + 2 front exhaust vents exposing the dark barrel inside, plus 3 recessed top gas-expansion ports.
 * - Deep squared under-barrel counterweight with the iconic 45° front-bottom chin chamfer, crisp rear step ahead
 *   of the trigger guard, bold horizontal machined ribs along both flanks, and recessed retaining socket bolts.
 * - Tall swept-ramp target front sight with subtle inset tritium dot, and a subtle dark smart-aim sensor eye
 *   recessed in the vertical front face above the chin chamfer.
 */
function shroud(m: Mesher): void {
  const h = CAN_HALF;

  // Main squared upper barrel shroud with 3 large slanted compensator ports + 2 angled front exhaust vents cut through.
  m.use(SHROUD_MATTE);
  const band = poly([
    [CAN_BACK, CAN_TOP], [CAN_FRONT, CAN_TOP, 0.002], [CAN_FRONT, BAND_Y, 0.0015], [CAN_BACK, BAND_Y],
  ], 0.0008);
  const slant = (z: number, y: number, l: number, w: number, skew = 0.55): V2[] =>
    poly([[z, y - w / 2], [z - l, y - w / 2], [z - l - w * skew, y + w / 2], [z - w * skew, y + w / 2]], 0.0012);
  const holes = [
    // Three iconic large slanted side compensator ports showing the dark steel barrel inside.
    slant(-0.095, BORE, 0.034, 0.0138, 0.42),
    slant(-0.147, BORE, 0.034, 0.0138, 0.42),
    slant(-0.199, BORE, 0.034, 0.0138, 0.42),
    // Two narrower angled front exhaust vents right behind the muzzle block.
    slant(-0.252, BORE, 0.015, 0.0128, 0.62),
    slant(-0.279, BORE, 0.015, 0.0128, 0.62),
  ];
  m.side(band, h * 2, { bevel: 0.0024, holes });

  // Chamfered top spine rail strip & 3 recessed rectangular top gas-expansion ports.
  m.use(SLIDE_SATIN);
  m.side(poly([
    [CAN_BACK - 0.004, CAN_TOP + 0.0022], [CAN_FRONT + 0.004, CAN_TOP + 0.0022, 0.001],
    [CAN_FRONT + 0.002, CAN_TOP - 0.0006], [CAN_BACK - 0.002, CAN_TOP - 0.0006],
  ], 0.0005), h * 1.48, { bevel: 0.001 });
  m.use(F.black);
  for (let i = 0; i < 3; i++) {
    m.at([0, CAN_TOP + 0.002, -0.148 - i * 0.04], null, () => m.box(h * 1.18, 0.0012, 0.022, 0.0002));
  }

  // Machined rear mounting collar & socket bolts where the compensator mates over the Beretta 93R dust cover.
  m.use(STEEL_CHARCOAL);
  m.at([0, BAND_Y + 0.014, CAN_BACK - 0.008], null, () => m.box(h * 2 + 0.0016, 0.029, 0.016, 0.0012));
  m.mirror(() => {
    screwX(m, h + 0.0009, BAND_Y + 0.008, CAN_BACK - 0.008, 1, 0.002, STEEL_CHARCOAL);
    screwX(m, h + 0.0009, BAND_Y + 0.02, CAN_BACK - 0.008, 1, 0.002, STEEL_CHARCOAL);
  });

  // Deep squared under-barrel counterweight block with iconic 45° front-bottom chin chamfer and crisp rear step.
  m.use(FRAME_ANODIZED);
  m.side(poly([
    [CAN_BACK, BAND_Y + 0.0015],
    [WEIGHT_FRONT - 0.004, BAND_Y + 0.0015, 0.0015],
    [WEIGHT_FRONT - 0.004, WEIGHT_BOT + 0.016, 0.002],
    [WEIGHT_FRONT + 0.014, WEIGHT_BOT, 0.002],
    [WEIGHT_BACK - 0.006, WEIGHT_BOT, 0.002],
    [WEIGHT_BACK + 0.004, WEIGHT_BOT + 0.008, 0.0025],
    [CAN_BACK - 0.004, -0.005, 0.002],
    [CAN_BACK, -0.005],
  ], 0.0008), WEIGHT_CORE_HALF * 2, { bevel: 0.0015 });

  // Four bold horizontal machined ribs along both flanks of the deep squared counterweight (following the 45° chin chamfer).
  m.use(SHROUD_MATTE);
  for (let i = 0; i < 4; i++) {
    const y = 0.0148 - i * 0.0082;
    const back = i < 2 ? CAN_BACK - 0.004 : WEIGHT_BACK - 0.001;
    const chinTrim = Math.max(0, (WEIGHT_BOT + 0.016) - (y - 0.0022));
    const front = WEIGHT_FRONT - 0.001 + chinTrim * 0.95;
    m.side(poly([
      [back, y + 0.0026], [front, y + 0.0026, 0.0008], [front + 0.002, y - 0.0026, 0.0008], [back, y - 0.0026],
    ], 0.0004), h * 2, { bevel: 0.0009 });
  }
  // Squared bottom keel plate closing the counterweight underside up to the 45° chin chamfer.
  m.use(SLIDE_SATIN);
  m.side(poly([
    [WEIGHT_BACK - 0.004, WEIGHT_BOT + 0.0025],
    [WEIGHT_FRONT + 0.014, WEIGHT_BOT + 0.0025],
    [WEIGHT_FRONT + 0.016, WEIGHT_BOT - 0.002, 0.001],
    [WEIGHT_BACK - 0.007, WEIGHT_BOT - 0.002, 0.001],
  ], 0.0005), h * 1.72, { bevel: 0.0013 });

  // Three recessed Allen retaining bolts along the compensator side channel.
  m.mirror(() => {
    screwX(m, h + 0.0002, 0.0148, -0.105, 1, 0.002, STEEL_CHARCOAL);
    screwX(m, h + 0.0002, 0.0148, -0.188, 1, 0.002, STEEL_CHARCOAL);
    screwX(m, h + 0.0002, 0.0148, -0.272, 1, 0.002, STEEL_CHARCOAL);
  });

  // Heavy squared muzzle face, recessed dark-steel barrel bushing, and deep dark bore interior.
  m.at([0, BORE, CAN_FRONT], null, () => {
    m.use(SHROUD_MATTE);
    m.front(poly([
      [-0.015, -0.0135], [0.015, -0.0135], [0.016, 0.0095, 0.002], [0.012, 0.0138, 0.002], [-0.012, 0.0138, 0.002], [-0.016, 0.0095, 0.002],
    ], 0.0006), 0.015, { bevel: 0.0016 });
    m.use(STEEL_CHARCOAL);
    m.at([0, 0, -0.008], null, () => m.lathe([[0.0078, 0.001, 0], [0.0078, -0.0022], [0.0064, -0.0032], [0.0049, -0.0032, 0]], 20));
    m.use(F.black);
    m.at([0, 0, -0.0108], null, () => m.lathe([[0.0049, -0.0004, 0], [0.0043, 0.0065, 0], [0, 0.007, 0]], 16));
  });

  // Subtle dark smart-aim optical sensor eye recessed in the vertical front face of the weight block above the chin chamfer.
  m.at([0, 0.006, WEIGHT_FRONT - 0.0065], null, () => {
    m.use(F.black);
    m.front(poly([
      [-0.0092, -0.0055], [0.0092, -0.0055], [0.0102, 0.0045], [0.0082, 0.0058], [-0.0082, 0.0058], [-0.0102, 0.0045],
    ], 0.001), 0.0026, { bevel: 0.0006 });
    m.use(STEEL_CHARCOAL);
    m.at([0, 0, -0.0012], null, () => m.lathe([[0.0046, 0.001, 0], [0.0046, -0.0008], [0.0033, -0.0012, 0]], 16));
    m.use(F.black);
    m.at([0, 0, -0.0016], null, () => m.cyl(0.0032, 0.0008, 14, 0));
    m.glow('eye', () => m.at([0, 0, -0.0021], null, () => m.cyl(0.0017, 0.0006, 12, 0)));
  });

  // Iconic tall Auto-9 swept-ramp target front sight near the shroud nose with subtle inset green tritium dot.
  m.use(SHROUD_MATTE);
  m.side(poly([
    [FRONT_Z + 0.036, CAN_TOP + 0.0015],
    [FRONT_Z + 0.006, SIGHT_Y - 0.005, 0.0015],
    [FRONT_Z - 0.007, SIGHT_Y - 0.005, 0.001],
    [FRONT_Z - 0.011, CAN_TOP + 0.0015],
  ], 0.0005), 0.0124, { bevel: 0.0009 });
  m.use(STEEL_CHARCOAL);
  m.side(poly([
    [FRONT_Z + 0.0022, SIGHT_Y - 0.0085],
    [FRONT_Z + 0.0022, SIGHT_Y],
    [FRONT_Z - 0.0045, SIGHT_Y],
    [FRONT_Z - 0.0055, SIGHT_Y - 0.0085],
  ], 0.0002), 0.0036, { bevel: 0.0003 });
  m.glow('sight', () => m.at([0, SIGHT_Y - 0.0028, FRONT_Z + 0.0024], null, () => m.cyl(0.00095, 0.0005, 10, 0)));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    // Dark blued-charcoal heavy barrel clearly visible inside the open-top slide and through every shroud side port.
    m.use(STEEL_CHARCOAL);
    m.lathe([[0.0066, 0.018, 0], [0.0066, CAN_FRONT + 0.004], [0.0058, CAN_FRONT + 0.002, 0]], 18);
    // Chamber hood & Beretta locking-block recess.
    m.use(SLIDE_SATIN);
    m.at([0, 0.002, 0.008], null, () => m.box(0.0162, 0.0162, 0.036, 0.001));
  });
  // Full-length steel recoil spring guide rod beneath the barrel.
  m.use(STEEL_CHARCOAL);
  m.at([0, BORE - 0.012, -0.03], null, () => m.cyl(0.0032, 0.052, 12));
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, SLIDE_Z], () => {
    const top = SIGHT_Y - 0.0135 - BORE;
    m.use(SLIDE_SATIN);
    // Classic Beretta 93R / 92FS open-top slide: solid rounded rear bridge, cut open along the top to show the barrel.
    m.side(poly([
      [0.069, -0.0175], [0.072, top - 0.0075, 0.003], [0.067, top, 0.003], [0.014, top, 0.002], [0.006, top - 0.006, 0.003], [0.006, -0.0175],
    ], 0.0015), 0.0246, { bevel: 0.0024 });
    m.mirror(() => m.at([0.0106, 0, 0], null, () => m.side(poly([
      [0.009, -0.0175], [0.009, 0.0028], [-0.039, 0.0008, 0.003], [-0.047, 0.0062, 0.002], [-0.052, 0.0042, 0.001], [-0.052, -0.0175],
    ], 0.0008), 0.0034, { bevel: 0.0008 })));
    m.at([0, -0.0128, -0.022], null, () => m.box(0.0184, 0.0095, 0.062, 0.0008));

    // Ambidextrous slide-mounted safety wings on the Beretta tail.
    m.use(STEEL_CHARCOAL);
    m.mirror(() => m.at([0.0129, top - 0.0062, 0.058], null, () => m.side(poly([
      [0.0075, -0.0025], [0.0075, 0.0025, 0.002], [-0.0085, 0.0035, 0.0025], [-0.0095, -0.002, 0.001],
    ], 0.0005), 0.0026, { bevel: 0.0006 })));

    // Tall, squared Auto-9 target rear sight housing across the slide tail with deep square notch and inset tritium dots.
    const y0 = top - 0.0015;
    const y1 = SIGHT_Y - BORE;
    const ny = y1 - 0.005;
    m.use(SHROUD_MATTE);
    m.at([0, 0, REAR_Z - SLIDE_Z], null, () => m.front(poly([
      [-0.0132, y0], [0.0132, y0], [0.0122, y1, 0.0006], [0.0024, y1], [0.0024, ny], [-0.0024, ny], [-0.0024, y1], [-0.0122, y1, 0.0006],
    ], 0.0002), 0.0145, { bevel: 0.0008 }));
    // Target sight windage adjustment screw on right side of the rear sight block.
    screwX(m, 0.0131, (y0 + y1) * 0.55, REAR_Z - SLIDE_Z, 1, 0.0017, STEEL_CHARCOAL);
    m.glow('sight', () => m.mirror(() => m.at([0.0056, y1 - 0.0028, REAR_Z - SLIDE_Z + 0.0075], null, () => m.cyl(0.0009, 0.0005, 10, 0))));

    // Eight crisp angled Beretta rear slide serrations per side.
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 8; i++) {
        m.at([0.0124, -0.0075, 0.02 + i * 0.0044], [0.24, 0, 0], () => m.box(0.0012, 0.0145, 0.002, 0.0003));
      }
    });
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      // Extended 93R black-steel box magazine extending well past the grip heel.
      m.use(STEEL_CHARCOAL);
      m.side(poly([[-0.018, 0.022], [0.018, 0.022], [0.018, -0.156, 0.003], [-0.018, -0.156, 0.003]], 0.0015), 0.023, { bevel: 0.0012 });
      m.use(F.black);
      for (let i = 0; i < 5; i++) m.at([0, -0.042 - i * 0.022, 0.0182], null, () => m.cyl(0.0021, 0.0012, 8, 0));
      // Thick angled black base pad.
      m.use(FRAME_ANODIZED);
      m.at([0, -0.160, 0.002], null, () => m.box(0.03, 0.0105, 0.044, 0.0028, 0.0035));
      m.use(STEEL_CHARCOAL);
      m.at([0, 0.026, -0.004], [0.06, 0, 0], () => round(m, 0.0048, 0.019, 0.011));

      // Extended magazine mod (`autorafficaMag`): lower matte-steel sleeve with witness holes and heavy black base pad.
      m.part('magExt', [0, -0.165, 0], () => {
        m.use(STEEL_CHARCOAL);
        m.side(poly([[-0.0175, 0.0], [0.0175, 0.0], [0.0175, -0.054, 0.003], [-0.0175, -0.054, 0.003]], 0.0012), 0.022, { bevel: 0.001 });
        m.use(F.black);
        for (let i = 0; i < 3; i++) m.at([0, -0.012 - i * 0.014, 0.0175], null, () => m.cyl(0.0021, 0.0012, 8, 0));
        m.use(FRAME_ANODIZED);
        m.at([0, -0.058, 0.003], null, () => m.side(poly([[-0.026, 0.004], [0.026, 0.004], [0.024, -0.0055, 0.003], [-0.023, -0.0065, 0.003]], 0.001), 0.03, { bevel: 0.0018 }));
      });
    });
  });
}

function buildAutoraffica(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0011;
  frame(m);
  barrel(m);
  shroud(m);
  slide(m);
  magazine(m);

  // Exposed Beretta ring hammer over the beavertail, rocking back sharply on every round.
  m.part('hammer', [0, 0.0245, 0.073], () => {
    m.use(STEEL_CHARCOAL);
    m.side(poly([
      [-0.004, -0.004], [0.005, -0.006], [0.0085, 0.009, 0.003], [0.017, 0.019, 0.007], [0.0098, 0.0275, 0.006], [0.0005, 0.0225, 0.003], [-0.004, 0.009],
    ], 0.001), 0.0078, {
      bevel: 0.0009, holes: [circle(0.009, 0.0185, 0.0032, 16)],
    });
  });

  // Curved steel trigger inside the squared 93R guard.
  m.part('trigger', [0, -0.006, -0.012], () => {
    m.use(STEEL_CHARCOAL);
    m.side(poly([
      [-0.0035, 0.002], [0.0035, 0.002], [0.0025, -0.008, 0.001], [0.004, -0.02, 0.001], [0.0, -0.021, 0.001], [-0.0035, -0.009, 0.002],
    ], 0.001), 0.0064, { bevel: 0.0007 });
  });

  // Shop weapon light (`autorafficaLight`), hidden until fitted; mounted cleanly on the left flank of the weight block.
  weaponLight(m, [-0.0285, 0.004, -0.268], -Math.PI / 2, 0.85);

  const model = new Model(m, kit.mats, {
    glows: { sight: [0x6dff5c, 4.2], eye: [0xff2432, 5.5], torch: TORCH },
  });
  model.socket('muzzle', [0, BORE, MUZZLE]);
  model.socket('eject', [0.016, BORE + 0.006, 0.0]);
  model.hand('gripR', [0.0205, -0.068, 0.067], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.pistolSupport('gripL', [-0.031, -0.072, 0.062]);
  model.hand('magHold', [-0.016, -0.11, 0.012], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.04, 0.36);
  a.glow('sight', 1);
  const t = a.sinceFire;
  const p = a.reload;

  // Crisp linear slide cycle (zero roll/twist): back in 12 ms, home by 40 ms; locks open on empty mag.
  let back = t < 0.012 ? outQuad(t / 0.012) : t < 0.04 ? 1 - inOut(seg(t, 0.012, 0.04)) : 0;
  if (a.mag <= 0) back = p >= 0.82 ? 1 - seg(p, 0.82, 0.86) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;
  P.hammer!.rotation.x += back * 0.38;

  // Subtle recessed red optical eye: near-dark in BURST, glows when SMART is on, bright pulse while painting/locked.
  a.glow('eye', 0.05 + a.smart * 0.65 + a.lock * (1.7 + Math.sin(a.time * 28) * 0.35));

  // Crisp vertical muzzle flip per round — straight up in pitch, zero roll.
  if (t < 0.09) a.gunR.x += bump(t, 0, 0.09) * 0.024;

  // Smart aim tracking: turns straight onto the painted head in yaw & pitch with zero roll/cant twist.
  a.gunR.y += a.lock * a.lockYaw;
  a.gunR.x += a.lock * a.lockPitch;
  a.gunP.x -= a.lock * 0.012;
  a.gunP.y += a.lock * 0.006;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.1;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.55;
  }
  if (p < 0) return;

  // Reload foley: out at 0.05, in at 0.50, slide release at 0.84.
  const mag = P.mag!;
  const out = seg(p, 0.05, 0.2);
  const inn = seg(p, 0.36, 0.5);
  const away = inQuad(out) * (1 - outCubic(inn));
  mag.position.y -= away * 0.34;
  mag.position.z += away * 0.06;
  if (p > 0.22 && p < 0.34) mag.visible = false;
  const seat = p >= 0.5 ? thud(seg(p, 0.5, 0.62)) : 0;

  const present = hold(p, 0.0, 0.12, 0.74, 0.88);
  const snap = bump(p, 0.82, 0.96);
  a.gunR.x += present * 0.22 + seat * 0.06 - snap * 0.05;
  a.gunR.y += present * 0.14;
  a.gunP.x -= present * 0.035;
  a.gunP.y += present * 0.055 + seat * 0.01;
  a.gunP.z += present * 0.045 + snap * 0.012;

  const h = a.left;
  h.fingerRate = 44;
  h.to('pouchL', inOut(seg(p, 0.04, 0.2)));
  h.to('magHold', inOut(seg(p, 0.3, 0.42)));
  h.to('gripL', inOut(seg(p, 0.66, 0.8)));
  h.shape(HANDS.cup, hold(p, 0.24, 0.36, 0.56, 0.66));
}

export function autorafficaDef(kit: Kit): ViewDef {
  return {
    id: 'autoraffica',
    model: buildAutoraffica(kit),
    pos: [0.13, -0.13, -0.38],
    rot: [0.02, 0.06, 0],
    // ADS: front post flush with the tall squared rear notch on `SIGHT_Y`, three green tritium dots aligned.
    sight: [0, SIGHT_Y, FRONT_Z], rear: [0, SIGHT_Y, REAR_Z - 0.004], relief: 0.62,
    recoil: { back: 0.022, lift: 0.008, pitch: 0.068, yaw: 0.01, roll: 0, omega: 38, zeta: 0.65 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.pistolSupport },
    heatPerShot: 0.015,
    animate: clip,
    // Extended magazine sleeve (`magExt`) and weapon light (`light`).
    mods: { autorafficaMag: { part: 'magExt' }, autorafficaLight: { part: 'light' } },
  };
}
