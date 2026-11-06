/**
 * The Stakegun: a pneumatic rebar driver somebody took off a building site. Safety-yellow shell, black rubber armour,
 * an exposed air tank with a gauge, and a sharpened stake lying in an open channel along the top so everyone can see
 * what is about to happen. Four spares ride in a rack on the left. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slot, slotRow } from '../kit/shapes';
import { coil, hexX, hose } from '../kit/details';
import { bump, hold, inOut, outBack, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger } from './common';

const CHANNEL_Y = 0.098;
const STAKE_LEN = 0.62;
const RACK = ['s0', 's1', 's2', 's3'] as const;

/** Ribbed bar along Z, point at -Z. */
function stake(m: Mesher, len: number): void {
  const r = 0.0072;
  m.use({ color: 0x5c5f64, rough: 0.5, metal: 1, wear: 0.3 });
  const prof: [number, number, number?][] = [[0, 0, 0], [r, 0.0], [r, -0.006]];
  const ribs = Math.floor((len - 0.1) / 0.022);
  for (let i = 0; i < ribs; i++) {
    const z = -0.01 - i * 0.022;
    prof.push([r, z], [r + 0.0013, z - 0.003], [r + 0.0013, z - 0.0055], [r, z - 0.0085]);
  }
  const zt = -len + 0.075;
  prof.push([r, zt], [r * 0.5, zt - 0.05], [0.0009, -len, 0]);
  m.lathe(prof, 10, { chamfer: 0, smooth: 24 });
  // The sharpened tip is bright, from the grinder.
  m.use(F.steel);
  m.lathe([[r * 1.01, zt, 0], [r * 0.5 + 0.0002, zt - 0.05], [0.0011, -len - 0.0003, 0]], 10, { chamfer: 0 });
}

