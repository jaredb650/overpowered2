/**
 * RGL (Revolving Grenade Launcher, internal id `mgl`): a chunky 6-shot revolving 40 mm grenade launcher on key 3.
 *
 * A wide 6-chamber revolving cylinder drum with visible 40 mm olive/brass rounds, short heavy ribbed 40 mm barrel
 * with quad-rail shroud, vertical foregrip, top rail with glowing reflex sight, and telescoping buttstock.
 *
 * Each shot indexes the drum 60° (Math.PI / 3); reloading swings the 6-chamber cylinder crane cleanly out to the left
 * (with zero gun roll), dumps the spent casings, seats three hand-carried pairs of fresh 40 mm grenades into the open
 * chambers in sync with the reload foley, and snaps the drum shut. Shop mods: `mglSticky` (left-flank remote telemetry
 * pod), `mglLong` (extended heavy fluted 40 mm barrel), and `mglTrigger` (machined skeletonized match trigger & housing).
 * Origin at the top of the pistol grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, rect } from '../kit/shapes';
import { hexX, rail, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

const BORE = 0.088;
const CHAMBER_R = 0.036;
const CYL_Y = BORE - CHAMBER_R;
const DRUM_R = 0.064;
const DRUM_FRONT = -0.195;
const DRUM_BACK = -0.045;
const DRUM_MID = (DRUM_FRONT + DRUM_BACK) / 2;
const MUZZLE = -0.455;
const MUZZLE_LONG = -0.685;
const STEP = Math.PI / 3;
/** Lower-left crane pivot: swings the 6-chamber drum out clear of the top bridge rail and rear receiver spine. */
const CRANE_X = -0.042;
const CRANE_Y = CYL_Y - DRUM_R - 0.008;
const CRANE_OPEN = 1.35;

const OLIVE: Finish = { color: 0x4b563c, rough: 0.56, metal: 0.14, wear: 0.12 };
const DRUM_STEEL: Finish = { color: 0x35393f, rough: 0.36, metal: 0.82, wear: 0.16 };

