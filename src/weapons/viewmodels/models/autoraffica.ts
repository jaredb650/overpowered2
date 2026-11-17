/**
 * The Autoraffica: a machine pistol on a service-pistol frame, its barrel inside a deep square suppressor that is part of the
 * gun, long and slim. The can is a hollow box of plates: long slots and three round ports down the upper flanks show the
 * barrel inside, ribs run along its lower half, a vented top carries a ramp and post, and the bore sits high on its blunt
 * face over a red sensor eye (the smart aim's, lit while it is on). Behind it a slide with a notched rear blade cycles on
 * every round of the burst and locks open on an empty magazine. Three green dots, two on the blade and one on the post, line
 * up when it is aimed. An exposed hammer, a fire selector, a long magazine out of the grip, a cyan line down each flank and a
 * count on the left of the can. Origin at the top of the grip.
 *
 * Smart aim (weapons.smartAim, eased into `a.smart`, `a.lock`, `a.lockYaw`, `a.lockPitch` by the rig): on, the gun cants a
 * little; locked, it turns to the head, cants further and comes in toward the line of sight, as if aiming itself.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger, round } from './common';
import { TORCH, weaponLight } from './light';

const BORE = 0.036;
const SLIDE_Z = 0;
const SLIDE_TRAVEL = 0.03;
/** The can: from just ahead of the slide to its face, its top, foot and half width. Long and slim, its top under the slide's. */
const CAN_BACK = -0.05;
const CAN_FRONT = -0.31;
/** The shroud's top, flush with the slide's, and its half width: wider than the slide, as the film gun's casket is. */
const CAN_TOP = 0.0485;
const CAN_HALF = 0.017;
/** The upper band round the barrel: full width, from `BAND_Y` to the top. Under it the wedge, narrower, finned. */
const BAND_Y = 0.021;
const CORE_HALF = 0.0125;
/** The wedge's keel: deepest at its heel just ahead of the guard, rising to the front. */
const KEEL_BACK: readonly [number, number] = [-0.086, -0.031];
const KEEL_FRONT: readonly [number, number] = [-0.292, 0.004];
const keelY = (z: number) => KEEL_BACK[1] + ((z - KEEL_BACK[0]) * (KEEL_FRONT[1] - KEEL_BACK[1])) / (KEEL_FRONT[0] - KEEL_BACK[0]);
/** The heel, swept up and back from the keel to the frame, clear ahead of the trigger guard: where it is at height `y`. */
const HEEL: readonly (readonly [number, number])[] = [[CAN_BACK, -0.004], [-0.071, -0.023], KEEL_BACK];
const heelZ = (y: number) => {
  const [a, b] = y >= HEEL[1]![1] ? [HEEL[0]!, HEEL[1]!] : [HEEL[1]!, HEEL[2]!];
  return a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
};
const keelZ = (y: number) => KEEL_BACK[0] + ((y - KEEL_BACK[1]) * (KEEL_FRONT[0] - KEEL_BACK[0])) / (KEEL_FRONT[1] - KEEL_BACK[1]);
const MUZZLE = CAN_FRONT - 0.012;
/**
 * The sight line, raised on the shroud as the film gun's sights are: 1.75 cm over its top, so nothing of it rises into the
 * picture. The rear blade's top and the front post's top both sit on it, so aimed the gun is level and the post stands in the
 * notch, flush with the blade, the point of aim on its top. The post stands at `FRONT_Z`, the blade at `REAR_Z` on the slide.
 */
const SIGHT_Y = 0.066;
const FRONT_Z = CAN_FRONT + 0.02;
const REAR_Z = 0.05;
/** Bright brushed steel for the shroud and slide, a darker steel for what is set into them; the frame is black. */
const SILVER: Finish = { color: 0xb3b9c1, rough: 0.27, metal: 1, wear: 0.05, kind: 3 };
const SILVER_DARK: Finish = { color: 0x5f656e, rough: 0.36, metal: 0.95, wear: 0.04 };
const GUNMETAL_DARK: Finish = { color: 0x2c3036, rough: 0.42, metal: 0.85, wear: 0.08 };
/** The frame and grip: black polymer, less worn at the edges than the house's. */
const FRAME: Finish = { ...F.polymer, wear: 0.08 };

