/**
 * The Buzzsaw: a six-barrel rotary carried at the hip. Motor housing, a toothed front disc that turns with the barrels
 * and gave the thing its name, an ammo can on the left with a flexible chute that shakes while it feeds, and barrels
 * that visibly heat. Origin at the top of the rear grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { clampBand, hexX, hose, rivet } from '../kit/details';
import { hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger } from './common';

const AXIS = 0.066;
const R_BARREL = 0.024;
const BARRELS = 6;

function housing(m: Mesher): void {
  m.use(F.parkerized);
  m.side(poly([[0.175, 0.0], [0.18, 0.102, 0.012], [0.16, 0.126, 0.012], [-0.03, 0.13, 0.016], [-0.14, 0.126, 0.01], [-0.15, 0.09], [-0.15, 0.02, 0.008], [-0.12, 0.0, 0.008]], 0.003), 0.094, { bevel: 0.003 });
  const panel = poly([[0.16, 0.016], [0.164, 0.096, 0.008], [0.148, 0.112, 0.008], [-0.024, 0.116, 0.01], [-0.128, 0.112, 0.008], [-0.134, 0.09], [-0.134, 0.022, 0.006], [-0.11, 0.012, 0.006]], 0.002);
  m.use(F.anodized);
  m.mirror(() => m.at([0.0485, 0, 0], null, () => m.side(panel, 0.0034, {
    bevel: 0.001,
    holes: [...slotRow(-0.118, 0.04, -0.04, 0.04, 6, 0.04, 0.0062, Math.PI / 2), rect(0.04, 0.03, 0.14, 0.09, 0.005)],
  })));
  m.use(F.black);
  m.mirror(() => m.at([0.0472, 0.06, 0.09], null, () => m.box(0.0012, 0.058, 0.098, 0)));
  m.mirror(() => {
    for (const [y, z] of [[0.104, 0.15], [0.02, 0.15], [0.104, -0.12], [0.022, -0.12], [0.108, 0.02]] as const) hexX(m, 0.0505, y, z, 1, 0.0034);
  });
  // Drive motor in the flank window: fins and a bright end bell.
  m.use(F.steelDark);
  m.at([-0.0375, 0.06, 0.09], null, () => {
    m.lathe([[0.0, 0.05, 0], [0.024, 0.05], [0.026, 0.046], [0.026, -0.046], [0.024, -0.05], [0, -0.05, 0]], 22);
    m.use(F.anodizedGrey);
    for (let i = 0; i < 12; i++) m.at([0, 0, -0.039 + i * 0.0071], null, () => m.lathe([[0.0255, 0.0016, 0], [0.0292, 0.0016], [0.0292, -0.0016], [0.0255, -0.0016, 0]], 22, { chamfer: 0.0005 }));
  });
  m.at([-0.051, 0.074, 0.156], [0, -Math.PI / 2, 0], () => m.decal('saw', 0.03, 0.0066, 0xd8c35a));
  m.at([-0.0505, 0.024, -0.05], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.1, 0.01, 0xc9a227));
  // Round count, tilted back to the eye.
  m.at([-0.012, 0.126, 0.1], [-Math.PI / 2 + 0.16, 0, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.0205, -0.035, 0.0205, 0.035, 0.003), 0.003, { bevel: 0.0009 });
    m.use(F.black);
    m.at([0, 0, 0.0012], null, () => m.prism(rect(-0.0178, -0.032, 0.0178, 0.032, 0.0012), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.0021], [0, 0, Math.PI / 2], () => m.screen('ammo', 0.06, 0.033));
  });
  // Carry handle over the top, the outline's second hump.
  m.use(F.steelDark);
  m.tube([[0.02, 0.13, -0.11], [0.02, 0.17, -0.09], [0.02, 0.18, -0.03], [0.02, 0.172, 0.02], [0.02, 0.13, 0.04]], 0.0052, { seg: 10, samples: 26, tension: 0.4 });
  m.use(F.rubber);
  m.tube([[0.02, 0.178, -0.07], [0.02, 0.179, -0.01]], 0.0086, { seg: 12, samples: 4 });

  // Rear grip block and trigger group.
  m.use(F.parkerized);
  m.side(poly([[0.112, 0.004], [0.108, -0.012, 0.006], [0.09, -0.018, 0.006], [-0.05, -0.018, 0.006], [-0.056, 0.004]], 0.003), 0.05, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.016], [0.021, -0.04], [0.028, -0.062], [0.036, -0.084], [0.044, -0.116]], 4);
  const back = curve([[0.1, -0.116], [0.096, -0.082], [0.088, -0.048], [0.082, -0.016]], 4);
  m.side([...front, [0.046, -0.122], [0.098, -0.122], ...back], 0.033, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1245, 0.073], null, () => m.box(0.034, 0.006, 0.058, 0.0014, 0.003));
  m.use(F.steelDark);
  m.side(poly([[-0.04, -0.016], [-0.044, -0.034, 0.006], [-0.026, -0.05, 0.008], [0.03, -0.05, 0.008], [0.05, -0.022, 0.004], [0.05, -0.016]], 0.002), 0.013, {
    bevel: 0.0013,
    holes: [poly([[-0.035, -0.018], [-0.037, -0.032, 0.005], [-0.023, -0.0445, 0.005], [0.022, -0.0445, 0.005], [0.041, -0.0215, 0.003], [0.042, -0.018]], 0.002)],
  });

  // Forward grip under the nose.
  m.use(F.parkerized);
  m.at([0, -0.006, -0.12], null, () => m.box(0.04, 0.014, 0.06, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, -0.014, -0.12], null, () => {
    const f = curve([[-0.02, 0], [-0.0235, -0.03], [-0.0245, -0.06], [-0.02, -0.1]], 4);
    const b = curve([[0.024, -0.1], [0.026, -0.06], [0.024, -0.03], [0.02, 0]], 4);
    m.side([...f, ...b], 0.032, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, -0.117, -0.12], null, () => m.box(0.035, 0.006, 0.05, 0.0014, 0.003));

  // Nose bearing the barrels spin in.
  m.at([0, AXIS, -0.15], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.046, 0.02, 0], [0.05, 0.016], [0.05, -0.012], [0.046, -0.018], [0.042, -0.02, 0]], 36);
    m.use(F.brass);
    m.lathe([[0.038, -0.018, 0], [0.042, -0.02], [0.042, -0.026], [0.038, -0.026, 0]], 30);
  });
}

function barrels(m: Mesher): void {
  m.part('barrels', [0, AXIS, -0.17], () => {
    const zf = -0.5;
    for (let i = 0; i < BARRELS; i++) {
      const a = (i / BARRELS) * Math.PI * 2;
      m.at([Math.cos(a) * R_BARREL, Math.sin(a) * R_BARREL, 0], null, () => {
        m.use(F.barrel);
        m.lathe([[0.0095, 0.0, 0], [0.0095, -0.02], [0.0082, -0.024], [0.0082, zf + 0.006], [0.0092, zf + 0.004], [0.0092, zf], [0.0048, zf - 0.001, 0]], 14);
        m.use(F.black);
        m.lathe([[0.0048, zf - 0.001, 0], [0.0046, zf + 0.008, 0], [0, zf + 0.0085, 0]], 10);
      });
    }
    // Support plates along the cluster: spun steel, each one drilled for the six tubes.
    const plate = (z: number, r: number, depth: number) => m.at([0, 0, z], null, () => {
      const holes: V2[][] = [];
      for (let i = 0; i < BARRELS; i++) {
        const a = (i / BARRELS) * Math.PI * 2 + Math.PI / BARRELS;
        holes.push(circle(Math.cos(a) * R_BARREL, Math.sin(a) * R_BARREL, 0.0058, 10));
      }
      m.front(circle(0, 0, r, 30), depth, { bevel: 0.0018, holes, smooth: 30 });
    });
    m.use(F.steelDark);
    plate(-0.012, 0.038, 0.02);
    plate(-0.17, 0.0368, 0.014);
    plate(-0.34, 0.0368, 0.014);
    // Central spindle.
    m.use(F.steel);
    m.lathe([[0.009, 0.0, 0], [0.009, zf + 0.04, 0]], 12);
    // The saw: a thick toothed disc ahead of the muzzles.
    const teeth = 16;
    const out: [number, number][] = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.72) / teeth) * Math.PI * 2;
      const a2 = ((i + 1) / teeth) * Math.PI * 2;
      out.push([Math.cos(a0) * 0.0425, Math.sin(a0) * 0.0425]);
      out.push([Math.cos(a1) * 0.052, Math.sin(a1) * 0.052]);
      out.push([Math.cos(a2) * 0.0425, Math.sin(a2) * 0.0425]);
    }
    const holes: V2[][] = [];
    for (let i = 0; i < BARRELS; i++) {
      const a = (i / BARRELS) * Math.PI * 2;
      holes.push(circle(Math.cos(a) * R_BARREL, Math.sin(a) * R_BARREL, 0.0095, 12));
    }
    m.use(F.red);
    m.at([0, 0, zf + 0.022], null, () => m.front(out, 0.008, { bevel: 0.001, holes, smooth: 20 }));
    m.use(F.steel);
    for (let i = 0; i < teeth; i++) {
      const a = ((i + 0.72) / teeth) * Math.PI * 2;
      m.at([Math.cos(a) * 0.0492, Math.sin(a) * 0.0492, zf + 0.022], [0, 0, a], () => m.box(0.0056, 0.0034, 0.0086, 0.0005));
    }
    m.use(F.steelDark);
    for (let i = 0; i < BARRELS; i++) {
      const a = (i / BARRELS) * Math.PI * 2 + Math.PI / BARRELS;
      m.at([Math.cos(a) * R_BARREL, Math.sin(a) * R_BARREL, zf + 0.0165], [Math.PI, 0, 0], () => rivet(m, 0.0026));
    }
  });
}

function ammoCan(m: Mesher): void {
  m.part('can', [-0.098, -0.005, -0.015], () => {
    m.use(F.olive);
    m.box(0.082, 0.13, 0.19, 0.003, 0.006);
    m.use(F.oliveDark);
    for (const z of [-0.075, -0.03, 0.03, 0.075]) m.at([-0.042, 0, z], null, () => m.box(0.0035, 0.12, 0.012, 0.0009));
    m.at([0, 0.066, 0], null, () => m.box(0.082, 0.006, 0.19, 0.0016, 0.003));
    m.at([-0.0425, 0.02, 0.0], [0, -Math.PI / 2, 0], () => m.decal('cal9', 0.1, 0.014, 0xd8d0a0));
    m.use(F.steelDark);
    m.at([0.0, 0.076, 0.0], null, () => m.box(0.05, 0.014, 0.05, 0.002, 0.003));
    m.at([-0.0445, -0.022, 0], null, () => { m.use(F.steelDark); m.box(0.003, 0.012, 0.045, 0.0009); });
  });
  // The chute is one part so a whole run of it can be shaken by the feed.
  m.part('chute', [-0.062, 0.078, -0.015], () => {
    const links = 14;
    const path: V3[] = [];
    for (let i = 0; i <= links; i++) {
      const t = i / links;
      path.push([-0.04 + t * 0.078, Math.sin(t * Math.PI) * 0.058 - 0.002 + t * 0.012, Math.sin(t * Math.PI) * 0.012]);
    }
    for (let i = 0; i < links; i++) {
      const p = path[i]!;
      const q = path[i + 1]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      m.at([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [0, 0, Math.atan2(dy, dx)], () => {
        m.use(i % 2 === 0 ? F.steelDark : F.anodized);
        m.box(0.0062, 0.0115, 0.056, 0.0012, 0.002);
      });
    }
  });
}

function buildBuzzsaw(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  housing(m);
  barrels(m);
  ammoCan(m);
  m.at([0.05, 0.13, 0.1], null, () => { m.use(F.rubber); hose(m, [[0, 0, 0.05], [0.012, 0.012, 0.0], [0.006, 0.004, -0.08], [-0.012, -0.006, -0.16]], 0.0048, 14, F.rubber); });
  m.at([0.05, 0.12, 0.12], null, () => clampBand(m, 0.006, 0.006, F.steel));
  m.part('crank', [-0.0505, 0.108, 0.05], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0078, 0.008, 16));
    m.at([-0.006, 0, -0.022], null, () => m.box(0.005, 0.009, 0.05, 0.0014, 0.002));
    m.use(F.red);
    m.at([-0.012, 0, -0.044], [0, Math.PI / 2, 0], () => m.cyl(0.0056, 0.016, 12));
  });
  m.part('trigger', [0, -0.018, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { screens: { ammo: [176, 96] } });
  model.socket('muzzle', [0, AXIS + R_BARREL, -0.17 - 0.5]);
  model.socket('eject', [0.05, 0.04, -0.09]);
  model.hand('gripR', [0.018, -0.056, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, -0.066, -0.12], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('canHold', [-0.05, 0.0, 0.02], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'can');
  model.hand('crankHold', [-0.018, 0, -0.044], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'crank');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.06, 0.24);
  P.barrels!.rotation.z += a.spin;

  // Spin torque rolls the gun a touch against the barrels, and the belt chatters while it feeds.
  const s = a.spinRate / 30;
  a.gunR.z += s * 0.012;
  a.gunP.x += Math.sin(a.time * 87) * s * 0.0011;
  a.gunP.y += Math.sin(a.time * 113) * s * 0.0011;
  const feed = a.sinceFire < 0.08 ? 1 : 0;
  P.chute!.position.y += Math.sin(a.time * 71) * 0.0018 * feed;
  P.chute!.position.x += Math.sin(a.time * 97) * 0.0012 * feed;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.05;
    a.gunR.z -= k * 0.14;
  }
  const p = a.reload;
  if (p < 0) return;

  // Swap the can: pop it, let it fall, bring the new one up, seat it, wind the crank.
  const drop = inQuad(seg(p, 0.1, 0.3));
  const rise = 1 - outCubic(seg(p, 0.36, 0.58));
  const can = P.can!;
  const off = p < 0.33 ? drop : rise;
  can.position.y -= off * 0.42;
  can.position.x -= off * 0.1;
  can.rotation.z += off * 0.4;
  if (p > 0.3 && p < 0.37) can.visible = false;
  // The chute lifts clear of the can while it is out.
  P.chute!.rotation.z += hold(p, 0.05, 0.14, 0.56, 0.66) * 0.5;
  const seat = p >= 0.575 ? thud(seg(p, 0.575, 0.7)) : 0;
  // One hard throw of the feed lever. Winding it round would drag the wrist through a full circle.
  P.crank!.rotation.x += hold(p, 0.74, 0.84, 0.86, 0.92) * 0.85;

  const present = hold(p, 0, 0.12, 0.88, 1);
  a.gunR.z -= present * 0.28;
  a.gunR.x += present * 0.1 + seat * 0.03;
  a.gunP.x -= present * 0.06;
  a.gunP.y += present * 0.04;
  a.gunP.z += present * 0.08;

  const h = a.left;
  h.fingerRate = 34;
  h.to('canHold', inOut(seg(p, 0.03, 0.1)));
  h.to('pouchL', inOut(seg(p, 0.24, 0.34)));
  h.to('canHold', inOut(seg(p, 0.36, 0.46)));
  h.to('crankHold', inOut(seg(p, 0.64, 0.72)));
  h.to('gripL', inOut(seg(p, 0.92, 1)));
  h.shape(HANDS.cup, hold(p, 0.04, 0.1, 0.58, 0.62));
  h.shape(HANDS.foregrip, hold(p, 0.66, 0.72, 0.92, 0.96));
}

export function buzzsawDef(kit: Kit): ViewDef {
  return {
    id: 'buzzsaw',
    model: buildBuzzsaw(kit),
    pos: [0.21, -0.222, -0.44],
    rot: [0.04, 0.06, 0],
    recoil: { back: 0.0075, lift: 0.0012, pitch: 0.0055, yaw: 0.0016, roll: 0.0016, omega: 74, zeta: 0.55 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.0058,
    spinMax: 30,
    animate: clip,
    readout: a => drawCount(a, 'ammo', 3, 4, '#ffb43a'),
  };
}

