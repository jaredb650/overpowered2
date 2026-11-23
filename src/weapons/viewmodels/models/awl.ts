/**
 * The Awl: a bolt-action scout rifle after the Steyr Scout, built our own way. A slim sage polymer stock in one line from the
 * fore-end tip to the butt: a dead-straight comb, a skeletal butt whose window carries the spare magazine, a near-vertical
 * grip behind a big moulded guard, and a fore-end whose lower half is the two folded bipod legs. A dark gunmetal receiver
 * with an integral rail that runs on past the action, so the long-eye-relief scope sits forward over the barrel. A bright
 * fluted bolt with a swept handle and a black ball knob, a six-flute barrel, a ported muzzle cap. One amber inset line a flank.
 *
 * Origin at the top of the grip, -Z forward. The bolt lifts, runs back and returns on `boltPose`; the case leaves the port on
 * the weapon system's own eject cue.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, curve, poly, slotRow, type V2 } from '../kit/shapes';
import { knurl, rail, screwX } from '../kit/details';
import { hold, inOut, outCubic, seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';
import { acog, acogShade, OPTIC_GLOWS } from './optics';
import { TORCH, weaponLight } from './light';
import { LASER_GLOW, SNIPER_LAM_RANGE, lamSocket, weaponLam } from './laser';
import { GREASE } from '../../mods';

const BORE = 0.047;
const MUZZLE = -0.61;
/** The extended barrel's muzzle (`awlBarrel`), 12 cm on, and how far the can goes forward with it to sit over its brake. */
const LONG = MUZZLE - 0.12;
const CAN_SHIFT = LONG + 0.072 - (MUZZLE + 0.036);
/** Receiver ends, and the integral rail: its base and top, and how far forward it runs past the action. */
const REC_FRONT = -0.135;
const REC_REAR = 0.1;
const RAIL_BASE = 0.0706;
const RAIL_TOP = 0.078;
const RAIL_FRONT = -0.205;
/** Where the stock's upper edge runs along the action, under the bolt handle's arc. */
const STOCK_TOP = 0.034;
/** The fore-end's underside, which is the bipod legs' underside. */
const BELLY = -0.014;
const TIP = -0.402;
/** The scout scope's axis and middle. */
const SCOPE_Y = 0.104;
const SCOPE_Z = -0.15;

const STOCK: Finish = { color: 0x5a604e, rough: 0.66, metal: 0.03, wear: 0.06 };
const STOCK_GRIP: Finish = { color: 0x5a604e, rough: 0.82, metal: 0.02, wear: 0, kind: Kind.stipple };
const GUNMETAL: Finish = { color: 0x2c2f34, rough: 0.4, metal: 0.65, wear: 0.18 };
const BARREL: Finish = { ...F.barrel, wear: 0.1 };
const STAINLESS: Finish = { color: 0xc3c8cd, rough: 0.22, metal: 1, wear: 0.05, kind: Kind.brushed };
const LENS: Finish = { color: 0x07090d, rough: 0.12, metal: 0.25, wear: 0 };
/** The greased bolt's film: amber, wet and near mirror-smooth, laid in the flutes. */
const GREASE_FILM: Finish = { color: 0x9a7424, rough: 0.04, metal: 0.55, wear: 0 };

/**
 * The bolt after a shot, on the row's `cycleTime` of 0.65 s and its `cycleFoley` cues (data.ts): lift 0.068-0.164 s, pull
 * 0.164-0.274 (the case out at 0.205), push 0.383-0.506, lock 0.534-0.616, the hand back on the grip by 0.65.
 */
export function boltPose(seconds: number): { lift: number; back: number; hand: number } {
  const lift = inOut(seg(seconds, 0.068, 0.164)) * (1 - inOut(seg(seconds, 0.534, 0.616)));
  const back = inOut(seg(seconds, 0.164, 0.274)) * (1 - inOut(seg(seconds, 0.383, 0.506)));
  return { lift, back, hand: hold(seconds, 0.027, 0.089, 0.616, 0.65) };
}

/**
 * The fore-end's underside, which is the legs': flat back by the magazine, sweeping up to the nose. Profile corners take a
 * radius at least the prism's bevel, or the inset cap folds over itself and fills the holes.
 */
const LEG_LINE: V2[] = curve([[-0.168, BELLY], [-0.27, BELLY], [-0.34, -0.009], [-0.385, -0.0005], [TIP + 0.004, 0.006]], 5);
const SEAM = 0.0125;

/** The fore-end and the stock along the action: one profile, the barrel channel's top just under the bore. */
function foreStock(m: Mesher): void {
  m.use(STOCK);
  const outline = poly([
    [TIP, SEAM + 0.006, 0.006], [TIP + 0.016, 0.0345, 0.012], [REC_FRONT - 0.012, 0.0398, 0.01], [REC_FRONT + 0.004, STOCK_TOP, 0.006],
    [REC_REAR + 0.006, STOCK_TOP, 0.007], [REC_REAR + 0.006, -0.008, 0.007], [-0.004, BELLY, 0.008], [-0.168, BELLY, 0.007],
    [-0.168, SEAM, 0.004], [TIP + 0.01, SEAM, 0.007],
  ], 0.006);
  // Long windows under the barrel channel, through to the far side.
  m.side(outline, 0.036, { bevel: 0.0058, smooth: 50, holes: slotRow(-0.352, 0.0238, -0.2, 0.0238, 4, 0.028, 0.0072, 0) });
  // The seam over the legs, and the barrel channel's dark floor.
  m.use(F.black);
  m.at([0, SEAM - 0.0004, -0.285], null, () => m.box(0.033, 0.0012, 0.23, 0.0003));
  m.at([0, 0.0386, -0.27], null, () => m.box(0.016, 0.0008, 0.25, 0.0003));
  // Sling cups, steel rings let into the left flank.
  m.use(F.steelDark);
  m.at([-0.0182, 0.026, -0.37], [0, Math.PI / 2, 0], () => m.pipe(0.0052, 0.0034, 0.003, 16));
  m.at([-0.0193, -0.062, 0.37], [0, Math.PI / 2, 0], () => m.pipe(0.0052, 0.0034, 0.003, 16));
}

