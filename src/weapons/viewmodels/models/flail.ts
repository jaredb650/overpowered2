/**
 * The Flail: a belt-fed light machine gun, last on key 1. A square-shouldered receiver under a feed cover hinged at its front, the
 * cover carrying the rail an optic clamps to; a box hung under the receiver on the left, the belt climbing out of it up the flank and
 * in at the feed lip; a ventilated heat shield over the barrel and a polymer handguard under it; a carry handle folded flat to the
 * left, a bipod folded forward under the barrel, a fixed angular stock. Graphite anodizing, black polymer and a pale ceramic shield,
 * cyan lines let into the receiver and cover, and an amber line in each of the shield's vents that brightens as the barrel heats.
 *
 * The stock 100 is a soft pouch on a polymer frame, a round count lit down its face; the shop's 200 (`flailBox`) is a hard box twice
 * the volume, deeper and longer forward, with the same lid height so the belt climbs out of it the same way. Origin at the top of the
 * grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type P2 } from '../kit/shapes';
import { hexX, knurl, rail, screwX, serrations } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ModLook, ViewDef } from '../def';
import { HANDS } from '../poses';
import { OPTIC_GLOWS, acog, acogShade, redDot } from './optics';

const BORE = 0.044;
/** Half width of the receiver. */
const HALF = 0.025;
const REC_BACK = 0.12;
const REC_FRONT = -0.18;
/** Top of the receiver's walls, where the feed tray lies and the cover closes. */
const REC_TOP = 0.074;
/** The cover's hinge, at its front, and its length back from there. */
const COVER_FRONT = -0.165;
const COVER_LEN = 0.235;
/** Top of the cover's rail. */
const RAIL = 0.094;
const SHIELD_FRONT = -0.44;
const GUARD_REAR = -0.192;
const GUARD_FRONT = -0.37;
const GAS = -0.452;
const POST = -0.585;
const HIDER = -0.62;
const MUZZLE = -0.668;
/** Heavy M60/MG42-inspired fore-end (`flailHeavy`): chunky slotted shroud and aggressive muzzle booster. */
const SHROUD_H_REAR = -0.198;
const SHROUD_H_FRONT = -0.562;
const MUZZLE_HEAVY = -0.718;
/** The irons' line, the front post's tip to the rear aperture: level. */
const IRONS = 0.112;
/** Where the belt comes up the left flank and in, and the middle of the box under it. */
const BELT_Z = -0.1;
/** Two rounds on the belt. */
const PITCH = 0.0118;
const TRAY_ROUNDS = 3;
const HANG_ROUNDS = 6;

/** Pale ceramic on the heat shield, against the graphite gun. */
const CERAMIC: Finish = { color: 0x8e9399, rough: 0.72, metal: 0.05, wear: 0.55 };
/** The pouch's cloth: coyote nylon, and the darker webbing strapped round it. */
const CLOTH: Finish = { color: 0x6b5f45, rough: 0.9, metal: 0, wear: 0, kind: F.fabric.kind };
const STRAP: Finish = { color: 0x3f3a2c, rough: 0.86, metal: 0, wear: 0, kind: F.fabric.kind };
/** The cyber accent: blued graphite on the side plates. */
const PLATE: Finish = { color: 0x22262c, rough: 0.4, metal: 0.55, wear: 0.7 };

/** A 5.56 round along Z, its head at the origin, the nose toward -Z, in a steel link. */
function linked(m: Mesher): void {
  m.use(F.brass);
  m.lathe([[0, 0.0002, 0], [0.0049, 0.0002], [0.0049, -0.0012], [0.0043, -0.0016], [0.0047, -0.0022], [0.0045, -0.03], [0.003, -0.034], [0.003, -0.039, 0]], 10, { chamfer: 0.0002 });
  m.use(F.copper);
  m.lathe([[0.0028, -0.039, 0], [0.0028, -0.043], [0.0017, -0.05], [0, -0.054, 0]], 10, { chamfer: 0 });
  m.use(F.steelDark);
  m.at([0, 0, -0.011], null, () => m.box(0.0112, 0.0112, 0.007, 0.0012, 0.003));
}

function receiver(m: Mesher): void {
  m.use(F.anodized);
  // The box: square at the back where the stock bolts on, chamfered at its top front down onto the trunnion.
  m.side(poly([[REC_BACK, 0.004], [REC_BACK, REC_TOP, 0.003], [REC_FRONT + 0.012, REC_TOP, 0.004], [REC_FRONT, REC_TOP - 0.016, 0.003], [REC_FRONT, 0.004, 0.003]], 0.002), HALF * 2, { bevel: 0.0022 });
  // Side plates, a facet proud of each wall, cut back at the front in a rake, a line let into each that runs the length of it
  // and steps down with the rake.
  const plate: P2[] = [[REC_BACK - 0.012, 0.016], [REC_BACK - 0.012, 0.062, 0.003], [-0.06, 0.062], [-0.072, 0.05, 0.003], [-0.072, 0.016, 0.003]];
  m.use(PLATE);
  m.mirror(() => m.at([HALF + 0.0012, 0, 0], null, () => m.side(poly(plate, 0.002), 0.0026, { bevel: 0.0009 })));
  const strip = (h: number): P2[] => [[REC_BACK - 0.02, 0.0545 + h], [-0.058 - h, 0.0545 + h], [-0.064 - h, 0.0485 + h], [-0.064 + h, 0.0485 - h], [-0.058 + h, 0.0545 - h], [REC_BACK - 0.02, 0.0545 - h]];
  m.use(F.black);
  m.mirror(() => m.at([HALF + 0.0022, 0, 0], null, () => m.side(poly(strip(0.0016), 0.0005), 0.0008, { bevel: 0.0002 })));
  m.glow('line', () => m.mirror(() => m.at([HALF + 0.0027, 0, 0], null, () => m.side(poly(strip(0.0007), 0.0003), 0.0006, { bevel: 0 }))));
  // Pins through both walls, the trunnion's big ones and the plates' screws.
  m.mirror(() => {
    hexX(m, HALF + 0.0025, 0.03, 0.08, 1, 0.0046);
    hexX(m, HALF, 0.05, REC_FRONT + 0.016, 1, 0.0052);
    screwX(m, HALF + 0.0025, 0.024, -0.05, 1, 0.0019);
    screwX(m, HALF + 0.0025, 0.024, 0.02, 1, 0.0019);
  });
  m.at([-(HALF + 0.0026), 0.032, -0.012], [0, -Math.PI / 2, 0], () => m.decal('flail', 0.058, 0.0086, 0xb9bec4));
  m.at([-(HALF + 0.0026), 0.022, 0.06], [0, -Math.PI / 2, 0], () => m.decal('cal556', 0.04, 0.0062, 0x9aa0a6));
  // The trunnion block the barrel screws into, proud of the box.
  m.use(F.steelDark);
  m.at([0, BORE, REC_FRONT - 0.008], null, () => m.box(HALF * 2 + 0.006, 0.05, 0.02, 0.002, 0.005));
  // The feed: a black mouth in the left wall the belt goes in at, a steel tray across the top that it lies on with the cover up,
  // and the cover's two side rails.
  m.use(F.black);
  m.at([-(HALF + 0.0004), 0.064, BELT_Z], null, () => m.box(0.0016, 0.02, 0.064, 0.0006));
  m.use(F.steel);
  m.at([-0.004, REC_TOP + 0.0006, BELT_Z], null, () => m.box(HALF * 2 - 0.012, 0.0022, 0.07, 0.0008));
  m.use(F.steelDark);
  for (const x of [-0.012, 0.006]) m.at([x, REC_TOP + 0.0018, BELT_Z], null, () => m.box(0.0026, 0.0026, 0.07, 0.0006));
  m.at([-(HALF - 0.003), REC_TOP + 0.003, BELT_Z], null, () => m.box(0.006, 0.006, 0.07, 0.0012));
  // The box's mount under the receiver: two rails it slides onto, and the latch.
  m.at([-0.006, 0.002, BELT_Z], null, () => m.box(0.05, 0.006, 0.108, 0.0014, 0.002));
  m.use(F.steel);
  m.at([-0.006, -0.001, BELT_Z + 0.056], null, () => m.box(0.014, 0.006, 0.006, 0.0012));
  // An ejection chute under the right: the cases go down.
  m.use(F.black);
  m.at([HALF - 0.008, 0.0035, -0.028], null, () => m.box(0.012, 0.002, 0.04, 0.0006));
}

