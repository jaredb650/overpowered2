/**
 * The Rivet: a faithful Beretta 92FS-silhouette service pistol (zero real or trademarked names/logos).
 * Iconic arched open-top Bruniton slide exposing the glossy cylindrical blued barrel, smooth tapered alloy dust
 * cover, hooked combat trigger guard, curved palm-swell grip with contoured checkered panels and heel lanyard loop,
 * vertical rear slide serrations, ambidextrous slide-mounted wing safety/decocker, external right-side trigger
 * transfer bar, and exposed skeletonized hammer. Origin at the top of the grip.
 *
 * Exports `pistolBackHalf` so the Autoraffica (same pistol family) can share its frame, grip, hammer, and controls.
 * Mods (weapons/mods.ts): extended 22-round magazine (`rivetMag`), weapon light (`rivetLight`), ported match
 * compensator (`rivetComp`), slim threaded suppressor (`rivetCan`), low-profile open reflex sight (`rivetDot`),
 * under-frame laser module (`rivetLam`), and flared competition magwell (`rivetMagwell`).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, type V2 } from '../kit/shapes';
import { knurl, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ModLook, ViewDef } from '../def';
import { HANDS } from '../poses';
import { COMP } from '../../mods';
import { pullTrigger, round } from './common';
import { TORCH, weaponLight } from './light';
import { OPTIC_GLOWS, openReflex } from './optics';
import { animateRiotShield, attachRiotShieldHand, buildRiotShield } from './shield';

const BORE = 0.036;
const FRAME_TOP = 0.02;
const SLIDE_BOT = 0.0195;
const SLIDE_TOP = 0.0485;
const SIGHT_Y = 0.0545;

const MUZZLE = -0.169;
const SLIDE_FRONT = -0.155;
const OPEN_FRONT = -0.133;
const OPEN_REAR = 0.016;
const SLIDE_REAR = 0.088;
const DUST_FRONT = -0.148;
const SLIDE_TRAVEL = 0.038;

const FRAME_W = 0.0226;
const SLIDE_W = 0.0248;
const COMP_END = -0.214;
const CAN_END = -0.32;
const RMR_Z = 0.046;

/** Classic 92FS finishes: satin Bruniton steel slide, deep matte anodized alloy frame, glossy blued barrel, dark parkerized steel controls. */
const SLIDE_METAL: Finish = { color: 0x39414e, rough: 0.3, metal: 0.88, wear: 0.14, kind: Kind.brushed };
const FRAME_ALLOY: Finish = { color: 0x262b34, rough: 0.46, metal: 0.48, wear: 0.14 };
const BARREL_BLUED: Finish = { color: 0x1a2230, rough: 0.16, metal: 0.98, wear: 0.1, heat: 1 };
const CONTROLS_DARK: Finish = { color: 0x454d5a, rough: 0.32, metal: 0.9, wear: 0.12, kind: Kind.brushed };
const CONTROLS_STEEL: Finish = { color: 0x9aa2ad, rough: 0.26, metal: 1, wear: 0.1, kind: Kind.brushed };
const COMP_METAL: Finish = { color: 0x2f3540, rough: 0.31, metal: 0.9, wear: 0.16, kind: Kind.brushed };
const CAN_TUBE: Finish = { color: 0x23272e, rough: 0.4, metal: 0.42, wear: 0.18, kind: Kind.carbon };
const GRIP_RIM: Finish = { color: 0x1e2228, rough: 0.5, metal: 0.04, wear: 0.08 };
const GRIP_CHECK: Finish = { color: 0x2d323b, rough: 0.84, metal: 0.03, wear: 0.06, kind: Kind.stipple };

export interface PistolBackOpts {
  frameFinish?: Finish;
  controlsFinish?: Finish;
  gripRimFinish?: Finish;
  gripCheckFinish?: Finish;
  /** Classic 92FS combat trigger guard (default), or `'none'` if a sibling weapon supplies its own guard. */
  triggerGuard?: 'round' | 'none';
}

/**
 * Shared rear pistol half (Beretta 92 / 93 family): slim satin-black anodized rear receiver with sweeping
 * beavertail tang, curved palm-swell grip with contoured checkered panels, blank oval medallion, heel lanyard loop,
 * left-side slide stop & rotating takedown lever, right-side external trigger transfer bar & disassembly button,
 * exposed skeletonized hammer, and curved steel trigger.
 */