/** The butt's underside, a straight line from the grip's heel to the toe. */
const TOE: V2 = [0.402, -0.086];
const HEEL: V2 = [0.398, 0.052];
const under = (z: number) => -0.04 + (z - 0.128) * ((TOE[1] + 0.04) / (TOE[0] - 0.128));

/** The butt and wrist: straight comb, a window through the butt that holds the spare magazine, spacers and a pad. */
function butt(m: Mesher): void {
  m.use(STOCK);
  const outline = poly([
    [REC_REAR - 0.004, STOCK_TOP, 0.008], [0.2, STOCK_TOP, 0.018], [0.255, HEEL[1], 0.022], [HEEL[0], HEEL[1], 0.008],
    [TOE[0], TOE[1], 0.008], [0.128, -0.04, 0.014], [REC_REAR - 0.004, -0.012, 0.008],
  ], 0.008);
  const window = poly([
    [0.266, 0.032, 0.012], [0.372, 0.032, 0.01], [0.372, under(0.372) + 0.017, 0.008], [0.236, under(0.236) + 0.017, 0.012],
  ], 0.008);
  m.side(outline, 0.038, { bevel: 0.0072, smooth: 50, holes: [window] });
  // A grey cheek pad set into the comb, where the face rests.
  m.use(F.polymerGrey);
  m.at([0, HEEL[1] - 0.0012, 0.33], null, () => m.box(0.026, 0.004, 0.11, 0.0015, 0.004));
  // Two length-of-pull spacers and the rubber pad.
  const face = (dz: number): V2[] => poly([[HEEL[0] + dz, HEEL[1] - 0.002], [HEEL[0] + dz + 0.004, HEEL[1] - 0.002], [TOE[0] + dz + 0.004, TOE[1] + 0.002], [TOE[0] + dz, TOE[1] + 0.002]], 0.002);
  m.use(GUNMETAL);
  m.side(face(-0.001), 0.035, { bevel: 0.0012 });
  m.use(F.polymerGrey);
  m.side(face(0.003), 0.035, { bevel: 0.0012 });
  m.use(F.rubber);
  m.side(poly([[HEEL[0] + 0.006, HEEL[1] + 0.001], [HEEL[0] + 0.02, HEEL[1] - 0.003], [TOE[0] + 0.022, TOE[1] + 0.004], [TOE[0] + 0.007, TOE[1] - 0.001]], 0.007), 0.039, { bevel: 0.005, smooth: 50 });
  // The spare magazine, clipped into the window from below, its floor flush with the underside.
  const slope = Math.atan2(TOE[1] + 0.04, TOE[0] - 0.128);
  m.at([0, under(0.3) + 0.002, 0.3], [-slope, 0, 0], () => {
    m.use(F.polymer);
    m.side(poly([[-0.034, 0.042], [0.03, 0.042], [0.03, 0], [-0.034, 0]], 0.005), 0.029, { bevel: 0.002 });
    m.use(GUNMETAL);
    m.at([0, 0.002, -0.002], null, () => m.box(0.033, 0.006, 0.07, 0.0016, 0.003));
    m.use(F.black);
    for (let i = 0; i < 3; i++) m.mirror(() => m.at([0.0147, 0.015 + i * 0.008, -0.002], null, () => m.box(0.0006, 0.0024, 0.05, 0.0002)));
    // Feed lips, and the top round, brass under them.
    m.use(GUNMETAL);
    m.mirror(() => m.at([0.0098, 0.0435, -0.004], null, () => m.box(0.0066, 0.004, 0.05, 0.0012)));
    m.use(F.brass);
    m.at([0, 0.0445, 0.012], null, () => m.lathe([[0, 0.002, 0], [0.0058, 0.002], [0.0058, -0.034], [0.0044, -0.04], [0.0042, -0.044, 0]], 14));
    m.use(F.copper);
    m.at([0, 0.0445, 0.012], null, () => m.lathe([[0.0042, -0.044, 0], [0.0039, -0.05], [0.0022, -0.058], [0, -0.06, 0]], 14));
  });
}

function grip(m: Mesher): void {
  // Raked, with a finger-side curve, its back sweeping up into the butt's underside as one web.
  const front = curve([[0.054, -0.004], [0.059, -0.028], [0.063, -0.05], [0.069, -0.072], [0.076, -0.092], [0.08, -0.104]], 4);
  const back = curve([[0.136, -0.1], [0.131, -0.08], [0.127, -0.063], [0.13, -0.051], [0.143, -0.045], [0.165, -0.046]], 4);
  const soft = (p: V2) => [p[0], p[1], 0] as const;
  m.use(STOCK);
  m.side(poly([
    ...front.map(soft), [0.082, -0.112, 0.008], [0.134, -0.108, 0.008], ...back.map(soft), [0.15, -0.012, 0.008], [0.06, -0.003, 0.008],
  ], 0.006), 0.03, { bevel: 0.0055, smooth: 55 });
  // Stippled panels in the stock's own colour, and a gunmetal cap on the foot.
  const panel = poly([[0.068, -0.034, 0.006], [0.113, -0.036, 0.006], [0.12, -0.092, 0.006], [0.087, -0.097, 0.008]], 0.004);
  m.use(STOCK_GRIP);
  m.mirror(() => m.at([0.0148, 0, 0], null, () => m.side(panel, 0.0016, { bevel: 0.0006 })));
  m.use(GUNMETAL);
  m.side(poly([[0.081, -0.107], [0.134, -0.103], [0.135, -0.112], [0.082, -0.117]], 0.003), 0.031, { bevel: 0.0022 });
  // The guard, a big polymer bow moulded on, with a gloved finger's room.
  const out = poly([[-0.014, -0.006], [-0.017, -0.03, 0.01], [-0.002, -0.046, 0.012], [0.046, -0.046, 0.008], [0.066, -0.03, 0.006], [0.062, -0.006]], 0.002);
  const inn = poly([[-0.009, -0.01], [-0.011, -0.029, 0.007], [0.0, -0.039, 0.008], [0.044, -0.039, 0.006], [0.057, -0.027, 0.004], [0.054, -0.01]], 0.002);
  m.use(STOCK);
  m.side(out, 0.016, { bevel: 0.002, holes: [inn], smooth: 40 });
  // Magazine well lip under the fore-end.
  m.use(GUNMETAL);
  m.at([0, BELLY - 0.0015, -0.07], null, () => m.top(poly([[-0.0195, -0.044], [0.0195, -0.044], [0.0195, 0.044], [-0.0195, 0.044]], 0.004), 0.004, {
    bevel: 0.001, holes: [poly([[-0.0158, -0.0365], [0.0158, -0.0365], [0.0158, 0.0365], [-0.0158, 0.0365]], 0.003)],
  }));
}

