/**
 * Milkor MGL: a chunky 6-shot revolving 40 mm grenade launcher on key 3.
 *
 * A wide 6-chamber revolving cylinder drum with visible 40 mm olive/brass rounds, short heavy ribbed 40 mm barrel
 * with quad-rail shroud, vertical foregrip, top rail with glowing reflex sight, and telescoping buttstock.
 *
 * Each shot indexes the drum 60° (Math.PI / 3); reloading swings the front yoke open, dumps empties, indexes fresh
 * 40 mm grenades in, and snaps the drum shut. The `mglSticky` shop mod mounts a left-flank remote detonator telemetry
 * pod with a pulsing red-amber armed LED strip. Origin at the top of the pistol grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly } from '../kit/shapes';
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
const STEP = Math.PI / 3;

const OLIVE: Finish = { color: 0x4b563c, rough: 0.56, metal: 0.14, wear: 0.12 };
const DRUM_STEEL: Finish = { color: 0x35393f, rough: 0.36, metal: 0.82, wear: 0.16 };

/** Rear receiver frame, pistol grip, trigger guard, telescoping stock, and top reflex sight. */
function receiver(m: Mesher): void {
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

  // Top bridge rail over the drum + rear sight base.
  m.use(F.steelDark);
  m.at([0, 0.131, -0.122], null, () => m.box(0.032, 0.014, 0.25, 0.002, 0.003));
  m.at([0, 0.138, 0], null, () => rail(m, 0.09, -0.23, 0.022, F.steelDark));

  // Milkor occluded/reflex grenade sight perched on the top rail, with glowing amber-red dot.
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

  // Receiver side hardware + existing decals only (crucible, serial, hazard).
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
}

/**
 * Hinged front yoke: swings open left during reload, carrying the 6-chamber revolving 40 mm drum,
 * short heavy ribbed barrel, quad-rail handguard, and vertical foregrip.
 */