export function pistolBackHalf(m: Mesher, opts: PistolBackOpts = {}): void {
  const frameFin = opts.frameFinish ?? FRAME_ALLOY;
  const ctrlFin = opts.controlsFinish ?? CONTROLS_DARK;
  const rimFin = opts.gripRimFinish ?? GRIP_RIM;
  const checkFin = opts.gripCheckFinish ?? GRIP_CHECK;

  m.use(frameFin);
  // Rear receiver rails and graceful upswept 92FS beavertail tang sheltering the web of the hand.
  m.side(poly([
    [-0.052, -0.008, 0.002], [-0.052, FRAME_TOP, 0.0015], [0.068, FRAME_TOP, 0.002],
    [0.08, 0.0175, 0.004], [0.096, 0.0195, 0.003], [0.0985, 0.0135, 0.003],
    [0.085, 0.0055, 0.007], [0.068, 0.001, 0.006], [0.025, -0.009, 0.003],
  ], 0.0016), FRAME_W, { bevel: 0.0014, smooth: 48 });

  // Recessed hammer slot milled into the rear tang.
  m.use(F.black);
  m.at([0, 0.017, 0.08], null, () => m.box(0.0066, 0.008, 0.022, 0));

  // Authentic curved 92FS grip: deep high undercut under the trigger guard, graceful inward web curve under the
  // beavertail swelling gently across the mid-palm and curving cleanly into the heel.
  const front = curve([
    [0.021, -0.008], [0.022, -0.025], [0.028, -0.052], [0.035, -0.085], [0.043, -0.116],
  ], 5);
  const back = curve([
    [0.092, -0.116], [0.095, -0.084], [0.089, -0.048], [0.077, -0.019], [0.07, 0.002], [0.064, 0.014],
  ], 6);
  const gripOutline: V2[] = [...front, [0.045, -0.121], [0.091, -0.121], ...back];
  m.use(frameFin);
  m.side(gripOutline, 0.025, { bevel: 0.0035, smooth: 50 });

  // Iconic 92FS lanyard loop nub protruding subtly from the rear heel of the mainspring cap.
  m.use(ctrlFin);
  m.at([0, -0.1225, 0.0835], [0.18, 0, 0], () => {
    const loop = poly([[-0.0045, 0.004], [0.0045, 0.004], [0.0045, -0.0045, 0.003], [-0.0045, -0.0045, 0.003]], 0.001);
    m.front(loop, 0.0032, { bevel: 0.0005, holes: [circle(0, -0.0014, 0.0018, 10)] });
  });

  // Fine vertical front-strap & back-strap serration ribs (classic 92FS grip texture).
  m.use(F.steelDark);
  for (let i = 0; i < 6; i++) {
    const x = -0.0062 + i * 0.00248;
    m.at([x, -0.072, 0.031], [-0.24, 0, 0], () => m.box(0.0011, 0.078, 0.0012, 0.0002));
    m.at([x, -0.068, 0.0915], [-0.14, 0, 0], () => m.box(0.0011, 0.072, 0.0012, 0.0002));
  }

  // Authentic curved 92FS polymer grip panels: arched top contour tucking around the mag release & trigger bar,
  // matte diamond-stippled field inside a smooth border, subtle blank oval center medallion (no logos), two slotted screws.
  const panelOuter = curve([
    [0.035, -0.015], [0.049, -0.012], [0.069, -0.01], [0.079, -0.028], [0.086, -0.06],
    [0.088, -0.095], [0.086, -0.112], [0.068, -0.114], [0.048, -0.113], [0.042, -0.085],
    [0.036, -0.052], [0.031, -0.028],
  ], 3);
  const panelField = curve([
    [0.041, -0.024], [0.065, -0.021], [0.074, -0.036], [0.08, -0.062],
    [0.081, -0.096], [0.077, -0.105], [0.053, -0.105], [0.047, -0.082],
    [0.042, -0.054], [0.038, -0.034],
  ], 3);
  m.mirror(() => {
    m.use(rimFin);
    m.at([0.0126, 0, 0], null, () => m.side(panelOuter, 0.0032, { bevel: 0.0011, smooth: 44 }));
    m.use(checkFin);
    m.at([0.0143, 0, 0], null, () => m.side(panelField, 0.0011, { bevel: 0.0004, smooth: 40 }));
    // Smooth blank oval medallion centered in the checkering (classic 92FS panel detail, zero text/trademarks).
    m.use(rimFin);
    m.at([0.0149, -0.062, 0.061], [0.16, 0, 0], () => m.side(poly([
      [-0.0085, 0, 0.006], [0, 0.0115, 0.006], [0.0085, 0, 0.006], [0, -0.0115, 0.006],
    ], 0.005), 0.0007, { bevel: 0.0003, smooth: 44 }));
    // Two authentic slotted dark-steel grip screws per side.
    screwX(m, 0.0151, -0.028, 0.057, 1, 0.0021, ctrlFin);
    screwX(m, 0.0151, -0.101, 0.07, 1, 0.0021, ctrlFin);
  });

  // Signature 92FS mechanical controls in dark parkerized steel:
  m.use(ctrlFin);
  // Left contoured slide stop lever with serrated thumb pad & forward pin boss (animates on empty reload slide release).
  m.part('slideStop', [-FRAME_W / 2 - 0.0012, 0.0115, 0.007], () => {
    m.use(ctrlFin);
    m.side(poly([
      [-0.023, -0.0024], [0.025, -0.0018], [0.028, 0.004, 0.0014], [0.015, 0.0046, 0.0014],
      [-0.006, 0.0026, 0.0012], [-0.021, 0.003, 0.0012],
    ], 0.0006), 0.0023, { bevel: 0.0005 });
  });
  // Left rotating takedown lever (pivot boss + curved thumb wing) & right circular disassembly release button.
  m.at([-FRAME_W / 2 - 0.0012, 0.0095, -0.044], [0, Math.PI / 2, 0], () => m.cyl(0.0044, 0.0024, 14, 0.0005));
  m.at([-FRAME_W / 2 - 0.0016, 0.0095, -0.052], null, () => m.side(poly([
    [-0.0085, -0.0016], [0.0065, -0.0022], [0.0065, 0.0022], [-0.0085, 0.0016],
  ], 0.0006), 0.0022, { bevel: 0.0005 }));
  m.at([FRAME_W / 2 + 0.0009, 0.0095, -0.044], [0, Math.PI / 2, 0], () => m.cyl(0.004, 0.002, 14, 0.0004));
  // Checkered round magazine release button tucked right behind the trigger guard.
  m.at([-FRAME_W / 2 - 0.0007, -0.0195, 0.0255], [0, Math.PI / 2, 0], () => m.cyl(0.0038, 0.0028, 14, 0.0005));
  // Iconic external right-side 92FS trigger transfer bar running above the right grip panel.
  m.at([FRAME_W / 2 + 0.0008, 0.0068, 0.014], null, () => m.side(poly([
    [-0.022, -0.0026], [0.036, -0.0008], [0.038, 0.0026], [0.014, 0.0024], [-0.022, 0.0018],
  ], 0.0006), 0.0016, { bevel: 0.0004 }));
  // Flush hammer pivot pin & trigger pivot pin.
  m.mirror(() => {
    screwX(m, FRAME_W / 2 + 0.0003, 0.008, 0.056, 1, 0.0018, ctrlFin);
    screwX(m, FRAME_W / 2 + 0.0003, -0.003, -0.008, 1, 0.0016, ctrlFin);
  });

  // Authentic Beretta 92FS combat trigger guard: smooth lower sweep curving forward into the iconic concave
  // two-hand finger-rest front bow with crisp horizontal front serrations and deep grip undercut.
  if (opts.triggerGuard !== 'none') {
    m.use(frameFin);
    const guardOuter = poly([
      [-0.042, -0.004], [-0.045, -0.011, 0.004], [-0.0415, -0.022, 0.007], [-0.045, -0.033, 0.005],
      [-0.036, -0.0385, 0.006], [0.013, -0.037, 0.009], [0.026, -0.015, 0.005], [0.026, -0.005],
    ], 0.002);
    const guardHole = poly([
      [-0.036, -0.009], [-0.0385, -0.016, 0.004], [-0.0365, -0.029, 0.005],
      [-0.029, -0.0335, 0.005], [0.009, -0.032, 0.006], [0.021, -0.014, 0.004],
    ], 0.002);
    m.side(guardOuter, 0.0098, { bevel: 0.0011, holes: [guardHole], smooth: 38 });
    // Fine serration ribs along the concave front finger rest of the combat trigger guard.
    m.use(F.steelDark);
    for (let i = 0; i < 4; i++) {
      m.at([0, -0.014 - i * 0.0045, -0.0442], null, () => m.box(0.0082, 0.0012, 0.001, 0.0002));
    }
  }

  // Exposed curved skeletonized 92FS hammer (strikes and cocks in `clip`): genuine circular ring cutout + serrated top spur.
  m.part('hammer', [0, 0.018, 0.082], () => {
    m.use(ctrlFin);
    const body = poly([
      [-0.004, -0.005, 0.002], [0.005, -0.005, 0.002], [0.0135, 0.0035, 0.004],
      [0.0175, 0.0145, 0.005], [0.0115, 0.0225, 0.005], [0.002, 0.0215, 0.004], [-0.005, 0.011, 0.003],
    ], 0.0015);
    m.side(body, 0.0062, { bevel: 0.0009, holes: [circle(0.007, 0.0115, 0.0041, 16)], smooth: 44 });
    m.use(F.steelDark);
    for (let i = 0; i < 4; i++) {
      m.at([0, 0.021 - i * 0.0014, 0.0115 + i * 0.0016], [0.55, 0, 0], () => m.box(0.006, 0.0006, 0.0012, 0.0001));
    }
  });

  // Classic curved 92FS double-action/single-action steel trigger.
  m.part('trigger', [0, -0.006, -0.006], () => {
    m.use(ctrlFin);
    m.side(poly([
      [-0.003, 0.002], [0.0032, 0.002], [0.0008, -0.0105, 0.003],
      [0.0048, -0.022, 0.0018], [0.0014, -0.023, 0.0012], [-0.0038, -0.0105, 0.004],
    ], 0.001), 0.0056, { bevel: 0.0006 });
  });
}

