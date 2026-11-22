/**
 * Metal Storm: a 36-barrel electronically-fired stacked-projectile weapon on key 8.
 *
 * A monolithic 6×6 block of dark gunmetal barrels clamped inside a heavy industrial frame, wired by exposed copper and
 * brass ignition bus bars, with zero moving bolt or ejection port. A rear OLED readout and a four-segment LED strip
 * track the active electronic fire rate (600 / 3.6K / 60K / 1M RPM) through `Anim.charge`.
 *
 * The `metalstorm40mm` (40mm FireStorm) shop mod swaps the 6×6 slim barrel block for a chunky 3×3 40 mm grenade matrix
 * wrapped in brass breech rings and hazard-stripe shrouding. Origin at the top of the pistol grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, poly } from '../kit/shapes';
import { hexX, rail, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const BORE = 0.068;
/** Half width of the main electronic chassis. */
const HALF = 0.044;
const CHASSIS_FRONT = -0.17;
const MUZZLE = -0.64;

const RPM_LABELS = ['600 RPM', '3.6K RPM', '60K RPM', '1M RPM'] as const;
const RPM_COLORS = ['#35e8ff', '#44ff99', '#ffaa22', '#ff3b2a'] as const;

function rateTier(charge: number): number {
  return Math.max(0, Math.min(3, Math.round(charge * 3)));
}