function lower(m: Mesher): void {
  // Fire control housing, the pistol grip, the guard.
  m.use(F.anodized);
  m.side(poly([[0.112, 0.006], [0.112, -0.004, 0.004], [0.094, -0.012, 0.004], [-0.048, -0.012, 0.003], [-0.052, 0.006]], 0.002), 0.038, { bevel: 0.0018 });
  const front = curve([[0.02, -0.002], [0.021, -0.024], [0.027, -0.042], [0.03, -0.06], [0.037, -0.08], [0.044, -0.1], [0.047, -0.116]], 4);
  const back = curve([[0.105, -0.116], [0.099, -0.082], [0.09, -0.048], [0.085, -0.022], [0.078, -0.002]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.048, -0.122], [0.103, -0.122], ...back], 0.034, { bevel: 0.0045, smooth: 50 });
  m.use(F.polymer);
  m.at([0, -0.1245, 0.076], null, () => m.box(0.034, 0.005, 0.058, 0.0013, 0.003));
  m.use(F.anodized);
  const guardOut = poly([[-0.04, -0.0105], [-0.044, -0.034, 0.006], [-0.026, -0.047, 0.008], [0.03, -0.047, 0.008], [0.052, -0.016, 0.004], [0.052, -0.0105]], 0.002);
  const guardIn = poly([[-0.036, -0.0125], [-0.039, -0.033, 0.005], [-0.024, -0.0435, 0.005], [0.027, -0.0435, 0.005], [0.047, -0.0155, 0.003], [0.047, -0.0125]], 0.002);
  m.side(guardOut, 0.013, { bevel: 0.0009, holes: [guardIn] });
  // The safety, a push-through button over the grip.
  m.use(F.steelDark);
  m.at([-0.02, -0.004, 0.03], [0, Math.PI / 2, 0], () => m.cyl(0.004, 0.006, 12));
}

function stock(m: Mesher): void {
  // The buffer's end cap where either stock meets the receiver.
  m.use(F.steelDark);
  m.at([0, 0.04, REC_BACK + 0.004], null, () => m.box(HALF * 2 + 0.002, 0.056, 0.01, 0.002, 0.004));

  // The issued fixed angular skeleton stock; hidden when `flailStock` is fitted.
  m.part('stockStd', [0, 0, 0], () => {
    m.use(F.polymer);
    const outer = poly([[REC_BACK - 0.004, 0.068], [REC_BACK - 0.004, 0.012], [0.2, -0.004, 0.012], [0.35, -0.022, 0.008], [0.362, -0.02, 0.004], [0.362, 0.076, 0.006], [0.28, 0.074, 0.02], [0.17, 0.07, 0.012]], 0.004);
    const cut = poly([[0.17, 0.05], [0.2, 0.018], [0.322, 0.002], [0.33, 0.012], [0.33, 0.054], [0.29, 0.056]], 0.006);
    m.side(outer, 0.04, { bevel: 0.006, smooth: 50, holes: [cut] });
    m.use(F.polymerGrey);
    m.mirror(() => m.at([0.0205, 0, 0], null, () => m.side(poly([[0.2, 0.066], [0.31, 0.068], [0.32, 0.06], [0.21, 0.058]], 0.002), 0.002, { bevel: 0.0006 })));
    m.use(F.rubber);
    m.at([0, 0.028, 0.368], null, () => m.box(0.042, 0.1, 0.012, 0.004, 0.008));
  });

  // Enhanced tactical precision cheek-rest stock (`flailStock`): bevelled multi-material frame, adjustable cheek riser on twin
  // steel guide posts, knurled elevation/LOP dials, machined cheek rails, under-heel shoulder hook and heavy ribbed recoil pad.
  m.part('stockEnh', [0, 0, 0], () => {
    // Heavy contoured lower/main body with twin truss cut-outs revealing the machined LOP guide rods.
    m.use(F.polymer);
    const frame = poly([
      [REC_BACK - 0.002, 0.069], [REC_BACK - 0.002, 0.01], [0.18, -0.006, 0.01],
      [0.245, -0.026, 0.008], [0.368, -0.032, 0.006], [0.376, -0.026, 0.004],
      [0.376, 0.078, 0.006], [0.33, 0.075, 0.01], [0.18, 0.07, 0.008],
    ], 0.004);
    const frontCut = poly([[0.175, 0.046], [0.195, 0.016], [0.26, -0.006], [0.262, 0.046]], 0.006);
    const rearCut = poly([[0.285, 0.044], [0.285, -0.012], [0.342, -0.015], [0.344, 0.044]], 0.006);
    m.side(frame, 0.042, { bevel: 0.0055, smooth: 50, holes: [frontCut, rearCut] });

    // Contrasting machined anodized-grey side rail plates + QD sling sockets + thin inset cyan accent strip.
    m.use(F.anodizedGrey);
    m.mirror(() => {
      m.at([0.0218, 0, 0], null, () => m.side(poly([
        [0.145, 0.064], [0.355, 0.068], [0.36, 0.052], [0.15, 0.048],
      ], 0.0025), 0.0032, { bevel: 0.0009 }));
      // QD sling cup at rear lower flank.
      m.use(F.steelDark);
      m.at([0.0218, -0.006, 0.354], [0, Math.PI / 2, 0], () => m.cyl(0.0068, 0.0032, 16));
      m.use(F.black);
      m.at([0.023, -0.006, 0.354], [0, Math.PI / 2, 0], () => m.cyl(0.0038, 0.0014, 14));
      m.use(F.anodizedGrey);
    });
    m.use(F.black);
    m.at([-0.0236, 0, 0], null, () => m.side(poly([[0.158, 0.058], [0.342, 0.061], [0.342, 0.056], [0.158, 0.053]], 0.0006), 0.0008, { bevel: 0.0002 }));
    m.glow('line', () => m.at([-0.0241, 0, 0], null, () => m.side(poly([[0.16, 0.0564], [0.34, 0.0594], [0.34, 0.0576], [0.16, 0.0546]], 0.0003), 0.0006, { bevel: 0 })));

    // Twin brushed-steel guide posts & knurled elevation / length-of-pull adjustment wheels inside the cutouts.
    m.use(F.steel);
    for (const z of [0.215, 0.295]) m.at([0, 0.066, z], [Math.PI / 2, 0, 0], () => m.cyl(0.0048, 0.024, 12));
    m.at([0, 0.015, 0.314], [Math.PI / 2, 0, 0], () => knurl(m, 0.0115, 0.016, F.steelDark, 20, 0.0007));
    m.at([0, 0.026, 0.225], null, () => knurl(m, 0.0095, 0.014, F.steel, 18, 0.0006));

    // Elevated ergonomic cheek riser saddle riding on the twin posts (contrasting stippled polymer + rubber top pad).
    m.use(F.polymerStipple);
    const riser = poly([
      [0.184, 0.072], [0.205, 0.084, 0.008], [0.316, 0.086, 0.008], [0.33, 0.074, 0.005],
      [0.326, 0.064, 0.003], [0.188, 0.062, 0.003],
    ], 0.003);
    m.side(riser, 0.048, { bevel: 0.005, smooth: 50 });
    m.use(F.rubber);
    m.at([0, 0.085, 0.26], null, () => m.top(rect(-0.016, -0.052, 0.016, 0.052, 0.006), 0.0035, { bevel: 0.0012 }));
    m.mirror(() => {
      screwX(m, 0.0242, 0.072, 0.215, 1, 0.0022, F.steel);
      screwX(m, 0.0242, 0.073, 0.295, 1, 0.0022, F.steel);
    });

    // Under-stock heavy machined folding shoulder-hook / monopod rail.
    m.use(F.steelDark);
    m.side(poly([[0.252, -0.026], [0.362, -0.031], [0.366, -0.041, 0.003], [0.258, -0.036, 0.003]], 0.002), 0.024, { bevel: 0.0016 });
    m.use(F.steel);
    m.at([0, -0.034, 0.352], [0, Math.PI / 2, 0], () => m.cyl(0.0046, 0.028, 12));

    // Heavy contoured rubber recoil buttpad with horizontal traction ribs.
    m.use(F.rubber);
    m.side(poly([[0.372, 0.08], [0.388, 0.077, 0.005], [0.39, -0.032, 0.006], [0.372, -0.036, 0.004]], 0.003), 0.044, { bevel: 0.004, smooth: 40 });
    m.use(F.polymerGrey);
    for (let i = 0; i < 6; i++) {
      m.at([0, -0.018 + i * 0.016, 0.388], null, () => m.front(rect(-0.016, -0.0022, 0.016, 0.0022, 0.0008), 0.0026, { bevel: 0.0006 }));
    }
  });
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0128, REC_FRONT - 0.016, 0], [0.0128, GUARD_REAR - 0.012], [0.0108, GUARD_REAR - 0.02], [0.0108, HIDER + 0.004], [0.0098, HIDER, 0]], 20);
    // The birdcage hider, slotted round its top and sides.
    m.use(F.barrelBlack);
    m.lathe([[0.0098, HIDER + 0.002, 0], [0.0118, HIDER], [0.0118, MUZZLE + 0.004], [0.0104, MUZZLE], [0.006, MUZZLE, 0]], 20);
    m.use(F.black);
    for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
      m.at([Math.sin(a) * 0.0116, Math.cos(a) * 0.0116, (HIDER + MUZZLE) / 2], [0, 0, -a], () => m.box(0.0026, 0.0012, 0.032, 0));
    }
    m.lathe([[0.006, MUZZLE + 0.0005, 0], [0.0054, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 14);
    // The front post on a band: a tall fin with a lit tip.
    m.use(F.steelDark);
    m.at([0, 0, POST], null, () => {
      m.lathe([[0.0108, 0.01, 0], [0.0136, 0.01], [0.0136, -0.01], [0.0108, -0.01, 0]], 18);
      m.side(poly([[0.009, 0.008], [0.004, IRONS - BORE - 0.006, 0.002], [-0.004, IRONS - BORE - 0.006, 0.002], [-0.009, 0.008]], 0.0012), 0.007, { bevel: 0.0008 });
      m.use(F.black);
      m.at([0, IRONS - BORE - 0.003, 0], null, () => m.box(0.0024, 0.006, 0.005, 0.0004));
      m.glow('sight', () => m.at([0, IRONS - BORE - 0.0015, 0.0026], null, () => m.box(0.0014, 0.0024, 0.0004, 0)));
    });
  });
  // The gas block and the tube back under the barrel into the handguard.
  m.use(F.barrelBlack);
  m.at([0, 0, GAS], null, () => m.front(poly([[-0.0128, BORE - 0.032], [0.0128, BORE - 0.032], [0.0138, BORE + 0.004], [0.0084, BORE + 0.0128], [-0.0084, BORE + 0.0128], [-0.0138, BORE + 0.004]], 0.002), 0.024, { bevel: 0.0016 }));
  m.use(F.steelDark);
  m.at([0, BORE - 0.022, (GAS + GUARD_REAR) / 2], null, () => m.cyl(0.0058, GUARD_REAR - GAS, 14));
  m.mirror(() => m.at([0.0138, BORE - 0.012, GAS], [0, Math.PI / 2, 0], () => m.cyl(0.0026, 0.002, 10)));
}