/** The receiver section from behind: flat flanks, chamfered shoulders and a flat crown for the rail. */
const REC_W = 0.0155;
const REC_LOW = 0.024;
const REC_HIGH = 0.064;

function receiverSection(): V2[] {
  return poly([[-REC_W, REC_LOW], [REC_W, REC_LOW], [REC_W, 0.056], [0.0105, REC_HIGH, 0.003], [-0.0105, REC_HIGH, 0.003], [-REC_W, 0.056]], 0.002);
}

function receiver(m: Mesher): void {
  m.use(GUNMETAL);
  const full = receiverSection();
  // Front ring, closed round the barrel.
  const ringEnd = -0.044;
  m.at([0, 0, (REC_FRONT + ringEnd) / 2], null, () => m.front(full, ringEnd - REC_FRONT, { bevel: 0.0018, holes: [circle(0, BORE, 0.0124, 24)] }));
  // The port: open on the right from the chamber back to the handle's notch, so the bolt shows and the case leaves by it.
  const portEnd = 0.088;
  const arc: V2[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = 1.12 + (k / 12) * (Math.PI * 2 - 2.24);
    arc.push([Math.cos(a) * 0.0128, BORE + Math.sin(a) * 0.0128]);
  }
  const open = poly([
    [REC_W, 0.0352, 0], [REC_W, REC_LOW], [-REC_W, REC_LOW], [-REC_W, 0.056], [-0.0105, REC_HIGH, 0.003], [0.0105, REC_HIGH, 0.003],
    [REC_W, 0.0585, 0], ...arc.map(p => [p[0], p[1], 0] as const),
  ], 0.0015);
  m.at([0, 0, (ringEnd + portEnd) / 2], null, () => m.front(open, portEnd - ringEnd + 0.002, { bevel: 0.0012, capFront: false, capBack: false }));
  // Rear bridge and tang, with the bolt's way through it.
  m.at([0, 0, (portEnd + REC_REAR) / 2], null, () => m.front(full, REC_REAR - portEnd + 0.002, { bevel: 0.0014, holes: [circle(0, BORE, 0.0124, 24)] }));
  // Port edges: a dark cut so the opening reads from the side.
  m.use(F.black);
  m.at([REC_W - 0.0005, 0.0353, 0.022], null, () => m.box(0.002, 0.0012, 0.13, 0.0003));
  // Integral rail, with a cantilevered bridge carrying it forward over the barrel.
  m.use(GUNMETAL);
  m.side(poly([[REC_FRONT + 0.03, REC_HIGH - 0.006], [REC_FRONT + 0.02, RAIL_BASE], [RAIL_FRONT, RAIL_BASE], [RAIL_FRONT + 0.006, RAIL_BASE - 0.008, 0.004], [REC_FRONT - 0.02, 0.061, 0.01]], 0.002), 0.017, { bevel: 0.0016 });
  m.at([0, (REC_HIGH + RAIL_BASE) / 2, (REC_REAR + RAIL_FRONT) / 2], null, () => m.box(0.019, RAIL_BASE - REC_HIGH + 0.002, REC_REAR - RAIL_FRONT - 0.004, 0.0012));
  m.at([0, RAIL_BASE, 0], null, () => rail(m, REC_REAR - 0.004, RAIL_FRONT, 0.0212, GUNMETAL));
  // Barrel nut where the barrel meets the front ring.
  m.at([0, BORE, REC_FRONT - 0.004], null, () => m.cyl(0.0158, 0.008, 28, 0.0012));
  // The inset line along each flank of the front ring.
  m.use(F.black);
  m.mirror(() => m.at([REC_W + 0.0001, 0.0425, -0.088], null, () => m.box(0.0008, 0.0034, 0.078, 0.0003)));
  m.glow('accent', () => m.mirror(() => m.at([REC_W + 0.0005, 0.0425, -0.088], null, () => m.box(0.0004, 0.0011, 0.074, 0))));
  m.mirror(() => screwX(m, REC_W, 0.054, -0.122, 1, 0.0019, F.steelDark));
  // Roller safety on the tang behind the bolt, knurled, its white index line up.
  m.use(F.steelDark);
  m.at([0, STOCK_TOP + 0.003, REC_REAR + 0.02], [0, Math.PI / 2, 0], () => {
    m.cyl(0.0062, 0.016, 18);
    knurl(m, 0.0066, 0.012, F.steelDark, 14, 0.0005);
  });
  m.use(F.white);
  m.at([0, STOCK_TOP + 0.0095, REC_REAR + 0.02], null, () => m.box(0.008, 0.0008, 0.0012, 0.0002));
  // Bolt stop on the left.
  m.use(F.steelDark);
  m.at([-REC_W - 0.001, 0.05, 0.075], null, () => m.box(0.003, 0.007, 0.014, 0.0008));
}

/** Six flutes round the barrel, rounded scallops. */
function fluted(r: number, depth: number, n = 48): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a * 6 + Math.PI / 6);
    const cut = Math.max(0, (c - 0.15) / 0.85);
    const rr = r - depth * Math.sqrt(cut);
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}

