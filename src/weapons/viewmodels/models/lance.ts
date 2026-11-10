/**
 * The Lance: a railgun built like laboratory kit. Ceramic-white shell, two open rails lined with copper, coil packs
 * clamped along them, and a bank of four glass capacitors on the shoulder that fill one by one as the trigger is held.
 * The rails are open to the air, so the charge has nowhere to hide. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, rect, slotRow } from '../kit/shapes';
import { coil, rail, screwX } from '../kit/details';
import { clamp, lerp } from '../../../core/math';
import { TUNING } from '../../data';
import { hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

/** The charge each stage of the beam is reached at (src/weapons/lance.ts). A capacitor fills on the way to each. */
const STAGE_AT: readonly number[] = TUNING.lance.stages.map(s => s.at);
/** Seconds a capacitor flares white, and the gun jolts, as its stage lands. */
const STAGE_POP = 0.16;
/** Hum in the hands by stage reached: none, first, second, full. Metres. */
const HUM = [0, 0.0004, 0.001, 0.0034] as const;

const BORE = 0.074;
const RAIL_Z0 = -0.17;
const RAIL_Z1 = -0.74;
const CERAMIC: Finish = { color: 0xc4c8cc, rough: 0.42, metal: 0.04, wear: 0.9 };
const CERAMIC_DARK: Finish = { color: 0x2b2e34, rough: 0.5, metal: 0.2, wear: 0.5 };
const CAPS = ['cap0', 'cap1', 'cap2', 'cap3'] as const;