/**
 * The heat shield: a pale ceramic hood over the barrel from the trunnion to the gas block, faceted, with five raked vents a side,
 * each with an amber line along the bottom of its slot. Under it the black polymer handguard the off hand holds, ribbed, with a
 * cyan line down its left flank.
 */
function shroud(m: Mesher): void {
  const R = GUARD_REAR;
  const N = SHIELD_FRONT;
  m.use(CERAMIC);
  // Section (x, y): a low peaked hood standing on two side skirts, its own thickness, hollow so the barrel shows down the vents.
  const hood = poly([[-0.019, BORE - 0.002], [-0.019, BORE + 0.012], [-0.009, BORE + 0.022], [0.009, BORE + 0.022], [0.019, BORE + 0.012], [0.019, BORE - 0.002],
    [0.0165, BORE - 0.002], [0.0165, BORE + 0.011], [0.0078, BORE + 0.0192], [-0.0078, BORE + 0.0192], [-0.0165, BORE + 0.011], [-0.0165, BORE - 0.002]], 0.0012);
  m.at([0, 0, (R + N) / 2], null, () => m.front(hood, R - N, { bevel: 0.0012 }));
  // The vents, cut as black slots raked forward down each flank, a lit line in the bottom of each.
  m.mirror(() => {
    for (let i = 0; i < 5; i++) {
      const z = R - 0.03 - i * 0.042;
      m.at([0.0168, BORE + 0.009, z], [0.45, 0, 0], () => {
        m.use(F.black);
        m.box(0.0046, 0.006, 0.026, 0.0008);
        m.glow('vent', () => m.at([0.0018, -0.0022, 0], null, () => m.box(0.0012, 0.0008, 0.021, 0)));
      });
    }
  });
  m.use(F.steelDark);
  // Its two clamp bands and the end caps, bolted.
  for (const z of [R - 0.004, N + 0.004]) m.at([0, 0, z], null, () => m.front(poly([[-0.0205, BORE - 0.004], [0.0205, BORE - 0.004], [0.0205, BORE + 0.013], [0.0098, BORE + 0.0238], [-0.0098, BORE + 0.0238], [-0.0205, BORE + 0.013]], 0.0016), 0.008, { bevel: 0.0012 }));
  m.mirror(() => { hexX(m, 0.0205, BORE + 0.004, R - 0.004, 1, 0.0024); hexX(m, 0.0205, BORE + 0.004, N + 0.004, 1, 0.0024); });

  // The handguard: a U of polymer round the barrel's underside, its belly ribbed where the fingers go.
  m.use(F.polymer);
  const guard = poly([[-0.022, BORE - 0.002], [-0.022, 0.012, 0.006], [-0.012, -0.002, 0.008], [0.012, -0.002, 0.008], [0.022, 0.012, 0.006], [0.022, BORE - 0.002],
    [0.0186, BORE - 0.002], [0.0186, 0.013], [0.0105, 0.0016], [-0.0105, 0.0016], [-0.0186, 0.013], [-0.0186, BORE - 0.002]], 0.0014);
  m.at([0, 0, (GUARD_REAR + GUARD_FRONT) / 2], null, () => m.front(guard, GUARD_REAR - GUARD_FRONT, { bevel: 0.0016 }));
  m.use(F.polymerGrey);
  for (let i = 0; i < 7; i++) m.at([0, -0.0024, -0.235 - i * 0.017], null, () => m.box(0.018, 0.0016, 0.006, 0.0005));
  const line = (h: number): P2[] => [[GUARD_REAR - 0.012, 0.03 + h], [GUARD_FRONT + 0.012, 0.03 + h], [GUARD_FRONT + 0.012, 0.03 - h], [GUARD_REAR - 0.012, 0.03 - h]];
  m.use(F.black);
  m.at([-0.0222, 0, 0], null, () => m.side(poly(line(0.0016), 0.0005), 0.0008, { bevel: 0.0002 }));
  m.glow('line', () => m.at([-0.0227, 0, 0], null, () => m.side(poly(line(0.0006), 0.0002), 0.0006, { bevel: 0 })));
}