/** Rear receiver frame, pistol grip, trigger guard, telescoping stock, front frame, barrel, foregrip, and top reflex sight. */
function receiverAndFront(m: Mesher): void {
  // Heavy rear recoil bulkhead behind the revolving 6-chamber drum.
  m.use(F.parkerized);
  m.at([0, CYL_Y, DRUM_BACK + 0.018], null, () => m.cyl(DRUM_R + 0.005, 0.026, 24, 0.002));
  // Upper frame spine over the rear bulkhead back to the stock hinge.
  m.side(
    poly([
      [0.12, 0.015], [0.12, 0.118, 0.006], [-0.036, 0.128, 0.005],
      [-0.042, 0.012, 0.004], [0.095, 0.006, 0.005],
    ], 0.003),
    0.046,
    { bevel: 0.0022 },
  );

  // Fixed top bridge rail spanning cleanly over the drum to the front barrel bulkhead.
  m.use(F.steelDark);
  m.at([0, 0.131, -0.122], null, () => m.box(0.032, 0.014, 0.25, 0.002, 0.003));
  m.at([0, 0.138, 0], null, () => rail(m, 0.09, -0.23, 0.022, F.steelDark));

  // Front fixed drum bulkhead & lower crane-hinge trunnion tied rigidly to the top bridge rail.
  m.use(F.parkerized);
  m.at([0, CYL_Y, DRUM_FRONT - 0.016], null, () => m.cyl(DRUM_R + 0.005, 0.028, 24, 0.002));
  m.at([CRANE_X, CRANE_Y, DRUM_FRONT - 0.016], null, () => m.cyl(0.011, 0.028, 12, 0.001));
  m.at([CRANE_X, CRANE_Y, DRUM_BACK + 0.016], null, () => m.cyl(0.011, 0.028, 12, 0.001));
  // Hazard stencil on the left side of the front bulkhead collar.
  m.at([-DRUM_R - 0.0056, CYL_Y, DRUM_FRONT - 0.016], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.024, 0.014, 0xf0c428));

  // RGL occluded/reflex grenade sight perched on the top rail, with glowing amber-red dot.
  m.at([0, 0.142, -0.055], null, () => {
    m.use(F.anodized);
    m.at([0, 0.006, 0], null, () => m.box(0.03, 0.012, 0.068, 0.0015));
    // Sight hood framing the reflex lens.
    m.at([0, 0.026, 0], null, () => m.front(
      poly([[-0.018, -0.016], [0.018, -0.016], [0.02, 0.016], [-0.02, 0.016]], 0.004),
      0.062,
      { bevel: 0.0015, holes: [poly([[-0.013, -0.011], [0.013, -0.011], [0.014, 0.011], [-0.014, 0.011]], 0.003)] },
    ));
    m.glass(() => m.at([0, 0.026, -0.02], null, () => m.box(0.026, 0.021, 0.0012, 0)));
    // Range-drum knob on the left of the optic.
    m.use(F.steelDark);
    m.at([-0.022, 0.02, 0.006], [0, Math.PI / 2, 0], () => m.cyl(0.008, 0.008, 12, 0.0006));
    m.glow('sight', () => m.at([0, 0.026, -0.018], null, () => m.cyl(0.0022, 0.0012, 10, 0)));
  });

  // Receiver side hardware + existing Bureau stencils only (crucible, serial, hazard).
  m.mirror(() => {
    screwX(m, 0.024, 0.088, 0.075, 1, 0.0024);
    screwX(m, 0.024, 0.042, 0.075, 1, 0.0024);
    hexX(m, 0.024, 0.064, 0.015, 1, 0.0046);
  });
  m.at([-0.0244, 0.082, 0.035], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.064, 0.012, 0xc8ced6));
  m.at([-0.0244, 0.056, 0.038], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.048, 0.0056, 0x9aa2aa));

  // Pistol grip & enlarged gloved trigger guard.
  const front = curve([[0.015, 0.008], [0.019, -0.022], [0.026, -0.048], [0.034, -0.078], [0.042, -0.114]], 4);
  const back = curve([[0.095, -0.114], [0.089, -0.076], [0.082, -0.042], [0.074, -0.014], [0.068, 0.008]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.044, -0.12], [0.092, -0.12], ...back], 0.034, { bevel: 0.004, smooth: 48 });
  m.use(F.steelDark);
  m.at([0, -0.122, 0.068], null, () => m.box(0.034, 0.005, 0.052, 0.0012));

  const guardOut = poly([[-0.032, 0.008], [-0.038, -0.026, 0.007], [-0.018, -0.044, 0.008], [0.026, -0.044, 0.008], [0.044, -0.012, 0.004], [0.044, 0.008]], 0.002);
  const guardIn = poly([[-0.027, 0.004], [-0.032, -0.024, 0.005], [-0.016, -0.038, 0.005], [0.023, -0.038, 0.005], [0.039, -0.012, 0.003], [0.039, 0.004]], 0.002);
  m.use(F.parkerized);
  m.side(guardOut, 0.014, { bevel: 0.001, holes: [guardIn] });

  // Telescoping stock: buffer tube, twin rails, polymer cheek stock, rubber recoil pad.
  m.use(F.steelDark);
  m.at([0, 0.082, 0.23], null, () => m.cyl(0.015, 0.22, 16, 0.001));
  m.mirror(() => m.at([0.02, 0.048, 0.22], null, () => m.cyl(0.0052, 0.21, 10, 0.0006)));
  m.use(F.polymer);
  m.side(poly([[0.21, 0.096], [0.345, 0.096, 0.008], [0.345, -0.028, 0.008], [0.275, -0.022, 0.012], [0.21, 0.045, 0.008]], 0.004), 0.038, { bevel: 0.004 });
  m.use(F.rubber);
  m.at([0, 0.035, 0.354], null, () => m.box(0.044, 0.122, 0.018, 0.004, 0.006));

  // Short heavy ribbed 40 mm barrel ahead of the front bulkhead (fixed so reloading never twists the barrel).
  const bStart = DRUM_FRONT - 0.028;
  const bEnd = MUZZLE;
  const bMid = (bStart + bEnd) / 2;
  const bLen = bStart - bEnd;
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrelBlack);
    m.lathe([
      [0.025, bStart, 0], [0.025, bStart - 0.022], [0.0235, bStart - 0.026],
      [0.0235, bEnd + 0.02], [0.0265, bEnd + 0.016], [0.0265, bEnd], [0.0205, bEnd + 0.004, 0],
    ], 20);
    // Deep 40 mm bore cavity.
    m.use(F.black);
    m.at([0, 0, bEnd + 0.012], null, () => m.cyl(0.0202, 0.026, 16, 0));
    // Heavy cooling ribs along the barrel.
    m.use(F.steelDark);
    for (let i = 0; i < 4; i++) {
      m.at([0, 0, bStart - 0.042 - i * 0.036], null, () => m.cyl(0.0272, 0.012, 18, 0.0012));
    }
    // Quad-rail shroud around the lower half of the barrel.
    m.use(F.anodized);
    m.at([0, -0.026, bMid + 0.01], null, () => m.box(0.044, 0.016, bLen - 0.04, 0.002));
    m.at([0, -0.035, bMid + 0.01], null, () => m.box(0.024, 0.008, bLen - 0.05, 0.001));
    m.mirror(() => m.at([0.028, -0.006, bMid + 0.015], null, () => m.box(0.008, 0.018, bLen - 0.06, 0.0012)));
  });

  // Vertical foregrip bolted to the lower barrel rail.
  m.at([0, BORE - 0.04, bMid + 0.008], null, () => {
    m.use(F.steelDark);
    m.box(0.028, 0.014, 0.036, 0.0015);
    m.use(F.polymerStipple);
    m.at([0, -0.052, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0165, 0.095, 14, 0.002));
    m.use(F.rubber);
    m.at([0, -0.102, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0185, 0.012, 14, 0.002));
  });
}