function chassis(m: Mesher): void {
  // Heavy squared electronic receiver housing, deeper than a rifle to back the 6×6 barrel matrix.
  m.use(F.parkerized);
  m.side(
    poly([
      [0.165, 0.008], [0.168, 0.114, 0.006], [0.148, 0.128, 0.006],
      [CHASSIS_FRONT, 0.128, 0.004], [CHASSIS_FRONT, 0.008, 0.004],
    ], 0.003),
    HALF * 2,
    { bevel: 0.0028 },
  );

  // Heavy bulkhead plate where the stacked barrel block bolts onto the ignition manifold.
  m.use(F.steelDark);
  m.at([0, BORE, CHASSIS_FRONT - 0.014], null, () => m.box(HALF * 2 + 0.022, 0.126, 0.032, 0.003, 0.005));

  // Side reinforcement ribs, rivets, and copper/brass electronic bus conduits.
  m.mirror(() => {
    m.use(F.anodized);
    m.at([HALF + 0.002, 0.068, -0.01], null, () => m.box(0.005, 0.072, 0.28, 0.0014, 0.002));
    // Copper high-voltage ignition bus rail along each flank.
    m.use(F.copperCoil);
    m.at([HALF + 0.0065, 0.092, -0.01], null, () => m.box(0.0045, 0.011, 0.30, 0.001));
    m.use(F.brass);
    for (let i = 0; i < 4; i++) {
      m.at([HALF + 0.0085, 0.092, 0.10 - i * 0.075], null, () => m.box(0.004, 0.015, 0.012, 0.0008));
    }
    for (let i = 0; i < 5; i++) screwX(m, HALF + 0.0046, 0.036, 0.12 - i * 0.064, 1, 0.0026);
    hexX(m, HALF + 0.0046, 0.068, 0.135, 1, 0.005);
    hexX(m, HALF + 0.0046, 0.068, -0.145, 1, 0.005);
  });

  // Existing decals only (crucible + serial) on the left flank facing the shooter.
  m.at([-(HALF + 0.0052), 0.066, 0.06], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.078, 0.015, 0xc8ced6));
  m.at([-(HALF + 0.0052), 0.044, -0.08], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.055, 0.0062, 0x9aa2aa));

  // Rear capacitor buttplate and rubber shoulder pad.
  m.use(F.steelDark);
  m.at([0, 0.068, 0.174], null, () => m.box(HALF * 2 + 0.006, 0.114, 0.016, 0.0025, 0.004));
  m.use(F.rubber);
  m.at([0, 0.064, 0.194], null, () => m.box(0.074, 0.112, 0.024, 0.005, 0.008));

  // Top tactical rail ahead of the electronic console, plus angled fire-control console facing the eye.
  m.at([0, 0.128, 0], null, () => rail(m, -0.155, -0.015, 0.022, F.steelDark));

  // Rear angled electronic console: OLED readout + 4 glowing RPM-tier LED bars.
  m.use(F.steelDark);
  m.at([0, 0.134, 0.078], [-0.32, 0, 0], () => {
    m.box(0.074, 0.022, 0.082, 0.002, 0.003);
    // Bezel frame around the screen.
    m.use(F.black);
    m.at([0, 0.0114, -0.006], [-Math.PI / 2, 0, 0], () => m.box(0.062, 0.026, 0.0012, 0));
    m.at([0, 0.0124, -0.006], [-Math.PI / 2, 0, 0], () => m.screen('ammo', 0.058, 0.022));
    // 4-segment electronic RPM indicator LED strip just behind the OLED screen.
    const names = ['led0', 'led1', 'led2', 'led3'] as const;
    for (let i = 0; i < 4; i++) {
      const x = -0.0225 + i * 0.015;
      m.glow(names[i]!, () => m.at([x, 0.0122, 0.022], null, () => m.box(0.0115, 0.0024, 0.009, 0)));
    }
  });

  // Front iron sight post on top of the front manifold collar.
  m.use(F.steelDark);
  m.at([0, 0.132, CHASSIS_FRONT - 0.014], null, () => {
    m.box(0.018, 0.014, 0.022, 0.0012);
    m.glow('sight', () => m.at([0, 0.009, 0.0115], null, () => m.box(0.0032, 0.007, 0.0008, 0)));
  });

  // Lower fire-control housing, pistol grip, trigger guard, and front angled foregrip.
  m.use(F.parkerized);
  m.side(poly([[0.105, 0.009], [0.108, -0.004, 0.004], [0.088, -0.014, 0.004], [-0.048, -0.014, 0.003], [-0.054, 0.009]], 0.002), 0.044, { bevel: 0.0018 });
  const front = curve([[0.02, -0.004], [0.022, -0.026], [0.028, -0.046], [0.032, -0.066], [0.04, -0.09], [0.046, -0.118]], 4);
  const back = curve([[0.102, -0.118], [0.096, -0.082], [0.088, -0.046], [0.08, -0.018], [0.075, -0.004]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.048, -0.124], [0.10, -0.124], ...back], 0.036, { bevel: 0.0042, smooth: 50 });
  m.use(F.steelDark);
  m.at([0, -0.126, 0.074], null, () => m.box(0.036, 0.005, 0.056, 0.0012, 0.002));
  const guardOut = poly([[-0.038, -0.012], [-0.042, -0.035, 0.006], [-0.024, -0.048, 0.008], [0.028, -0.048, 0.008], [0.048, -0.016, 0.004], [0.048, -0.012]], 0.002);
  const guardIn = poly([[-0.034, -0.014], [-0.037, -0.033, 0.005], [-0.022, -0.044, 0.005], [0.025, -0.044, 0.005], [0.044, -0.016, 0.003], [0.044, -0.014]], 0.002);
  m.side(guardOut, 0.014, { bevel: 0.0009, holes: [guardIn] });

  // Heavy lower support rail + vertical foregrip under the stacked barrel matrix.
  m.use(F.steelDark);
  m.at([0, 0.002, -0.34], null, () => m.box(0.052, 0.018, 0.28, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, -0.008, -0.35], null, () => {
    const f = curve([[-0.02, 0], [-0.024, -0.032], [-0.024, -0.064], [-0.019, -0.102]], 4);
    const b = curve([[0.023, -0.102], [0.026, -0.064], [0.024, -0.032], [0.02, 0]], 4);
    m.side([...f, ...b], 0.034, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.steelDark);
  m.at([0, -0.112, -0.348], null, () => m.box(0.036, 0.006, 0.048, 0.0012, 0.002));
}

function powerPack(m: Mesher): void {
  // Detachable bottom stacked-cassette & ignition capacitor pack swapped during reload.
  m.part('pack', [0, -0.022, -0.14], () => {
    m.use(F.anodizedGrey);
    m.box(0.072, 0.064, 0.132, 0.003, 0.005);
    m.use(F.copper);
    m.mirror(() => m.at([0.037, 0.01, 0], null, () => m.box(0.003, 0.016, 0.104, 0.0006)));
    m.use(F.steelDark);
    m.at([0, -0.033, 0], null, () => m.box(0.076, 0.008, 0.136, 0.002));
    m.at([-0.0368, -0.008, 0], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.09, 0.014, 0xe8c238));
  });
}