/** Chunky rectangular multi-chamber tank muzzle brake for the .50 Cal conversion (both standard and extended barrels). */
function tankBrake(m: Mesher, rearZ: number, frontZ: number, chambers: number, width: number, height: number): void {
  const hw = width / 2;
  const hh = height / 2;
  const bore = [circle(0, 0, 0.0074, 12)];
  const wall = poly([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], 0.0022, 1);
  const len = rearZ - frontZ;
  const walls = chambers + 1;
  m.use(GUNMETAL);
  for (let i = 0; i < walls; i++) {
    const t = i / (walls - 1);
    const thick = i === 0 ? 0.011 : 0.006;
    const z = rearZ - thick / 2 - t * (len - thick);
    m.at([0, 0, z], null, () => m.front(wall, thick, { bevel: 0.0008, holes: bore }));
  }
  // Heavy top and bottom structural plates spanning the blast chambers.
  const midZ = (rearZ + frontZ) / 2;
  for (const y of [hh - 0.0018, -hh + 0.0018]) {
    m.at([0, y, midZ], null, () => m.box(width * 0.88, 0.0036, len - 0.002, 0.0006));
  }
  // Darkened heavy .50 bore and rear accent bar.
  m.use(F.black);
  m.lathe([[0.0074, frontZ + 0.0002, 0], [0.0068, frontZ + 0.024, 0], [0, frontZ + 0.025, 0]], 12);
  m.mirror(() => m.at([hw + 0.0001, -hh + 0.0042, rearZ - 0.0055], null, () => m.box(0.0006, 0.0018, 0.008, 0.0002)));
  m.glow('accent', () => m.mirror(() => m.at([hw + 0.0004, -hh + 0.0042, rearZ - 0.0055], null, () => m.box(0.0003, 0.0007, 0.0068, 0))));
}