/** The carry handle folded flat to the left of the barrel's root, and the bipod folded forward under the barrel. */
function handleAndBipod(m: Mesher): void {
  m.use(F.steelDark);
  m.at([0, BORE, -0.2], null, () => m.pipe(0.0158, 0.0128, 0.012, 20));
  m.tube([[-0.014, BORE + 0.006, -0.198], [-0.034, BORE + 0.014, -0.2], [-0.037, BORE + 0.016, -0.262], [-0.02, BORE + 0.012, -0.268]], 0.004, { seg: 8, samples: 14, tension: 0.4 });
  m.use(F.polymerStipple);
  m.tube([[-0.0372, BORE + 0.0162, -0.212], [-0.0378, BORE + 0.0164, -0.252]], 0.0068, { seg: 10, samples: 3 });

  // Bipod: a clamp on the gas block, two legs folded forward along the barrel's belly, each a tube over a leg with a spade foot.
  m.use(F.anodized);
  m.at([0, BORE - 0.036, GAS], null, () => m.box(0.03, 0.01, 0.022, 0.0016, 0.003));
  m.mirror(() => {
    m.at([0.012, BORE - 0.038, GAS], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); m.cyl(0.0042, 0.008, 12); });
    m.at([0.0105, BORE - 0.038, GAS - 0.06], [0, -0.035, 0], () => {
      m.use(F.anodized);
      m.cyl(0.0045, 0.1, 12);
      m.use(F.steel);
      m.at([0, 0, -0.07], null, () => m.cyl(0.0032, 0.05, 10));
      m.use(F.steelDark);
      m.at([0, 0, 0.03], null, () => knurl(m, 0.0052, 0.014, F.steelDark, 12, 0.0004));
      m.use(F.rubber);
      m.at([0, -0.001, -0.098], null, () => m.box(0.008, 0.006, 0.012, 0.0012, 0.002));
    });
  });
}

/**
 * The shop's heavy barrel (`flailHeavy`): replaces the whole fore-end with a chunky futuristic M60/MG42-inspired square slotted
 * shroud, a heavy fluted radiator barrel visible right through the cut-out vents, an M60 ribbed lower fore-end handguard, heavy
 * folded stamped bipod legs, a canted quick-change carry handle, a hooded front sight, and an aggressive slotted muzzle booster.
 */