function frontFrame(m: Mesher): void {
  // Classic Beretta 92FS smooth, clean, gently tapered alloy dust cover (no Picatinny rail lugs on the bare 92FS!).
  m.use(FRAME_ALLOY);
  m.side(poly([
    [-0.048, FRAME_TOP, 0.0015], [DUST_FRONT, FRAME_TOP, 0.002], [DUST_FRONT, 0.0105, 0.003],
    [DUST_FRONT + 0.008, 0.002, 0.004], [-0.042, -0.0045, 0.003], [-0.048, -0.008],
  ], 0.0016), FRAME_W, { bevel: 0.0016, smooth: 44 });

  // Subtle horizontal step-seam reveal between dust cover and slide rails.
  m.use(F.black);
  m.mirror(() => m.at([FRAME_W / 2 + 0.0001, 0.0175, -0.098], null, () => m.box(0.0005, 0.0012, 0.088, 0)));
}

function barrel(m: Mesher): void {
  // Iconic exposed glossy cylindrical blued 92FS barrel protruding ~14 mm past the arched slide nose.
  m.at([0, BORE, 0], null, () => {
    m.use(BARREL_BLUED);
    // Chamber block -> smooth stepped cylinder -> gently recessed crown nose.
    m.lathe([
      [0.0085, 0.017, 0], [0.0085, -0.022], [0.0077, -0.027],
      [0.0076, MUZZLE + 0.0025], [0.0072, MUZZLE], [0.0046, MUZZLE, 0],
    ], 26);
    // Crisp recessed target crown ring + deep black rifled bore.
    m.use(CONTROLS_DARK);
    m.lathe([[0.0064, MUZZLE + 0.0004, 0], [0.0064, MUZZLE - 0.0003], [0.0047, MUZZLE - 0.0003], [0.0047, MUZZLE + 0.001, 0]], 20);
    m.use(F.black);
    m.lathe([[0.0047, MUZZLE + 0.0002, 0], [0.0044, MUZZLE + 0.024, 0], [0, MUZZLE + 0.025, 0]], 14);
    // Subtle flat-topped breech chamber hood visible at the rear of the open-top slide cutout.
    m.use(BARREL_BLUED);
    m.at([0, 0.001, -0.004], null, () => m.box(0.0154, 0.0144, 0.036, 0.0018));
    // Falling locking-block lugs nestled cleanly beneath the chamber (distinctive 92FS engineering).
    m.use(CONTROLS_DARK);
    m.at([0, -0.008, -0.022], null, () => m.box(0.0182, 0.0048, 0.026, 0.0008));
  });
  // Flush recoil spring guide rod peeking out right below the protruding barrel nose.
  m.use(CONTROLS_DARK);
  m.at([0, BORE - 0.0122, -0.088], null, () => m.cyl(0.0036, 0.132, 14, 0.0005));
}

/**
 * Iconic Beretta 92FS semi-cylindrical arched slide cross-section: slim flat lower flanks curving smoothly
 * into a rounded dome top (rather than a boxy flat-top Glock/SIG slab).
 */
function slideArch(): V2[] {
  const hw = SLIDE_W / 2;
  const pts: V2[] = [[-hw + 0.0008, SLIDE_BOT], [hw - 0.0008, SLIDE_BOT], [hw, SLIDE_BOT + 0.0025], [hw, 0.0365]];
  // Smooth semicircular dome across the top from +hw to -hw centered at y = 0.0365, rx = hw, ry = SLIDE_TOP - 0.0365.
  const ry = SLIDE_TOP - 0.0365;
  const steps = 10;
  for (let i = 1; i < steps; i++) {
    const a = (i / steps) * Math.PI;
    pts.push([Math.cos(a) * hw, 0.0365 + Math.sin(a) * ry]);
  }
  pts.push([-hw, 0.0365], [-hw, SLIDE_BOT + 0.0025]);
  return pts;
}