function barrel(m: Mesher): void {
  const flutesFrom = -0.25;
  const flutesTo = -0.545;
  m.at([0, BORE, 0], null, () => {
    m.use(BARREL);
    m.lathe([[0.0128, REC_FRONT - 0.004, 0], [0.0128, -0.19], [0.0099, -0.23], [0.0099, flutesFrom, 0]], 28);
    m.at([0, 0, (flutesFrom + flutesTo) / 2], null, () => m.front(fluted(0.0099, 0.0021), flutesFrom - flutesTo, { bevel: 0.0005, smooth: 60 }));
    m.lathe([[0.0099, flutesTo, 0], [0.0099, MUZZLE + 0.04], [0.009, MUZZLE + 0.036, 0]], 28);
  });
  // A short ported cap on the crown. A part, so the extended barrel takes its place.
  m.part('crown', [0, BORE, 0], () => {
    m.use(GUNMETAL);
    m.lathe([[0.009, MUZZLE + 0.037, 0], [0.0108, MUZZLE + 0.035], [0.0108, MUZZLE + 0.003], [0.0097, MUZZLE], [0.0052, MUZZLE, 0]], 28, { chamfer: 0.0008 });
    m.use(F.black);
    m.mirror(() => {
      for (const z of [MUZZLE + 0.011, MUZZLE + 0.022]) m.at([0.0101, 0, z], null, () => m.box(0.0018, 0.005, 0.0062, 0.0006));
    });
    m.lathe([[0.0052, MUZZLE + 0.0002, 0], [0.0046, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 14);
    // .50 Cal dual-chamber tank brake: child of crown so awlBarrel hides it automatically when switching to the long .50 brake.
    m.part('cal50BrakeStd', [0, 0, 0], () => {
      m.use(F.steelDark);
      m.lathe([[0.0152, MUZZLE + 0.044, 0], [0.0172, MUZZLE + 0.041], [0.0172, MUZZLE + 0.032], [0.0158, MUZZLE + 0.03, 0]], 14);
      tankBrake(m, MUZZLE + 0.031, MUZZLE - 0.012, 2, 0.038, 0.025);
    });
  });
}

/**
 * The shop's extended barrel (`awlBarrel`): the barrel runs on 12 cm past the cap it replaces, to a gunmetal jam nut and a
 * two-port brake, its ports open both sides, a dark inset under them and the receiver's amber line along each flank.
 */
function longBarrel(m: Mesher): void {
  m.part('longBarrel', [0, BORE, 0], () => {
    m.use(BARREL);
    m.lathe([[0.0099, MUZZLE + 0.041, 0], [0.0099, LONG + 0.068], [0.0094, LONG + 0.064, 0]], 20);
    m.use(GUNMETAL);
    m.lathe([[0.0094, LONG + 0.068, 0], [0.0116, LONG + 0.066], [0.0121, LONG + 0.062], [0.0121, LONG + 0.055], [0.0112, LONG + 0.052, 0]], 18);
    // The brake: a rear block, a baffle and the face, each with the bore through it; straps top and bottom between them.
    const block = poly([[-0.0112, -0.0102], [0.0112, -0.0102], [0.0112, 0.0102], [-0.0112, 0.0102]], 0.003, 1);
    const bore = [circle(0, 0, 0.0052, 12)];
    for (const [z, len] of [[LONG + 0.041, 0.022], [LONG + 0.0195, 0.007], [LONG + 0.0035, 0.007]] as const) {
      m.at([0, 0, z], null, () => m.front(block, len, { bevel: 0.0009, holes: bore }));
    }
    for (const y of [0.0092, -0.0092]) m.at([0, y, LONG + 0.022], null, () => m.box(0.0154, 0.002, 0.036, 0));
    m.use(F.black);
    m.mirror(() => m.at([0.0113, -0.0062, LONG + 0.043], null, () => m.box(0.0006, 0.0016, 0.015, 0.0002)));
    m.glow('accent', () => m.mirror(() => m.at([0.0115, -0.0062, LONG + 0.043], null, () => m.box(0.0003, 0.0006, 0.013, 0))));
    // The bore, dark down its first few centimetres.
    m.lathe([[0.0052, LONG + 0.0002, 0], [0.0047, LONG + 0.03, 0], [0, LONG + 0.031, 0]], 12);
    // .50 Cal extended bull barrel + 3-chamber tank brake: child of longBarrel so it shows only when BOTH awl50 and awlBarrel are fitted.
    m.part('cal50Long', [0, 0, 0], () => {
      m.use(BARREL);
      m.lathe([[0.0152, MUZZLE + 0.042, 0], [0.0152, LONG + 0.068], [0.0144, LONG + 0.063, 0]], 16);
      // Heavy machined cooling collar and longitudinal fluting ribs on the extended section.
      m.use(F.steelDark);
      m.at([0, 0, (MUZZLE + 0.04 + LONG + 0.066) / 2], null, () => m.cyl(0.0164, 0.014, 14, 0.0008));
      m.use(F.black);
      for (const ang of [0.45, 1.57, 2.69, -0.45, -1.57, -2.69]) {
        m.at([Math.cos(ang) * 0.0149, Math.sin(ang) * 0.0149, (MUZZLE + 0.042 + LONG + 0.066) / 2], [0, 0, ang], () =>
          m.box(0.0014, 0.0024, (MUZZLE + 0.042) - (LONG + 0.066) - 0.012, 0));
      }
      // Heavy hex jam nut and oversized 3-chamber .50 BMG tank brake.
      m.use(F.steelDark);
      m.lathe([[0.0144, LONG + 0.068, 0], [0.0178, LONG + 0.065], [0.0178, LONG + 0.056], [0.0164, LONG + 0.054, 0]], 12);
      tankBrake(m, LONG + 0.055, LONG - 0.010, 3, 0.041, 0.027);
    });
  });
}

/**
 * The shop's .50 Cal anti-materiel conversion (`awl50`): reinforced billet receiver armor shroud, beefed-up recoil lug,
 * heavy fore-end heatshield shoulders, and thick bull-contour .50 barrel jacket. Paired with nested parts on `crown`,
 * `longBarrel`, `bolt`, and `mag` so both standard and extended barrels transform cleanly.
 */
function cal50Kit(m: Mesher): void {
  m.part('cal50Kit', [0, 0, 0], () => {
    // Reinforced billet receiver armor plates flanking the front ring (widening the action visibly).
    m.use(GUNMETAL);
    m.mirror(() => {
      m.at([REC_W + 0.0038, 0.044, -0.09], null, () => m.box(0.0076, 0.036, 0.104, 0.0018));
      m.use(F.steelDark);
      m.at([REC_W + 0.0075, 0.053, -0.125], [0, Math.PI / 2, 0], () => m.cyl(0.0028, 0.0016, 6, 0.0003));
      m.at([REC_W + 0.0075, 0.035, -0.058], [0, Math.PI / 2, 0], () => m.cyl(0.0028, 0.0016, 6, 0.0003));
      m.use(GUNMETAL);
    });
    // Left-side heavy receiver slab running back over the action (leaves right ejection port clear).
    m.at([-REC_W - 0.0034, 0.046, 0.024], null, () => m.box(0.0068, 0.034, 0.148, 0.0016));
    // Rear bridge armor cap and bold flank amber bars.
    m.at([0, 0.046, REC_REAR - 0.005], null, () => m.box(0.042, 0.034, 0.016, 0.0016));
    m.use(F.black);
    m.mirror(() => m.at([REC_W + 0.0077, 0.044, -0.09], null, () => m.box(0.0007, 0.0046, 0.072, 0.0002)));
    m.glow('accent', () => m.mirror(() => m.at([REC_W + 0.0081, 0.044, -0.09], null, () => m.box(0.0003, 0.0016, 0.068, 0))));
    // Heavy fore-end chassis rails / side armor shoulders bulking up the slim scout fore-end.
    m.use(F.steelDark);
    m.mirror(() => {
      m.at([0.0205, 0.024, -0.268], null, () => m.box(0.0055, 0.021, 0.242, 0.0014));
      m.at([0.0226, 0.024, -0.35], null, () => m.box(0.0032, 0.012, 0.055, 0.0008));
    });
    // Heavy barrel recoil lug + thick stepped .50 BMG bull barrel jacket.
    m.at([0, BORE, 0], null, () => {
      m.use(F.steelDark);
      m.lathe([[0.0195, REC_FRONT + 0.002, 0], [0.0212, REC_FRONT - 0.003], [0.0212, REC_FRONT - 0.024], [0.0185, REC_FRONT - 0.028, 0]], 12);
      m.use(BARREL);
      m.lathe([
        [0.0182, REC_FRONT - 0.026, 0], [0.0174, -0.205], [0.0156, -0.235], [0.0152, MUZZLE + 0.042, 0],
      ], 18);
      // Heavy barrel clamp collar mid-span and dark machined fluting channels.
      m.use(F.steelDark);
      m.at([0, 0, -0.395], null, () => m.cyl(0.0172, 0.018, 14, 0.0009));
      m.use(F.black);
      for (const ang of [0.45, 1.57, 2.69, -0.45, -1.57, -2.69]) {
        m.at([Math.cos(ang) * 0.0149, Math.sin(ang) * 0.0149, -0.405], [0, 0, ang], () =>
          m.box(0.0014, 0.0025, 0.295, 0));
      }
    });
  });
}

/**
 * The shop's greased bolt (`awlBolt`): a wet amber film down the three flutes the port shows and over the front lugs. Its own
 * part on the bolt's pivot, moved with the bolt (`clip`).
 */
function grease(m: Mesher): void {
  m.part('grease', [0, BORE, 0.045], () => {
    m.use(GREASE_FILM);
    // Flute middles sit at -5 degrees and every 60 from there; these three face the port.
    for (const deg of [-5, 55, -65]) {
      const a = (deg * Math.PI) / 180;
      m.at([Math.cos(a) * 0.0101, Math.sin(a) * 0.0101, -0.03], [0, 0, a], () => m.box(0.0007, 0.0026, 0.105, 0));
    }
    m.at([0, 0, -0.0915], null, () => m.lathe([[0.0109, 0.0006, 0], [0.0109, -0.0006, 0]], 16));
  });
}

/** The bolt: a bright fluted body, a dark shroud with a red cocking pin, a swept handle and a ball knob. Pivot on the bore. */
function bolt(m: Mesher): void {
  m.part('bolt', [0, BORE, 0.045], () => {
    m.use(STAINLESS);
    m.at([0, 0, -0.016], null, () => m.front(fluted(0.0112, 0.0014, 36), 0.148, { bevel: 0.0008, smooth: 60 }));
    // Bolt face and extractor, two front lugs.
    m.use(F.steelDark);
    m.at([0, 0, -0.0905], null, () => m.cyl(0.0108, 0.002, 20, 0.0004));
    m.mirror(() => m.at([0.0088, 0.0058, -0.084], [0, 0, -0.58], () => m.box(0.004, 0.0045, 0.01, 0.0008)));
    // Shroud behind the receiver.
    m.use(GUNMETAL);
    m.lathe([[0, 0.087, 0], [0.0066, 0.087], [0.0084, 0.085], [0.0084, 0.079], [0.0112, 0.077], [0.0118, 0.071], [0.0118, 0.058], [0.0108, 0.056, 0]], 24, { chamfer: 0.0008 });
    m.use(F.red);
    m.at([0, 0.0035, 0.0885], null, () => m.cyl(0.0018, 0.004, 10, 0.0004));
    // The handle: a root collar, a tapered stem swept back and down, a black ball knob.
    m.use(STAINLESS);
    m.at([0.009, 0, 0.035], [0, Math.PI / 2, 0], () => m.cyl(0.0058, 0.008, 16, 0.0008));
    m.tube([[0.008, 0, 0.035], [0.022, -0.006, 0.037], [0.034, -0.016, 0.043], [0.041, -0.024, 0.048]], t => 0.0042 - t * 0.0012, { seg: 12, samples: 14, caps: true });
    m.at([0.041, -0.024, 0.048], null, () => m.cyl(0.0042, 0.0042, 16, 0.0008));
    m.use(F.polymer);
    const ball: [number, number, number?][] = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI;
      ball.push([Math.sin(a) * 0.0088, Math.cos(a) * 0.0094, 0]);
    }
    m.at([0.046, -0.029, 0.051], [0.55, 0.85, 0], () => m.lathe(ball, 22));
    // .50 Cal heavy bolt shroud and oversized tactical cylindrical bolt knob (moves automatically with bolt).
    m.part('cal50Bolt', [0, 0, 0], () => {
      m.use(GUNMETAL);
      m.lathe([[0, 0.094, 0], [0.011, 0.094], [0.0148, 0.088], [0.0148, 0.058], [0.013, 0.055, 0]], 16, { chamfer: 0.0008 });
      m.use(F.red);
      m.at([0, 0.005, 0.0955], null, () => m.cyl(0.0026, 0.005, 8, 0.0004));
      m.use(F.steelDark);
      m.at([0.012, 0, 0.035], [0, Math.PI / 2, 0], () => m.box(0.014, 0.014, 0.014, 0.0014));
      m.at([0.048, -0.031, 0.053], [0.55, 0.85, 0], () => m.cyl(0.0124, 0.024, 14, 0.0014));
      m.use(F.black);
      for (const dy of [-0.005, 0.005]) {
        m.at([0.048, -0.031, 0.053], [0.55, 0.85, 0], () => m.at([0, 0, dy], null, () => m.cyl(0.0127, 0.0022, 14, 0)));
      }
    });
  });
}

function trigger(m: Mesher): void {
  m.part('trigger', [0, -0.006, 0.029], () => {
    m.use(STAINLESS);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0042, -0.0235, 0.0015], [0.0006, -0.0245, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0062, { bevel: 0.0007 });
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, BELLY, -0.07], () => {
    m.use(F.polymer);
    m.side(poly([[-0.0335, 0.044], [0.032, 0.044], [0.032, -0.008, 0.004], [-0.0335, -0.008, 0.007]], 0.003), 0.03, { bevel: 0.0018 });
    // Floor plate in gunmetal, a ledge forward for the fingers.
    m.use(GUNMETAL);
    m.side(poly([[-0.037, -0.006], [0.034, -0.006], [0.034, -0.0135, 0.003], [-0.031, -0.0135], [-0.038, -0.011, 0.002]], 0.002), 0.034, { bevel: 0.0016 });
    m.use(F.black);
    m.mirror(() => m.at([0.0151, -0.0035, 0], null, () => m.box(0.0006, 0.0018, 0.05, 0.0002)));
    // .50 Cal heavy protruding stamped-steel box magazine (drops and inserts automatically with mag).
    m.part('cal50Mag', [0, 0, 0], () => {
      m.use(GUNMETAL);
      m.side(poly([[-0.042, 0.042], [0.038, 0.042], [0.038, -0.048, 0.004], [-0.042, -0.044, 0.006]], 0.003), 0.039, { bevel: 0.0018 });
      m.use(F.steelDark);
      m.side(poly([[-0.046, -0.043], [0.042, -0.046], [0.042, -0.055, 0.003], [-0.046, -0.052, 0.003]], 0.002), 0.043, { bevel: 0.0016 });
      m.use(F.black);
      m.mirror(() => {
        for (const z of [-0.018, 0.014]) m.at([0.0196, -0.012, z], null, () => m.box(0.001, 0.056, 0.007, 0.0003));
      });
    });
  });
}