function heavyFront(m: Mesher): void {
  m.part('frontHeavy', [0, 0, 0], () => {
    const R = SHROUD_H_REAR; // -0.198
    const N = SHROUD_H_FRONT; // -0.562
    const shroudLen = R - N; // 0.364

    // --- 1. Heavy trunnion collar & MG42-style quick-change barrel latch on the right ---
    const outerCollar = poly([
      [-0.025, 0.012], [0.025, 0.012], [0.034, 0.022], [0.034, 0.066],
      [0.025, 0.077], [-0.025, 0.077], [-0.034, 0.066], [-0.034, 0.022],
    ], 0.002);
    const innerCage = poly([
      [-0.021, 0.02], [0.021, 0.02], [0.026, 0.027], [0.026, 0.061],
      [0.021, 0.068], [-0.021, 0.068], [-0.026, 0.061], [-0.026, 0.027],
    ], 0.002);
    m.use(F.steelDark);
    m.at([0, 0, R - 0.002], null, () => m.front(outerCollar, 0.036, { bevel: 0.0018, holes: [innerCage] }));
    // Right-side quick-change barrel lock housing and knurled swing release lever.
    m.at([0.035, 0, 0], null, () => m.side(poly([
      [R - 0.006, 0.028], [R - 0.044, 0.028], [R - 0.05, 0.044], [R - 0.042, 0.056], [R - 0.006, 0.056],
    ], 0.002), 0.007, { bevel: 0.0012 }));
    m.at([0.04, 0.042, R - 0.022], [0, Math.PI / 2, 0], () => knurl(m, 0.0065, 0.008, F.steel, 14, 0.0005));
    m.use(F.steel);
    m.at([0.04, 0, 0], null, () => m.side(poly([
      [R - 0.018, 0.047], [R - 0.018, 0.037], [R - 0.058, 0.033], [R - 0.062, 0.042],
    ], 0.0015), 0.004, { bevel: 0.0009 }));

    // --- 2. Chunky squared MG42/M60 slotted shroud with real through-cut vents ---
    const sideWall = poly([
      [R - 0.016, 0.014], [R - 0.016, 0.073], [N + 0.014, 0.073, 0.003],
      [N, 0.062, 0.002], [N, 0.024, 0.002], [N + 0.012, 0.014, 0.003],
    ], 0.0018);
    // Six big MG42 stadium windows centred on the bore so the fluted barrel & cooling fins show straight through.
    const mainVents = slotRow(-0.258, BORE, -0.508, BORE, 6, 0.022, 0.017, 0);
    // Five upper shoulder raked exhaust cuts above the main vents.
    const upperVents = [0, 1, 2, 3, 4].map(i => {
      const z = -0.252 - i * 0.054;
      return poly([[z, 0.0585], [z - 0.028, 0.0585], [z - 0.034, 0.0675], [z - 0.006, 0.0675]], 0.0018);
    });
    m.use(PLATE);
    m.mirror(() => m.at([0.0295, 0, 0], null, () => m.side(sideWall, 0.0044, { bevel: 0.0009, holes: [...mainVents, ...upperVents] })));

    // Contrasting pale ceramic lower armour cheek strips bolted along both sides of the squared shroud.
    const cheekStrip = poly([
      [R - 0.03, 0.016], [R - 0.03, 0.032], [N + 0.022, 0.032, 0.002],
      [N + 0.014, 0.022, 0.002], [N + 0.02, 0.016, 0.002],
    ], 0.0015);
    const cheekCuts = slotRow(-0.285, 0.024, -0.495, 0.024, 4, 0.026, 0.0065, 0);
    m.use(CERAMIC);
    m.mirror(() => m.at([0.0324, 0, 0], null, () => m.side(cheekStrip, 0.0028, { bevel: 0.0007, holes: cheekCuts })));

    // Crisp inset cyan accent line along the left flank of the heavy shroud.
    const glowLine = (h: number): P2[] => [
      [R - 0.036, 0.0335 + h], [N + 0.028, 0.0335 + h], [N + 0.028, 0.0335 - h], [R - 0.036, 0.0335 - h],
    ];
    m.use(F.black);
    m.at([-0.032, 0, 0], null, () => m.side(poly(glowLine(0.0016), 0.0004), 0.0008, { bevel: 0.0002 }));
    m.glow('line', () => m.at([-0.0325, 0, 0], null, () => m.side(poly(glowLine(0.0006), 0.0002), 0.0006, { bevel: 0 })));

    // Slotted bevelled top heat-shield deck with twin-row real dorsal cooling vents + forward Picatinny rail.
    m.use(F.anodizedGrey);
    const topDeck = poly([
      [-0.0265, R - 0.02], [0.0265, R - 0.02], [0.0265, N + 0.014, 0.003],
      [0.021, N + 0.006, 0.002], [-0.021, N + 0.006, 0.002], [-0.0265, N + 0.014, 0.003],
    ], 0.002);
    const topVents = [
      ...slotRow(-0.0125, -0.258, -0.0125, -0.508, 6, 0.018, 0.008, Math.PI / 2),
      ...slotRow(0.0125, -0.258, 0.0125, -0.508, 6, 0.018, 0.008, Math.PI / 2),
    ];
    m.at([0, 0.0736, 0], null, () => m.top(topDeck, 0.0044, { bevel: 0.0009, holes: topVents }));
    // Short dorsal tactical rail on the forward section, well below the iron sight line (0.112).
    m.at([0, 0.0756, 0], null, () => rail(m, -0.405, -0.535, 0.02, F.anodized));

    // Three heavy machined structural rib collars wrapping the shroud, bolted through with hex bolts.
    m.use(F.steelDark);
    for (const z of [-0.232, -0.386, N + 0.008]) {
      m.at([0, 0, z], null, () => m.front(outerCollar, 0.012, { bevel: 0.0014, holes: [innerCage] }));
      m.mirror(() => {
        hexX(m, 0.0342, 0.056, z, 1, 0.0028);
        hexX(m, 0.0342, 0.026, z, 1, 0.0028);
      });
    }
    // Forward armoured muzzle bulkhead capping the shroud around the protruding heavy barrel and gas regulator.
    const frontCap = poly([
      [-0.024, 0.014], [0.024, 0.014], [0.031, 0.023], [0.031, 0.064],
      [0.023, 0.073], [-0.023, 0.073], [-0.031, 0.064], [-0.031, 0.023],
    ], 0.002);
    m.use(F.steelDark);
    m.at([0, 0, N + 0.003], null, () => m.front(frontCap, 0.008, {
      bevel: 0.0012,
      holes: [circle(0, BORE, 0.0175, 18)],
    }));

    // Internal amber heat-indicator radiator rails tucked deep inside the shroud walls (brighten as barrel heats).
    m.glow('vent', () => m.mirror(() => {
      m.at([0.0258, 0.058, (R + N) / 2], null, () => m.side(rect(-shroudLen * 0.4, -0.0014, shroudLen * 0.4, 0.0014, 0.0004), 0.0012, { bevel: 0 }));
    }));

    // --- 3. M60-style sculpted ribbed lower polymer handguard cradle (belly at y = -0.002 for gripL) ---
    m.use(F.polymer);
    const cradle = poly([
      [-0.027, 0.018], [-0.027, 0.008, 0.004], [-0.015, -0.002, 0.006], [0.015, -0.002, 0.006],
      [0.027, 0.008, 0.004], [0.027, 0.018], [0.0225, 0.018], [0.0225, 0.01],
      [0.0125, 0.0025], [-0.0125, 0.0025], [-0.0225, 0.01], [-0.0225, 0.018],
    ], 0.0014);
    m.at([0, 0, -0.296], null, () => m.front(cradle, 0.194, { bevel: 0.0016 }));
    // Stippled side grip swells and transverse belly cooling ribs.
    m.use(F.polymerStipple);
    m.mirror(() => m.at([0.0276, 0, 0], null, () => m.side(poly([
      [-0.208, 0.015], [-0.382, 0.015], [-0.376, 0.004, 0.003], [-0.214, 0.004, 0.003],
    ], 0.002), 0.0024, { bevel: 0.0007 })));
    m.use(F.polymerGrey);
    const ribProf = poly([[-0.014, -0.0032], [0.014, -0.0032], [0.017, 0.0005], [-0.017, 0.0005]], 0.0008);
    for (let i = 0; i < 8; i++) m.at([0, 0, -0.22 - i * 0.021], null, () => m.front(ribProf, 0.007, { bevel: 0.0007 }));
    // Angled forward hand-stop / heat deflector lip at the front of the polymer handguard.
    m.at([0, 0, 0], null, () => m.side(poly([[-0.384, 0.004], [-0.398, 0.004], [-0.394, -0.012, 0.003], [-0.38, -0.003, 0.003]], 0.0015), 0.026, { bevel: 0.0012 }));

    // --- 4. Massive heavy fluted barrel + cooling radiator discs + M60 under-barrel gas cylinder ---
    m.at([0, BORE, 0], null, () => {
      m.use(F.barrel);
      m.lathe([
        [0.0168, R + 0.004, 0], [0.0168, R - 0.024], [0.0152, R - 0.032],
        [0.0152, N - 0.006], [0.0142, N - 0.014], [0.0142, -0.632, 0],
      ], 24);
      // Eight deep machined longitudinal cooling flutes spanning from inside the shroud out past the front sight.
      m.use(F.barrelBlack);
      const fluteLen = (-0.232) - (-0.622);
      const fluteMid = (-0.232 + -0.622) / 2;
      const fluteProf = poly([[-0.0016, -0.0018], [0.0016, -0.0018], [0.0022, 0.0018], [-0.0022, 0.0018]], 0.0004);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        m.at([Math.cos(a) * 0.0148, Math.sin(a) * 0.0148, fluteMid], [0, 0, a], () => m.front(fluteProf, fluteLen, { bevel: 0.0005 }));
      }
      // Six machined brushed-steel radiator fin collars visible right through the shroud's six MG42 windows.
      m.use(F.steel);
      for (let i = 0; i < 6; i++) {
        const z = -0.258 - i * 0.05;
        m.lathe([[0.0152, z + 0.005, 0], [0.0196, z + 0.004], [0.0196, z - 0.004], [0.0152, z - 0.005, 0]], 22);
      }
    });
    // M60 heavy under-barrel gas cylinder, forward gas block, and protruding knurled gas regulator cap.
    m.use(F.steelDark);
    m.at([0, BORE - 0.026, -0.38], null, () => m.cyl(0.0082, 0.355, 16));
    m.at([0, 0, N + 0.012], null, () => m.front(poly([
      [-0.014, 0.004], [0.014, 0.004], [0.016, 0.024], [0.01, 0.036], [-0.01, 0.036], [-0.016, 0.024],
    ], 0.002), 0.024, { bevel: 0.0014 }));
    m.at([0, BORE - 0.026, N - 0.008], null, () => knurl(m, 0.0092, 0.016, F.steel, 16, 0.0006));
    m.use(F.steelDark);
    m.at([0, BORE - 0.026, N - 0.019], null, () => m.cyl(0.0072, 0.006, 6));

    // --- 5. Heavy folded stamped-steel MG42/M60 bipod (folds cleanly back along shroud lower flanks, clear of gripL) ---
    m.use(F.steelDark);
    m.at([0, 0, N + 0.016], null, () => m.front(poly([
      [-0.028, 0.002], [0.028, 0.002], [0.034, 0.014], [-0.034, 0.014],
    ], 0.002), 0.022, { bevel: 0.0014 }));
    m.use(F.steel);
    m.at([0, 0.007, N + 0.016], [0, Math.PI / 2, 0], () => m.cyl(0.005, 0.076, 12));
    m.mirror(() => {
      // Stamped chamfered steel outer bipod strut with lightening holes, folded backward from -0.544 to -0.398.
      m.use(F.anodized);
      const legOuter = poly([
        [N + 0.018, 0.014], [N + 0.018, 0.0], [-0.415, -0.002, 0.002], [-0.415, 0.012, 0.002],
      ], 0.0018);
      const legHoles = [-0.51, -0.478, -0.446].map(z => circle(z, 0.006, 0.0032, 10));
      m.at([0.0365, 0, 0], null, () => m.side(legOuter, 0.006, { bevel: 0.001, holes: legHoles }));
      // Telescoping brushed-steel inner rod + knurled tension lock collar.
      m.use(F.steel);
      m.at([0.0365, 0.0055, -0.402], null, () => m.cyl(0.0038, 0.038, 12));
      m.at([0.0365, 0.0055, -0.418], null, () => knurl(m, 0.0056, 0.012, F.steelDark, 14, 0.0005));
      // Aggressive wide serrated stamped spade foot resting neatly at z = -0.382 (well ahead of gripL at -0.30).
      m.use(F.steelDark);
      m.at([0.038, 0, 0], null, () => m.side(poly([
        [-0.392, 0.014], [-0.376, 0.017, 0.001], [-0.374, 0.009, 0.001], [-0.38, 0.005, 0.001],
        [-0.374, 0.001, 0.001], [-0.376, -0.007, 0.001], [-0.392, -0.004],
      ], 0.001), 0.01, { bevel: 0.0009 }));
      m.use(F.rubber);
      m.at([0.0435, 0, 0], null, () => m.side(rect(-0.39, -0.003, -0.378, 0.013, 0.0015), 0.0024, { bevel: 0.0006 }));
    });

    // --- 6. Heavy canted quick-change carry handle (upper-left, iconic in FP & studio, clear of ADS sight line) ---
    m.use(F.steelDark);
    m.at([-0.033, 0.06, -0.232], [0, Math.PI / 2, 0], () => m.cyl(0.0075, 0.008, 14));
    m.tube([
      [-0.032, 0.06, -0.232], [-0.056, 0.074, -0.236], [-0.058, 0.076, -0.334], [-0.034, 0.064, -0.336],
    ], 0.0046, { seg: 10, samples: 18, tension: 0.35 });
    // Chunky finger-grooved ergonomic polymer carry grip with machined anodized end caps and steel lock nut.
    m.at([-0.0575, 0.0755, -0.285], null, () => {
      m.use(F.polymerStipple);
      m.lathe([
        [0.005, 0.042, 0], [0.0098, 0.04], [0.0098, 0.026], [0.0084, 0.022], [0.0098, 0.018],
        [0.0098, 0.004], [0.0084, 0], [0.0098, -0.004], [0.0098, -0.018], [0.0084, -0.022],
        [0.0098, -0.026], [0.0098, -0.04], [0.005, -0.042, 0],
      ], 18);
      m.use(F.anodizedGrey);
      for (const z of [0.042, -0.042]) m.at([0, 0, z], null, () => m.cyl(0.0112, 0.005, 16));
      m.use(F.steel);
      m.at([0, 0, -0.047], null, () => m.cyl(0.0068, 0.005, 6));
    });

    // --- 7. Heavy hooded MG42/M60 front sight tower at exact [0, IRONS, POST] so irons ADS stays dead-level ---
    m.at([0, BORE, POST], null, () => {
      m.use(F.steelDark);
      m.lathe([[0.0144, 0.012, 0], [0.0176, 0.011], [0.0176, -0.011], [0.0144, -0.012, 0]], 20);
      // Tapered A-frame sight tower base.
      m.side(poly([[0.011, 0.013], [0.006, IRONS - BORE - 0.008, 0.002], [-0.006, IRONS - BORE - 0.008, 0.002], [-0.011, 0.013]], 0.0014), 0.011, { bevel: 0.001 });
      // Protective circular/horseshoe armoured sight hood.
      const hoodOut = poly([
        [-0.0115, IRONS - BORE - 0.012], [0.0115, IRONS - BORE - 0.012],
        [0.013, IRONS - BORE + 0.002, 0.005], [0.007, IRONS - BORE + 0.011, 0.004],
        [-0.007, IRONS - BORE + 0.011, 0.004], [-0.013, IRONS - BORE + 0.002, 0.005],
      ], 0.0015);
      const hoodIn = poly([
        [-0.0075, IRONS - BORE - 0.008], [0.0075, IRONS - BORE - 0.008],
        [0.0088, IRONS - BORE + 0.001, 0.004], [0.0045, IRONS - BORE + 0.007, 0.003],
        [-0.0045, IRONS - BORE + 0.007, 0.003], [-0.0088, IRONS - BORE + 0.001, 0.004],
      ], 0.0012);
      m.at([0, 0, 0], null, () => m.front(hoodOut, 0.012, { bevel: 0.0009, holes: [hoodIn] }));
      // Sight post & lit green tritium tip aligned to IRONS.
      m.use(F.black);
      m.at([0, IRONS - BORE - 0.004, 0], null, () => m.front(rect(-0.0012, -0.0035, 0.0012, 0.0035, 0.0003), 0.004, { bevel: 0.0003 }));
      m.glow('sight', () => m.at([0, IRONS - BORE - 0.0015, 0.0024], null, () => m.front(rect(-0.0007, -0.0013, 0.0007, 0.0013, 0.0002), 0.0005, { bevel: 0 })));
    });

    // --- 8. Aggressive big slotted MG42 muzzle booster & multi-chamber flash hider ---
    m.at([0, BORE, 0], null, () => {
      // Stage 1: heavy hex barrel collar & stepped conical MG42 recoil-booster funnel (-0.620 to -0.650).
      m.use(F.steel);
      m.lathe([[0.0142, -0.618, 0], [0.0185, -0.619], [0.0185, -0.628], [0.0158, -0.63, 0]], 6);
      m.use(F.steelDark);
      m.lathe([[0.0156, -0.628, 0], [0.0208, -0.638], [0.0208, -0.65], [0.0165, -0.652, 0]], 22);

      // Stage 2: massive squared-octagonal slotted compensator shroud (-0.650 to -0.704) with real open side blast chambers.
      const brakeOct = poly([
        [-0.016, -0.017], [0.016, -0.017], [0.0215, -0.011], [0.0215, 0.011],
        [0.016, 0.017], [-0.016, 0.017], [-0.0215, 0.011], [-0.0215, -0.011],
      ], 0.0016);
      const brakeBore = circle(0, 0, 0.0076, 18);
      m.use(F.barrelBlack);
      m.at([0, 0, -0.654], null, () => m.front(brakeOct, 0.009, { bevel: 0.0011, holes: [brakeBore] }));
      m.at([0, 0, -0.677], null, () => m.front(brakeOct, 0.007, { bevel: 0.0009, holes: [brakeBore] }));
      m.at([0, 0, -0.699], null, () => m.front(brakeOct, 0.009, { bevel: 0.0011, holes: [brakeBore] }));
      // Top and bottom slotted armoured decks spanning the open side chambers.
      m.use(PLATE);
      const brakeDeck = poly([[-0.0165, -0.65], [0.0165, -0.65], [0.0165, -0.703], [-0.0165, -0.703]], 0.0018);
      m.at([0, 0.0145, 0], null, () => m.top(brakeDeck, 0.0052, {
        bevel: 0.0009,
        holes: slotRow(0, -0.665, 0, -0.688, 2, 0.016, 0.0065, 0),
      }));
      m.at([0, -0.0145, 0], null, () => m.top(brakeDeck, 0.0052, { bevel: 0.0009 }));
      // Inner ported core sleeve visible through the open side blast windows.
      m.use(F.steelDark);
      m.at([0, 0, -0.676], null, () => m.pipe(0.0102, 0.0078, 0.048, 18));

      // Stage 3: four aggressive serrated stand-off muzzle prongs (-0.702 to MUZZLE_HEAVY = -0.718) + deep dark bore.
      m.use(F.steelDark);
      const prong = poly([[-0.0042, -0.004], [0.0042, -0.004], [0.0026, 0.0045], [-0.0026, 0.0045]], 0.0007);
      for (const [px, py] of [[-0.013, 0.0115], [0.013, 0.0115], [-0.013, -0.0115], [0.013, -0.0115]] as const) {
        m.at([px, py, MUZZLE_HEAVY + 0.008], null, () => m.front(prong, 0.016, { bevel: 0.0008 }));
      }
      m.use(F.black);
      m.lathe([[0.0078, -0.702, 0], [0.0064, -0.662, 0], [0, -0.661, 0]], 16);
    });
  });
}

