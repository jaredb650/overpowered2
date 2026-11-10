/**
 * The Trommel: a 20 mm rotary cannon carried at the hip, and what key 8 holds since the Buzzsaw's rework (its id is still
 * `buzzsaw`). Six barrels as thick as a wrist in a cluster twice the width of the old one, clamped by a heavy muzzle ring
 * where the saw disc was, turning in a deep slab-sided housing with a drive motor in its flank. A steel can of 20 mm on
 * the left feeds it through a chute of fat links. Nothing on it is toothed and nothing on it is red.
 *
 * It shakes: `clip` hammers the whole gun about while rounds are leaving, on top of the recoil spring, and the can and
 * the chute rattle against it. Origin at the top of the rear grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { clampBand, hexBolt, hexX, hose, rivet } from '../kit/details';
import { hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger } from './common';

/** Height of the cluster's axis over the grip. */
const AXIS = 0.08;
/** Barrel centres sit on this circle. */
const R_CLUSTER = 0.041;
const BARRELS = 6;
/** Outside radius of a barrel along its length, and of its bore: 20 mm across. */
const R_BARREL = 0.0152;
const R_BORE = 0.01;
/** Where the cluster starts, and how far the muzzles are ahead of that. */
const NOSE = -0.19;
const LENGTH = 0.46;
/** Half width of the housing. */
const HALF = 0.064;
/** Radians a second at full spin. Under a third of a barrel a frame at 60 Hz, so it reads as turning and not as a strobe. */
const SPIN_MAX = 24;

/** Holes for the six barrels, or for whatever sits between them when `offset` is half a step. */
function ring(radius: number, hole: number, offset = 0, seg = 14): V2[][] {
  const out: V2[][] = [];
  for (let i = 0; i < BARRELS; i++) {
    const a = ((i + offset) / BARRELS) * Math.PI * 2;
    out.push(circle(Math.cos(a) * radius, Math.sin(a) * radius, hole, seg));
  }
  return out;
}