function body(m: Mesher): void {
  m.use(CERAMIC);
  // Bullpup slab: the mass sits behind the grip, the rails run clear in front of it.
  m.side(poly([[0.27, 0.01], [0.28, 0.1, 0.012], [0.25, 0.128, 0.014], [0.06, 0.13, 0.02], [-0.1, 0.122, 0.02], [-0.18, 0.106, 0.008], [-0.195, 0.048, 0.006], [-0.17, 0.014, 0.012], [-0.06, 0.004, 0.012]], 0.004), 0.066, { bevel: 0.0028, smooth: 34 });
  // Dark inset panels break up the white.
  const flank = poly([[0.24, 0.03], [0.245, 0.092, 0.01], [0.21, 0.11, 0.01], [0.09, 0.112, 0.012], [-0.05, 0.106, 0.012], [-0.12, 0.092, 0.006], [-0.12, 0.03, 0.01]], 0.003);
  m.use(CERAMIC_DARK);
  m.mirror(() => m.at([0.0322, 0, 0], null, () => m.side(flank, 0.0028, { bevel: 0.0008, holes: [...slotRow(0.17, 0.05, 0.225, 0.05, 5, 0.03, 0.0052, Math.PI / 2)] })));
  m.use(F.black);
  m.mirror(() => m.at([0.0314, 0.05, 0.198], null, () => m.box(0.0012, 0.036, 0.074, 0)));
  m.mirror(() => {
    screwX(m, 0.0336, 0.1, 0.2, 1, 0.0022);
    screwX(m, 0.0336, 0.04, -0.1, 1, 0.0022);
    screwX(m, 0.0336, 0.04, 0.23, 1, 0.0022);
  });
  m.at([-0.0338, 0.086, 0.16], [0, -Math.PI / 2, 0], () => m.decal('lance', 0.074, 0.0145, 0x3fd0e6));
  m.at([-0.0338, 0.041, 0.14], [0, -Math.PI / 2, 0], () => m.decal('hv', 0.066, 0.01, 0xd8c35a));
  m.at([-0.0338, 0.041, 0.075], [0, -Math.PI / 2, 0], () => m.decal('warn', 0.015, 0.015, 0xd8c35a));

  // Grip, guard and stock pad.
  m.use(F.polymerStipple);
  const front = curve([[0.02, 0.006], [0.021, -0.02], [0.028, -0.05], [0.036, -0.078], [0.044, -0.108]], 4);
  const back = curve([[0.098, -0.108], [0.094, -0.078], [0.086, -0.042], [0.082, 0.006]], 4);
  m.side([...front, [0.046, -0.114], [0.096, -0.114], ...back], 0.032, { bevel: 0.0036, smooth: 50 });
  m.use(CERAMIC_DARK);
  m.at([0, -0.1165, 0.071], null, () => m.box(0.033, 0.006, 0.056, 0.0014, 0.003));
  m.side(poly([[-0.04, 0.006], [-0.044, -0.018, 0.006], [-0.026, -0.034, 0.008], [0.03, -0.034, 0.008], [0.05, -0.006, 0.004], [0.05, 0.006]], 0.002), 0.0125, {
    bevel: 0.0012,
    holes: [poly([[-0.035, 0.002], [-0.037, -0.016, 0.005], [-0.023, -0.0285, 0.005], [0.022, -0.0285, 0.005], [0.041, -0.0055, 0.003], [0.042, 0.002]], 0.002)],
  });
  m.use(F.rubber);
  m.at([0, 0.056, 0.292], null, () => m.front(rect(-0.032, -0.048, 0.032, 0.048, 0.012), 0.026, { bevel: 0.0036 }));

  // Rail on the shoulder for the optic, and a low collimator with its own charge arc.
  m.use(F.anodized);
  m.at([0, 0.1315, 0.09], null, () => rail(m, 0.075, -0.075, 0.0212, F.anodized));
  m.at([0, 0.139, 0.09], null, () => {
    m.use(CERAMIC_DARK);
    m.at([0, 0.006, 0], null, () => m.box(0.032, 0.012, 0.05, 0.0014, 0.003));
    const frameO = poly([[-0.021, 0.0], [0.021, 0.0], [0.024, 0.03, 0.008], [0.012, 0.042, 0.005], [-0.012, 0.042, 0.005], [-0.024, 0.03, 0.008]], 0.002);
    const frameI = poly([[-0.0172, 0.004], [0.0172, 0.004], [0.0196, 0.028, 0.006], [0.0098, 0.038, 0.004], [-0.0098, 0.038, 0.004], [-0.0196, 0.028, 0.006]], 0.002);
    m.at([0, 0.012, 0], null, () => m.front(frameO, 0.018, { bevel: 0.0012, holes: [frameI] }));
    m.glass(() => m.at([0, 0.012, -0.002], null, () => m.front(frameI, 0.001, { bevel: 0 })));
    m.glow('sight', () => m.at([0, 0.032, -0.0015], null, () => {
      m.prism(rect(-0.0009, -0.0009, 0.0009, 0.0009, 0), 0.0002, { bevel: 0 });
      for (const s of [-1, 1]) m.at([s * 0.0078, 0, 0], null, () => m.prism(rect(-0.0028, -0.0004, 0.0028, 0.0004, 0), 0.0002, { bevel: 0 }));
    }));
  });
  // Charge screen tilted to the eye.
  m.at([0.0, 0.1255, 0.215], [-Math.PI / 2 + 0.2, 0, 0], () => {
    m.use(CERAMIC_DARK);
    m.prism(rect(-0.022, -0.036, 0.022, 0.036, 0.003), 0.003, { bevel: 0.0009 });
    m.use(F.black);
    m.at([0, 0, 0.0012], null, () => m.prism(rect(-0.0195, -0.0335, 0.0195, 0.0335, 0.0014), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.0021], [0, 0, Math.PI / 2], () => m.screen('charge', 0.063, 0.036));
  });
}