function shell(m: Mesher): void {
  m.use(F.yellow);
  m.side(poly([[0.17, 0.004], [0.18, 0.086, 0.012], [0.15, 0.11, 0.012], [-0.15, 0.11, 0.01], [-0.2, 0.094, 0.006], [-0.21, 0.052, 0.006], [-0.17, 0.016, 0.012], [-0.05, 0.004, 0.01]], 0.0035), 0.07, { bevel: 0.0034, smooth: 34 });
  const plate = poly([[0.15, 0.016], [0.156, 0.08, 0.008], [0.134, 0.094, 0.01], [-0.1, 0.094, 0.01], [-0.16, 0.08, 0.008], [-0.16, 0.042, 0.01], [-0.11, 0.024, 0.006]], 0.0025);
  m.use(F.rubber);
  m.mirror(() => m.at([0.0345, 0, 0], null, () => m.side(plate, 0.0032, { bevel: 0.0012, holes: [slot(-0.12, 0.062, -0.02, 0.062, 0.0075, 4), ...slotRow(0.03, 0.04, 0.12, 0.04, 6, 0.022, 0.0065, Math.PI / 2)] })));
  m.use(F.black);
  m.mirror(() => m.at([0.0335, 0.05, 0.0], null, () => m.box(0.0012, 0.078, 0.29, 0)));
  m.mirror(() => {
    for (const [y, z] of [[0.086, 0.14], [0.086, -0.12], [0.03, 0.14]] as const) hexX(m, 0.0365, y, z, 1, 0.0032);
  });
  m.at([-0.0374, 0.0805, -0.02], [0, -Math.PI / 2, 0], () => m.decal('stake', 0.08, 0.0115, 0xe8d36a));
  m.at([-0.0374, 0.024, 0.1], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.076, 0.0104, 0xe8d36a));
  m.at([-0.0374, 0.048, -0.145], [0, -Math.PI / 2, 0], () => m.decal('warn', 0.018, 0.018, 0x1a1a1a));

  // Hazard band at the nose.
  m.at([0, 0.1105, -0.13], [-Math.PI / 2, 0, -Math.PI / 2], () => m.decal('hazard', 0.05, 0.03, 0x121212));

  // Channel the stake lies in: two rails and a floor, open to the sky.
  m.use(F.steelDark);
  m.at([0, CHANNEL_Y - 0.003, -0.05], null, () => m.box(0.03, 0.006, 0.44, 0.0012));
  m.mirror(() => m.at([0.016, CHANNEL_Y + 0.006, -0.05], null, () => m.box(0.006, 0.02, 0.44, 0.0014, 0.0022)));
  m.use(F.black);
  m.at([0, CHANNEL_Y + 0.0005, -0.05], null, () => m.box(0.0245, 0.0012, 0.43, 0));
  // Steel guide tube at the nose, the last thing the stake touches.
  m.at([0, CHANNEL_Y + 0.006, -0.26], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.0115, 0.03, 0], [0.018, 0.03], [0.018, 0.012], [0.0155, 0.01], [0.0155, -0.04], [0.019, -0.044], [0.019, -0.06], [0.0098, -0.06, 0]], 22);
    m.use(F.black);
    m.lathe([[0.0098, -0.06, 0], [0.0098, 0.03, 0]], 16);
  });
  // Rear piston housing and its spring.
  m.at([0, CHANNEL_Y + 0.006, 0.19], null, () => {
    m.use(F.anodized);
    m.lathe([[0, 0.08, 0], [0.024, 0.08], [0.0265, 0.074], [0.0265, 0.0], [0.024, -0.006], [0.0145, -0.012], [0.0145, -0.018], [0, -0.018, 0]], 24);
    m.use(F.steelDark);
    for (const z of [0.012, 0.04, 0.066]) m.at([0, 0, z], null, () => m.lathe([[0.0265, 0.003, 0], [0.0285, 0.003], [0.0285, -0.003], [0.0265, -0.003, 0]], 24));
  });

  // Sight: a plain folding post, because it is a tool.
  m.use(F.steelDark);
  m.at([0.024, CHANNEL_Y + 0.018, -0.2], null, () => m.side(poly([[0.01, -0.012], [-0.01, -0.012], [-0.004, 0.018, 0.002], [0.004, 0.018, 0.002]], 0.001), 0.004, { bevel: 0.0007 }));
  m.glow('sight', () => m.at([0.024, CHANNEL_Y + 0.0345, -0.2], [Math.PI / 2, 0, 0], () => m.cyl(0.0016, 0.002, 8, 0)));

  // Grip, guard, pad.
  m.use(F.rubber);
  const front = curve([[0.02, 0.006], [0.021, -0.02], [0.028, -0.05], [0.036, -0.078], [0.044, -0.108]], 4);
  const back = curve([[0.098, -0.108], [0.094, -0.078], [0.086, -0.042], [0.082, 0.006]], 4);
  m.side([...front, [0.046, -0.114], [0.096, -0.114], ...back], 0.034, { bevel: 0.0038, smooth: 50 });
  m.use(F.steelDark);
  m.at([0, -0.1165, 0.071], null, () => m.box(0.034, 0.006, 0.056, 0.0014, 0.003));
  m.use(F.yellow);
  m.side(poly([[-0.04, 0.006], [-0.044, -0.018, 0.006], [-0.026, -0.034, 0.008], [0.03, -0.034, 0.008], [0.05, -0.006, 0.004], [0.05, 0.006]], 0.002), 0.0135, {
    bevel: 0.0013,
    holes: [poly([[-0.035, 0.002], [-0.037, -0.016, 0.005], [-0.023, -0.0285, 0.005], [0.022, -0.0285, 0.005], [0.041, -0.0055, 0.003], [0.042, 0.002]], 0.002)],
  });
  m.use(F.rubber);
  m.at([0, 0.052, 0.262], null, () => m.side(poly([[-0.01, 0.06], [0.03, 0.058, 0.008], [0.03, -0.05, 0.008], [-0.01, -0.052]], 0.003), 0.05, { bevel: 0.004 }));
  m.use(F.steelDark);
  m.at([0, 0.052, 0.21], null, () => m.box(0.03, 0.032, 0.09, 0.002, 0.003));

  // Count readout set into the top of the shell.
  m.at([-0.024, 0.1115, 0.08], [-Math.PI / 2 + 0.1, 0, 0], () => {
    m.use(F.rubber);
    m.prism(rect(-0.0105, -0.03, 0.0105, 0.03, 0.002), 0.002, { bevel: 0.0007 });
    m.at([0, 0, 0.0012], [0, 0, Math.PI / 2], () => m.screen('ammo', 0.056, 0.0176));
  });
}