/** Two legs, side by side, are the fore-end's lower half; hinged at the nose, feet back by the magazine. */
function bipod(m: Mesher): void {
  const hinge: V2 = [TIP + 0.014, 0.004];
  m.part('bipod', [0, hinge[1], hinge[0]], () => {
    const leg = poly([
      ...[...LEG_LINE].reverse().map(p => [p[0] - hinge[0], p[1] - hinge[1], 0] as const),
      [-0.168 - hinge[0], BELLY - hinge[1], 0.006], [-0.168 - hinge[0] + 0.002, SEAM - 0.001 - hinge[1], 0.005],
      [TIP + 0.006 - hinge[0], SEAM - 0.001 - hinge[1], 0.006],
    ], 0.005);
    m.mirror(() => {
      m.use(STOCK);
      m.at([0.0094, 0, 0], null, () => m.side(leg, 0.0164, { bevel: 0.0042, smooth: 50 }));
      m.use(F.rubber);
      m.at([0.0094, BELLY - hinge[1] + 0.009, -0.174 - hinge[0]], null, () => m.box(0.0152, 0.018, 0.012, 0.003, 0.004));
      m.use(F.steelDark);
      m.at([0.0182, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.0016, 16, 0.0004));
    });
    m.use(F.black);
    m.at([0, -0.006, 0.12], null, () => m.box(0.0012, 0.022, 0.21, 0.0003));
    // The release button underneath.
    m.use(F.polymerGrey);
    m.at([0, BELLY - hinge[1] - 0.001, 0.2], null, () => m.box(0.012, 0.003, 0.012, 0.001, 0.003));
  });
}