function caps(m: Mesher): void {
  // Four capacitors on the left shoulder: end caps, glass sleeves, a core that lights as it fills.
  const x = -0.0515;
  const y = 0.094;
  m.use(CERAMIC_DARK);
  m.at([x + 0.012, y - 0.008, 0.0], null, () => m.box(0.018, 0.024, 0.27, 0.002, 0.004));
  for (let i = 0; i < CAPS.length; i++) {
    const z = 0.1 - i * 0.066;
    m.at([x, y, z], null, () => {
      m.use(F.steel);
      m.lathe([[0.0072, 0.03, 0], [0.0138, 0.03], [0.0138, 0.022], [0.0122, 0.0205, 0]], 18);
      m.lathe([[0.0122, -0.0205, 0], [0.0138, -0.022], [0.0138, -0.03], [0.0072, -0.03, 0]], 18);
      m.use(F.copper);
      m.lathe([[0.0045, 0.033, 0], [0.0045, 0.03, 0]], 10);
      m.glow(CAPS[i]!, () => m.lathe([[0, 0.0205, 0], [0.0074, 0.0205], [0.0074, -0.0205], [0, -0.0205, 0]], 12, { chamfer: 0 }));
      m.use(F.copperCoil);
      coil(m, 0.0084, 0.0007, 0.037, 9, F.copperCoil);
      m.glass(() => m.lathe([[0.0122, 0.0205, 0], [0.0122, -0.0205, 0]], 18, { chamfer: 0 }));
    });
  }
  // Bus bar tying them together.
  m.use(F.copper);
  m.at([x + 0.0015, y + 0.0165, 0.0], null, () => m.box(0.008, 0.0024, 0.27, 0.0006));
  for (let i = 0; i < 4; i++) m.at([x + 0.0015, y + 0.0135, 0.1 - i * 0.066], null, () => m.box(0.0032, 0.007, 0.0065, 0.0005));
}

function rails(m: Mesher): void {
  const len = RAIL_Z0 - RAIL_Z1;
  const zc = (RAIL_Z0 + RAIL_Z1) / 2;
  m.at([0, BORE, zc], null, () => {
    // Two steel beams with a copper face on the inside, and the channel between them where the shot runs.
    for (const s of [1, -1] as const) {
      m.at([0, s * 0.021, 0], null, () => {
        m.use(F.steelDark);
        m.front(poly([[-0.0185, -0.0095], [0.0185, -0.0095], [0.0185, 0.0095, 0.004], [-0.0185, 0.0095, 0.004]].map(q => [q[0]!, q[1]! * s, q[2]] as [number, number, number?]), 0.002), len, { bevel: 0.0014 });
        m.use(F.copperCoil);
        m.at([0, -s * 0.0105, 0], null, () => m.box(0.022, 0.0022, len - 0.006, 0.0005));
        m.glow('rail', () => m.at([0, -s * 0.0122, 0], null, () => m.box(0.012, 0.0009, len - 0.01, 0)));
      });
    }
    // Yokes every so often, each one wound with a coil pack.
    for (let i = 0; i < 7; i++) {
      const z = len / 2 - 0.05 - i * 0.082;
      m.at([0, 0, z], null, () => {
        m.use(i % 2 === 0 ? CERAMIC : CERAMIC_DARK);
        m.front(poly([[-0.034, -0.041], [0.034, -0.041], [0.034, 0.041, 0.012], [0.022, 0.044, 0.008], [-0.022, 0.044, 0.008], [-0.034, 0.041, 0.012]], 0.004), 0.018, { bevel: 0.0018, holes: [rect(-0.0195, -0.0112, 0.0195, 0.0112, 0.002)] });
        m.mirror(() => {
          screwX(m, 0.0345, 0.024, 0, 1, 0.0022);
          screwX(m, 0.0345, -0.024, 0, 1, 0.0022);
        });
      });
      if (i < 6) {
        m.at([0, 0, z - 0.041], null, () => {
          m.use(F.copperCoil);
          m.mirror(() => m.at([0.0255, 0, 0], null, () => { for (let k = 0; k < 11; k++) m.at([0, 0, -0.026 + k * 0.0052], null, () => m.lathe([[0.012, 0.0024, 0], [0.0148, 0.0024], [0.0148, -0.0024], [0.012, -0.0024, 0]], 12, { chamfer: 0.0009 })); }));
        });
      }
    }
    // Muzzle block.
    m.at([0, 0, -len / 2 - 0.012], null, () => {
      m.use(CERAMIC);
      m.front(poly([[-0.036, -0.044], [0.036, -0.044], [0.04, -0.032], [0.04, 0.032], [0.036, 0.044], [-0.036, 0.044], [-0.04, 0.032], [-0.04, -0.032]], 0.004), 0.03, { bevel: 0.0024, holes: [rect(-0.0195, -0.0112, 0.0195, 0.0112, 0.002)] });
      m.use(F.black);
      m.at([0, 0, 0.016], null, () => m.front(rect(-0.019, -0.011, 0.019, 0.011, 0.002), 0.002, { bevel: 0 }));
    });
  });
  // Foregrip bracket and the cabling that feeds it.
  m.use(CERAMIC_DARK);
  m.at([0, BORE - 0.052, -0.27], null, () => m.box(0.05, 0.016, 0.1, 0.0024, 0.004));
  m.use(F.polymerStipple);
  m.at([0, BORE - 0.062, -0.27], null, () => {
    const f = curve([[-0.021, 0], [-0.0245, -0.03], [-0.026, -0.06], [-0.022, -0.1]], 4);
    const b = curve([[0.022, -0.1], [0.024, -0.06], [0.022, -0.03], [0.02, 0]], 4);
    m.side([...f, ...b], 0.031, { bevel: 0.0036, smooth: 50 });
  });
  m.use(CERAMIC_DARK);
  m.at([0, BORE - 0.165, -0.27], null, () => m.box(0.034, 0.006, 0.05, 0.0014, 0.003));
  m.use(F.rubber);
  m.mirror(() => m.tube([[0.0235, BORE - 0.016, -0.19], [0.042, BORE - 0.02, -0.24], [0.046, BORE - 0.03, -0.34], [0.046, BORE - 0.026, -0.48], [0.038, BORE - 0.018, -0.56]], 0.0034, { seg: 7, samples: 22 }));
}