function slide(m: Mesher): ModLook {
  let dotLook!: ModLook;
  m.part('slide', [0, BORE, 0], () => m.at([0, -BORE, 0], null, () => {
    const arch = slideArch();
    const hw = SLIDE_W / 2;
    m.use(SLIDE_METAL);

    // Compact rounded front slide bridge wrapping the protruding blued barrel & recoil guide rod.
    m.at([0, 0, (SLIDE_FRONT + OPEN_FRONT) / 2], null, () => m.front(arch, OPEN_FRONT - SLIDE_FRONT, {
      bevel: 0.0014, smooth: 46,
      holes: [circle(0, BORE, 0.0081, 22), circle(0, BORE - 0.0122, 0.0042, 14)],
    }));

    // Signature Beretta 92FS open-top scalloped side rails: long graceful S-curve sweep exposing almost the
    // entire cylindrical barrel and breech from right behind the front sight back to the rear serrations.
    const cheek = poly([
      [SLIDE_FRONT + 0.002, SLIDE_BOT], [OPEN_REAR + 0.004, SLIDE_BOT],
      [OPEN_REAR + 0.004, 0.0435, 0.005], [OPEN_REAR - 0.014, 0.0345, 0.016],
      [-0.058, 0.0325, 0.02], [OPEN_FRONT + 0.014, 0.035, 0.015],
      [OPEN_FRONT - 0.001, 0.0435, 0.004], [SLIDE_FRONT + 0.002, 0.0425],
    ], 0.0014);
    m.mirror(() => m.at([hw - 0.0016, 0, 0], null, () => m.side(cheek, 0.0032, { bevel: 0.0008, smooth: 48 })));

    // Subtle dark recessed inner rail channel inside the open-top cutout.
    m.use(F.black);
    m.mirror(() => m.at([hw - 0.0031, 0.0278, (OPEN_FRONT + OPEN_REAR) / 2], null, () => m.box(0.0006, 0.0105, OPEN_REAR - OPEN_FRONT - 0.006, 0)));

    // Arched rear slide bridge behind the open-top cutout.
    m.use(SLIDE_METAL);
    m.at([0, 0, (OPEN_REAR + SLIDE_REAR) / 2], null, () => m.front(arch, SLIDE_REAR - OPEN_REAR, { bevel: 0.0014, smooth: 46 }));

    // 11 crisp VERTICAL rear slide serrations (true 92FS vertical grip grooves below the wing safety).
    m.use(F.black);
    m.mirror(() => m.at([hw + 0.0001, 0.0305, 0.056], null, () => m.box(0.0005, 0.0145, 0.037, 0)));
    m.use(SLIDE_METAL);
    m.mirror(() => {
      for (let i = 0; i < 11; i++) {
        m.at([hw + 0.0003, 0.0305, 0.0395 + i * 0.0033], null, () => m.box(0.001, 0.015, 0.0015, 0.00025));
      }
    });

    // Signature ambidextrous 92FS slide-mounted wing safety / decocker with circular drum & red fire-ready dot.
    m.mirror(() => {
      m.use(CONTROLS_DARK);
      m.at([hw + 0.0006, 0.0365, 0.073], [0, Math.PI / 2, 0], () => m.cyl(0.0046, 0.0022, 16, 0.0005));
      m.at([hw + 0.0018, 0.0375, 0.068], null, () => m.side(poly([
        [-0.0115, -0.0034, 0.0015], [0.007, -0.0024, 0.0015], [0.008, 0.0032, 0.002], [-0.0115, 0.0012, 0.0015],
      ], 0.0008), 0.0024, { bevel: 0.0005 }));
      m.use(F.bureauRed);
      m.at([hw + 0.0004, 0.0315, 0.065], [0, Math.PI / 2, 0], () => m.cyl(0.0012, 0.0006, 10, 0));
    });

    // External right-side 92FS extractor bar with red loaded-chamber edge along the breech flank.
    m.use(CONTROLS_DARK);
    m.at([hw + 0.0004, 0.034, 0.008], null, () => m.box(0.0012, 0.0032, 0.022, 0.0003));
    m.use(F.bureauRed);
    m.at([hw + 0.0006, 0.0355, 0.001], null, () => m.box(0.0006, 0.0012, 0.004, 0));

    // Clean rear slide face: recessed hammer clearance notch & flush firing pin boss.
    m.use(F.black);
    m.at([0, 0.028, SLIDE_REAR - 0.0005], null, () => m.box(0.0072, 0.016, 0.004, 0));
    m.use(CONTROLS_DARK);
    m.at([0, BORE, SLIDE_REAR + 0.0005], null, () => m.cyl(0.0022, 0.001, 12, 0.0003));

    // Authentic low-profile dovetailed 92FS rear sight (compact U-notch + twin crisp dots).
    m.use(F.blued);
    m.at([0, 0, 0.079], null, () => m.front(poly([
      [-0.0082, SLIDE_TOP - 0.0015, 0], [0.0082, SLIDE_TOP - 0.0015, 0],
      [0.0068, SIGHT_Y + 0.0018, 0.0007], [0.002, SIGHT_Y + 0.0018, 0.0004],
      [0.002, SIGHT_Y - 0.0025, 0.0005], [-0.002, SIGHT_Y - 0.0025, 0.0005],
      [-0.002, SIGHT_Y + 0.0018, 0.0004], [-0.0068, SIGHT_Y + 0.0018, 0.0007],
    ], 0.0006), 0.01, { bevel: 0.0005 }));
    m.glow('rear', () => m.mirror(() => m.at([0.0043, SIGHT_Y - 0.0001, 0.0844], null, () => m.cyl(0.0008, 0.0005, 10, 0))));

    // Iconic integral ramped 92FS front sight milled cleanly out of the front slide bridge.
    m.use(SLIDE_METAL);
    m.at([0, 0, -0.144], null, () => m.side(poly([
      [0.006, SLIDE_TOP - 0.0015, 0], [0.0042, SIGHT_Y + 0.0016, 0.0006],
      [-0.0028, SIGHT_Y + 0.0016, 0.0008], [-0.0095, SLIDE_TOP - 0.0015, 0],
    ], 0.0006), 0.0034, { bevel: 0.0004 }));
    m.glow('sight', () => m.at([0, SIGHT_Y + 0.0002, -0.1391], null, () => m.cyl(0.00105, 0.0007, 10, 0)));

    // Shared ultra-low-profile open reflex sight (`rivetDot`) mounted directly on the rear slide bridge.
    dotLook = openReflex(m, [0, SLIDE_TOP - 0.0005, RMR_Z], {
      name: 'rmr', scale: 0.96, relief: 0.17, finish: FRAME_ALLOY, accent: SLIDE_METAL,
    });
  }));
  return dotLook;
}