function tank(m: Mesher): void {
  // Air tank slung under the nose, with a gauge and the fat hose that feeds the piston.
  m.at([0, -0.022, -0.17], null, () => {
    m.use(F.polymer);
    m.lathe([[0, 0.135, 0], [0.018, 0.128], [0.031, 0.108], [0.034, 0.08], [0.034, -0.08], [0.031, -0.108], [0.018, -0.128], [0, -0.135, 0]], 28, { chamfer: 0, smooth: 34 });
    m.use(F.yellow);
    for (const z of [0.05, -0.05]) m.at([0, 0, z], null, () => m.lathe([[0.034, 0.008, 0], [0.0352, 0.008], [0.0352, -0.008], [0.034, -0.008, 0]], 28, { chamfer: 0.0005 }));
    m.at([-0.0348, 0, 0], [0, -Math.PI / 2, 0], () => m.decal('press', 0.07, 0.0102, 0xe8d36a));
  });
  m.use(F.steelDark);
  for (const z of [-0.26, -0.09]) m.at([0, 0.008, z], null, () => m.front(poly([[-0.03, -0.012], [0.03, -0.012], [0.03, 0.012], [-0.03, 0.012]], 0.004), 0.012, { bevel: 0.0014, holes: [circle(0, -0.03, 0.034, 22)] }));
  m.use(F.brass);
  m.at([0, -0.022, -0.0345], null, () => m.lathe([[0.0, 0.01, 0], [0.0064, 0.01], [0.0064, -0.004], [0, -0.004, 0]], 6, { chamfer: 0.0007 }));
  hose(m, [[0.0, -0.022, -0.028], [0.03, -0.024, 0.01], [0.042, 0.03, 0.03], [0.04, 0.09, 0.12], [0.03, CHANNEL_Y + 0.01, 0.205]], 0.0068, 30, F.rubber);
}

function rack(m: Mesher): void {
  // Four spares in a shelf on the left, tips forward. They go one by one as the magazine runs down.
  m.at([-0.05, 0.03, 0], null, () => {
    m.use(F.steelDark);
    for (const z of [-0.2, 0.0, 0.12]) m.at([0.009, 0.03, z], null, () => m.box(0.022, 0.09, 0.012, 0.0012, 0.002));
    m.at([-0.002, -0.015, -0.04], null, () => m.box(0.02, 0.006, 0.34, 0.0012));
  });
  for (let i = 0; i < RACK.length; i++) {
    const y = 0.03 + i * 0.021;
    m.part(RACK[i]!, [-0.054, y, 0.13], () => stake(m, STAKE_LEN - 0.04));
  }
}