function vents(m: Mesher): void {
  // Louvres that lift off the back of the rails while the bank is hot.
  for (const [i, z] of [[0, -0.125], [1, -0.102], [2, -0.079]] as const) {
    m.part(`vent${i}`, [0, 0.124, z], () => {
      m.use(CERAMIC_DARK);
      m.at([0, 0.002, -0.0095], null, () => m.box(0.05, 0.0028, 0.021, 0.0009));
    });
  }
}

function cell(m: Mesher): void {
  // Power cell, seated in the left flank ahead of the grip. Glows when live.
  m.part('cell', [-0.0345, 0.052, -0.055], () => {
    m.use(CERAMIC_DARK);
    m.box(0.016, 0.052, 0.098, 0.0022, 0.005);
    m.use(F.anodizedGrey);
    m.at([-0.0092, 0, 0], null, () => m.side(rect(-0.042, -0.02, 0.042, 0.02, 0.003), 0.0024, { bevel: 0.0007, holes: slotRow(-0.024, 0, 0.024, 0, 3, 0.028, 0.0062, Math.PI / 2) }));
    m.glow('cell', () => m.at([-0.0086, 0, 0], null, () => m.box(0.0012, 0.03, 0.066, 0)));
    m.use(F.steelDark);
    m.at([-0.0125, 0, 0.0], null, () => m.tube([[0, 0, 0.03], [-0.008, 0, 0.022], [-0.008, 0, -0.022], [0, 0, -0.03]], 0.0024, { seg: 8, samples: 12 }));
  });
}