/**
 * The long-eye-relief scope, ahead of the action on the rail: one turned body from the eyecup to the objective bell, a
 * faceted saddle with capped turrets, and two rings on the rail. Hidden while the ACOG is fitted.
 */
function scoutScope(m: Mesher): void {
  m.part('scoutScope', [0, SCOPE_Y, SCOPE_Z], () => {
    m.use(GUNMETAL);
    m.lathe([
      [0, 0.128, 0], [0.0152, 0.128, 0], [0.0152, 0.134], [0.0178, 0.134], [0.0184, 0.128], [0.0184, 0.098], [0.0166, 0.09],
      [0.0128, 0.074], [0.0128, -0.068], [0.0152, -0.08], [0.0196, -0.104], [0.0199, -0.14], [0.0176, -0.142], [0.0172, -0.128, 0], [0, -0.128, 0],
    ], 32, { chamfer: 0.0007 });
    m.use(F.rubber);
    m.lathe([[0.0153, 0.143, 0], [0.0186, 0.143], [0.0189, 0.136], [0.0153, 0.136, 0]], 32);
    m.at([0, 0, 0.111], null, () => knurl(m, 0.0189, 0.012, F.steelDark, 22, 0.0005));
    // Coated lenses under the glass.
    m.use(LENS);
    m.at([0, 0, 0.1282], null, () => m.cyl(0.0151, 0.0004, 32, 0));
    m.at([0, 0, -0.1282], null, () => m.cyl(0.0171, 0.0004, 32, 0));
    m.glass(() => {
      m.at([0, 0, 0.1292], null, () => m.cyl(0.0151, 0.0004, 32, 0));
      m.at([0, 0, -0.1292], null, () => m.cyl(0.0171, 0.0004, 32, 0));
    });
    // Saddle and turrets: elevation on top, windage on the right, the illumination dial on the left.
    m.use(GUNMETAL);
    m.at([0, 0, 0.004], null, () => m.front(poly([[-0.0148, -0.011], [0.0148, -0.011], [0.0172, 0.0], [0.0148, 0.0145], [-0.0148, 0.0145], [-0.0172, 0.0]], 0.003), 0.05, { bevel: 0.0022 }));
    m.at([0, 0.0185, 0.004], [Math.PI / 2, 0, 0], () => m.cyl(0.0078, 0.008, 22));
    m.at([0.0198, 0, 0.004], [0, Math.PI / 2, 0], () => m.cyl(0.0078, 0.008, 22));
    m.at([-0.0192, 0, 0.004], [0, Math.PI / 2, 0], () => m.cyl(0.0066, 0.006, 22));
    m.at([0, 0.0255, 0.004], [Math.PI / 2, 0, 0], () => knurl(m, 0.0084, 0.008, F.steelDark, 16, 0.0005));
    m.at([0.0265, 0, 0.004], [0, Math.PI / 2, 0], () => knurl(m, 0.0084, 0.008, F.steelDark, 16, 0.0005));
    m.use(GUNMETAL);
    m.at([0, 0.0298, 0.004], [Math.PI / 2, 0, 0], () => m.cyl(0.0072, 0.0016, 22, 0.0005));
    m.at([0.0308, 0, 0.004], [0, Math.PI / 2, 0], () => m.cyl(0.0072, 0.0016, 22, 0.0005));
    m.glow('accent', () => m.at([0, 0.0308, 0.004 + 0.004], null, () => m.box(0.0008, 0.0003, 0.004, 0)));
    // Rings: a clamp on the rail, a neck, a split ring with a screw each side.
    const ring: V2[] = [[-0.0125, RAIL_TOP - SCOPE_Y], [0.0125, RAIL_TOP - SCOPE_Y]];
    for (let k = 0; k <= 20; k++) {
      const a = -0.85 + (k / 20) * (Math.PI + 1.7);
      ring.push([Math.cos(a) * 0.0162, Math.sin(a) * 0.0162]);
    }
    for (const z of [0.055, -0.048]) {
      m.at([0, 0, z], null, () => {
        m.front(poly(ring.map((p, i) => [p[0], p[1], i < 2 ? 0.002 : 0] as const), 0.002), 0.013, { bevel: 0.0012, holes: [circle(0, 0, 0.0128, 28)] });
        m.at([0, RAIL_TOP - SCOPE_Y + 0.003, 0], null, () => m.box(0.028, 0.006, 0.018, 0.0012));
        m.use(F.black);
        m.mirror(() => m.at([0.0158, 0.0, 0], null, () => m.box(0.0012, 0.0008, 0.0134, 0.0002)));
        m.mirror(() => screwX(m, 0.0158, 0.0065, 0, 1, 0.0018, F.steelDark));
        m.use(F.steelDark);
        m.at([-0.0148, RAIL_TOP - SCOPE_Y + 0.003, 0], [0, -Math.PI / 2, 0], () => m.cyl(0.0034, 0.004, 6, 0.0004));
        m.use(GUNMETAL);
      });
    }
  });
}