function buildStakegun(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  shell(m);
  tank(m);
  rack(m);
  m.part('stake', [0, CHANNEL_Y + 0.006, 0.16], () => stake(m, STAKE_LEN));
  m.part('ram', [0, CHANNEL_Y + 0.006, 0.16], () => {
    m.use(F.chrome);
    m.at([0, 0, 0.038], null, () => m.cyl(0.0095, 0.09, 16));
    m.use(F.steelDark);
    m.at([0, 0, 0.0], null, () => m.lathe([[0.0, 0.006, 0], [0.012, 0.006], [0.012, -0.008], [0.0078, -0.012], [0, -0.012, 0]], 18));
    m.at([0, 0, 0.04], null, () => coil(m, 0.0128, 0.0013, 0.07, 8, F.steel));
  });
  m.part('lever', [-0.036, 0.08, 0.02], () => {
    m.use(F.steelDark);
    m.at([-0.004, 0, 0], null, () => m.box(0.009, 0.01, 0.02, 0.0012));
    m.use(F.red);
    m.at([-0.012, 0.0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0064, 0.014, 12));
  });
  m.part('trigger', [0, 0.004, -0.002], () => {
    m.use(F.red);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0075, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: { sight: [0xff5a1a, 8] },
    screens: { ammo: [176, 56] },
  });
  model.socket('muzzle', [0, CHANNEL_Y + 0.006, -0.325]);
  model.socket('eject', [0.04, 0.1, 0.1]);
  model.hand('gripR', [0.018, -0.046, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.004, -0.058, -0.17], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('stakeHold', [-0.012, 0, -0.14], [-0.2, 0.1, -0.97], [0.9, -0.1, -0.2], 'stake');
  model.hand('leverHold', [-0.03, 0, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'lever');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.08);
  a.glow('sight', 1);
  const t = a.sinceFire;
  const p = a.reload;

  // Ram drives forward on the frame of the shot, then the piston resets and the next stake rolls down off the rack.
  const drive = t < 0.42 ? 1 - inOut(seg(t, 0.06, 0.34)) : 0;
  const hidden = t < 0.46;
  P.ram!.position.z -= drive * 0.2;
  const loaded = a.mag > 0;
  const stakeUp = t < 0.5 ? outBack(seg(t, 0.2, 0.46), 1.1) : 1;
  P.stake!.visible = loaded && (!hidden || t > 0.2);
  P.stake!.position.y += (1 - stakeUp) * -0.02;
  P.stake!.position.x += (1 - stakeUp) * -0.05;
  P.stake!.position.z += (1 - stakeUp) * 0.02;

  // The rack empties from the top as the magazine runs down.
  for (let i = 0; i < RACK.length; i++) P[RACK[i]!]!.visible = a.mag - 1 > i || p >= 0.3;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunR.z -= k * 0.18;
    P.ram!.position.z += bump(a.draw, 0.3, 1) * 0.05;
  }
  if (p < 0) return;

  // New stake hand-fed down the channel from the front, lever thrown to cock the ram.
  const feed = 1 - outCubic(seg(p, 0.3, 0.6));
  const st = P.stake!;
  st.visible = p > 0.2 || loaded;
  if (p > 0.2) {
    st.position.y += feed * 0.03 + (1 - inOut(seg(p, 0.2, 0.34))) * -0.32;
    st.position.x += (1 - inOut(seg(p, 0.2, 0.34))) * -0.16;
    st.position.z += feed * -0.1;
    st.rotation.x += feed * 0.12;
  }
  const seat = p >= 0.595 ? thud(seg(p, 0.595, 0.72)) : 0;
  const rack = hold(p, 0.74, 0.84, 0.86, 0.9);
  P.lever!.position.z += rack * 0.1;
  P.ram!.position.z += rack * 0.09;

  const present = hold(p, 0, 0.13, 0.86, 1);
  a.gunR.z -= present * 0.22;
  a.gunR.x += present * 0.2 + seat * 0.03;
  a.gunP.x -= present * 0.055;
  a.gunP.y += present * 0.02;
  a.gunP.z += present * 0.07 + rack * 0.012;

  const h = a.left;
  h.fingerRate = 36;
  h.to('pouchL', inOut(seg(p, 0.03, 0.18)));
  h.to('stakeHold', inOut(seg(p, 0.22, 0.32)));
  h.to('leverHold', inOut(seg(p, 0.66, 0.74)));
  h.to('gripL', inOut(seg(p, 0.9, 1)));
  h.shape(HANDS.cup, hold(p, 0.24, 0.32, 0.6, 0.65));
  h.shape(HANDS.pinch, hold(p, 0.68, 0.74, 0.88, 0.93));
}

export function stakegunDef(kit: Kit): ViewDef {
  return {
    id: 'stakegun',
    model: buildStakegun(kit),
    pos: [0.165, -0.19, -0.4],
    rot: [0.02, 0.07, 0],
    recoil: { back: 0.07, lift: 0.012, pitch: 0.095, yaw: 0.012, roll: 0.03, omega: 32, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    animate: clip,
    readout: a => drawCount(a, 'ammo', 1, 5, '#ffd24a'),
  };
}