/** One 40 mm grenade shell (brass rimmed case, steel primer, olive hull, and gold-banded ogive nose). */
function grenadeShell(m: Mesher): void {
  m.use(F.brass);
  m.at([0, 0, 0.002], null, () => m.cyl(0.0218, 0.006, 12, 0.0008));
  m.use(F.steel);
  m.at([0, 0, 0.0054], null, () => m.cyl(0.0055, 0.001, 10, 0));
  m.use(F.brass);
  m.at([0, 0, -0.018], null, () => m.cyl(0.0204, 0.036, 12, 0.0008));
  m.use(OLIVE);
  m.at([0, 0, -0.054], null, () => m.cyl(0.0192, 0.042, 12, 0.0015));
  m.use(F.yellow);
  m.at([0, 0, -0.074], null, () => m.cyl(0.0176, 0.008, 12, 0.001));
  m.use(OLIVE);
  m.lathe([[0.0172, -0.078, 0], [0.0135, -0.092], [0.007, -0.1], [0, -0.102, 0]], 12, { chamfer: 0, smooth: 30 });
}

/**
 * Hinged lower-left cylinder crane (`yoke`): swings ONLY the 6-chamber revolving 40 mm drum cleanly out to the left
 * during reload, keeping the upper rail, barrel, and foregrip rock-steady. Carries six individual chamber rounds
 * (`round0`..`round5`) and a hand-carried fresh twin-shell loader (`shellIn`) synced to the reload foley.
 */