function frame(m: Mesher): void {
  m.use(FRAME);
  // Dust cover, running into the can's heel.
  m.side(poly([
    [0.064, 0.002], [0.066, 0.0185, 0.002], [-0.054, 0.0185, 0.002], [-0.056, -0.006, 0.002], [-0.03, -0.01, 0.003],
  ], 0.002), 0.024, { bevel: 0.0013 });
  // The beavertail: the frame's tang swept up and back over the web of the hand, under the hammer.
  m.side(poly([
    [0.058, 0.004], [0.08, 0.004, 0.006], [0.093, 0.0105, 0.005], [0.095, 0.0165, 0.003], [0.089, 0.0195, 0.003], [0.075, 0.0175, 0.005], [0.062, 0.0185],
  ], 0.002), 0.022, { bevel: 0.0024, smooth: 50 });
  // Slide stop, takedown lever, and the fire selector on the left over the grip: a lever with a red dot at its tip.
  m.use(GUNMETAL_DARK);
  m.at([-0.0128, 0.012, 0.012], null, () => m.side(poly([[0.026, -0.0025], [0.024, 0.0025, 0.001], [-0.012, 0.003, 0.0015], [-0.014, -0.002, 0.001]], 0.0005), 0.0024, { bevel: 0.0006 }));
  m.at([-0.0126, 0.008, -0.034], null, () => m.side(poly([[0.004, -0.004], [0.004, 0.004, 0.002], [-0.006, 0.003, 0.002], [-0.006, -0.002]], 0.0005), 0.002, { bevel: 0.0005 }));
  m.at([-0.0158, 0.004, 0.05], [0.5, 0, 0], () => m.box(0.003, 0.004, 0.022, 0.0009));
  m.use(F.bureauRed);
  m.at([-0.0172, 0.0, 0.041], null, () => m.box(0.0006, 0.0028, 0.0028, 0.0003));
  m.mirror(() => screwX(m, 0.0124, 0.007, 0.046, 1, 0.0019, GUNMETAL_DARK));

  // Grip: the service pistol's, a straight front strap raked back, the back strap curving up into the beavertail, a flared
  // heel; tall panels with rounded corners and two screws each.
  const front = curve([[0.022, -0.01], [0.025, -0.036], [0.029, -0.062], [0.034, -0.09], [0.04, -0.118]], 5);
  const back = curve([[0.097, -0.12], [0.095, -0.09], [0.088, -0.052], [0.077, -0.018], [0.07, 0.004], [0.062, 0.014]], 6);
  const outline: V2[] = [...front, [0.042, -0.124], [0.098, -0.125], ...back];
  m.use(FRAME);
  m.side(outline, 0.03, { bevel: 0.0045, smooth: 46 });
  m.use(F.polymerStipple);
  m.mirror(() => {
    m.at([0.0153, 0, 0], null, () => m.side(poly([[0.033, -0.016, 0.006], [0.07, -0.012, 0.008], [0.088, -0.112, 0.006], [0.046, -0.116, 0.006]], 0.004), 0.0024, { bevel: 0.0009 }));
    screwX(m, 0.0167, -0.028, 0.058, 1, 0.0022, GUNMETAL_DARK);
    screwX(m, 0.0167, -0.104, 0.07, 1, 0.0022, GUNMETAL_DARK);
  });
  // The burst pistol's foregrip, folded forward under the shroud's heel: a hinge at the frame and a flat bar along the heel
  // with a lip at its tip.
  m.use(GUNMETAL_DARK);
  m.at([0, -0.009, -0.054], [Math.PI / 2, 0, 0], () => m.cyl(0.0032, 0.017, 14));
  m.use(FRAME);
  m.side(poly([
    [-0.053, -0.011], [-0.07, -0.026, 0.002], [-0.083, -0.035, 0.002], [-0.087, -0.041, 0.002], [-0.081, -0.042, 0.002], [-0.066, -0.032, 0.002], [-0.052, -0.016],
  ], 0.001), 0.015, { bevel: 0.0014 });
  // The burst pistol's trigger guard: deep and rounded behind, its front swept forward into a hook for the off hand's finger.
  m.use(FRAME);
  m.side(poly([
    [-0.034, -0.006], [-0.05, -0.012, 0.006], [-0.054, -0.034, 0.004], [-0.064, -0.046, 0.003], [-0.06, -0.051, 0.002],
    [-0.046, -0.049, 0.005], [0.012, -0.047, 0.01], [0.032, -0.016, 0.005], [0.032, -0.006],
  ], 0.002), 0.011, {
    bevel: 0.0012,
    holes: [poly([[-0.034, -0.0115], [-0.043, -0.016, 0.004], [-0.045, -0.036, 0.006], [0.01, -0.04, 0.008], [0.025, -0.014, 0.004]], 0.002)],
  });
}

