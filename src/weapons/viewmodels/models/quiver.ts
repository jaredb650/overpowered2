/**
 * The Quiver: a shoulder-fired box of four tubes in a 2 by 2 block. A ribbed olive housing with a framed face you can see
 * the four seeker noses through, a painter unit on the left flank whose lamps and screen count the marks, and a folding
 * fore grip. It loads from the front, a round at a time, so the reload is four pushes you can count.
 *
 * Origin at the top of the rear grip. The block rides above it on the shoulder. Tubes are numbered as they fire: 0 top
 * left, 1 top right, 2 bottom left, 3 bottom right, seen from behind, and each has its own muzzle socket.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, type V2 } from '../kit/shapes';
import { rivet, screwX } from '../kit/details';
import { bump, hold, inOut, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

/** Height of the block's centre above the grip, the half spacing of the tubes, and a tube's bore. */
const AXIS = 0.098;
const SP = 0.029;
const BORE = 0.024;
/** The housing: half its width and height, and where it starts and ends along Z. */
const HALF = SP + BORE + 0.008;
const REAR = 0.2;
const FACE = -0.49;
/** Where each tube sits in X and Y, in firing order. */
const TUBES: readonly (readonly [number, number])[] = [[-SP, SP], [SP, SP], [-SP, -SP], [SP, -SP]];
/** A round's pivot along Z, and how far out of the face it starts a reload. */
const ROUND_Z = -0.3;
const OUT = 0.42;
/** When each of the four pushes lands: the `quiver_load` cues in the weapon's row. */
const PUSH = [0.24, 0.4, 0.56, 0.72];

function housing(m: Mesher): void {
  m.at([0, AXIS, (REAR + FACE) / 2], null, () => {
    m.use(F.olive);
    m.box(HALF * 2, HALF * 2, REAR - FACE, 0.004, 0.012);
    // Pressed ribs around the block, and the seam where the two shells meet.
    m.use(F.oliveDark);
    for (const z of [-0.26, -0.1, 0.06, 0.22]) m.at([0, 0, z], null, () => m.box(HALF * 2 + 0.006, HALF * 2 + 0.006, 0.016, 0.002, 0.012));
    m.mirror(() => m.at([HALF + 0.0012, 0, 0], null, () => m.box(0.002, 0.004, REAR - FACE - 0.02, 0.0006)));
  });
  // The face: a frame with four mouths, each with a black bore and a lip.
  m.at([0, AXIS, FACE - 0.006], null, () => {
    m.use(F.oliveDark);
    m.front(rect(-HALF - 0.002, -HALF - 0.002, HALF + 0.002, HALF + 0.002, 0.012), 0.012, {
      bevel: 0.002, holes: TUBES.map(([x, y]) => circle(x, y, BORE, 24)),
    });
    for (const [x, y] of TUBES) {
      m.use(F.black);
      // Walked front to rear, so the faces look into the bore.
      m.at([x, y, 0.2], null, () => m.lathe([[BORE - 0.0005, -0.2, 0], [BORE, 0.2, 0]], 24));
      m.use(F.steelDark);
      m.at([x, y, -0.006], null, () => m.lathe([[BORE + 0.0035, 0.002, 0], [BORE + 0.0035, -0.004], [BORE, -0.004, 0], [BORE, 0.002, 0]], 24, { chamfer: 0.0008 }));
    }
  });
  // The rear: four venturis, flared, that the backblast leaves through.
  m.at([0, AXIS, REAR + 0.004], null, () => {
    m.use(F.oliveDark);
    m.front(rect(-HALF, -HALF, HALF, HALF, 0.012), 0.008, { bevel: 0.002, holes: TUBES.map(([x, y]) => circle(x, y, BORE - 0.004, 20)) });
    for (const [x, y] of TUBES) {
      m.use(F.steelDark);
      m.at([x, y, 0], null, () => m.lathe([[BORE + 0.004, 0.024, 0], [BORE + 0.002, 0.018], [BORE - 0.004, 0.0, 0]], 20, { chamfer: 0.0008 }));
      m.use(F.black);
      m.at([x, y, 0.01], null, () => m.cyl(BORE - 0.006, 0.004, 16, 0));
    }
  });
  // Stencils on the camera's flank and the top, and a hazard band by the face.
  m.at([-HALF - 0.0012, AXIS + 0.012, -0.16], [0, -Math.PI / 2, 0], () => m.decal('quiver', 0.14, 0.028, 0xd8c35a));
  m.at([-HALF - 0.0012, AXIS - 0.022, -0.16], [0, -Math.PI / 2, 0], () => m.decal('msl', 0.12, 0.015, 0xc8c4a0));
  m.at([-HALF - 0.0012, AXIS - 0.044, 0.02], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.1, 0.011, 0xb0ad90));
  m.at([0, AXIS + HALF + 0.0012, -0.4], [-Math.PI / 2, 0, 0], () => m.decal('hazard', HALF * 2, 0.022, 0xc9a227));
  m.at([0, AXIS + HALF + 0.0012, 0.12], [-Math.PI / 2, 0, 0], () => m.decal('warn', 0.026, 0.026, 0xd8c35a));
  // Rivets along the seam.
  for (let i = 0; i < 6; i++) {
    const z = -0.42 + i * 0.12;
    m.at([-HALF - 0.0005, AXIS + HALF - 0.01, z], [0, -Math.PI / 2, 0], () => rivet(m, 0.002));
    m.at([-HALF - 0.0005, AXIS - HALF + 0.01, z], [0, -Math.PI / 2, 0], () => rivet(m, 0.002));
  }
  // A carry strap's two bails on top.
  m.use(F.steelDark);
  for (const z of [-0.34, 0.1]) m.at([0, AXIS + HALF + 0.006, z], null, () => m.box(0.03, 0.01, 0.012, 0.002));
}