function cover(m: Mesher): { dot: ModLook; scope: ModLook } {
  // Hinged at its front, its rear latched down: the hand lifts it there to lay a belt. Everything on it moves with it.
  let dot: ModLook | null = null;
  let scope: ModLook | null = null;
  m.part('cover', [0, REC_TOP, COVER_FRONT], () => {
    const L = COVER_LEN;
    m.use(F.anodized);
    m.side(poly([[0, 0], [0, 0.009, 0.003], [0.012, 0.014, 0.002], [L - 0.018, 0.014, 0.003], [L, 0.006, 0.002], [L, 0]], 0.0015), HALF * 2 + 0.004, { bevel: 0.0016 });
    // The rail, most of the cover's length, with its cross slots.
    m.at([0, 0.017, L / 2 - 0.006], null, () => m.top(rect(-0.0105, -L / 2 + 0.016, 0.0105, L / 2 - 0.02, 0.0015), 0.006, { bevel: 0.001 }));
    m.use(F.black);
    for (let z = 0.016; z < L - 0.03; z += 0.01) m.at([0, RAIL - REC_TOP + 0.0001, z], null, () => m.box(0.021, 0.0012, 0.0042, 0));
    // A facet down each side with the line in it, a cut of the receiver's.
    m.use(PLATE);
    m.mirror(() => m.at([HALF + 0.0024, 0, 0], null, () => m.side(poly([[0.03, 0.002], [0.03, 0.01], [L - 0.03, 0.01], [L - 0.026, 0.002]], 0.001), 0.0016, { bevel: 0.0005 })));
    m.glow('line', () => m.at([-(HALF + 0.0033), 0.006, (L - 0.004) / 2 + 0.014], null, () => m.box(0.0005, 0.0012, L - 0.07, 0)));
    // The hinge pin across its front.
    m.use(F.steelDark);
    m.at([0, 0.003, 0.002], [0, Math.PI / 2, 0], () => m.cyl(0.0052, HALF * 2 + 0.01, 14));
    // Under it, seen with it up: the feed pawls that walk the belt in.
    m.at([-0.004, -0.004, BELT_Z - COVER_FRONT], null, () => {
      m.box(0.036, 0.006, 0.05, 0.0012);
      m.mirror(() => m.at([0.012, -0.005, 0], null, () => m.box(0.004, 0.006, 0.014, 0.001)));
    });
    // The latch at the back, the tab the thumb lifts.
    m.use(F.steel);
    m.at([0, 0.008, L - 0.003], null, () => m.box(0.026, 0.007, 0.008, 0.0014, 0.002));
    m.at([0, 0.0115, L + 0.001], null, () => serrations(m, 3, 0.002, 0.0004, 0.004, 0.02, F.steelDark));
    // The rear aperture, a flip-up at the back of the rail, seen only with no optic.
    m.part('irons', [0, RAIL - REC_TOP, L - 0.03], () => {
      m.use(F.steelDark);
      m.box(0.022, 0.004, 0.012, 0.001);
      m.at([0, IRONS - RAIL, 0], null, () => {
        m.front(poly([[-0.0092, -0.016], [0.0092, -0.016], [0.0092, 0.002, 0.003], [0.004, 0.0072, 0.002], [-0.004, 0.0072, 0.002], [-0.0092, 0.002, 0.003]], 0.001), 0.004, {
          bevel: 0.0007, holes: [poly([[-0.0022, -0.0022], [0.0022, -0.0022], [0.0022, 0.0022], [-0.0022, 0.0022]], 0.0016)],
        });
      });
    });
    // Optics on the rail, over the feed: they ride up with the cover.
    const at = [0, RAIL - REC_TOP, -0.03 - COVER_FRONT] as const;
    const shift = (l: ModLook): ModLook => ({ ...l, sight: [l.sight![0], l.sight![1] + REC_TOP, l.sight![2] + COVER_FRONT] });
    dot = shift(redDot(m, at, 'reddot'));
    scope = shift(acog(m, at, 'acog'));
  });
  return { dot: dot!, scope: scope! };
}