function buildLance(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  body(m);
  caps(m);
  rails(m);
  vents(m);
  cell(m);
  m.part('bolt', [-0.0345, 0.106, 0.02], () => {
    m.use(F.steelDark);
    m.at([-0.004, 0, 0], null, () => m.box(0.0085, 0.009, 0.014, 0.0012));
    m.use(F.red);
    m.at([-0.012, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.006, 0.008, 12));
  });
  m.part('trigger', [0, 0.004, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: {
      sight: [0x35e8ff, 7], rail: [0x7ff4ff, 1], cell: [0x35e8ff, 2.4],
      cap0: [0x45e8ff, 1], cap1: [0x45e8ff, 1], cap2: [0x45e8ff, 1], cap3: [0x45e8ff, 1],
    },
    screens: { charge: [192, 112] },
  });
  model.socket('muzzle', [0, BORE, RAIL_Z1 - 0.03]);
  model.socket('eject', [0.036, 0.09, 0.05]);
  model.hand('gripR', [0.018, -0.046, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, BORE - 0.112, -0.27], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('cellHold', [-0.03, 0, 0.0], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'cell');
  model.hand('boltHold', [-0.022, 0, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'bolt');
  return model;
}

function drawScreen(a: Anim): void {
  const s = a.model!.screens.charge;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const full = a.charge >= 0.999;
  const stage = stageOf(a.charge);
  g.fillStyle = '#03090d';
  g.fillRect(0, 0, w, h);
  g.fillStyle = full ? '#ffffff' : '#35e8ff';
  g.font = '800 44px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(full ? 'MAX' : `${String(Math.round(a.charge * 100)).padStart(3, '0')}%`, 8, 6);
  // What letting go now fires: a ball under the first stage, then the beam by its stage.
  g.font = '800 26px "Courier New", monospace';
  g.fillText(stage === 0 ? 'BALL' : 'I'.repeat(stage), 128, 14);
  g.font = '700 20px "Courier New", monospace';
  g.fillText(`CELL ${a.mag}/${a.magSize}`, 8, 54);
  g.fillStyle = '#123';
  g.fillRect(8, 84, w - 16, 18);
  g.fillStyle = full ? '#ffffff' : '#35e8ff';
  g.fillRect(8, 84, (w - 16) * a.charge, 18);
  // A notch at each stage short of full.
  g.fillStyle = '#03090d';
  for (let i = 0; i < STAGE_AT.length - 1; i++) g.fillRect(8 + (w - 16) * STAGE_AT[i]! - 2, 84, 4, 18);
  texture.needsUpdate = true;
}

/** Stages the charge has reached: 0 under the first, up to the number there are. */
function stageOf(charge: number): number {
  let n = 0;
  for (let i = 0; i < STAGE_AT.length; i++) if (charge >= STAGE_AT[i]! - 1e-6) n = i + 1;
  return n;
}

/** The stage seen last frame and when it landed, for the flare. One Lance is ever in the hands. */
let seenStage = 0;
let stageLanded = -99;

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.1, 0.3);
  const c = a.charge;
  const t = a.sinceFire;
  // The bank discharges in a flash, then bleeds down over the half-second after a shot.
  const burst = t < 0.5 ? (1 - t / 0.5) ** 2 * a.strength : 0;

  // A stage landing flares its capacitor white and jolts the gun, so the charge is read in steps and not as a ramp.
  const stage = stageOf(c);
  if (stage > seenStage) stageLanded = a.time;
  seenStage = stage;
  const pop = clamp(1 - (a.time - stageLanded) / STAGE_POP);

  // Three capacitors fill on the way to the three stages and burn once theirs is reached. The fourth is the full charge.
  for (let i = 0; i < CAPS.length; i++) {
    let level = 0.3 + burst * 3;
    if (i < STAGE_AT.length) {
      const from = i === 0 ? 0 : STAGE_AT[i - 1]!;
      const reached = stage > i;
      level += clamp((c - from) / (STAGE_AT[i]! - from)) * 2 + (reached ? 6 : 0) + (stage === i + 1 ? pop * 10 : 0);
    } else if (stage >= STAGE_AT.length) {
      level += 8 + 3 * Math.sin(a.time * 44) + pop * 10;
    }
    a.glow(CAPS[i]!, level);
  }
  const full = c >= 0.999 ? 1 + 0.25 * Math.sin(a.time * 44) : 0;
  a.glow('rail', 0.06 + c * c * 5 + stage * 2 + pop * 6 + full * 5 + burst * 16);
  a.glow('sight', 0.9 + c * 0.8);
  a.glow('cell', 0.7 + c * 1.1);

  // Hum in the hands: small and fast, stepping up with each stage to a real shake at full charge.
  const hum = c * c * 0.0006 + HUM[Math.min(stage, HUM.length - 1)]!;
  a.gunP.x += Math.sin(a.time * 91) * hum;
  a.gunP.y += Math.sin(a.time * 107 + 1) * hum;
  a.gunR.z += Math.sin(a.time * 83) * hum * 2.2;
  a.gunR.x += Math.sin(a.time * 97 + 2) * hum * 0.9;
  // The arms brace as it charges, and take the jolt of each stage.
  a.gunP.z += c * 0.018 + pop * 0.006;
  a.gunP.y -= c * 0.004;
  a.gunR.x += pop * 0.012;

  const vent = Math.max(seg(c, 0.3, 1), t < 0.8 ? 1 - seg(t, 0.25, 0.8) : 0);
  P.vent0!.rotation.x -= vent * 0.75;
  P.vent1!.rotation.x -= vent * 0.75;
  P.vent2!.rotation.x -= vent * 0.75;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunR.z += k * 0.2;
    a.gunP.x += k * 0.05;
  }
  const p = a.reload;
  if (p < 0) return;

  // Latch, pull, drop. New cell in, slam, then the charging bolt wakes the bank up.
  const out = inOut(seg(p, 0.1, 0.26));
  const inn = 1 - outCubic(seg(p, 0.42, 0.66));
  const cl = P.cell!;
  const away = p < 0.34 ? out : inn;
  cl.position.x -= away * 0.2 + (p < 0.34 ? inQuad(seg(p, 0.2, 0.34)) * 0.1 : inn * 0.1);
  cl.position.y -= away * 0.28;
  cl.position.z += away * 0.05;
  cl.rotation.z += away * 0.9;
  if (p > 0.3 && p < 0.38) cl.visible = false;
  const seat = p >= 0.655 ? thud(seg(p, 0.655, 0.78)) : 0;
  const rack = hold(p, 0.76, 0.84, 0.86, 0.92);
  P.bolt!.position.z += rack * 0.06;
  a.glow('cell', p > 0.3 && p < 0.7 ? 0.05 : 0.2 + seg(p, 0.86, 1) * 0.6);
  for (let i = 0; i < CAPS.length; i++) a.glow(CAPS[i]!, lerp(0.05, 0.3, seg(p, 0.86, 1)));

  const present = hold(p, 0, 0.12, 0.86, 1);
  a.gunR.z -= present * 0.3;
  a.gunR.x += present * 0.16 + seat * 0.04;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.03;
  a.gunP.z += present * 0.07 + rack * 0.01;

  const h = a.left;
  h.fingerRate = 36;
  h.to('cellHold', inOut(seg(p, 0.03, 0.11)));
  h.to('pouchL', inOut(seg(p, 0.22, 0.34)));
  h.to('cellHold', inOut(seg(p, 0.38, 0.48)));
  h.to('boltHold', inOut(seg(p, 0.68, 0.76)));
  h.to('gripL', inOut(seg(p, 0.9, 1)));
  h.shape(HANDS.cup, hold(p, 0.04, 0.1, 0.62, 0.68));
  h.shape(HANDS.pinch, hold(p, 0.7, 0.76, 0.88, 0.93));
}

export function lanceDef(kit: Kit): ViewDef {
  return {
    id: 'lance',
    model: buildLance(kit),
    pos: [0.205, -0.225, -0.47],
    rot: [0.012, 0.06, 0],
    recoil: { back: 0.1, lift: 0.016, pitch: 0.1, yaw: 0.012, roll: 0.04, omega: 26, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    animate: clip,
    readout: drawScreen,
  };
}