function housing(m: Mesher): void {
  // One deep slab: half as wide again as the old gun's and taller, with a heavy chamfer along the top.
  m.use(F.parkerized);
  m.side(poly([[0.19, 0.0], [0.196, 0.118, 0.014], [0.172, 0.15, 0.014], [-0.03, 0.156, 0.02], [-0.158, 0.15, 0.012], [-0.172, 0.104], [-0.172, 0.024, 0.012], [-0.136, 0.0, 0.012]], 0.004), HALF * 2, { bevel: 0.0045 });
  // Bolted flank plates, slotted over the drive and cut open over the motor.
  const panel = poly([[0.172, 0.018], [0.177, 0.11, 0.01], [0.158, 0.134, 0.01], [-0.026, 0.14, 0.012], [-0.144, 0.134, 0.01], [-0.152, 0.104], [-0.152, 0.026, 0.008], [-0.124, 0.014, 0.008]], 0.003);
  m.use(F.anodized);
  m.mirror(() => m.at([HALF + 0.0022, 0, 0], null, () => m.side(panel, 0.0046, {
    bevel: 0.0014,
    holes: [...slotRow(-0.132, 0.05, -0.05, 0.05, 5, 0.052, 0.009, Math.PI / 2), rect(0.04, 0.03, 0.158, 0.114, 0.006)],
  })));
  m.use(F.black);
  m.mirror(() => m.at([HALF + 0.0004, 0.072, 0.099], null, () => m.box(0.0012, 0.07, 0.116, 0)));
  m.mirror(() => {
    for (const [y, z] of [[0.124, 0.166], [0.024, 0.166], [0.126, -0.136], [0.028, -0.136], [0.13, 0.016], [0.02, 0.016]] as const) hexX(m, HALF + 0.0046, y, z, 1, 0.0046);
  });

  // Drive motor in the flank window: a fat finned can with a bright end bell and its cable.
  m.at([-(HALF - 0.012), 0.072, 0.099], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.0, 0.056, 0], [0.03, 0.056], [0.033, 0.051], [0.033, -0.051], [0.03, -0.056], [0, -0.056, 0]], 24);
    m.use(F.anodizedGrey);
    for (let i = 0; i < 11; i++) m.at([0, 0, -0.043 + i * 0.0086], null, () => m.lathe([[0.0325, 0.0021, 0], [0.0372, 0.0021], [0.0372, -0.0021], [0.0325, -0.0021, 0]], 24, { chamfer: 0.0006 }));
    m.use(F.steel);
    m.at([0, 0, 0.058], null, () => m.cyl(0.014, 0.008, 16));
  });
  m.at([-(HALF + 0.005), 0.126, 0.168], [0, -Math.PI / 2, 0], () => m.decal('trommel', 0.05, 0.01, 0xd8d0a0));
  m.at([-(HALF + 0.005), 0.027, -0.05], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.13, 0.012, 0xc9a227));
  m.at([-(HALF + 0.005), 0.126, -0.1], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.05, 0.0056, 0x8f949a));

  // Round count, tilted back to the eye.
  m.at([-0.02, 0.153, 0.118], [-Math.PI / 2 + 0.2, 0, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.024, -0.04, 0.024, 0.04, 0.003), 0.004, { bevel: 0.001 });
    m.use(F.black);
    m.at([0, 0, 0.0017], null, () => m.prism(rect(-0.021, -0.037, 0.021, 0.037, 0.0012), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.0027], [0, 0, Math.PI / 2], () => m.screen('ammo', 0.07, 0.038));
  });
  // Top deck: a slab of heat sink over the drive, and the conduit that feeds it. The camera sees this face most.
  m.use(F.anodized);
  m.at([0, 0.158, -0.064], null, () => m.box(0.1, 0.006, 0.19, 0.0014, 0.004));
  m.use(F.steelDark);
  for (let i = 0; i < 8; i++) m.at([0, 0.169, -0.142 + i * 0.0222], null, () => m.box(0.09, 0.016, 0.0094, 0.0016, 0.002));
  m.use(F.copper);
  for (const x of [-0.055, -0.046]) m.tube([[x, 0.153, 0.07], [x, 0.16, 0.046], [x, 0.163, -0.02], [x, 0.163, -0.12], [x, 0.154, -0.156]], 0.0028, { seg: 6, samples: 18 });
  m.use(F.polymerGrey);
  m.at([0.036, 0.154, 0.146], null, () => m.box(0.028, 0.008, 0.056, 0.0016, 0.003));
  m.use(F.yellow);
  m.at([0.036, 0.1595, 0.164], null, () => m.box(0.015, 0.004, 0.011, 0.001));
  m.glow('status', () => m.at([0.036, 0.159, 0.134], [Math.PI / 2, 0, 0], () => m.cyl(0.0026, 0.002, 8, 0)));

  // Carry handle over the top: thick bar on two welded feet. The outline's second hump.
  m.use(F.steelDark);
  m.tube([[0.03, 0.156, -0.13], [0.03, 0.2, -0.108], [0.03, 0.214, -0.04], [0.03, 0.206, 0.02], [0.03, 0.156, 0.044]], 0.0072, { seg: 10, samples: 26, tension: 0.4 });
  for (const z of [-0.13, 0.044]) m.at([0.03, 0.159, z], null, () => m.box(0.026, 0.006, 0.03, 0.0014, 0.003));
  m.use(F.rubber);
  m.tube([[0.03, 0.211, -0.082], [0.03, 0.213, -0.008]], 0.0112, { seg: 12, samples: 4 });

  // Rear grip block and trigger group.
  m.use(F.parkerized);
  m.side(poly([[0.118, 0.004], [0.114, -0.014, 0.006], [0.094, -0.02, 0.006], [-0.056, -0.02, 0.006], [-0.062, 0.004]], 0.003), 0.058, { bevel: 0.0022 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.018], [0.021, -0.04], [0.028, -0.062], [0.036, -0.084], [0.044, -0.116]], 4);
  const back = curve([[0.1, -0.116], [0.096, -0.082], [0.088, -0.048], [0.082, -0.018]], 4);
  m.side([...front, [0.046, -0.122], [0.098, -0.122], ...back], 0.034, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1245, 0.073], null, () => m.box(0.036, 0.006, 0.058, 0.0014, 0.003));
  m.use(F.steelDark);
  m.side(poly([[-0.04, -0.018], [-0.044, -0.036, 0.006], [-0.026, -0.052, 0.008], [0.03, -0.052, 0.008], [0.05, -0.024, 0.004], [0.05, -0.018]], 0.002), 0.014, {
    bevel: 0.0013,
    holes: [poly([[-0.035, -0.02], [-0.037, -0.034, 0.005], [-0.023, -0.0465, 0.005], [0.022, -0.0465, 0.005], [0.041, -0.0235, 0.003], [0.042, -0.02]], 0.002)],
  });

  // Forward grip under the nose, on a block bolted to the housing.
  m.use(F.parkerized);
  m.at([0, -0.007, -0.126], null, () => m.box(0.052, 0.016, 0.07, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, -0.016, -0.126], null, () => {
    const f = curve([[-0.021, 0], [-0.0245, -0.03], [-0.0255, -0.06], [-0.021, -0.1]], 4);
    const b = curve([[0.025, -0.1], [0.027, -0.06], [0.025, -0.03], [0.021, 0]], 4);
    m.side([...f, ...b], 0.034, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, -0.119, -0.126], null, () => m.box(0.037, 0.006, 0.052, 0.0014, 0.003));

  // Nose bearing the cluster turns in: a steel collar as wide as the housing with a brass race.
  m.at([0, AXIS, -0.172], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.068, 0.024, 0], [0.074, 0.019], [0.074, -0.014], [0.069, -0.021], [0.063, -0.024, 0]], 40);
    m.use(F.brass);
    m.lathe([[0.058, -0.021, 0], [0.063, -0.024], [0.063, -0.03], [0.058, -0.03, 0]], 34);
    m.use(F.steelDark);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      m.at([Math.cos(a) * 0.0705, Math.sin(a) * 0.0705, -0.0205], [Math.PI, 0, 0], () => hexBolt(m, 0.0034));
    }
  });
}