/** The painter: a box on the left flank with a lens forward, four lock lamps and a screen facing the shooter. */
function painter(m: Mesher): void {
  m.at([-HALF - 0.032, AXIS + 0.02, -0.12], null, () => {
    m.use(F.anodized);
    m.at([0.022, -0.01, 0], null, () => m.box(0.02, 0.016, 0.08, 0.002));
    m.use(F.polymer);
    m.side(poly([[0.11, -0.024], [0.11, 0.022, 0.006], [0.094, 0.032, 0.006], [-0.1, 0.032, 0.006], [-0.11, 0.02, 0.006], [-0.11, -0.024, 0.005]], 0.003), 0.044, { bevel: 0.0024 });
    m.use(F.polymerGrey);
    m.mirror(() => screwX(m, 0.0225, 0.014, 0.08, 1, 0.0018));
    // The seeker's lens, hooded.
    m.at([0, 0.004, -0.11], null, () => {
      m.use(F.rubber);
      m.lathe([[0.019, 0.004, 0], [0.021, 0.0], [0.021, -0.022], [0.0185, -0.024], [0.016, -0.014, 0]], 22);
      m.glass(() => m.at([0, 0, -0.008], null, () => m.cyl(0.016, 0.0008, 20, 0)));
    });
    // The rear face the shooter reads: four lamps over a screen.
    m.at([0, 0.004, 0.1105], null, () => {
      m.use(F.black);
      m.prism(rect(-0.0205, -0.026, 0.0205, 0.026, 0.002), 0.001, { bevel: 0 });
      for (let i = 0; i < 4; i++) {
        m.glow(`lamp${i}`, () => m.at([-0.0135 + i * 0.009, 0.018, 0.0008], null, () => m.box(0.006, 0.006, 0.0014, 0.0005)));
      }
      m.at([0, -0.006, 0.0008], null, () => m.screen('locks', 0.036, 0.026));
    });
  });
}