/** How far the stock 15-round and extended 22-round (`rivetMag`) magazines extend below the well mouth. */
const MAG_FOOT = -0.115;
const EXT_FOOT = -0.156;

function magazine(m: Mesher): void {
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      m.part('magStd', [0, 0, 0], () => {
        m.use(F.steelDark);
        m.side(poly([[-0.016, 0.02], [0.016, 0.02], [0.016, MAG_FOOT, 0.003], [-0.016, MAG_FOOT, 0.003]], 0.0014), 0.0195, { bevel: 0.001 });
        m.use(F.black);
        for (let i = 0; i < 5; i++) m.at([0, -0.03 - i * 0.016, 0.0162], null, () => m.cyl(0.002, 0.001, 8, 0));
        // Sleek flush-fit bevelled steel floorplate (matches the slim 92FS silhouette).
        m.use(FRAME_ALLOY);
        m.at([0, MAG_FOOT - 0.0045, 0.0015], null, () => m.side(poly([
          [-0.021, 0.004], [0.021, 0.004], [0.0225, -0.0035, 0.002], [-0.023, -0.004, 0.002],
        ], 0.0012), 0.0255, { bevel: 0.0012 }));
      });
      m.part('magExt', [0, 0, 0], () => {
        m.use(F.steelDark);
        m.side(poly([[-0.016, 0.02], [0.016, 0.02], [0.016, EXT_FOOT, 0.003], [-0.016, EXT_FOOT, 0.003]], 0.0014), 0.0195, { bevel: 0.001 });
        m.use(F.black);
        for (let i = 0; i < 7; i++) m.at([0, -0.03 - i * 0.016, 0.0162], null, () => m.cyl(0.002, 0.001, 8, 0));
        // Ribbed grip extension sleeve + witness window showing live brass rounds + competition base pad.
        m.use(FRAME_ALLOY);
        m.side(poly([[-0.0185, -0.112], [0.019, -0.112], [0.0195, EXT_FOOT - 0.004, 0.003], [-0.0195, EXT_FOOT - 0.004, 0.003]], 0.0014), 0.0235, { bevel: 0.0012 });
        m.use(F.polymer);
        for (let i = 0; i < 3; i++) m.at([0, -0.123 - i * 0.01, 0.0005], null, () => m.box(0.025, 0.0026, 0.039, 0.0008));
        m.use(SLIDE_METAL);
        m.at([0, EXT_FOOT - 0.0085, 0.003], null, () => m.side(poly([
          [-0.024, 0.0055], [0.023, 0.0055], [0.0245, -0.004, 0.0025], [-0.026, -0.004, 0.0025],
        ], 0.0014), 0.0275, { bevel: 0.0013 }));
        m.use(F.black);
        m.at([-0.012, -0.135, 0.0005], [0, -Math.PI / 2, 0], () => m.prism(rect(-0.006, -0.012, 0.006, 0.012, 0.0014), 0.001, { bevel: 0 }));
        m.use(F.brass);
        for (let i = 0; i < 3; i++) m.at([-0.0116, -0.127 - i * 0.008, 0.0005], null, () => m.cyl(0.0026, 0.01, 8));
      });
      m.use(CONTROLS_STEEL);
      m.mirror(() => m.at([0.0072, 0.0205, 0], null, () => m.box(0.002, 0.0045, 0.028, 0.0004)));
      m.at([0, 0.023, -0.004], [0.06, 0, 0], () => round(m, 0.0048, 0.017, 0.011));
    });
  });
}

/**
 * Sleek ported match compensator (`rivetComp`): frame-mounted 92FS "Match" nose extending the silhouette cleanly
 * forward from the slide front, carrying its arched top line and slim frame under-bevel with two deep upward
 * expansion ports, angled side gas vents, and a brushed stainless muzzle crown.
 */