function barrels(m: Mesher): void {
  m.part('barrels', [0, AXIS, NOSE], () => {
    const zf = -LENGTH;
    for (let i = 0; i < BARRELS; i++) {
      const a = (i / BARRELS) * Math.PI * 2;
      m.at([Math.cos(a) * R_CLUSTER, Math.sin(a) * R_CLUSTER, 0], null, () => {
        // A breech sleeve, the long run, and a collar at the muzzle heavier than the tube behind it.
        m.use(F.barrel);
        m.lathe([[0.0178, 0.0, 0], [0.0178, -0.036], [R_BARREL, -0.042], [R_BARREL, zf + 0.058], [0.0176, zf + 0.053], [0.0176, zf + 0.002], [0.0166, zf], [R_BORE, zf - 0.001, 0]], 16);
        m.use(F.black);
        m.lathe([[R_BORE, zf - 0.001, 0], [R_BORE - 0.0006, zf + 0.016, 0], [0, zf + 0.0165, 0]], 12);
      });
    }
    // Support plates along the cluster: thick spun steel, lightened between the spindle and the tubes.
    const plate = (z: number, r: number, depth: number) => m.at([0, 0, z], null, () => {
      m.front(circle(0, 0, r, 36), depth, { bevel: 0.0022, holes: ring(0.0215, 0.0042, 0.5, 10), smooth: 30 });
    });
    m.use(F.steelDark);
    plate(-0.014, 0.063, 0.026);
    plate(-0.2, 0.0605, 0.02);
    // Central spindle, as thick as one of the old gun's barrels.
    m.use(F.steel);
    m.lathe([[0.012, 0.0, 0], [0.012, zf + 0.044, 0]], 14);
    // The muzzle ring: a heavy clamp the six collars sit in, where the saw disc used to be. Plain round steel.
    m.use(F.steelDark);
    m.at([0, 0, zf + 0.03], null, () => m.front(circle(0, 0, 0.0655, 40), 0.03, { bevel: 0.0026, holes: ring(R_CLUSTER, 0.0178, 0, 16), smooth: 30 }));
    m.use(F.steel);
    m.at([0, 0, zf + 0.0152], [Math.PI, 0, 0], () => hexBolt(m, 0.0085, F.steel));
    m.use(F.steelDark);
    for (let i = 0; i < BARRELS; i++) {
      const a = ((i + 0.5) / BARRELS) * Math.PI * 2;
      m.at([Math.cos(a) * 0.056, Math.sin(a) * 0.056, zf + 0.0152], [Math.PI, 0, 0], () => rivet(m, 0.003));
    }
  });
}