/**
 * The shroud, the film cop's casket in spirit: a squared upper band round the barrel with three big ports near the nose and
 * slanted slots behind them, a deep wedge under it hanging well below the barrel line and tapering to the front, its sides
 * stepped with fins that run out along the keel, a stepped nose, a chamfered keel. One solid body, its holes cut through, so
 * the barrel shows in every port. Origin at the top of the grip.
 */
function can(m: Mesher): void {
  const h = CAN_HALF;
  m.use(SILVER);
  // The upper band, ports and slots through it.
  const band = poly([[CAN_BACK, CAN_TOP], [CAN_FRONT, CAN_TOP, 0.002], [CAN_FRONT, BAND_Y, 0.0015], [CAN_BACK, BAND_Y]], 0.0008);
  const slant = (z: number, y: number, l: number, w: number): V2[] =>
    poly([[z, y - w / 2], [z - l, y - w / 2], [z - l - w * 0.9, y + w / 2], [z - w * 0.9, y + w / 2]], 0.0012);
  const holes = [
    ...[0, 1, 2].map(i => slant(-0.118 - i * 0.04, BORE, 0.03, 0.0074)),
    ...[0, 1, 2].map(i => circle(-0.247 - i * 0.022, BORE, 0.0068, 22)),
  ];
  m.side(band, h * 2, { bevel: 0.0026, holes });
  // The wedge under it: a narrower core from the band down to the keel, the heel swept up and back to the frame.
  m.use(SILVER_DARK);
  m.side(poly([
    [CAN_BACK, BAND_Y + 0.002], [KEEL_FRONT[0] - 0.004, BAND_Y + 0.002], [KEEL_FRONT[0], KEEL_FRONT[1], 0.002], [KEEL_BACK[0], KEEL_BACK[1], 0.004],
    [HEEL[1]![0], HEEL[1]![1], 0.004], [CAN_BACK, -0.004],
  ], 0.0008), CORE_HALF * 2, { bevel: 0.0016 });
  // Fins down each side of the wedge, full width, each running from the heel to the keel's slope, so they step back as they go
  // down; the lowest is the keel's chamfered edge.
  m.use(SILVER);
  for (let i = 0; i < 6; i++) {
    const y = 0.0155 - i * 0.0078;
    const back = y - 0.0016 >= -0.004 ? CAN_BACK - 0.003 : heelZ(y - 0.0016) - 0.001;
    // Above the keel's front the fin runs to the wedge's nose; below it, out along the keel.
    const front = Math.max(keelZ(y - 0.0012), KEEL_FRONT[0]) + 0.003;
    m.side(poly([[back, y + 0.0016], [front + 0.004, y + 0.0016], [front, y - 0.0016], [back, y - 0.0016]], 0.0005), h * 2, { bevel: 0.0009 });
  }
  m.at([0, 0, 0], null, () => m.side(poly([
    [KEEL_BACK[0], KEEL_BACK[1] - 0.0006], [KEEL_FRONT[0] + 0.004, KEEL_FRONT[1] - 0.0006], [KEEL_FRONT[0], KEEL_FRONT[1] + 0.003],
    [heelZ(KEEL_BACK[1] + 0.003), KEEL_BACK[1] + 0.003],
  ], 0.0006), h * 2 - 0.004, { bevel: 0.0014 }));
  // The nose: the band stands proud of the wedge, a squared muzzle block on it, the bore and a crown.
  m.at([0, BORE, CAN_FRONT], null, () => {
    m.use(SILVER);
    m.front(poly([[-0.012, -0.012], [0.012, -0.012], [0.013, 0.008, 0.002], [0.009, 0.012, 0.002], [-0.009, 0.012, 0.002], [-0.013, 0.008, 0.002]], 0.0006), 0.016, { bevel: 0.0016 });
    m.use(GUNMETAL_DARK);
    m.at([0, 0, -0.0085], null, () => m.lathe([[0.0074, 0.001, 0], [0.0074, -0.002], [0.0062, -0.003], [0.0048, -0.003, 0]], 20));
    m.use(F.black);
    m.at([0, 0, -0.011], null, () => m.lathe([[0.0048, -0.0004, 0], [0.0042, 0.006, 0], [0, 0.0065, 0]], 16));
  });
  // Three vents across the top near the nose, set in.
  m.use(F.black);
  for (let i = 0; i < 3; i++) m.at([0, CAN_TOP + 0.0001, -0.19 - i * 0.022], null, () => m.box(h * 1.3, 0.0006, 0.004, 0));
  // The sensor eye, low on the wedge's nose in a dark bezel.
  m.at([0, 0.011, KEEL_FRONT[0] - 0.0035], null, () => {
    m.use(F.black);
    m.front(poly([[-0.0085, -0.004], [0.0085, -0.004], [0.0095, 0.003], [0.0075, 0.0042], [-0.0075, 0.0042], [-0.0095, 0.003]], 0.0012), 0.0018, { bevel: 0.0005 });
    m.glow('eye', () => m.at([0, 0, -0.001], null, () => m.cyl(0.0026, 0.0012, 14, 0)));
  });
  // A thin cyan line inset along the band's foot, each side.
  m.glow('accent', () => m.mirror(() => m.at([h + 0.0002, BAND_Y + 0.0032, (CAN_BACK + CAN_FRONT) / 2 + 0.01], null, () => m.box(0.0008, 0.0010, 0.2, 0))));
  // The front sight: a tall ramp off the band up to a thin square post, its top on the sight line, a green dot under the top.
  m.use(SILVER);
  m.side(poly([[FRONT_Z + 0.03, CAN_TOP], [FRONT_Z + 0.004, SIGHT_Y - 0.008, 0.002], [FRONT_Z - 0.006, SIGHT_Y - 0.008, 0.001], [FRONT_Z - 0.009, CAN_TOP]], 0.0006), 0.01, { bevel: 0.001 });
  m.use(F.blued);
  m.side(poly([[FRONT_Z + 0.0016, SIGHT_Y - 0.009], [FRONT_Z + 0.0016, SIGHT_Y], [FRONT_Z - 0.003, SIGHT_Y], [FRONT_Z - 0.004, SIGHT_Y - 0.009]], 0.0002), 0.0032, { bevel: 0.0003 });
  m.glow('sight', () => m.at([0, SIGHT_Y - 0.0026, FRONT_Z + 0.0019], null, () => m.cyl(0.001, 0.0006, 10, 0)));
  // The count on the band's left, in a black bezel; the name stencilled between the fins.
  m.at([-h - 0.0004, BAND_Y + 0.0145, -0.078], [0, -Math.PI / 2, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.016, -0.0052, 0.016, 0.0052, 0.0014), 0.0016, { bevel: 0.0005, holes: [rect(-0.0142, -0.0038, 0.0142, 0.0038, 0.0005)] });
    m.use(F.black);
    m.at([0, 0, -0.0004], null, () => m.prism(rect(-0.0146, -0.0042, 0.0146, 0.0042, 0.0005), 0.0008, { bevel: 0 }));
    m.at([0, 0, 0.0002], null, () => m.screen('count', 0.0282, 0.0078));
  });
  m.at([-CORE_HALF - 0.0003, 0.0116, -0.16], [0, -Math.PI / 2, 0], () => m.decal('autoraffica', 0.05, 0.0042, 0xc9ced4));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.steel);
    m.lathe([[0.0062, 0.018, 0], [0.0062, CAN_FRONT + 0.004], [0.0055, CAN_FRONT + 0.002, 0]], 18);
    m.use(F.steelDark);
    m.at([0, 0.002, 0.008], null, () => m.box(0.016, 0.016, 0.036, 0.001));
  });
  // Recoil spring guide under it.
  m.use(GUNMETAL_DARK);
  m.at([0, BORE - 0.012, -0.03], null, () => m.cyl(0.0032, 0.05, 12));
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, SLIDE_Z], () => {
    const top = SIGHT_Y - 0.0125 - BORE;
    m.use(SILVER);
    // The service pistol's open-top slide: a full-height rear with a rounded tail, then the top cut away down to two thin walls
    // either side of the barrel, rising again at the nose, which tucks into the can's heel.
    m.side(poly([[0.068, -0.0175], [0.071, top - 0.008, 0.003], [0.066, top, 0.003], [0.014, top, 0.002], [0.006, top - 0.006, 0.003], [0.006, -0.0175]], 0.0015), 0.024, { bevel: 0.0026 });
    m.mirror(() => m.at([0.0104, 0, 0], null, () => m.side(poly([
      [0.009, -0.0175], [0.009, 0.0025], [-0.04, 0.0005, 0.003], [-0.048, 0.006, 0.002], [-0.053, 0.004, 0.001], [-0.053, -0.0175],
    ], 0.0008), 0.0032, { bevel: 0.0008 })));
    m.at([0, -0.0128, -0.022], null, () => m.box(0.018, 0.0095, 0.062, 0.0008));
    // The safety lever on each side of the tail, the service pistol's.
    m.use(GUNMETAL_DARK);
    m.mirror(() => m.at([0.0126, top - 0.006, 0.058], null, () => m.side(poly([[0.007, -0.0025], [0.007, 0.0025, 0.002], [-0.008, 0.0035, 0.0025], [-0.009, -0.002, 0.001]], 0.0005), 0.0026, { bevel: 0.0006 })));
    // The rear sight: a low squared blade across the back, its top on the sight line, a clean notch the post shows in, and a
    // dot either side level with the post's.
    m.use(GUNMETAL_DARK);
    const y0 = top - 0.001;
    const y1 = SIGHT_Y - BORE;
    const ny = y1 - 0.0045;
    // Enlarged, as the film gun's: a squared block across the tail, its sides drawn in toward the top.
    m.at([0, 0, REAR_Z - SLIDE_Z], null, () => m.front(poly([
      [-0.0115, y0], [0.0115, y0], [0.0095, y1, 0.0008], [0.0022, y1], [0.0022, ny], [-0.0022, ny], [-0.0022, y1], [-0.0095, y1, 0.0008],
    ], 0.0002), 0.012, { bevel: 0.0008 }));
    m.glow('sight', () => m.mirror(() => m.at([0.0052, y1 - 0.0026, REAR_Z - SLIDE_Z + 0.0062], null, () => m.cyl(0.0009, 0.0006, 10, 0))));
    // Serrations either side at the back, under the safety.
    m.use(GUNMETAL_DARK);
    m.mirror(() => {
      for (let i = 0; i < 6; i++) m.at([0.0122, -0.008, 0.024 + i * 0.0052], [0.26, 0, 0], () => m.box(0.0012, 0.014, 0.0024, 0.0004));
    });
    m.glow('accent', () => m.mirror(() => m.at([0.0121, -0.0125, 0.0], null, () => m.box(0.0008, 0.001, 0.09, 0))));
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      m.use(GUNMETAL_DARK);
      // A long magazine: half again out of the grip, as the burst pistols carry.
      m.side(poly([[-0.018, 0.022], [0.018, 0.022], [0.018, -0.152, 0.003], [-0.018, -0.152, 0.003]], 0.0015), 0.023, { bevel: 0.0012 });
      m.use(F.black);
      for (let i = 0; i < 5; i++) m.at([0, -0.04 - i * 0.022, 0.0182], null, () => m.cyl(0.0022, 0.0012, 8, 0));
      m.use(F.polymer);
      m.at([0, -0.156, 0.002], null, () => m.box(0.03, 0.01, 0.044, 0.003, 0.004));
      m.use(F.steel);
      m.at([0, 0.026, -0.004], [0.06, 0, 0], () => round(m, 0.0048, 0.019, 0.011));
      // The extended magazine (its mod): a sleeve 5.6 cm on below the floorplate, which becomes its collar, witness holes down it,
      // a cyan line, and a heavier base pad.
      m.part('magExt', [0, -0.161, 0], () => {
        m.use(GUNMETAL_DARK);
        m.side(poly([[-0.0175, 0.0], [0.0175, 0.0], [0.0175, -0.052, 0.003], [-0.0175, -0.052, 0.003]], 0.0012), 0.022, { bevel: 0.001 });
        m.use(F.black);
        for (let i = 0; i < 3; i++) m.at([0, -0.012 - i * 0.014, 0.0175], null, () => m.cyl(0.0021, 0.0012, 8, 0));
        m.glow('accent', () => m.mirror(() => m.at([0.0111, -0.026, 0], null, () => m.box(0.0006, 0.04, 0.0008, 0))));
        m.use(F.polymer);
        m.at([0, -0.056, 0.003], null, () => m.side(poly([[-0.026, 0.004], [0.026, 0.004], [0.024, -0.005, 0.003], [-0.023, -0.006, 0.003]], 0.001), 0.03, { bevel: 0.0018 }));
      });
    });
  });
}