function barrels36(m: Mesher): void {
  // Standard 6×6 = 36-barrel stacked-projectile block with copper/brass electronic ignition bus bars.
  m.part('barrelsStd', [0, BORE, 0], () => {
    const start = CHASSIS_FRONT - 0.02;
    const len = start - MUZZLE;
    const mid = (start + MUZZLE) / 2;
    const pitch = 0.0156;
    const offset = -2.5 * pitch;

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const x = offset + col * pitch;
        const y = offset + row * pitch;
        m.at([x, y, mid], null, () => {
          m.use(F.barrel);
          m.cyl(0.0064, len, 10);
        });
        m.at([x, y, MUZZLE - 0.0004], null, () => {
          m.use(F.black);
          m.cyl(0.0042, 0.003, 8, 0);
        });
      }
    }

    // Three heavy machined steel manifold bulkheads clamping all 36 barrels into one rigid block.
    const clamps = [CHASSIS_FRONT - 0.07, -0.39, MUZZLE + 0.032];
    for (const z of clamps) {
      m.use(F.steelDark);
      m.at([0, 0, z], null, () => m.box(0.106, 0.106, 0.022, 0.003, 0.004));
      // Brass contact collar on each bulkhead.
      m.use(F.brass);
      m.at([0, 0, z], null, () => m.box(0.110, 0.016, 0.012, 0.001));
    }

    // Exposed copper ignition bus bars bridging the bulkheads along top and both flanks.
    m.use(F.copperCoil);
    m.mirror(() => {
      m.at([0.055, 0.026, mid + 0.01], null, () => m.box(0.0055, 0.011, len - 0.04, 0.001));
      m.at([0.055, -0.026, mid + 0.01], null, () => m.box(0.0055, 0.011, len - 0.04, 0.001));
    });
    m.at([-0.026, 0.055, mid + 0.01], null, () => m.box(0.011, 0.0055, len - 0.04, 0.001));
    m.at([0.026, 0.055, mid + 0.01], null, () => m.box(0.011, 0.0055, len - 0.04, 0.001));
  });
}

function barrels40mm(m: Mesher): void {
  // 40mm FireStorm shop mod: swaps the 6×6 slim barrels for a chunky 3×3 40 mm HE grenade launcher matrix.
  m.part('barrels40mm', [0, BORE, 0], () => {
    const start = CHASSIS_FRONT - 0.02;
    const muzzle40 = MUZZLE + 0.04;
    const len = start - muzzle40;
    const mid = (start + muzzle40) / 2;
    const pitch = 0.035;

    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        const x = col * pitch;
        const y = row * pitch;
        m.at([x, y, 0], null, () => {
          m.use(F.barrelBlack);
          m.lathe([
            [0.0162, start, 0],
            [0.0162, start - 0.055],
            [0.0152, start - 0.062],
            [0.0152, muzzle40 + 0.016],
            [0.0166, muzzle40 + 0.012],
            [0.0166, muzzle40],
            [0.0124, muzzle40 + 0.004, 0],
          ], 14);
          m.use(F.black);
          m.at([0, 0, muzzle40 + 0.003], null, () => m.cyl(0.0122, 0.012, 12, 0));
          // Heavy brass 40mm ignition band near the breech.
          m.use(F.brass);
          m.at([0, 0, start - 0.08], null, () => m.cyl(0.0164, 0.014, 14));
        });
      }
    }

    // Reinforced blast shroud plates with unmistakable hazard-stripe accents.
    m.use(F.steelDark);
    m.at([0, 0, start - 0.06], null, () => m.box(0.116, 0.116, 0.028, 0.003, 0.005));
    m.at([0, 0, muzzle40 + 0.045], null, () => m.box(0.118, 0.118, 0.032, 0.003, 0.005));
    m.mirror(() => {
      m.use(F.parkerized);
      m.at([0.060, 0, mid], null, () => m.box(0.007, 0.092, len - 0.08, 0.0015));
      m.at([0.0642, 0, mid], [0, Math.PI / 2, 0], () => m.decal('hazard', 0.18, 0.024, 0xf0c428));
    });
    // Left-flank hazard stripe oriented for first-person view.
    m.at([-0.0642, 0, mid], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.18, 0.024, 0xf0c428));
    m.use(F.copperCoil);
    m.at([0, 0.061, mid], null, () => m.box(0.034, 0.006, len - 0.06, 0.001));
  });
}

function buildMetalStorm(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  chassis(m);
  powerPack(m);
  barrels36(m);
  barrels40mm(m);

  m.part('trigger', [0, -0.013, -0.002], () => {
    m.use(F.steelDark);
    m.side(
      poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.022, 0.0015], [0.0005, -0.023, 0.001], [-0.0035, -0.0095, 0.003]], 0.001),
      0.0072,
      { bevel: 0.0007 },
    );
  });

  const model = new Model(m, kit.mats, {
    glows: {
      sight: [0x35e8ff, 4.5],
      led0: [0x35e8ff, 5],
      led1: [0x44ff99, 5],
      led2: [0xffaa22, 5.5],
      led3: [0xff3b2a, 7],
    },
    screens: { ammo: [192, 72] },
  });

  // Four quadrant muzzle sockets across the 36-barrel matrix so bursts flash across the whole face.
  model.socket('muzzle', [-0.026, BORE + 0.026, MUZZLE - 0.006]);
  model.socket('muzzle1', [0.026, BORE + 0.026, MUZZLE - 0.006]);
  model.socket('muzzle2', [-0.026, BORE - 0.026, MUZZLE - 0.006]);
  model.socket('muzzle3', [0.026, BORE - 0.026, MUZZLE - 0.006]);
  model.socket('muzzle40mm', [0, BORE, MUZZLE + 0.034]);
  model.hand('gripR', [0.018, -0.056, 0.072], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.foregrip('gripL', [-0.018, -0.062, -0.35]);
  model.hand('packHold', [-0.042, -0.01, 0.01], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'pack');
  return model;
}