function craneAndDrum(m: Mesher): void {
  const ox = -CRANE_X;
  const oy = CYL_Y - CRANE_Y;

  m.part('yoke', [CRANE_X, CRANE_Y, DRUM_MID], () => {
    const len = DRUM_BACK - DRUM_FRONT - 0.006;
    const half = len / 2;

    // Heavy crane hinge shaft & forged L-arm supporting the cylinder spindle.
    m.use(F.steelDark);
    m.cyl(0.0085, len + 0.024, 12, 0.001);
    m.use(F.parkerized);
    for (const z of [-half - 0.002, half + 0.002]) {
      m.at([ox * 0.5, oy * 0.5, z], [0, 0, Math.atan2(oy, ox)], () => m.box(Math.hypot(ox, oy) + 0.012, 0.016, 0.012, 0.0016));
    }

    // Revolving 6-chamber 40 mm cylinder drum (rotates 60° / Math.PI/3 per shot).
    m.part('drum', [ox, oy, 0], () => {
      // Central spindle hub.
      m.use(F.steelDark);
      m.cyl(0.017, len + 0.014, 16, 0.0012);
      // Six distinct hollow-bore 40 mm chamber tubes arranged in a bold scalloped revolver cluster.
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + i * STEP;
        const cx = Math.cos(a) * CHAMBER_R;
        const cy = Math.sin(a) * CHAMBER_R;
        m.at([cx, cy, 0], null, () => {
          m.use(DRUM_STEEL);
          m.cyl(0.0255, len, 14, 0.0014);
          // Front & rear dark 40 mm chamber mouths so empty chambers read unmistakably hollow.
          m.use(F.black);
          m.at([0, 0, -half - 0.0005], null, () => m.cyl(0.0205, 0.002, 12, 0));
          m.at([0, 0, half + 0.0005], null, () => m.cyl(0.0208, 0.002, 12, 0));
        });
      }
      // Reinforced mid-drum retaining band.
      m.use(F.anodized);
      m.cyl(DRUM_R - 0.004, 0.016, 24, 0.0012);

      // Six individual 40 mm chamber rounds: eject together on dump, then lock in two at a time as the hand seats them.
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + i * STEP;
        const cx = Math.cos(a) * CHAMBER_R;
        const cy = Math.sin(a) * CHAMBER_R;
        m.part(`round${i}`, [cx, cy, half], () => {
          grenadeShell(m);
        });
      }
    });

    // Fresh pair of 40 mm shells visibly carried by the left hand and rammed into the top two open chambers (chambers at pi/2 and pi/2 + STEP).
    const c0x = Math.cos(Math.PI / 2) * CHAMBER_R;
    const c0y = Math.sin(Math.PI / 2) * CHAMBER_R;
    const c1x = Math.cos(Math.PI / 2 + STEP) * CHAMBER_R;
    const c1y = Math.sin(Math.PI / 2 + STEP) * CHAMBER_R;
    m.part('shellIn', [ox, oy, half], () => {
      m.at([c0x, c0y, 0], null, () => grenadeShell(m));
      m.at([c1x, c1y, 0], null, () => grenadeShell(m));
    });
  });
}

/** Long heavy fluted 40 mm barrel extension (`mglLong`): bolted collar, 6 longitudinal flutes, cooling ring, and ported muzzle crown. */
function barrelLong(m: Mesher): void {
  m.part('barrelLong', [0, BORE, 0], () => {
    const start = MUZZLE + 0.02;
    const end = MUZZLE_LONG;
    // Stepped machined dark-steel clamping collar gripping the stock barrel crown with twin hex bolts.
    m.use(F.parkerized);
    m.lathe([
      [0.025, start, 0], [0.0298, start - 0.004], [0.0298, start - 0.036], [0.0258, start - 0.042, 0],
    ], 24, { chamfer: 0.0012 });
    m.mirror(() => {
      hexX(m, 0.0296, 0.008, start - 0.02, 1, 0.0024);
      hexX(m, 0.0296, -0.008, start - 0.02, 1, 0.0024);
    });
    // Ordnance yellow collar stripe for clean visual readability in FP and shop studio.
    m.use(F.yellow);
    m.at([0, 0, start - 0.045], null, () => m.cyl(0.0262, 0.007, 22, 0.0004));

    // Extended heavy 40 mm barrel tube.
    m.use(F.barrelBlack);
    m.lathe([
      [0.0252, start - 0.042, 0], [0.0252, end + 0.038], [0.0285, end + 0.034],
      [0.0285, end + 0.004], [0.026, end], [0.0205, end + 0.004, 0],
    ], 24, { chamfer: 0.0012 });

    // Six bold longitudinal flutes/ribs along the extended 40 mm ordnance tube.
    m.use(F.steelDark);
    const fluteMid = (start - 0.052 + end + 0.042) / 2;
    const fluteLen = (start - 0.052) - (end + 0.042);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      m.at([0, 0, fluteMid], [0, 0, a], () => {
        m.at([0.0258, 0, 0], null, () => m.box(0.0048, 0.0068, fluteLen, 0.001));
      });
    }

    // Brushed-steel mid-barrel heat dissipation ring.
    m.use(F.steel);
    m.at([0, 0, -0.555], null, () => m.cyl(0.0288, 0.014, 24, 0.0012));

    // Ported heavy chamfered muzzle brake crown & deep black 40 mm bore interior.
    m.use(F.parkerized);
    m.at([0, 0, end + 0.019], null, () => m.box(0.058, 0.046, 0.034, 0.003));
    m.use(F.black);
    m.mirror(() => {
      m.at([0.0294, 0, end + 0.019], null, () => m.box(0.002, 0.024, 0.018, 0));
    });
    m.at([0, 0, end + 0.014], null, () => m.cyl(0.0202, 0.03, 18, 0));
  });
}