function yokeAndDrum(m: Mesher): void {
  // Hinge pin on the left underside of the front bulkhead.
  m.part('yoke', [-0.056, 0.018, DRUM_BACK + 0.002], () => {
    const ox = 0.056;
    const oy = -0.018;
    const oz = -(DRUM_BACK + 0.002);

    // Front drum bulkhead & pivot yoke arm.
    m.use(F.parkerized);
    m.at([0, 0, -0.012], null, () => m.cyl(0.009, 0.032, 12, 0.001));
    m.at([ox, CYL_Y + oy, DRUM_FRONT - 0.016 + oz], null, () => m.cyl(DRUM_R + 0.005, 0.028, 24, 0.002));
    // Lower tie bar joining rear hinge to front bulkhead.
    m.at([ox, CYL_Y - DRUM_R - 0.006 + oy, DRUM_MID + oz], null, () => m.box(0.034, 0.018, DRUM_BACK - DRUM_FRONT + 0.042, 0.002));
    // Hazard stencil on the left side of the front bulkhead collar.
    m.at([ox - DRUM_R - 0.0056, CYL_Y + oy, DRUM_FRONT - 0.016 + oz], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.024, 0.014, 0xf0c428));

    // Revolving 6-chamber 40 mm cylinder drum (rotates 60° / Math.PI/3 per shot).
    m.part('drum', [ox, CYL_Y + oy, DRUM_MID + oz], () => {
      const len = DRUM_BACK - DRUM_FRONT - 0.006;
      const half = len / 2;
      // Central spindle hub.
      m.use(F.steelDark);
      m.cyl(0.017, len + 0.012, 16, 0.0012);
      // Six distinct 40 mm chamber tubes arranged in a bold scalloped revolver cluster.
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + i * STEP;
        const cx = Math.cos(a) * CHAMBER_R;
        const cy = Math.sin(a) * CHAMBER_R;
        m.at([cx, cy, 0], null, () => {
          m.use(DRUM_STEEL);
          m.cyl(0.0255, len, 14, 0.0014);
          // Front dark 40 mm chamber mouth.
          m.use(F.black);
          m.at([0, 0, -half - 0.0005], null, () => m.cyl(0.0205, 0.002, 12, 0));
          // Visible olive 40 mm grenade ogive nose inside the front of the chamber.
          m.use(OLIVE);
          m.at([0, 0, -half + 0.016], null, () => m.cyl(0.0185, 0.018, 12, 0.002));
        });
      }
      // Reinforced mid-drum retaining band.
      m.use(F.anodized);
      m.cyl(DRUM_R - 0.004, 0.016, 24, 0.0012);

      // Visible 40 mm brass cartridge rims & primers at the rear of the drum (slide out & reload during reload clip).
      m.part('rounds', [0, 0, half], () => {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 2 + i * STEP;
          const cx = Math.cos(a) * CHAMBER_R;
          const cy = Math.sin(a) * CHAMBER_R;
          m.at([cx, cy, 0], null, () => {
            m.use(F.brass);
            m.at([0, 0, 0.002], null, () => m.cyl(0.0218, 0.006, 12, 0.0008));
            m.use(OLIVE);
            m.at([0, 0, -0.022], null, () => m.cyl(0.0196, 0.044, 12, 0.001));
            m.use(F.steel);
            m.at([0, 0, 0.0054], null, () => m.cyl(0.0055, 0.001, 10, 0));
          });
        }
      });
    });

    // Short heavy ribbed 40 mm barrel ahead of the front bulkhead.
    const bStart = DRUM_FRONT - 0.028 + oz;
    const bEnd = MUZZLE + oz;
    const bMid = (bStart + bEnd) / 2;
    const bLen = bStart - bEnd;
    m.at([ox, BORE + oy, 0], null, () => {
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
    m.at([ox, BORE - 0.04 + oy, bMid + 0.008], null, () => {
      m.use(F.steelDark);
      m.box(0.028, 0.014, 0.036, 0.0015);
      m.use(F.polymerStipple);
      m.at([0, -0.052, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0165, 0.095, 14, 0.002));
      m.use(F.rubber);
      m.at([0, -0.102, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0185, 0.012, 14, 0.002));
    });
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
  receiver(m);
  yokeAndDrum(m);
  stickyPod(m);

  m.part('trigger', [0, 0.002, -0.002], () => {
    m.use(F.steelDark);
    m.side(
      poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.004, -0.022, 0.0015], [0.0006, -0.023, 0.001], [-0.0035, -0.01, 0.003]], 0.001),
      0.007,
      { bevel: 0.0007 },
    );
  });

  const model = new Model(m, kit.mats, {
    glows: {
      sight: [0xff5522, 6],
      stickyLed: [0xff4412, 6.5],
    },
  });

  model.socket('muzzle', [0, BORE, MUZZLE - 0.008]);
  model.hand('gripR', [0.018, -0.056, 0.064], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.foregrip('gripL', [0.056 - 0.016, BORE - 0.018 - 0.092, (DRUM_FRONT - 0.028 + MUZZLE) / 2 - (DRUM_BACK + 0.002) + 0.008], 'yoke');
  model.hand('drumHold', [0.01, 0.04, 0.04], [-0.2, 0.15, -0.96], [0.88, -0.25, -0.35], 'drum');
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

  // Drum indexes 60° (Math.PI / 3) per shot, snapping smoothly right after ignition.
  const t = a.sinceFire;
  const idx = t < 0.22 ? inOut(seg(t, 0.04, 0.18)) - 1 : 0;
  P.drum!.rotation.z += (a.shots + idx) * STEP;

  // Heavy hollow 40mm thoomp kick.
  if (t < 0.22) {
    const k = bump(t, 0, 0.22);
    a.gunP.z += k * 0.02 * a.strength;
    a.gunR.x += k * 0.06 * a.strength;
  }

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.09;
    a.gunR.x -= k * 0.42;
    a.gunR.z -= k * 0.18;
  }

  const p = a.reload;
  if (p < 0) return;

  // Swing front yoke open left, dump empties, index drum while loading fresh 40 mm shells, then snap shut.
  const open = inOut(seg(p, 0.04, 0.16)) * (1 - inQuad(seg(p, 0.74, 0.84)));
  const shut = p >= 0.84 ? thud(seg(p, 0.84, 0.94)) : 0;
  P.yoke!.rotation.z += open * 1.15 + shut * 0.06;

  // Empties back out, fresh rounds slide in, drum winds forward 3 chambers as shells seat.
  const out = inQuad(seg(p, 0.15, 0.24));
  const seat = outCubic(seg(p, 0.54, 0.68));
  const rounds = P.rounds!;
  rounds.position.z += out * (1 - seat) * 0.045;
  if (p >= 0.24 && p < 0.34) rounds.visible = false;
  P.drum!.rotation.z += inOut(seg(p, 0.24, 0.72)) * STEP * 3;

  const present = hold(p, 0.02, 0.14, 0.8, 0.94);
  a.gunR.z += present * 0.34 - shut * 0.08;
  a.gunR.x += present * 0.12;
  a.gunP.x -= present * 0.045;
  a.gunP.y += present * 0.025;

  const h = a.left;
  h.fingerRate = 36;
  h.to('drumHold', inOut(seg(p, 0.06, 0.18)));
  h.to('pouchL', inOut(seg(p, 0.26, 0.36)));
  h.to('drumHold', inOut(seg(p, 0.42, 0.54)));
  h.to('gripL', inOut(seg(p, 0.76, 0.92)));
  h.shape(HANDS.cup, hold(p, 0.08, 0.18, 0.68, 0.78));
}

export function mglDef(kit: Kit): ViewDef {
  return {
    id: 'mgl',
    model: buildMgl(kit),
    pos: [0.165, -0.175, -0.43],
    rot: [0.022, 0.068, 0],
    sight: [0, 0.168, -0.055],
    relief: 0.46,
    recoil: { back: 0.055, lift: 0.018, pitch: 0.14, yaw: 0.018, roll: 0.03, omega: 24, zeta: 0.58 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.04,
    mods: {
      mglSticky: { part: 'stickyPod' },
    },
    animate: clip,
  };
}