/** The stock 100: a soft cloth pouch on a polymer frame. Part space: the middle of its top. */
function pouch(m: Mesher): void {
  const W = 0.056;
  const H = 0.104;
  const D = 0.1;
  m.use(F.polymer);
  // The frame it hangs from: a lipped collar on the mount, the latch on its back.
  m.at([0, -0.006, 0], null, () => m.box(W + 0.004, 0.012, D + 0.004, 0.0018, 0.004));
  m.use(CLOTH);
  // The pouch itself, bellied: a soft box, its bottom a little wider than its mouth.
  m.at([0, -0.012 - H / 2, 0], null, () => m.side(poly([[D / 2, 0.048], [D / 2 + 0.003, -0.03, 0.02], [D / 2 - 0.004, -H / 2, 0.016], [-D / 2 + 0.004, -H / 2, 0.016], [-D / 2 - 0.003, -0.03, 0.02], [-D / 2, 0.048]], 0.006), W, { bevel: 0.007, smooth: 60 }));
  // Seams down its edges, two webbing straps round it, and the pull tab on the outer face.
  m.use(F.black);
  m.mirror(() => m.at([W / 2 - 0.002, -0.012 - H / 2, 0], null, () => m.side(poly([[D / 2 - 0.004, 0.044], [D / 2 - 0.0016, -0.03], [D / 2 - 0.006, -H / 2 + 0.006], [D / 2 - 0.008, -H / 2 + 0.006], [D / 2 - 0.0036, -0.03], [D / 2 - 0.0056, 0.044]], 0.0005), 0.0012, { bevel: 0.0002 })));
  m.use(STRAP);
  for (const y of [-0.04, -0.08]) m.at([0, y, 0], null, () => m.box(W + 0.006, 0.012, D + 0.006, 0.002, 0.008));
  m.use(F.steelDark);
  m.at([-(W / 2 + 0.004), -0.04, 0.026], null, () => m.box(0.003, 0.014, 0.012, 0.0008, 0.002));
  m.use(STRAP);
  m.at([-(W / 2 + 0.003), -0.012, -0.03], null, () => m.box(0.003, 0.03, 0.016, 0.0008, 0.003));
  m.at([-(W / 2 + 0.0035), -0.0275, -0.03], null, () => m.box(0.0036, 0.008, 0.022, 0.0008, 0.003));
  // The round count: a lit line in a black channel down the outer face, as long as the box is full.
  countStrip(m, 'countStd', [-(W / 2 + 0.0016), -0.096, 0.012], 0.044);
}

/** The shop's 200: a hard polymer box, deeper and longer forward, ribbed, a window on the belt and a latch on its lid. */
function hardBox(m: Mesher): void {
  const W = 0.07;
  const H = 0.156;
  const D = 0.136;
  const zc = -0.016;
  m.at([0, -H / 2, zc], null, () => {
    m.use(F.olive);
    m.box(W, H, D, 0.003, 0.008);
    m.use(F.oliveDark);
    // Ribs across both faces and a lid band round the top.
    m.mirror(() => { for (const z of [0.008, 0.048]) m.at([W / 2, -0.006, z], null, () => m.box(0.004, H - 0.03, 0.012, 0.001, 0.002)); });
    m.at([0, H / 2 - 0.008, 0], null, () => m.box(W + 0.003, 0.012, D + 0.003, 0.0016, 0.006));
    m.at([0, -H / 2 + 0.004, 0], null, () => m.box(W + 0.002, 0.008, D + 0.002, 0.0016, 0.006));
    // The window onto the belt: a slot down the outer face between two ribs, the folded rounds in it, noses forward.
    m.use(F.black);
    m.at([-(W / 2 + 0.0002), 0.004, -0.033], null, () => m.box(0.002, H - 0.06, 0.058, 0.0006));
    // Standing a hair proud of the black, in a frame under a clear pane: the belt folded inside, seen through it.
    for (let i = 0; i < 8; i++) m.at([-(W / 2 - 0.0032), H / 2 - 0.034 - i * PITCH, -0.006], null, () => linked(m));
    m.use(F.oliveDark);
    m.at([-(W / 2 + 0.0014), 0.004, -0.033], null, () => m.side(rect(-0.032, -(H - 0.06) / 2 - 0.004, 0.032, (H - 0.06) / 2 + 0.004, 0.003), 0.003, {
      bevel: 0.0008, holes: [rect(-0.029, -(H - 0.06) / 2, 0.029, (H - 0.06) / 2, 0.002)],
    }));
    m.glass(() => m.at([-(W / 2 + 0.0026), 0.004, -0.033], null, () => m.box(0.0006, H - 0.062, 0.058, 0)));
    // The lid latch on its front, the hinge on its back.
    m.use(F.steelDark);
    m.at([0, H / 2 - 0.016, -D / 2 - 0.003], null, () => m.box(0.026, 0.016, 0.006, 0.0012, 0.002));
    m.at([0, H / 2 - 0.004, D / 2 + 0.002], [0, Math.PI / 2, 0], () => m.cyl(0.0036, W - 0.01, 12));
    m.at([-(W / 2 + 0.0006), H / 2 - 0.05, 0.034], [0, -Math.PI / 2, 0], () => m.decal('cal556', 0.05, 0.0078, 0xd8d0a0));
  });
  m.use(F.polymer);
  m.at([0, -0.006, 0], null, () => m.box(0.06, 0.012, 0.104, 0.0018, 0.004));
  countStrip(m, 'countExt', [-(W / 2 + 0.003), -0.14, 0.046], 0.11);
}

/** A lit line in a black channel, `len` long upward from `at`, in a part of its own the clip scales by the count left. */
function countStrip(m: Mesher, name: string, at: readonly [number, number, number], len: number): void {
  m.use(F.black);
  m.at([at[0], at[1] + len / 2, at[2]], null, () => m.box(0.0014, len + 0.004, 0.0042, 0.0004));
  m.part(name, [at[0] - 0.0006, at[1], at[2]], () => m.glow('line', () => m.at([0, len / 2, 0], null, () => m.box(0.0008, len, 0.0016, 0))));
}