function compensator(m: Mesher): void {
  m.part('comp', [0, BORE, SLIDE_FRONT], () => m.at([0, -BORE, -SLIDE_FRONT], null, () => {
    const hw = SLIDE_W / 2;
    const z0 = SLIDE_FRONT - 0.0005;
    const z1 = COMP_END;
    const arch = slideArch();
    const span = (a: number, b: number, fn: () => void) => m.at([0, 0, (a + b) / 2], null, fn);

    // Lower matching alloy dust-cover nose extension raked cleanly upward toward the front.
    m.use(FRAME_ALLOY);
    m.side(poly([
      [z0 + 0.014, FRAME_TOP, 0.0015], [z0 + 0.014, 0.0014, 0.002],
      [z1 + 0.016, 0.0025, 0.003], [z1, 0.014, 0.003], [z1, FRAME_TOP, 0.0015],
    ], 0.0014), FRAME_W, { bevel: 0.0013 });

    // Upper ported compensator body matching the slide's arched silhouette in contrasting dark match gunmetal.
    m.use(COMP_METAL);
    // Solid front bridge, mid baffle bar, and rear collar round the bore.
    const bars: [number, number][] = [[z0, -0.163], [-0.178, -0.187], [-0.203, z1]];
    for (const [a, b] of bars) {
      span(a, b, () => m.front(arch, a - b, { bevel: 0.0013, holes: [circle(0, BORE, 0.0074, 18)] }));
    }
    // Lower cradle & side walls under the two deep top gas ports.
    const portBase = poly([
      [-hw + 0.001, SLIDE_BOT], [hw - 0.001, SLIDE_BOT], [hw, SLIDE_BOT + 0.003],
      [hw, 0.032], [-hw, 0.032], [-hw, SLIDE_BOT + 0.003],
    ], 0.0012);
    const portWall = poly([[0.0076, 0.03], [hw, 0.03], [hw, 0.0415, 0.002], [0.0076, 0.0435, 0.001]], 0.001);
    for (const [a, b] of [[-0.163, -0.178], [-0.187, -0.203]] as const) {
      span(a, b, () => {
        m.front(portBase, a - b, { bevel: 0.001 });
        m.mirror(() => m.front(portWall, a - b, { bevel: 0.0009 }));
      });
      // Carbon-black internal blast chamber floor and walls + angled lateral vent slots.
      m.use(F.black);
      m.at([0, 0.0335, (a + b) / 2], null, () => m.box(0.0144, 0.003, a - b - 0.002, 0));
      m.mirror(() => m.at([hw + 0.0001, 0.036, (a + b) / 2], [0.22, 0, 0], () => m.box(0.0008, 0.006, 0.0075, 0)));
      m.use(COMP_METAL);
    }

    // Brushed stainless muzzle crown ring & guide-rod nose boss on the front face.
    m.use(CONTROLS_STEEL);
    m.at([0, BORE, z1 - 0.0004], null, () => m.lathe([
      [0.0072, 0.0016, 0], [0.009, 0.0012], [0.0092, -0.0005], [0.0072, -0.0005, 0],
    ], 20));
    m.at([0, BORE - 0.0122, z1 + 0.001], null, () => m.cyl(0.0038, 0.0022, 12, 0.0004));
    m.use(F.black);
    m.at([0, BORE, z1], null, () => m.lathe([[0.0072, -0.0004, 0], [0.0066, 0.018, 0], [0, 0.019, 0]], 14));
  }));
}

/**
 * Slim cylindrical threaded tactical suppressor (`rivetCan`): threads onto the exposed 92FS barrel with a
 * stainless booster collar, slim matte carbon-weave tube (low enough to stay clear beneath the iron sights),
 * machined titanium heat rings, knurled front service grip, and recessed spanner-notched end-cap.
 */
function suppressor(m: Mesher): void {
  m.part('can', [0, BORE, MUZZLE + 0.006], () => {
    const len = MUZZLE + 0.006 - CAN_END; // ~0.158 m
    const r = 0.0136; // top at BORE + 0.0136 = 0.0496 < SIGHT_Y (0.0545)
    // Stainless threaded piston / Nielsen booster collar at the rear.
    m.use(CONTROLS_STEEL);
    m.lathe([[0.008, 0.002, 0], [0.0108, 0.002], [0.0112, -0.012], [0.0134, -0.017], [0.0134, -0.022, 0]], 22);
    // Matte carbon-weave slim cylindrical main tube.
    m.use(CAN_TUBE);
    m.lathe([
      [0.0134, -0.02, 0], [r, -0.023], [r, -len + 0.014], [r - 0.0012, -len + 0.006],
      [r - 0.0026, -len], [0.0056, -len, 0],
    ], 28);
    // Machined titanium cooling/reinforcement rings and front knurled grip band.
    m.use(SLIDE_METAL);
    for (const z of [-0.024, -0.072, -0.118]) m.at([0, 0, z], null, () => m.cyl(r + 0.0005, 0.0045, 28, 0.0004));
    m.at([0, 0, -len + 0.02], null, () => knurl(m, r + 0.0003, 0.014, F.steelDark, 24, 0.0004));
    // Subtle recessed side heat-relief flutes along the mid tube.
    m.use(F.black);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      m.at([Math.cos(a) * (r - 0.0001), Math.sin(a) * (r - 0.0001), -0.095], [0, 0, a], () => m.box(0.0006, 0.0022, 0.038, 0));
    }
    // Recessed stainless crown collar, dark bore, and 4 end-cap spanner notches.
    m.use(CONTROLS_STEEL);
    m.lathe([[0.0074, -len + 0.0012, 0], [0.0074, -len - 0.0004], [0.0054, -len - 0.0004], [0.0054, -len + 0.0016, 0]], 20);
    m.use(F.black);
    m.lathe([[0.0054, -len + 0.001, 0], [0.005, -len + 0.022, 0], [0, -len + 0.023, 0]], 14);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      m.at([Math.cos(a) * 0.0094, Math.sin(a) * 0.0094, -len + 0.0006], [0, 0, a], () => m.box(0.0024, 0.0014, 0.0014, 0));
    }
  });
}

/**
 * Sleek under-frame laser module (`rivetLam`): clamps cleanly around the smooth 92FS dust cover with a low
 * wraparound saddle bracket tucked ahead of the combat trigger guard, chamfered flanks, steel side accents,
 * ambidextrous rear paddle switches, and a recessed red emitter lens (`laser` socket drives `lam.ts`).
 */
const LAM_PIVOT: readonly [number, number, number] = [0, 0.001, -0.102];
const LAM_EMIT: readonly [number, number, number] = [0, -0.0115, -0.0308];