function suppressor(m: Mesher): void {
  m.part('can', [0, BORE, MUZZLE + 0.036], () => {
    m.use(GUNMETAL);
    m.lathe([
      [0.0109, 0.0, 0], [0.0145, 0.0], [0.0145, -0.012], [0.0212, -0.022], [0.0212, -0.164], [0.0196, -0.174], [0.0062, -0.174, 0],
    ], 32, { chamfer: 0.0012 });
    m.at([0, 0, -0.006], null, () => knurl(m, 0.0155, 0.009, F.steelDark, 20, 0.0005));
    m.use(F.steelDark);
    for (const z of [-0.03, -0.155]) m.at([0, 0, z], null, () => m.cyl(0.0216, 0.004, 32, 0.0006));
    m.use(F.black);
    m.lathe([[0.0062, -0.1735, 0], [0.005, -0.178, 0], [0, -0.1785, 0]], 14);
  });
}

function build(kit: Kit): { model: Model; mods: ViewDef['mods'] } {
  const m = kit.mesher();
  m.bevel = 0.0012;
  foreStock(m);
  butt(m);
  grip(m);
  receiver(m);
  barrel(m);
  longBarrel(m);
  cal50Kit(m);
  bolt(m);
  grease(m);
  trigger(m);
  magazine(m);
  bipod(m);
  scoutScope(m);
  const optic = acog(m, [0, RAIL_TOP, -0.105]);
  suppressor(m);
  // The shop's weapon light and laser sight (weapons/mods.ts), hidden until fitted. Opposite flanks at the fore-end tip.
  weaponLight(m, [-0.0332, 0.012, -0.3615], -Math.PI / 2);
  weaponLam(m, [0.0332, 0.012, -0.3615], Math.PI / 2);
  const model = new Model(m, kit.mats, { glows: { ...OPTIC_GLOWS, accent: [0xff9a2e, 3], torch: TORCH, laser: LASER_GLOW } });
  acogShade(model);
  lamSocket(model);
  model.socket('muzzle', [0, BORE, MUZZLE]);
  // On the can, so it goes forward with it onto the extended barrel.
  model.socket('muzzleCan', [0, 0, -0.178], [0, 0, 0], 'can');
  model.socket('muzzleLong', [0, BORE, LONG]);
  model.socket('eject', [REC_W + 0.004, BORE + 0.006, -0.012]);
  model.hand('gripR', [0.018, -0.054, 0.108], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.001, BELLY - 0.002, -0.29]);
  model.hand('boltHold', [0.056, -0.03, 0.05], [0, -1, 0], [0, 0, -1], 'bolt');
  model.hand('magHold', [-0.02, -0.012, 0], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return {
    model, mods: {
      awlAcog: optic, awlCan: { part: 'can', muzzle: 'muzzleCan' }, awlLight: { part: 'light' },
      awlLam: { part: 'lam', laser: 'lam', laserRange: SNIPER_LAM_RANGE },
      // After the can, so with both on the flash leaves the can's mouth, and the can goes on over the brake.
      awlBarrel: { part: 'longBarrel', hides: 'crown', muzzle: 'muzzleLong', moves: { part: 'can', z: CAN_SHIFT } },
      awlBolt: { part: 'grease' },
      // Chunky .50 Cal kit: cal50BrakeStd is nested in crown (hidden when awlBarrel is fitted), cal50Long in longBarrel
      // (visible only when both awl50 and awlBarrel are fitted), cal50Bolt in bolt, and cal50Mag in mag.
      awl50: { part: 'cal50Kit', also: ['cal50BrakeStd', 'cal50Long', 'cal50Bolt', 'cal50Mag'] },
    },
  };
}

function clip(anim: Anim): void {
  // The greased bolt runs sooner (GREASE); .50 Cal runs a deliberate 1.15x cycle (mods.ts awl50).
  const cycleScale = (anim.mods?.has('awlBolt') ? GREASE : 1) * (anim.mods?.has('awl50') ? 1.15 : 1);
  const boltTime = anim.sinceCycle >= 0 ? anim.sinceCycle : anim.sinceFire;
  const bolt = boltPose(boltTime / cycleScale);
  anim.parts.bolt!.rotation.z += bolt.lift * 1.12;
  anim.parts.bolt!.position.z += bolt.back * 0.095;
  anim.parts.grease!.rotation.z = anim.parts.bolt!.rotation.z;
  anim.parts.grease!.position.z = anim.parts.bolt!.position.z;
  anim.parts.scoutScope!.visible = !anim.mods?.has('awlAcog');
  anim.glow('accent', 1);
  anim.right.to('boltHold', bolt.hand);
  anim.right.shape(HANDS.grip, bolt.hand);
  anim.gunR.z -= bolt.hand * 0.14;
  anim.gunP.x -= bolt.hand * 0.018;
  anim.gunP.z -= bolt.hand * 0.1;
  pullTrigger(anim, 0.09, 0.25);
  if (anim.draw < 1) {
    const down = 1 - outCubic(anim.draw);
    anim.gunP.y -= down * 0.07;
    anim.gunR.x -= down * 0.35;
  }
  const progress = anim.reload;
  if (progress < 0) return;
  const away = inOut(seg(progress, 0.05, 0.22)) * (1 - inOut(seg(progress, 0.4, 0.55)));
  anim.parts.mag!.position.y -= away * 0.28;
  anim.parts.mag!.visible = !(progress > 0.24 && progress < 0.37);
  const present = hold(progress, 0, 0.12, 0.86, 1);
  anim.gunR.z -= present * 0.32;
  anim.gunR.x += present * 0.12;
  anim.left.to('magHold', inOut(seg(progress, 0, 0.06)));
  anim.left.to('pouchL', inOut(seg(progress, 0.2, 0.3)));
  anim.left.to('magHold', inOut(seg(progress, 0.37, 0.48)));
  anim.left.to('gripL', inOut(seg(progress, 0.65, 0.9)));
}

export function awlDef(kit: Kit): ViewDef {
  const { model, mods } = build(kit);
  return {
    id: 'awl', model, mods,
    // Down while the ACOG is on, in the shop's studio as on the gun.
    irons: 'scoutScope',
    pos: [0.135, -0.13, -0.42], rot: [0.025, 0.08, 0],
    recoil: { back: 0.047, lift: 0.006, pitch: 0.035, yaw: 0.008, roll: 0.014, omega: 33, zeta: 0.6 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.03,
    animate: clip,
  };
}