/** Match-grade trigger group housing (`mglTrigger`): CNC side plate, exposed speed-sear hardware, and brass overtravel pin. */
function triggerHousing(m: Mesher): void {
  m.part('triggerHousing', [0, 0, 0], () => {
    m.mirror(() => {
      // Machined anodized-grey CNC fire-control side plate flanking the lower receiver above the trigger guard.
      m.use(F.anodizedGrey);
      m.at([0.0245, 0.024, 0.006], null, () => m.box(0.0048, 0.03, 0.072, 0.001));
      // Brushed-steel anti-walk trigger & hammer linkage bars with brass match-sear pins.
      m.use(F.steel);
      m.at([0.0272, 0.024, 0.006], null, () => m.box(0.0022, 0.0085, 0.048, 0.0006));
      m.use(F.brass);
      m.at([0.0278, 0.024, -0.012], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.003, 12, 0.0005));
      m.at([0.0278, 0.024, 0.024], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.003, 12, 0.0005));
    });
    // Machined brushed-steel flared match overtravel collar at the front of the trigger guard.
    m.use(F.steel);
    m.at([0, -0.039, -0.02], null, () => m.box(0.017, 0.008, 0.016, 0.001));
  });
}

/** Sticky Bomb shop mod (`mglSticky`): remote-detonator telemetry pod + pulsing armed LED on the left flank. */
function stickyPod(m: Mesher): void {
  m.part('stickyPod', [-0.032, 0.088, -0.005], () => {
    m.use(F.steelDark);
    m.box(0.018, 0.034, 0.064, 0.002);
    m.use(F.anodized);
    m.at([-0.006, 0.004, 0.004], null, () => m.box(0.01, 0.022, 0.046, 0.0012));
    // Short RF detonator whip antenna stub.
    m.use(F.black);
    m.at([-0.006, 0.038, 0.018], [Math.PI / 2, 0, 0], () => m.cyl(0.0024, 0.048, 8, 0.0005));
    // Hazard strip & glowing armed LED bar visible in first person.
    m.at([-0.0114, -0.009, 0], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.042, 0.008, 0xf0c428));
    m.glow('stickyLed', () => m.at([-0.0116, 0.008, -0.008], null, () => m.box(0.002, 0.0065, 0.022, 0)));
  });
}