function laser(m: Mesher): void {
  m.part('lam', LAM_PIVOT, () => {
    // Wraparound dust-cover saddle bracket gripping the smooth 92FS dust cover flush with zero gap.
    m.use(F.steelDark);
    m.at([0, -0.0005, 0.002], null, () => m.box(FRAME_W + 0.0024, 0.0086, 0.054, 0.0009));
    // Sculpted chamfered main laser body tapering cleanly forward.
    m.use(FRAME_ALLOY);
    m.side(poly([
      [0.03, -0.0045], [0.03, -0.017, 0.003], [-0.024, -0.0185, 0.003], [-0.03, -0.0115, 0.003], [-0.03, -0.0045],
    ], 0.0012), 0.022, { bevel: 0.0014 });
    // Brushed steel side accent plates + cross-clamp screw + ambidextrous rear paddles.
    m.use(SLIDE_METAL);
    m.mirror(() => m.at([0.0112, 0, 0], null, () => m.side(poly([
      [0.022, -0.0072], [0.022, -0.0155], [-0.019, -0.0162], [-0.023, -0.011], [-0.023, -0.0072],
    ], 0.001), 0.0014, { bevel: 0.0004 })));
    m.mirror(() => screwX(m, FRAME_W / 2 + 0.0014, 0.0005, -0.006, 1, 0.0017, CONTROLS_STEEL));
    m.use(CONTROLS_STEEL);
    m.mirror(() => m.at([0.012, -0.0125, 0.022], null, () => m.box(0.0015, 0.0046, 0.009, 0.0005)));
    // Recessed front emitter bezel, clear optic lens, and glowing red laser diode.
    m.use(F.black);
    m.at([0, -0.0115, -0.0294], null, () => m.cyl(0.0048, 0.0026, 16, 0.0004));
    m.glass(() => m.at([0, -0.0115, -0.0306], null, () => m.cyl(0.0038, 0.0005, 16, 0)));
    m.glow('laser', () => m.at([LAM_EMIT[0], LAM_EMIT[1], LAM_EMIT[2] - 0.0002], null, () => m.cyl(0.0009, 0.00025, 10, 0)));
  });
}

/**
 * Flared bevelled competition magwell (`rivetMagwell`): machined brushed-steel funnel skirt clamping cleanly
 * around the base of the slim 92FS grip, widening into an open hollow mouth round the magazine floorplate.
 */
function magwell(m: Mesher): void {
  m.part('magwell', [0, -0.118, 0.0685], () => m.at([0, 0, 0], [-0.04, 0, 0], () => {
    // Upper matte-alloy locking collar hugging the grip heel.
    m.use(FRAME_ALLOY);
    m.mirror(() => m.at([0.0148, 0.0045, 0], null, () => m.side(poly([
      [-0.025, -0.0025], [0.026, -0.0025], [0.024, 0.0055, 0.0018], [-0.024, 0.0055, 0.0018],
    ], 0.001), 0.0034, { bevel: 0.0007 })));
    // Four sloped brushed-steel flared skirt walls framing a real hollow funnel mouth.
    m.use(CONTROLS_STEEL);
    m.mirror(() => m.at([0, 0, 0], null, () => {
      const wing = poly([
        [0.013, 0.0025], [0.0168, 0.0025, 0.0012], [0.0204, -0.0062, 0.002], [0.0192, -0.0088, 0.0012],
        [0.0136, -0.0088, 0.001], [0.0124, -0.003, 0.001],
      ], 0.0008);
      m.at([0, 0, 0.0005], null, () => m.front(wing, 0.058, { bevel: 0.0011 }));
    }));
    const frontLip = poly([
      [-0.025, 0.0025], [-0.0215, 0.0025], [-0.0222, -0.0035], [-0.0248, -0.0088, 0.0012],
      [-0.0298, -0.0088, 0.0018], [-0.0304, -0.0055, 0.002], [-0.0274, 0.0015, 0.0014],
    ], 0.0009);
    m.side(frontLip, 0.0385, { bevel: 0.0011 });
    const rearLip = poly([
      [0.022, 0.0025], [0.0265, 0.0025, 0.0012], [0.031, -0.0055, 0.002], [0.0298, -0.0088, 0.0016],
      [0.025, -0.0088, 0.001], [0.0232, -0.0035],
    ], 0.0009);
    m.side(rearLip, 0.0385, { bevel: 0.0011 });

    // Retention pin screws & recessed dark funnel throat liner.
    m.mirror(() => screwX(m, 0.0165, 0.0038, 0.018, 1, 0.0016, F.steelDark));
    m.use(F.black);
    m.at([0, -0.0035, 0.0005], null, () => m.front(rect(-0.013, -0.0046, 0.013, 0.0046, 0.0016), 0.049, { bevel: 0 }));
  }));
}