function buildAutoraffica(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0011;
  frame(m);
  barrel(m);
  can(m);
  slide(m);
  magazine(m);
  // The service pistol's exposed hammer: a round spur with a hole through it, over the beavertail, rocked back on every round.
  m.part('hammer', [0, 0.024, 0.072], () => {
    m.use(GUNMETAL_DARK);
    m.side(poly([[-0.004, -0.004], [0.005, -0.006], [0.008, 0.009, 0.003], [0.0165, 0.0185, 0.007], [0.0095, 0.027, 0.006], [0.0005, 0.022, 0.003], [-0.004, 0.009]], 0.001), 0.0078, {
      bevel: 0.0009, holes: [circle(0.0088, 0.0182, 0.003, 16)],
    });
  });
  m.part('trigger', [0, -0.006, -0.012], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.0025, -0.008, 0.001], [0.004, -0.02, 0.001], [0.0, -0.021, 0.001], [-0.0035, -0.009, 0.002]], 0.001), 0.0064, { bevel: 0.0007 });
  });
  // The shop's weapon light (weapons/mods.ts LIGHT_GUNS), hidden until fitted. The shroud's left, at its nose.
  weaponLight(m, [-0.0285, 0.035, -0.2856], -Math.PI / 2, 0.85);
  const model = new Model(m, kit.mats, {
    glows: { sight: [0x7dff6a, 6], accent: [0x36d6ff, 3], eye: [0xff2a3a, 6], torch: TORCH },
    screens: { count: [192, 54] },
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
  // Back in 12 ms and home by 40, inside the 50 ms between the rounds of a burst.
  let back = t < 0.012 ? outQuad(t / 0.012) : t < 0.04 ? 1 - inOut(seg(t, 0.012, 0.04)) : 0;
  if (a.mag <= 0) back = p >= 0.82 ? 1 - seg(p, 0.82, 0.86) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;
  P.hammer!.rotation.x += back * 0.35;
  a.glow('accent', 1 + (t < 0.15 ? (1 - t / 0.15) * 1.8 : 0));
  // The eye wakes with the smart aim, and burns while it holds a head.
  a.glow('eye', 0.12 + a.smart * 0.7 + a.lock * (1.6 + Math.sin(a.time * 30) * 0.4));
  // A light gun, a quick flip a round: three of them walk the muzzle up through a burst.
  if (t < 0.1) a.gunR.x += bump(t, 0, 0.1) * 0.025;

  // Smart aim: canted on, and turned to the head while it is locked, brought in toward the eye line.
  const cant = a.smart * 0.07 + a.lock * 0.16;
  a.gunR.z += cant;
  a.gunR.y += a.lock * a.lockYaw;
  a.gunR.x += a.lock * a.lockPitch;
  a.gunP.x -= a.lock * 0.014;
  a.gunP.y += a.lock * 0.008;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.1;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.6;
  }
  if (p < 0) return;

  // Foley: out at 0.05, in at 0.5, slide at 0.84.
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
  a.gunR.z -= present * 0.55;
  a.gunR.x += present * 0.24 + seat * 0.06 - snap * 0.06;
  a.gunR.y += present * 0.08;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.06 + seat * 0.01;
  a.gunP.z += present * 0.05 + snap * 0.012;

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
    // ADS: the post's top flush with the blade's in the notch, both on the sight line, so the gun sits level and the three
    // dots line up. The post is 0.62 m out and the blade 0.29 m: far enough that the blade hides little round the target.
    sight: [0, SIGHT_Y, FRONT_Z], rear: [0, SIGHT_Y, REAR_Z - 0.0035], relief: 0.62,
    recoil: { back: 0.022, lift: 0.008, pitch: 0.07, yaw: 0.012, roll: 0.016, omega: 36, zeta: 0.6 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.pistolSupport },
    heatPerShot: 0.015,
    animate: clip,
    // The extended magazine: the sleeve under the floorplate.
    mods: { autorafficaMag: { part: 'magExt' }, autorafficaLight: { part: 'light' } },
    readout: a => drawCount(a, 'count', 2, 7, '#36d6ff'),
  };
}