function buildMgl(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  receiverAndFront(m);
  craneAndDrum(m);
  barrelLong(m);
  triggerHousing(m);
  stickyPod(m);

  m.part('trigger', [0, 0.002, -0.002], () => {
    // Stock trigger shoe (hidden while `mglTrigger` is fitted).
    m.part('triggerStd', [0, 0, 0], () => {
      m.use(F.steelDark);
      m.side(
        poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.004, -0.022, 0.0015], [0.0006, -0.023, 0.001], [-0.0035, -0.01, 0.003]], 0.001),
        0.007,
        { bevel: 0.0007 },
      );
    });
    // Match-grade skeletonized trigger shoe (`mglTrigger`): brushed-steel lightened flat-face blade with red anodized safety shoe.
    m.part('triggerMatch', [0, 0, 0], () => {
      m.use(F.steel);
      m.side(
        poly([[-0.0042, 0.002], [0.0042, 0.002], [0.003, -0.012, 0.002], [0.005, -0.024, 0.0015], [0.0008, -0.025, 0.001], [-0.0042, -0.012, 0.002]], 0.001),
        0.0082,
        { bevel: 0.0007, holes: [rect(-0.0014, -0.017, 0.0018, -0.005, 0.0008)] },
      );
      m.use(F.red);
      m.at([0, -0.014, -0.0038], null, () => m.box(0.0034, 0.016, 0.0028, 0.0006));
    });
  });

  const model = new Model(m, kit.mats, {
    glows: {
      sight: [0xff5522, 6],
      stickyLed: [0xff4412, 6.5],
    },
  });

  model.socket('muzzle', [0, BORE, MUZZLE - 0.008]);
  model.socket('muzzleLong', [0, BORE, MUZZLE_LONG - 0.008]);
  model.hand('gripR', [0.018, -0.056, 0.064], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.foregrip('gripL', [-0.016, BORE - 0.092, (DRUM_FRONT - 0.028 + MUZZLE) / 2 + 0.008]);
  model.hand('drumHold', [-0.022, 0.035, 0.028], [-0.15, 0.12, -0.98], [0.9, -0.2, -0.3], 'drum');
  model.hand('shellHold', [-0.032, 0.032, 0.036], [-0.12, 0.1, -0.98], [0.86, 0.25, -0.35], 'shellIn');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.08, 0.34);
  a.glow('sight', 1);

  // Pulsing red-amber armed LED on the Sticky Bomb telemetry pod when fitted.
  if (a.mods?.has('mglSticky')) {
    const pulse = 0.55 + 0.65 * (0.5 + 0.5 * Math.sin(a.time * 7.5));
    a.glow('stickyLed', pulse);
  }

  const p = a.reload;
  const shellIn = P.shellIn!;
  shellIn.visible = false;

  // Drum indexes 60° (Math.PI / 3) per shot while not reloading.
  const t = a.sinceFire;
  if (p < 0) {
    const idx = t < 0.22 ? inOut(seg(t, 0.04, 0.18)) - 1 : 0;
    P.drum!.rotation.z += (a.shots + idx) * STEP;
  }

  // Heavy hollow 40mm thoomp kick (straight back + pitch lift, zero roll).
  if (t < 0.22) {
    const k = bump(t, 0, 0.22);
    a.gunP.z += k * 0.02 * a.strength;
    a.gunR.x += k * 0.06 * a.strength;
  }

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.09;
    a.gunR.x -= k * 0.38;
  }

  if (p < 0) return;

  // Zero-roll reload: gun holds level (gunR.z === 0), shifts cleanly right/slightly up so the swung-out 6-chamber drum
  // sits clearly in the left-center of the frame while the left hand loads three fresh pairs of 40 mm shells.
  const open = inOut(seg(p, 0.04, 0.13)) * (1 - inQuad(seg(p, 0.73, 0.81)));
  const shut = p >= 0.81 ? thud(seg(p, 0.81, 0.90)) : 0;
  P.yoke!.rotation.z += open * CRANE_OPEN + shut * 0.045;

  // Subtle level presentation: pitch & translation only — strictly ZERO gunR.z roll across the entire reload!
  const present = hold(p, 0.01, 0.12, 0.82, 0.96);
  a.gunP.x += present * 0.045;
  a.gunP.y += present * 0.022 - shut * 0.008;
  a.gunP.z += present * 0.035;
  a.gunR.x += present * 0.09 - shut * 0.035;

  // Phase 1 (0.11..0.20): spent casings slide straight back out of all 6 open chambers and drop down out of frame.
  const dump = inQuad(seg(p, 0.11, 0.19));
  const drop = inQuad(seg(p, 0.14, 0.20));
  const dumped = p >= 0.20;

  // Phase 2 (three twin-shell loading beats synced to reloadFoley at 0.24, 0.42, 0.60):
  // Beat 0 seats rounds 0 & 1, Beat 1 seats rounds 2 & 3, Beat 2 seats rounds 4 & 5.
  // Between beats the drum indexes -2 * STEP (-120 deg) so the next empty pair rotates right under the loader.
  const idx1 = inOut(seg(p, 0.29, 0.37));
  const idx2 = inOut(seg(p, 0.47, 0.55));
  const idx3 = inOut(seg(p, 0.65, 0.73));
  P.drum!.rotation.z -= (idx1 + idx2 + idx3) * STEP * 2;

  // Seated visibility for each of the 6 individual chamber rounds.
  const seated = [p >= 0.25, p >= 0.25, p >= 0.43, p >= 0.43, p >= 0.61, p >= 0.61];
  for (let i = 0; i < 6; i++) {
    const r = P[`round${i}`]!;
    if (!dumped) {
      r.visible = true;
      r.position.z += dump * 0.075;
      r.position.y -= drop * 0.16;
    } else {
      r.visible = seated[i]!;
    }
  }

  // Hand-carried twin 40 mm shells (`shellIn`): rises from belt pouch and slides cleanly forward into the open chambers on each beat.
  const beats: readonly [number, number, number][] = [
    [0.18, 0.25, 0.29],
    [0.36, 0.43, 0.47],
    [0.54, 0.61, 0.65],
  ];
  let activeBeat = -1;
  for (let b = 0; b < beats.length; b++) {
    const [bStart, bSeat, bEnd] = beats[b]!;
    if (p >= bStart && p < bEnd) {
      activeBeat = b;
      const carry = outCubic(seg(p, bStart, bSeat - 0.03));
      const push = inOut(seg(p, bSeat - 0.035, bSeat));
      shellIn.visible = p < bSeat + 0.008;
      shellIn.position.x -= (1 - carry) * 0.085;
      shellIn.position.y -= (1 - carry) * 0.22;
      shellIn.position.z += (1 - carry) * 0.08 + (1 - push) * 0.095;
      shellIn.rotation.x += (1 - carry) * 0.35;
      break;
    }
  }

  // Left-hand choreography: crack drum open -> fetch & ram 3 pairs of 40 mm shells -> close drum -> return to foregrip.
  const h = a.left;
  h.fingerRate = 36;
  h.to('drumHold', inOut(seg(p, 0.02, 0.10)));
  h.to('pouchL', inOut(seg(p, 0.12, 0.18)));
  h.to('shellHold', inOut(seg(p, 0.18, 0.23)));
  h.to('pouchL', inOut(seg(p, 0.28, 0.35)));
  h.to('shellHold', inOut(seg(p, 0.36, 0.41)));
  h.to('pouchL', inOut(seg(p, 0.46, 0.53)));
  h.to('shellHold', inOut(seg(p, 0.54, 0.59)));
  h.to('drumHold', inOut(seg(p, 0.66, 0.74)));
  h.to('gripL', inOut(seg(p, 0.83, 0.95)));
  h.shape(HANDS.cup, activeBeat >= 0 ? 1 : hold(p, 0.04, 0.10, 0.74, 0.83));
}

export function mglDef(kit: Kit): ViewDef {
  return {
    id: 'mgl',
    model: buildMgl(kit),
    pos: [0.165, -0.175, -0.43],
    rot: [0.022, 0.068, 0],
    sight: [0, 0.168, -0.055],
    relief: 0.46,
    recoil: { back: 0.055, lift: 0.018, pitch: 0.14, yaw: 0.018, roll: 0, omega: 24, zeta: 0.58 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.04,
    mods: {
      mglSticky: { part: 'stickyPod' },
      mglLong: { part: 'barrelLong', muzzle: 'muzzleLong' },
      mglTrigger: { part: 'triggerMatch', hides: 'triggerStd', also: 'triggerHousing' },
    },
    animate: clip,
  };
}