function buildRivet(kit: Kit): { model: Model; dotLook: ModLook; shieldLook: ModLook } {
  const m = kit.mesher();
  m.bevel = 0.001;
  pistolBackHalf(m);
  frontFrame(m);
  barrel(m);
  const dotLook = slide(m);
  magazine(m);
  magwell(m);
  compensator(m);
  suppressor(m);
  laser(m);
  // Weapon light mounted cleanly on the dust cover's left flank so it never collides with the under-rail `rivetLam`.
  weaponLight(m, [-0.0235, 0.0055, -0.106], -Math.PI / 2, 0.78);
  const shieldLook = buildRiotShield(m);
  const model = new Model(m, kit.mats, {
    glows: {
      sight: [0xff7a1a, 7], rear: [0xdce6f2, 1.8], laser: [0xff3020, 7],
      dot: OPTIC_GLOWS.dot, torch: TORCH,
    },
  });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.006]);
  model.socket('muzzleComp', [0, BORE, COMP_END - 0.004]);
  model.socket('muzzleCan', [0, BORE, CAN_END - 0.004]);
  model.socket('laser', LAM_EMIT, [0, 0, 0], 'lam');
  model.socket('eject', [SLIDE_W / 2 + 0.005, BORE + 0.008, -0.018]);
  model.hand('gripR', [0.0185, -0.066, 0.064], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  // The off hand wraps the shooting hand, thumbs forward under the slide.
  model.pistolSupport('gripL', [-0.0285, -0.068, 0.06]);
  model.hand('magHold', [-0.014, -0.1, 0.012], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.hand('slideReleaseHold', [-0.032, -0.024, 0.042], [-0.25, -0.45, -0.85], [0.95, 0, -0.3]);
  attachRiotShieldHand(model);
  return { model, dotLook, shieldLook };
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.05, 0.36);
  // Dim iron sight glows under the fitted reflex optic so only the crisp red dot floats in the open window.
  const irons = a.mods?.has('rivetDot') ? 0 : 1;
  a.glow('sight', irons);
  a.glow('rear', irons);

  const t = a.sinceFire;
  const p = a.reload;
  const fromEmpty = a.reloadFromEmpty || a.mag <= 0;
  // Crisp blowback inside 70 ms so rapid fire never catches the slide halfway.
  const cycle = t < 0.07 ? Math.sin((t / 0.07) * Math.PI) : 0;
  // Locked open on an empty magazine until the reload's slide release clicks it home.
  let back = p < 0 ? (a.mag <= 0 ? 1 : cycle) : 0;
  if (p >= 0 && fromEmpty) back = p >= 0.8 ? 1 - outCubic(seg(p, 0.8, 0.85)) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;

  // Exposed ring hammer falls forward on the shot, then gets pushed back to cocked by the reciprocating slide.
  const strike = t < 0.022 ? 1 - seg(t, 0.008, 0.022) : 0;
  P.hammer!.rotation.x += back * 0.34 - strike * 0.65;

  // Clean straight-up muzzle snap (no rolling), held down by the compensator (`COMP.flip`).
  if (a.shots > 0 && t < 0.14 && p < 0) {
    const comp = a.mods?.has('rivetComp') ? COMP.flip : 1;
    const flip = (t < 0.018 ? outQuad(t / 0.018) : Math.exp(-(t - 0.018) / 0.045)) * (1 - a.aim * 0.45) * comp;
    a.gunR.x += flip * 0.07;
    a.gunP.z += flip * 0.01;
  }

  if (a.draw < 1) {
    // Straight up out of the holster and punched out to the sights.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.09;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.55;
  }
  if (p >= 0) {
    const mag = P.mag!;
    const h = a.left;
    h.fingerRate = 44;
    if (fromEmpty) {
      // Empty reload: swap mag while slide is locked open, then thumb the left slide release to send the slide home.
      // Foley: out at 0.05, in at 0.50, slide release at 0.80.
      const out = seg(p, 0.05, 0.2);
      const inn = seg(p, 0.36, 0.5);
      const away = inQuad(out) * (1 - outCubic(inn));
      mag.position.y -= away * 0.3;
      mag.position.z += away * 0.058;
      if (p > 0.22 && p < 0.34) mag.visible = false;
      const seat = p >= 0.5 ? thud(seg(p, 0.5, 0.62)) : 0;
      const click = bump(p, 0.74, 0.84);
      P.slideStop!.position.y -= click * 0.0026;

      // Tilted slightly so the locked breech and left slide stop read clearly, then snapped level as the slide drops.
      const present = hold(p, 0.0, 0.12, 0.82, 0.96);
      const snap = bump(p, 0.8, 0.94);
      a.gunR.z -= present * 0.22;
      a.gunR.x += present * 0.3 + seat * 0.07 - snap * 0.06;
      a.gunR.y += present * 0.14;
      a.gunP.x -= present * 0.045;
      a.gunP.y += present * 0.09 + seat * 0.012;
      a.gunP.z += present * 0.065 + snap * 0.014;

      h.to('pouchL', inOut(seg(p, 0.04, 0.2)));
      h.to('magHold', inOut(seg(p, 0.3, 0.42)));
      h.to('slideReleaseHold', inOut(seg(p, 0.6, 0.74)));
      h.to('gripL', inOut(seg(p, 0.84, 0.98)));
      h.shape(HANDS.cup, hold(p, 0.24, 0.36, 0.55, 0.62));
      h.shape(HANDS.radio, hold(p, 0.66, 0.74, 0.82, 0.88));
    } else {
      // Tactical reload (round already chambered): swap magazine only, no slide movement.
      // Foley: out at 0.06, in at 0.64.
      const out = seg(p, 0.06, 0.24);
      const inn = seg(p, 0.44, 0.64);
      const away = inQuad(out) * (1 - outCubic(inn));
      mag.position.y -= away * 0.3;
      mag.position.z += away * 0.058;
      if (p > 0.26 && p < 0.41) mag.visible = false;
      const seat = p >= 0.64 ? thud(seg(p, 0.64, 0.78)) : 0;

      const present = hold(p, 0.0, 0.14, 0.78, 0.96);
      a.gunR.x += present * 0.32 + seat * 0.07;
      a.gunR.y += present * 0.12;
      a.gunP.x -= present * 0.04;
      a.gunP.y += present * 0.085 + seat * 0.012;
      a.gunP.z += present * 0.06;

      h.to('pouchL', inOut(seg(p, 0.04, 0.22)));
      h.to('magHold', inOut(seg(p, 0.36, 0.5)));
      h.to('gripL', inOut(seg(p, 0.72, 0.96)));
      h.shape(HANDS.cup, hold(p, 0.3, 0.44, 0.68, 0.76));
    }
  }
  animateRiotShield(a, 'rivetShield');
}

export function rivetDef(kit: Kit): ViewDef {
  const { model, dotLook, shieldLook } = buildRivet(kit);
  return {
    id: 'rivet',
    model,
    pos: [0.128, -0.126, -0.4],
    rot: [0.02, 0.06, 0],
    // ADS: glowing orange front post centred cleanly in the dovetail rear notch.
    sight: [0, SIGHT_Y, -0.1396], rear: [0, SIGHT_Y, 0.078], relief: 0.3,
    recoil: { back: 0.024, lift: 0.01, pitch: 0.12, yaw: 0.014, roll: 0, omega: 38, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.pistolSupport },
    heatPerShot: 0.02,
    mods: {
      rivetShield: shieldLook,
      rivetMag: { part: 'magExt', hides: 'magStd' },
      rivetLight: { part: 'light' },
      rivetComp: { part: 'comp', muzzle: 'muzzleComp', flip: COMP.flip },
      rivetCan: { part: 'can', muzzle: 'muzzleCan' },
      rivetDot: dotLook,
      rivetLam: { part: 'lam', laser: 'laser' },
      rivetMagwell: { part: 'magwell' },
    },
    animate: clip,
  };
}