function grips(m: Mesher): void {
  // Rear grip and its fire-control box, under the block.
  m.use(F.parkerized);
  m.side(poly([[0.1, 0.034], [0.1, 0.0, 0.006], [0.088, -0.012, 0.006], [-0.075, -0.012, 0.006], [-0.1, 0.034]], 0.003), 0.044, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.01], [0.021, -0.036], [0.028, -0.06], [0.036, -0.082], [0.044, -0.112]], 4);
  const back = curve([[0.098, -0.112], [0.094, -0.08], [0.086, -0.045], [0.08, -0.01]], 4);
  m.side([...front, [0.046, -0.118], [0.096, -0.118], ...back], 0.032, { bevel: 0.0036, smooth: 50 });
  m.use(F.polymer);
  m.side(poly([[-0.036, -0.012], [-0.04, -0.03, 0.006], [-0.024, -0.042, 0.008], [0.03, -0.042, 0.008], [0.05, -0.016, 0.004], [0.05, -0.012]], 0.002), 0.0125, {
    bevel: 0.0013,
    holes: [poly([[-0.031, -0.014], [-0.033, -0.028, 0.005], [-0.021, -0.0365, 0.005], [0.022, -0.0365, 0.005], [0.041, -0.0155, 0.003], [0.042, -0.014]], 0.002)],
  });
  // Arming lever, red, on the left.
  m.part('lever', [-0.0235, 0.014, 0.01], () => {
    m.use(F.red);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.006, 0.0032, 14));
    m.at([-0.0018, 0, -0.012], null, () => m.box(0.0028, 0.0052, 0.024, 0.0009));
  });
  // Fore grip on a bracket under the block, folded down.
  m.use(F.parkerized);
  m.at([0, AXIS - HALF - 0.008, -0.27], null, () => m.box(0.034, 0.016, 0.04, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, AXIS - HALF - 0.016, -0.27], null, () => m.side(foreGrip(), 0.03, { bevel: 0.0036, smooth: 50 }));
  // Shoulder rest under the rear of the block.
  m.use(F.rubber);
  m.at([0, AXIS - HALF - 0.008, 0.12], null, () => m.side(poly([[0.08, 0.006], [0.08, -0.008, 0.006], [0.066, -0.022, 0.008], [-0.066, -0.022, 0.008], [-0.08, -0.008, 0.006], [-0.08, 0.006]], 0.002), 0.05, { bevel: 0.003 }));
}

function foreGrip(): V2[] {
  const f = curve([[-0.018, 0], [-0.021, -0.03], [-0.022, -0.06], [-0.018, -0.096]], 4);
  const b = curve([[0.022, -0.096], [0.024, -0.06], [0.022, -0.03], [0.018, 0]], 4);
  return [...f, ...b];
}

/** One seeker round, along its tube: a grey body, a yellow band and an olive nose that shows in the mouth. */
function rounds(m: Mesher): void {
  TUBES.forEach(([x, y], i) => {
    m.part(`round${i}`, [x, AXIS + y, ROUND_Z], () => {
      m.use(F.anodizedGrey);
      m.lathe([[0.019, 0.2, 0], [0.0215, 0.196], [0.0215, -0.1, 0]], 18);
      // Fins folded flat at the tail, so the hand pushing it in has something to push.
      m.use(F.steelDark);
      for (let k = 0; k < 4; k++) m.at([0, 0, 0.17], [0, 0, (k / 4) * Math.PI * 2 + Math.PI / 4], () => m.at([0.02, 0, 0], null, () => m.box(0.007, 0.002, 0.05, 0.0006)));
      m.use(F.yellow);
      m.lathe([[0.0215, -0.1, 0], [0.0218, -0.112], [0.0215, -0.118, 0]], 18, { chamfer: 0 });
      m.use({ ...F.olive, color: 0x6a6b47 });
      const nose: [number, number, number?][] = [[0.0215, -0.118, 0]];
      for (let k = 1; k <= 10; k++) {
        const t = k / 10;
        nose.push([0.0215 * (1 - t ** 1.6) + 0.003, -0.118 - t * 0.06, 0]);
      }
      m.lathe(nose, 18, { chamfer: 0, smooth: 40 });
      // The seeker's glass eye in the tip.
      m.glass(() => m.at([0, 0, -0.179], null, () => m.cyl(0.0034, 0.002, 10, 0)));
    });
  });
}