function ammoCan(m: Mesher): void {
  m.part('can', [-(HALF + 0.066), -0.012, -0.01], () => {
    m.use(F.olive);
    m.box(0.104, 0.158, 0.224, 0.0034, 0.007);
    m.use(F.oliveDark);
    for (const z of [-0.088, -0.035, 0.035, 0.088]) m.at([-0.053, 0, z], null, () => m.box(0.004, 0.146, 0.014, 0.001));
    m.at([0, 0.08, 0], null, () => m.box(0.104, 0.007, 0.224, 0.0018, 0.003));
    m.at([-0.0535, 0.03, 0.0], [0, -Math.PI / 2, 0], () => m.decal('cal20', 0.116, 0.018, 0xd8d0a0));
    m.at([-0.0535, -0.03, 0.0], [0, -Math.PI / 2, 0], () => m.decal('he', 0.03, 0.012, 0xc9a227));
    m.use(F.steelDark);
    m.at([0.0, 0.092, 0.0], null, () => m.box(0.064, 0.018, 0.064, 0.002, 0.003));
    m.at([-0.0555, -0.04, 0], null, () => m.box(0.0036, 0.014, 0.054, 0.001));
  });
  // The chute is one part so a whole run of it can be shaken by the feed. Links as wide as a 20 mm round is long.
  m.part('chute', [-(HALF + 0.016), 0.096, -0.01], () => {
    const links = 13;
    const path: V3[] = [];
    for (let i = 0; i <= links; i++) {
      const t = i / links;
      path.push([-0.05 + t * 0.086, Math.sin(t * Math.PI) * 0.066 - 0.002 + t * 0.02, Math.sin(t * Math.PI) * 0.014]);
    }
    for (let i = 0; i < links; i++) {
      const p = path[i]!;
      const q = path[i + 1]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      m.at([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [0, 0, Math.atan2(dy, dx)], () => {
        m.use(i % 2 === 0 ? F.steelDark : F.anodized);
        m.box(0.0078, 0.0146, 0.074, 0.0014, 0.002);
      });
    }
  });
}

function buildTrommel(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0018;
  housing(m);
  barrels(m);
  ammoCan(m);
  m.at([HALF + 0.004, 0.152, 0.11], null, () => hose(m, [[0, 0, 0.056], [0.014, 0.014, 0.0], [0.008, 0.006, -0.09], [-0.012, -0.008, -0.18]], 0.0062, 14, F.rubber));
  m.at([HALF + 0.004, 0.142, 0.132], null, () => clampBand(m, 0.0078, 0.007, F.steel));
  m.part('crank', [-(HALF + 0.0046), 0.13, 0.06], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0098, 0.01, 16));
    m.at([-0.0075, 0, -0.027], null, () => m.box(0.006, 0.011, 0.06, 0.0016, 0.002));
    m.use(F.yellow);
    m.at([-0.015, 0, -0.053], [0, Math.PI / 2, 0], () => m.cyl(0.0068, 0.02, 12));
  });
  m.part('trigger', [0, -0.02, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0068, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { glows: { status: [0xffb43a, 5] }, screens: { ammo: [176, 96] } });
  model.socket('muzzle', [0, AXIS + R_CLUSTER, NOSE - LENGTH]);
  model.socket('eject', [HALF + 0.006, 0.04, -0.1]);
  model.hand('gripR', [0.018, -0.058, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, -0.068, -0.126], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('canHold', [-0.062, 0.0, 0.03], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'can');
  model.hand('crankHold', [-0.022, 0, -0.053], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'crank');
  return model;
}

/** Seconds the gun goes on hammering after the last round, and the fade after that. */
const FIRE_HOLD = 0.09;
const FIRE_FADE = 0.16;

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.06, 0.24);
  P.barrels!.rotation.z += a.spin;

  // Spin torque rolls the housing against the cluster, and a mass that size hums in the hands as it turns.
  const s = a.spinRate / SPIN_MAX;
  const t = a.time;
  a.gunR.z += s * 0.022;
  a.gunP.x += Math.sin(t * 53) * s * 0.0008;
  a.gunP.y += Math.sin(t * 71) * s * 0.0008;

  // Firing: the whole gun is hammered about, on top of what the recoil spring does with each round. Rates that share no
  // factor, so it never settles into a wobble. The can swings on its latch and the chute whips.
  const fire = a.sinceFire < FIRE_HOLD ? 1 : Math.max(0, 1 - (a.sinceFire - FIRE_HOLD) / FIRE_FADE);
  if (fire > 0) {
    a.gunP.x += Math.sin(t * 97) * 0.0026 * fire;
    a.gunP.y += Math.sin(t * 131 + 1) * 0.0032 * fire;
    a.gunP.z += Math.sin(t * 79 + 2) * 0.0036 * fire;
    a.gunR.x += Math.sin(t * 113) * 0.0058 * fire;
    a.gunR.y += Math.sin(t * 89 + 0.7) * 0.0046 * fire;
    a.gunR.z += Math.sin(t * 67 + 1.9) * 0.0085 * fire;
    P.can!.rotation.z += Math.sin(t * 61) * 0.014 * fire;
    P.can!.position.y += Math.sin(t * 83) * 0.0016 * fire;
    P.chute!.position.y += Math.sin(t * 71) * 0.0028 * fire;
    P.chute!.position.x += Math.sin(t * 97) * 0.0018 * fire;
    P.chute!.rotation.z += Math.sin(t * 59) * 0.03 * fire;
  }

  if (a.draw < 1) {
    // Hauled up from the hip: it arrives low and rolled over, and lands with its weight.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.075;
    a.gunR.z -= k * 0.2;
    a.gunR.x -= k * 0.08;
  }
  const p = a.reload;
  if (p < 0) return;

  // Swap the can: pop it, let it fall, bring the new one up, seat it, throw the feed lever.
  const drop = inQuad(seg(p, 0.1, 0.3));
  const rise = 1 - outCubic(seg(p, 0.36, 0.58));
  const can = P.can!;
  const off = p < 0.33 ? drop : rise;
  can.position.y -= off * 0.46;
  can.position.x -= off * 0.11;
  can.rotation.z += off * 0.4;
  if (p > 0.3 && p < 0.37) can.visible = false;
  // The chute lifts clear of the can while it is out.
  P.chute!.rotation.z += hold(p, 0.05, 0.14, 0.56, 0.66) * 0.5;
  const seat = p >= 0.575 ? thud(seg(p, 0.575, 0.7)) : 0;
  // One hard throw of the feed lever. Winding it round would drag the wrist through a full circle.
  P.crank!.rotation.x += hold(p, 0.74, 0.84, 0.86, 0.92) * 0.85;

  const present = hold(p, 0, 0.12, 0.88, 1);
  a.gunR.z -= present * 0.3;
  a.gunR.x += present * 0.1 + seat * 0.04;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.045 - seat * 0.01;
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

export function trommelDef(kit: Kit): ViewDef {
  return {
    id: 'buzzsaw',
    model: buildTrommel(kit),
    pos: [0.215, -0.238, -0.43],
    rot: [0.04, 0.06, 0],
    // Three times the old gun's travel on a slower spring: at 25 rounds a second it never comes home between two.
    recoil: { back: 0.018, lift: 0.003, pitch: 0.013, yaw: 0.005, roll: 0.007, omega: 58, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.012,
    spinMax: SPIN_MAX,
    animate: clip,
    readout: a => drawCount(a, 'ammo', 3, 4, '#ffb43a'),
  };
}