function drawReadout(a: Anim): void {
  const s = a.model!.screens.ammo;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const tier = rateTier(a.charge);
  const col = RPM_COLORS[tier]!;
  const is40 = a.mods?.has('metalstorm40mm') === true;

  g.fillStyle = '#041016';
  g.fillRect(0, 0, w, h);

  // Top line: active RPM mode + 40MM badge when modded.
  g.fillStyle = col;
  g.font = '800 19px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(is40 ? `40MM ${RPM_LABELS[tier]}` : RPM_LABELS[tier]!, 8, 6);

  // Bottom line: stacked round count + charge bar.
  g.fillStyle = a.mag <= a.magSize * 0.2 ? '#ff3a2a' : col;
  g.font = '800 30px "Courier New", monospace';
  g.textBaseline = 'bottom';
  g.fillText(String(a.mag).padStart(3, '0'), 8, h - 6);

  const x0 = 76;
  const segs = 10;
  const lit = Math.ceil(fill(a) * segs);
  const step = (w - x0 - 8) / segs;
  for (let i = 0; i < segs; i++) {
    g.globalAlpha = i < lit ? 1 : 0.16;
    g.fillRect(x0 + i * step, h - 28, step * 0.72, 20);
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.06, 0.28);

  // Rate-indicator LED strip: shifts color & intensity with RPM mode (600 / 3.6K / 60K / 1M RPM).
  const tier = rateTier(a.charge);
  const pulse = tier === 3 ? 0.85 + 0.45 * Math.sin(a.time * 16) : 1;
  a.glow('sight', 1);
  a.glow('led0', tier >= 0 ? 1.0 : 0.06);
  a.glow('led1', tier >= 1 ? 1.1 : 0.06);
  a.glow('led2', tier >= 2 ? 1.25 : 0.06);
  a.glow('led3', tier >= 3 ? 1.6 * pulse : 0.06);

  // Electronic recoil tremor (zero reciprocating bolt, pure impulse straight back into the shoulder).
  const jolt = a.sinceFire < 0.14 ? bump(a.sinceFire, 0, 0.14) : 0;
  a.gunP.z += jolt * 0.012 * a.strength;
  a.gunR.z -= jolt * 0.018 * a.strength;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.085;
    a.gunR.x -= k * 0.4;
    a.gunR.z -= k * 0.2;
  }

  const p = a.reload;
  if (p < 0) return;
  // Swap the bottom capacitor / stacked-cassette pack: tilt left, drop spent pack, seat fresh pack, lock.
  const out = inQuad(seg(p, 0.08, 0.28));
  const inn = outCubic(seg(p, 0.42, 0.58));
  const away = out * (1 - inn);
  const pack = P.pack!;
  pack.position.y -= away * 0.36;
  pack.position.x -= away * 0.06;
  pack.rotation.z += away * 0.35;
  if (p > 0.29 && p < 0.42) pack.visible = false;

  const seat = p >= 0.56 ? thud(seg(p, 0.56, 0.68)) : 0;
  const boot = p >= 0.8 ? bump(p, 0.8, 0.92) : 0;
  const present = hold(p, 0.0, 0.14, 0.88, 1);
  a.gunR.z -= present * 0.36 + seat * 0.05;
  a.gunR.x += present * 0.12 - seat * 0.04;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.03 - seat * 0.01 + boot * 0.006;

  const h = a.left;
  h.fingerRate = 34;
  h.to('packHold', inOut(seg(p, 0.0, 0.1)));
  h.to('pouchL', inOut(seg(p, 0.24, 0.36)));
  h.to('packHold', inOut(seg(p, 0.4, 0.54)));
  h.to('gripL', inOut(seg(p, 0.72, 0.92)));
  h.shape(HANDS.cup, hold(p, 0.08, 0.16, 0.62, 0.7));
}

export function metalstormDef(kit: Kit): ViewDef {
  return {
    id: 'metalstorm',
    model: buildMetalStorm(kit),
    pos: [0.18, -0.172, -0.41],
    rot: [0.024, 0.072, 0],
    sight: [0, 0.142, CHASSIS_FRONT - 0.014],
    rear: [0, 0.15, 0.06],
    relief: 0.58,
    recoil: { back: 0.046, lift: 0.004, pitch: 0.008, yaw: 0.006, roll: 0.01, omega: 38, zeta: 0.55 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.016,
    mods: {
      metalstorm40mm: { part: 'barrels40mm', hides: 'barrelsStd', muzzle: 'muzzle40mm' },
    },
    animate: clip,
    readout: drawReadout,
  };
}