function buildQuiver(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  housing(m);
  painter(m);
  grips(m);
  rounds(m);
  m.part('trigger', [0, -0.0125, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: { lamp0: [0xff3a22, 3], lamp1: [0xff3a22, 3], lamp2: [0xff3a22, 3], lamp3: [0xff3a22, 3] },
    screens: { locks: [96, 70] },
  });
  TUBES.forEach(([x, y], i) => model.socket(i === 0 ? 'muzzle' : `muzzle${i}`, [x, AXIS + y, FACE - 0.03]));
  model.socket('eject', [0, AXIS, REAR + 0.03]);
  model.hand('gripR', [0.018, -0.052, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, AXIS - HALF - 0.07, -0.27], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('leverHold', [-0.034, 0.016, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'lever');
  // The palm on a round's tail, for the push into its tube.
  TUBES.forEach((_, i) => model.hand(`load${i}`, [-0.012, -0.03, 0.2], [-0.2, 0.3, -0.93], [0.9, 0.2, -0.3], `round${i}`));
  return model;
}

/** Tubes still loaded: they empty in firing order, so tube `i` holds a round while `i` is at or past the spent ones. */
const loaded = (a: Anim, i: number) => i >= a.magSize - a.mag;

function readout(a: Anim): void {
  const s = a.model!.screens.locks;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const marks = Math.round(a.charge * 4);
  g.fillStyle = '#100604';
  g.fillRect(0, 0, w, h);
  g.fillStyle = marks >= 4 ? '#ffb020' : '#ff5a2a';
  g.font = '800 22px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(marks > 0 ? `LK ${marks}` : 'SEEK', 6, 4);
  // The four tubes as the face shows them, filled while loaded.
  for (let i = 0; i < 4; i++) {
    const x = 14 + (i % 2) * 34;
    const y = 32 + Math.floor(i / 2) * 18;
    g.globalAlpha = loaded(a, i) ? 1 : 0.2;
    g.beginPath();
    g.arc(x + 8, y + 7, 7, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09);
  const p = a.reload;
  for (let i = 0; i < 4; i++) P[`round${i}`]!.visible = p >= 0 ? p > PUSH[i]! - 0.14 : loaded(a, i);
  // A lamp for every mark, and the lamps breathe while the trigger is down with nothing marked.
  const marks = Math.round(a.charge * 4);
  for (let i = 0; i < 4; i++) a.glow(`lamp${i}`, i < marks ? 1 : 0.03);

  // Each tube kicks the block toward its own side: four shots read as four, left, right, left, right.
  if (a.sinceFire < 0.16) {
    const tube = (a.shots - 1) % 4;
    const k = bump(a.sinceFire, 0, 0.16) * a.strength;
    a.gunR.z += (tube % 2 === 0 ? 1 : -1) * k * 0.02;
    a.gunR.x += (tube < 2 ? 1 : 0.5) * k * 0.01;
  }

  if (a.draw < 1) {
    // Heaved up onto the shoulder, the arming lever thrown on the way.
    a.gunP.x += (1 - outCubic(a.draw)) * 0.07;
    a.gunP.y -= (1 - outCubic(a.draw)) * 0.05;
    a.gunR.y -= (1 - outCubic(a.draw)) * 0.3;
    P.lever!.rotation.x -= bump(a.draw, 0.5, 1) * 0.8;
  }
  if (p < 0) return;

  // The face is tipped down and in toward the middle of the view, so each round can be seen going in.
  const present = hold(p, 0, 0.12, 0.82, 0.96);
  const seat = p >= 0.86 ? thud(seg(p, 0.86, 0.96)) : 0;
  a.gunR.y += present * 0.2;
  a.gunR.x -= present * 0.26 - seat * 0.02;
  a.gunR.z += present * 0.18;
  a.gunP.x -= present * 0.08;
  a.gunP.y += present * 0.05;
  a.gunP.z -= present * 0.06;

  const h = a.left;
  h.fingerRate = 36;
  for (let i = 0; i < 4; i++) {
    const at = PUSH[i]!;
    const rise = inOut(seg(p, at - 0.13, at - 0.06));
    const push = inOut(seg(p, at - 0.06, at));
    const r = P[`round${i}`]!;
    // Up from the waist, square to the mouth, then shoved home.
    r.position.z -= (1 - push) * OUT;
    r.position.y -= (1 - rise) * 0.22;
    r.position.x -= (1 - rise) * 0.14;
    r.rotation.x += (1 - rise) * 0.6;
    r.rotation.z += (1 - rise) * 0.5;
    h.to(`load${i}`, hold(p, at - 0.14, at - 0.11, at - 0.01, at + 0.02));
  }
  h.to('leverHold', inOut(seg(p, 0.8, 0.85)));
  h.to('gripL', inOut(seg(p, 0.9, 1)));
  h.shape(HANDS.cup, hold(p, 0.08, 0.12, 0.74, 0.78));
  h.shape(HANDS.foregrip, hold(p, 0.86, 0.9, 1, 1.1));
  P.lever!.rotation.x -= bump(p, 0.84, 0.95) * 1.0;
}

export function quiverDef(kit: Kit): ViewDef {
  return {
    id: 'quiver',
    model: buildQuiver(kit),
    pos: [0.27, -0.255, -0.38],
    rot: [0.012, 0.075, 0],
    recoil: { back: 0.045, lift: 0.01, pitch: 0.04, yaw: 0.012, roll: 0.02, omega: 30, zeta: 0.55 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.12,
    animate: clip,
    readout,
  };
}