function feed(m: Mesher): void {
  m.part('box', [-0.006, 0, BELT_Z], () => {
    m.part('boxStd', [0, 0, 0], () => pouch(m));
    m.part('boxExt', [0, 0, 0], () => hardBox(m));
  });
  // The belt: three rounds on the tray, under the cover, and six hanging down the flank into the box's mouth. One part, so it can
  // step a link a shot and be laid on the tray by hand.
  m.part('belt', [-(HALF + 0.005), REC_TOP - 0.004, BELT_Z + 0.027], () => {
    for (let i = 0; i < TRAY_ROUNDS; i++) m.at([0.012 + i * PITCH, 0.008, 0], null, () => linked(m));
    for (let i = 0; i < HANG_ROUNDS; i++) {
      // Out over the lip, then down, bellying a little away from the wall.
      const t = (i + 1) / HANG_ROUNDS;
      m.at([-0.002 - Math.sin(t * Math.PI) * 0.006, 0.002 - (i + 0.5) * PITCH, 0], [0, 0, 0.12 * (1 - t)], () => linked(m));
    }
  });
}

function buildFlail(kit: Kit): { model: Model; mods: ViewDef['mods'] } {
  const m = kit.mesher();
  m.bevel = 0.0014;
  receiver(m);
  lower(m);
  stock(m);
  // Standard fore-end wrapped in `frontStd` so `flailHeavy` swaps the whole front cleanly in both FP and shop studio.
  m.part('frontStd', [0, 0, 0], () => {
    barrel(m);
    shroud(m);
    handleAndBipod(m);
  });
  heavyFront(m);
  const { dot, scope } = cover(m);
  feed(m);

  // The charging handle at the receiver's front left: a folding bar the hand racks back, clear of the belt.
  m.part('charge', [-(HALF + 0.0016), 0.04, -0.168], () => {
    m.use(F.steelDark);
    m.box(0.004, 0.01, 0.026, 0.001);
    m.at([-0.011, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.005, 0.02, 10));
    m.at([-0.026, 0, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0078, 0.018, F.steel, 14, 0.0005));
  });
  m.part('trigger', [0, -0.0115, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0225, 0.0015], [0.0005, -0.0235, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0068, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { line: [0x38d6ff, 5], vent: [0xff7a1e, 4], sight: [0x7dff5a, 6], ...OPTIC_GLOWS } });
  acogShade(model, 'acog');
  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  model.socket('muzzleHeavy', [0, BORE, MUZZLE_HEAVY - 0.004]);
  // Cases go down out of the chute.
  model.socket('eject', [HALF - 0.008, 0.002, -0.028], [0, 0, -Math.PI / 2]);
  model.hand('gripR', [0.018, -0.058, 0.074], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.001, -0.002, -0.3]);
  model.hand('coverHold', [-0.016, 0.018, COVER_LEN - 0.012], [-0.3, 0.4, -0.86], [0.85, 0.3, -0.42], 'cover');
  model.hand('boxHold', [-0.034, -0.05, 0.006], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'box');
  model.grasp('beltHold', [-0.018, -0.024, -0.006], [1, 0, 0], [0, 0.35, -0.94], 'belt');
  model.hand('chargeHold', [-0.03, 0.0, 0.004], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return {
    model,
    mods: {
      flailDot: dot,
      flailAcog: scope,
      flailBox: { part: 'boxExt', hides: 'boxStd' },
      flailHeavy: { part: 'frontHeavy', hides: 'frontStd', muzzle: 'muzzleHeavy' },
      flailStock: { part: 'stockEnh', hides: 'stockStd' },
    },
  };
}

const RACK = 0.036;

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.06, 0.3);
  a.glow('sight', 1);
  a.glow('vent', 0.25 + a.heat * 1.6);
  // The count down the box's face, as long as the box is full.
  const left = Math.max(0.015, fill(a));
  P.countStd!.scale.y = left;
  P.countExt!.scale.y = left;
  // Each round walks the belt a link toward the feed, and shakes the box and the belt against the gun.
  const cycle = 0.07;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const belt = P.belt!;
  belt.position.x -= (1 - c) * PITCH * 0.6;
  belt.position.y += (1 - c) * PITCH * 0.3;
  const jolt = a.sinceFire < 0.12 ? bump(a.sinceFire, 0, 0.12) : 0;
  P.box!.rotation.z += jolt * 0.02;
  P.box!.rotation.x += jolt * 0.01;

  if (a.draw < 1) {
    // Swung up from low, muzzle last, as a gun this weight is.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.08;
    a.gunR.x -= k * 0.46;
    a.gunR.z -= k * 0.26;
  }

  const p = a.reload;
  if (p < 0) return;
  // Foley (weapons/data.ts): cover up 0.07, box off 0.17, box on 0.49, belt on the tray 0.6, cover down 0.69, the handle 0.84.
  const open = outCubic(seg(p, 0.05, 0.13)) * (1 - inQuad(seg(p, 0.64, 0.69)));
  P.cover!.rotation.x -= open * 0.9;
  const coverShut = p >= 0.69 ? thud(seg(p, 0.69, 0.78)) : 0;

  const box = P.box!;
  const out = inQuad(seg(p, 0.16, 0.3));
  const inn = outCubic(seg(p, 0.37, 0.49));
  const away = out * (1 - inn);
  box.position.y -= away * 0.42;
  box.position.x -= away * 0.1;
  box.position.z += away * 0.04;
  box.rotation.z += away * 0.6;
  box.rotation.x -= away * 0.3;
  if (p > 0.29 && p < 0.37) box.visible = false;
  const seat = p >= 0.49 ? thud(seg(p, 0.49, 0.58)) : 0;
  // The old belt is pulled off the tray with its box; the new one comes up out of the box and is laid on the tray by hand.
  if (p > 0.15 && p < 0.5) belt.visible = false;
  const lay = inOut(seg(p, 0.5, 0.6));
  belt.position.x -= (1 - lay) * 0.026;
  belt.position.y -= (1 - lay) * 0.05;
  belt.rotation.z -= (1 - lay) * 0.5;

  const rack = bump(p, 0.79, 0.9);
  P.charge!.position.z += rack * RACK;

  // Rolled right, turned and held low so the top and the left flank face the eye: the cover, the tray and the box are all in view.
  const present = hold(p, 0.0, 0.12, 0.9, 1);
  a.gunR.z -= present * 0.3 + seat * 0.04;
  a.gunR.x += present * 0.04 + coverShut * 0.05 - rack * 0.04;
  a.gunR.y += present * 0.14;
  a.gunP.x -= present * 0.05;
  a.gunP.y -= present * 0.012 + coverShut * 0.01 - seat * 0.008;
  a.gunP.z -= present * 0.02 - rack * 0.02;

  const h = a.left;
  h.fingerRate = 34;
  h.to('coverHold', inOut(seg(p, 0.0, 0.06)));
  h.to('boxHold', inOut(seg(p, 0.1, 0.16)));
  h.to('pouchL', inOut(seg(p, 0.27, 0.34)));
  h.to('boxHold', inOut(seg(p, 0.35, 0.45)));
  h.to('beltHold', inOut(seg(p, 0.48, 0.52)));
  h.to('coverHold', inOut(seg(p, 0.6, 0.65)));
  h.to('chargeHold', inOut(seg(p, 0.73, 0.79)));
  h.to('gripL', inOut(seg(p, 0.91, 1)));
  h.shape(HANDS.open, hold(p, 0.0, 0.05, 0.08, 0.1));
  h.shape(HANDS.cup, hold(p, 0.12, 0.17, 0.46, 0.5));
  h.shape(HANDS.pinch, hold(p, 0.49, 0.52, 0.58, 0.61));
  h.shape(HANDS.open, hold(p, 0.61, 0.64, 0.7, 0.74));
  h.shape(HANDS.pinch, hold(p, 0.76, 0.79, 0.9, 0.93));
}

export function flailDef(kit: Kit): ViewDef {
  const { model, mods } = buildFlail(kit);
  return {
    id: 'flail',
    model,
    pos: [0.15, -0.15, -0.43],
    rot: [0.024, 0.078, 0],
    // ADS with no optic: the post through the cover's aperture, level. An optic on the cover brings its own (`mods`).
    sight: [0, IRONS, POST], rear: [0, IRONS, COVER_FRONT + COVER_LEN - 0.03], relief: 0.88,
    // A heavier, slower spring than the carbines': each round shoves rather than snaps.
    recoil: { back: 0.034, lift: 0.002, pitch: 0.009, yaw: 0.007, roll: 0.01, omega: 40, zeta: 0.55 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.008,
    mods,
    irons: 'irons',
    animate: clip,
  };
}
