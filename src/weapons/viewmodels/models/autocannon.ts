/**
 * The Thirty: a 30 mm belt-fed cannon cut down to something one lunatic can carry. Slab receiver, hydraulic buffers
 * either side of a barrel that really recoils, a muzzle brake the size of a head, a live belt of five shells up the
 * left flank, and a long scope that the zoom looks through. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slot, slotRow, type V2 } from '../kit/shapes';
import { hexX, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger } from './common';

const BORE = 0.086;
const PITCH = 0.04;
const ROUNDS = ['r0', 'r1', 'r2', 'r3', 'r4'] as const;
const BELT_X = -0.0715;
const BELT_Z = -0.095;
const BELT_TOP = 0.092;
const BARREL_TRAVEL = 0.07;

/**
 * The Sabot is the same cannon set up for darts: a smooth tube under a long ported sleeve where the Thirty has its
 * baffles, blue-banded rounds with a tungsten rod where the Thirty's are yellow-tipped, cold blue glass. Everything
 * the hands touch is in the same place, so the two share one reload and one draw. The shot is its own: see `Action`.
 */
interface Look {
  ap: boolean;
  /** Side armour. */
  plate: Finish;
  /** Paint on the cover latch and charging handle. */
  accent: Finish;
  caliber: string;
  stripe: number;
}

const AP_BLUE: Finish = { color: 0x1d4f93, rough: 0.42, metal: 0.1, wear: 0.9 };
const HE: Look = { ap: false, plate: F.anodized, accent: F.red, caliber: 'cal30', stripe: 0xc9a227 };
const AP: Look = { ap: true, plate: { color: 0x2a3442, rough: 0.44, metal: 0.35, wear: 0.85 }, accent: AP_BLUE, caliber: 'cal30ap', stripe: 0x3f8fe0 };

function receiver(m: Mesher, look: Look): void {
  m.use(F.parkerized);
  m.side(poly([[0.205, 0.004], [0.208, 0.112, 0.008], [0.176, 0.142, 0.012], [-0.25, 0.142, 0.008], [-0.268, 0.122, 0.006], [-0.268, 0.02, 0.008], [-0.22, -0.002, 0.008]], 0.003), 0.1, { bevel: 0.0032 });

  // Stepped side armour: three layers of plate so the big flat flank has real depth.
  const armour = poly([[0.19, 0.018], [0.192, 0.1, 0.006], [0.168, 0.126, 0.008], [-0.238, 0.126, 0.006], [-0.25, 0.11, 0.006], [-0.25, 0.024, 0.006], [-0.21, 0.012, 0.006]], 0.0025);
  m.use(look.plate);
  m.mirror(() => m.at([0.0515, 0, 0], null, () => m.side(armour, 0.004, {
    bevel: 0.0011,
    holes: [...slotRow(-0.225, 0.04, -0.13, 0.04, 6, 0.042, 0.0085, Math.PI / 2), slot(0.17, 0.104, 0.025, 0.104, 0.0052, 3)],
  })));
  m.use(F.black);
  m.mirror(() => m.at([0.0498, 0.04, -0.178], null, () => m.box(0.0012, 0.05, 0.106, 0)));
  m.mirror(() => {
    for (const [y, z] of [[0.114, 0.178], [0.114, -0.232], [0.024, 0.178], [0.03, -0.232], [0.024, 0.04], [0.114, -0.02]] as const) {
      hexX(m, 0.0536, y, z, 1, 0.0042);
    }
  });
  // Top plate carries the rail and the scope's cradle.
  m.use(F.anodized);
  m.at([0, 0.1445, -0.14], null, () => m.top(rect(-0.04, -0.125, 0.04, 0.115, 0.006), 0.005, { bevel: 0.0014 }));
  m.at([0, 0.147, -0.14], null, () => rail(m, 0.105, -0.115, 0.0212, F.anodized));
  m.at([-0.0528, 0.056, 0.12], [0, -Math.PI / 2, 0], () => m.decal(look.caliber, look.ap ? 0.1 : 0.082, 0.0125, 0xc4c8cc));
  m.at([-0.0528, 0.034, 0.1], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.11, 0.0145, 0x9aa0a6));
  m.at([-0.0528, 0.0755, 0.134], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.1, 0.012, look.stripe));
  // Rear readout, angled up at the eye.
  m.at([-0.03, 0.1455, 0.13], [-Math.PI / 2 + 0.12, 0, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.0185, -0.0345, 0.0185, 0.0345, 0.003), 0.003, { bevel: 0.0009 });
    m.use(F.black);
    m.at([0, 0, 0.0012], null, () => m.prism(rect(-0.016, -0.031, 0.016, 0.031, 0.0014), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.002], [0, 0, Math.PI / 2], () => m.screen('ammo', 0.058, 0.029));
  });

  // Lower: fire-control housing, grip, guard.
  m.use(F.parkerized);
  m.side(poly([[0.11, 0.006], [0.106, -0.012, 0.006], [0.088, -0.018, 0.006], [-0.05, -0.018, 0.006], [-0.056, 0.006]], 0.003), 0.052, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.016], [0.021, -0.04], [0.028, -0.062], [0.036, -0.084], [0.044, -0.116]], 4);
  const back = curve([[0.1, -0.116], [0.096, -0.082], [0.088, -0.048], [0.082, -0.016]], 4);
  m.side([...front, [0.046, -0.122], [0.098, -0.122], ...back], 0.033, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1245, 0.073], null, () => m.box(0.034, 0.006, 0.058, 0.0014, 0.003));
  m.use(F.steelDark);
  m.side(poly([[-0.04, -0.016], [-0.044, -0.034, 0.006], [-0.026, -0.05, 0.008], [0.03, -0.05, 0.008], [0.05, -0.022, 0.004], [0.05, -0.016]], 0.002), 0.014, {
    bevel: 0.0013,
    holes: [poly([[-0.035, -0.018], [-0.037, -0.032, 0.005], [-0.023, -0.0445, 0.005], [0.022, -0.0445, 0.005], [0.041, -0.0215, 0.003], [0.042, -0.018]], 0.002)],
  });

  // Rear buffer housing, the block that actually eats the recoil.
  m.use(F.anodized);
  m.at([0, 0.066, 0.214], null, () => m.front(poly([[-0.04, -0.052], [0.04, -0.052], [0.046, -0.04], [0.046, 0.04], [0.04, 0.052], [-0.04, 0.052], [-0.046, 0.04], [-0.046, -0.04]], 0.003), 0.024, { bevel: 0.002 }));
  m.use(F.rubber);
  m.at([0, 0.066, 0.238], null, () => m.front(rect(-0.038, -0.052, 0.038, 0.052, 0.012), 0.03, { bevel: 0.004 }));

  // Forward grip on a rail under the jacket.
  m.use(F.parkerized);
  m.at([0, -0.008, -0.24], null, () => m.box(0.044, 0.014, 0.1, 0.0022, 0.004));
  m.at([0, -0.0165, -0.24], null, () => rail(m, 0.044, -0.044, 0.0212, F.anodized));
  m.use(F.polymerStipple);
  m.at([0, -0.026, -0.24], null, () => {
    const f = curve([[-0.02, 0], [-0.0235, -0.03], [-0.0245, -0.06], [-0.02, -0.102]], 4);
    const b = curve([[0.024, -0.102], [0.026, -0.06], [0.024, -0.03], [0.02, 0]], 4);
    m.side([...f, ...b], 0.033, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, -0.131, -0.24], null, () => m.box(0.036, 0.006, 0.05, 0.0014, 0.003));
}

function buffers(m: Mesher): void {
  // Outer sleeves stay on the receiver; the chrome rods ride with the barrel.
  m.use(F.steelDark);
  for (const s of [-1, 1]) {
    m.at([s * 0.04, BORE + 0.018, 0], null, () => {
      m.lathe([[0.0145, -0.26, 0], [0.0145, -0.34], [0.016, -0.343], [0.016, -0.362], [0.013, -0.365], [0.0105, -0.365, 0]], 18);
    });
  }
}

function scope(m: Mesher): void {
  m.at([0, 0.191, -0.205], null, () => {
    // Rings.
    m.use(F.anodized);
    for (const z of [-0.075, 0.07]) {
      m.at([0, 0, z], null, () => {
        m.at([0, -0.021, 0], null, () => m.box(0.03, 0.022, 0.022, 0.0016, 0.003));
        m.lathe([[0.0252, 0.0115, 0], [0.0298, 0.0115], [0.0298, -0.0115], [0.0252, -0.0115, 0]], 26);
      });
    }
    m.use(F.polymer);
    m.lathe([[0.0225, 0.145, 0], [0.0305, 0.14], [0.031, 0.102], [0.0255, 0.084], [0.0255, -0.094], [0.038, -0.126], [0.0395, -0.168], [0.0375, -0.172], [0.031, -0.172, 0]], 32, { chamfer: 0.0015, smooth: 24 });
    m.use(F.rubber);
    m.lathe([[0.0295, 0.19, 0], [0.0305, 0.19], [0.032, 0.172], [0.03, 0.142], [0.0255, 0.142, 0]], 26);
    m.use(F.black);
    m.at([0, 0, 0.168], null, () => m.cyl(0.0268, 0.001, 22, 0));
    m.at([0, 0, -0.168], null, () => m.cyl(0.034, 0.001, 24, 0));
    m.glass(() => m.at([0, 0, -0.169], null, () => m.cyl(0.0338, 0.0006, 24, 0)));
    m.glow('scope', () => {
      m.at([0, 0, 0.1695], null, () => {
        m.prism(rect(-0.017, -0.0003, 0.017, 0.0003, 0), 0.0002, { bevel: 0 });
        m.prism(rect(-0.0003, -0.017, 0.0003, 0.017, 0), 0.0002, { bevel: 0 });
      });
    });
    // Turrets with knurled caps.
    m.at([0, 0.03, 0], [Math.PI / 2, 0, 0], () => { knurl(m, 0.0125, 0.014, F.steelDark, 24, 0.0006); m.use(F.anodized); m.at([0, 0, -0.008], null, () => m.cyl(0.0132, 0.002, 20)); });
    m.at([-0.03, 0, 0], [0, Math.PI / 2, 0], () => { knurl(m, 0.0125, 0.014, F.steelDark, 24, 0.0006); m.use(F.anodized); m.at([0, 0, 0.008], null, () => m.cyl(0.0132, 0.002, 20)); });
    m.use(F.anodizedGrey);
    m.at([0, 0.0265, 0.06], [Math.PI / 2, 0, 0], () => m.cyl(0.0052, 0.003, 12));
  });
}

function barrel(m: Mesher, look: Look): void {
  m.part('barrel', [0, BORE, -0.268], () => {
    const zEnd = -0.56;
    m.use(F.barrel);
    m.lathe([[0.033, 0.03, 0], [0.033, -0.04], [0.0285, -0.046], [0.0285, -0.08, 0]], 24);
    // Fluted: real ribs down the tube, so the barrel catches a run of highlights instead of one.
    const flutes = 8;
    if (look.ap) {
      // Smoothbore: a plain heavy tube, stepped once, with a blue band so nobody loads it with the wrong belt.
      m.lathe([[0.0285, -0.08, 0], [0.0285, -0.3], [0.0262, -0.306], [0.0262, zEnd, 0]], 26);
      m.use(AP_BLUE);
      m.lathe([[0.0266, -0.34, 0], [0.0274, -0.342], [0.0274, -0.372], [0.0266, -0.374, 0]], 26, { chamfer: 0.0004 });
    } else {
      m.surface(flutes * 6, 18, (u, v, out) => {
        const a = u * Math.PI * 2;
        const r = 0.0272 + 0.0022 * Math.cos(a * flutes) ** 2;
        out.set(Math.cos(a) * r, Math.sin(a) * r, -0.08 + v * (zEnd + 0.08));
      }, { wrapU: true, flip: true });
    }
    m.use(F.steelDark);
    // Collar where the buffer rods land.
    m.at([0, 0.009, -0.17], null, () => m.front(poly([[-0.058, -0.016], [0.058, -0.016], [0.058, 0.016, 0.012], [0.03, 0.03, 0.006], [-0.03, 0.03, 0.006], [-0.058, 0.016, 0.012]], 0.004), 0.018, { bevel: 0.002, holes: [circle(0, -0.009, 0.0285, 22)] }));
    for (const s of [-1, 1]) {
      m.use(F.chrome);
      m.at([s * 0.04, 0.018, -0.07], null, () => m.cyl(0.0088, 0.2, 16));
      m.at([s * 0.052, 0.012, -0.17], [0, s * Math.PI / 2, 0], () => m.cyl(0.0048, 0.002, 12));
    }
    // Muzzle brake: four flared baffles on two spines.
    const zb = zEnd;
    if (look.ap) {
      sleeve(m, zb);
      return;
    }
    m.use(F.barrelBlack);
    m.lathe([[0.0288, zb + 0.02, 0], [0.034, zb + 0.016], [0.034, zb - 0.015], [0.0288, zb - 0.02, 0]], 24);
    const baffle = (w: number, h: number, depth: number) => {
      m.front(poly([[-w, -h * 0.55], [w, -h * 0.55], [w + 0.006, 0], [w, h * 0.55], [-w, h * 0.55], [-w - 0.006, 0]], 0.003), depth, { bevel: 0.002, holes: [circle(0, 0, 0.0245, 22)] });
    };
    for (let i = 0; i < 4; i++) {
      const z = zb - 0.042 - i * 0.044;
      m.at([0, 0, z], null, () => baffle(0.05 - i * 0.003, 0.058, 0.015));
    }
    m.use(F.parkerized);
    for (const y of [-0.031, 0.031]) {
      m.at([0, y, zb - 0.11], null, () => m.box(0.05, 0.012, 0.19, 0.002, 0.004));
    }
    m.mirror(() => {
      for (let i = 0; i < 4; i++) {
        const z = zb - 0.042 - i * 0.044;
        m.at([0.0185, 0.0375, z], [-Math.PI / 2, 0, 0], () => rivet(m, 0.0026));
      }
    });
    m.use(F.black);
    m.at([0, 0, zb - 0.1], null, () => m.lathe([[0.0245, 0.09, 0], [0.0245, -0.1, 0]], 18));
    m.use(F.barrelBlack);
    m.lathe([[0.03, zb - 0.2, 0], [0.033, zb - 0.204], [0.033, zb - 0.222], [0.0295, zb - 0.226], [0.0245, zb - 0.226, 0]], 24);
  });
}

/** The Sabot's muzzle: a long pepperpot sleeve, three rings of ports, the same length as the Thirty's brake. */
function sleeve(m: Mesher, zb: number): void {
  m.use(F.barrelBlack);
  m.lathe([[0.0262, zb + 0.02, 0], [0.039, zb + 0.008], [0.039, zb - 0.196], [0.035, zb - 0.222], [0.031, zb - 0.226], [0.0215, zb - 0.226, 0]], 28, { chamfer: 0.0012 });
  m.use(F.steelDark);
  for (const z of [zb - 0.012, zb - 0.1, zb - 0.188]) m.at([0, 0, z], null, () => m.lathe([[0.039, 0.007, 0], [0.0412, 0.005], [0.0412, -0.005], [0.039, -0.007, 0]], 28, { chamfer: 0.0006 }));
  m.use(F.black);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + row * (Math.PI / 8);
      for (let k = 0; k < 3; k++) {
        const z = zb - 0.034 - row * 0.088 - k * 0.02;
        m.at([Math.cos(a) * 0.0388, Math.sin(a) * 0.0388, z], [0, 0, a], () => m.box(0.0012, 0.0105, 0.0125, 0.0003));
      }
    }
  }
  m.at([0, 0, zb - 0.1], null, () => m.lathe([[0.0215, 0.09, 0], [0.0215, -0.126, 0]], 18));
}

/** A fin-stabilised dart in its sabot: the case is the Thirty's, everything ahead of it is not. */
function dart(m: Mesher): void {
  m.use(F.brass);
  m.lathe([[0, 0.1, 0], [0.0165, 0.1], [0.0165, 0.094], [0.0148, 0.092], [0.015, 0.088], [0.0152, -0.012], [0.0128, -0.028], [0.0118, -0.03, 0]], 18, { chamfer: 0.0006 });
  m.use(AP_BLUE);
  m.lathe([[0.0118, -0.03, 0], [0.0118, -0.05], [0.0126, -0.052], [0.0126, -0.062], [0.0106, -0.066], [0.0062, -0.07, 0]], 18, { chamfer: 0.0004 });
  m.use({ color: 0x565a60, rough: 0.3, metal: 1, wear: 0.1 });
  m.lathe([[0.0046, -0.07, 0], [0.0046, -0.1], [0.0026, -0.116], [0, -0.122, 0]], 12, { chamfer: 0 });
}

function shell(m: Mesher): void {
  // A 30 mm round lying along Z with its head at +Z. Scaled to read at arm's length, not to fit a NATO drawing.
  m.use(F.brass);
  m.lathe([[0, 0.1, 0], [0.0165, 0.1], [0.0165, 0.094], [0.0148, 0.092], [0.015, 0.088], [0.0152, -0.012], [0.0128, -0.028], [0.0118, -0.03, 0]], 18, { chamfer: 0.0006 });
  m.use({ color: 0x2d2f33, rough: 0.5, metal: 0.4, wear: 0.4 });
  m.lathe([[0.0118, -0.03, 0], [0.0118, -0.042], [0.0124, -0.044], [0.0124, -0.052], [0.0118, -0.054], [0.0112, -0.08], [0.0085, -0.098, 0]], 18, { chamfer: 0.0004 });
  m.use(F.yellow);
  m.lathe([[0.0085, -0.098, 0], [0.0055, -0.11], [0.0022, -0.119], [0, -0.12, 0]], 18, { chamfer: 0 });
}

function belt(m: Mesher, look: Look): void {
  m.part('belt', [BELT_X, BELT_TOP, BELT_Z], () => {
    for (let i = 0; i < ROUNDS.length; i++) {
      m.part(ROUNDS[i]!, [0, -i * PITCH, 0], () => {
        if (look.ap) dart(m);
        else shell(m);
        // Steel link clipped round the case.
        m.use(F.steelDark);
        for (const z of [0.05, -0.002]) m.at([0, 0, z], null, () => m.lathe([[0.0156, 0.0065, 0], [0.0176, 0.0065], [0.0176, -0.0065], [0.0156, -0.0065, 0]], 18, { a0: -0.7, a1: Math.PI + 0.7, chamfer: 0.0005 }));
      });
    }
  });
}

function feed(m: Mesher): void {
  // Guide posts that keep the belt from flapping.
  m.use(F.steelDark);
  for (const z of [BELT_Z - 0.084, BELT_Z + 0.106]) {
    m.at([-0.0625, 0.0, z], null, () => m.box(0.022, 0.17, 0.008, 0.0012, 0.002));
    m.at([-0.0875, -0.082, z], null, () => m.box(0.04, 0.008, 0.008, 0.0012, 0.002));
  }
  // Rear top plate: an access panel with a slotted grille.
  m.at([0, 0.1445, 0.11], null, () => {
    m.use(F.anodizedGrey);
    m.top(poly([[-0.05, -0.0855], [0.05, -0.0855], [0.05, 0.085], [-0.05, 0.085]], 0.005), 0.012, { bevel: 0.002 });
    m.use(F.anodized);
    m.at([0, 0.008, 0], null, () => m.top(poly([[-0.04, -0.07], [0.04, -0.07], [0.04, 0.07], [-0.04, 0.07]], 0.006), 0.006, { bevel: 0.0016, holes: slotRow(-0.024, 0, 0.024, 0, 4, 0.1, 0.0065, Math.PI / 2) }));
    m.use(F.black);
    m.at([0, 0.0065, 0], null, () => m.box(0.07, 0.0015, 0.13, 0));
  });
}

/** The hood the belt climbs into. It hinges along the receiver's top edge, and is the door a new belt goes in through. */
function cover(m: Mesher, look: Look): void {
  m.part('cover', [-0.05, 0.142, BELT_Z], () => {
    m.use(F.anodized);
    m.at([-0.0235, -0.024, 0], null, () => {
      m.front(poly([[-0.026, -0.02], [0.022, -0.02], [0.022, 0.024, 0.004], [-0.01, 0.024, 0.008], [-0.026, 0.008, 0.008]], 0.003), 0.15, { bevel: 0.0022 });
      m.use(F.anodizedGrey);
      for (const z of [-0.058, 0.058]) m.at([0, 0, z], null, () => m.front(poly([[-0.0275, -0.022], [0.023, -0.022], [0.023, 0.026, 0.004], [-0.01, 0.026, 0.008], [-0.0275, 0.009, 0.008]], 0.003), 0.012, { bevel: 0.0014 }));
      screwX(m, -0.0268, 0.0, 0.0, -1, 0.0028);
      m.use(look.accent);
      m.at([-0.0285, -0.006, 0], null, () => m.box(0.0055, 0.012, 0.04, 0.0014, 0.002));
    });
    m.use(F.steel);
    m.cyl(0.0038, 0.16, 12);
  });
}

function charge(m: Mesher, look: Look): void {
  m.part('charge', [-0.0575, 0.104, 0.06], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.008, 0.0078, 0.024, 0.0012));
    m.at([-0.012, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.02, 12));
    m.use(look.accent);
    m.at([-0.026, 0, 0], null, () => {
      const t: V2[] = [[-0.022, -0.0052], [0.022, -0.0052], [0.022, 0.0052], [-0.022, 0.0052]];
      m.top(t.map(p => [p[1], p[0]] as V2), 0.011, { bevel: 0.0022 });
    });
  });
}

function buildCannon(kit: Kit, look: Look): Model {
  const m = kit.mesher();
  m.bevel = 0.0018;
  receiver(m, look);
  buffers(m);
  scope(m);
  feed(m);
  barrel(m, look);
  belt(m, look);
  cover(m, look);
  charge(m, look);
  m.part('trigger', [0, -0.018, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: { scope: [look.ap ? 0x39b8ff : 0xff3a22, 2.4] },
    screens: { ammo: [176, 88] },
  });
  model.socket('muzzle', [0, BORE, -0.268 - 0.79]);
  model.socket('eject', [0.056, 0.08, 0.02]);
  model.hand('gripR', [0.018, -0.056, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, -0.082, -0.24], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('coverHold', [-0.06, -0.03, 0], [-0.1, 0.1, -0.98], [0.75, 0.6, -0.1], 'cover');
  model.hand('beltHold', [-0.022, -0.1, 0.02], [-0.1, 0.1, -0.98], [0.9, 0.1, -0.2], 'belt');
  model.hand('chargeHold', [-0.03, 0, 0.012], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

/** How the gun works on a shot. */
interface Action {
  /** How far the barrel runs back, and how long it takes to come home. */
  travel: number;
  home: number;
  /** How far the charging handle is thrown back with it. */
  handle: number;
}

/** The Thirty's brake bleeds the shot off at the muzzle: a short stroke, home before the next round at 0.15 s. */
const SHORT_RECOIL: Action = { travel: BARREL_TRAVEL, home: 0.14, handle: 0 };
/**
 * The Sabot has no brake, only a sleeve. The whole barrel runs back half as far again, takes the handle with it, and rides
 * home on its buffers through most of the 0.45 s before the next dart.
 */
const LONG_RECOIL: Action = { travel: 0.105, home: 0.36, handle: 0.05 };

const clip = (act: Action) => (a: Anim): void => {
  const P = a.parts;
  pullTrigger(a, 0.08);
  const t = a.sinceFire;
  // Peak on the frame of the shot, home before the next one.
  const kick = t < act.home ? (1 - t / act.home) ** 2 : 0;
  P.barrel!.position.z += kick * act.travel;
  // Thrown back with the barrel, and home well before it.
  if (act.handle > 0) P.charge!.position.z += (t < act.home * 0.5 ? (1 - t / (act.home * 0.5)) ** 2 : 0) * act.handle;
  a.glow('scope', 1);

  const p = a.reload;
  const spent = Math.max(0, a.magSize - a.mag);
  // The belt jumps up one link on each shot.
  const lag = 1 - outCubic(seg(t, 0.02, 0.1));
  let lift = (spent - lag * (spent > 0 ? 1 : 0)) * PITCH;
  for (let i = 0; i < ROUNDS.length; i++) P[ROUNDS[i]!]!.visible = p >= 0.32 || i >= spent;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.05;
    a.gunR.z -= k * 0.14;
    P.charge!.position.z += bump(a.draw, 0.3, 1) * 0.1;
  }
  if (p >= 0) {
    const coverUp = inOut(seg(p, 0.1, 0.2)) * (1 - inQuad(seg(p, 0.6, 0.66)));
    const slam = p >= 0.66 ? thud(seg(p, 0.66, 0.78)) : 0;
    P.cover!.rotation.z -= coverUp * 1.2 + slam * 0.05;
    if (p < 0.32) lift -= inQuad(seg(p, 0.14, 0.3)) * 0.5;
    else lift = -(1 - outCubic(seg(p, 0.32, 0.56))) * 0.5;

    const rack = hold(p, 0.74, 0.84, 0.86, 0.9);
    P.charge!.position.z += rack * 0.11;
    P.barrel!.position.z += rack * 0.02;

    const present = hold(p, 0.0, 0.12, 0.84, 1);
    a.gunR.z -= present * 0.32;
    a.gunR.x += present * 0.14 + slam * 0.03;
    a.gunR.y += present * 0.06;
    a.gunP.x -= present * 0.06;
    a.gunP.y += present * 0.03;
    a.gunP.z += present * 0.08 + rack * 0.016;

    const h = a.left;
    h.fingerRate = 36;
    h.to('coverHold', inOut(seg(p, 0.01, 0.09)));
    h.to('beltHold', inOut(seg(p, 0.14, 0.34)));
    h.to('coverHold', inOut(seg(p, 0.52, 0.59)));
    h.to('chargeHold', inOut(seg(p, 0.67, 0.74)));
    h.to('gripL', inOut(seg(p, 0.9, 1)));
    h.shape(HANDS.pinch, hold(p, 0.02, 0.08, 0.12, 0.17));
    h.shape(HANDS.cup, hold(p, 0.26, 0.34, 0.5, 0.55));
    h.shape(HANDS.foregrip, hold(p, 0.68, 0.74, 0.9, 0.95));
  }
  P.belt!.position.y += lift;
};

export function autocannonDef(kit: Kit): ViewDef {
  return {
    id: 'autocannon',
    model: buildCannon(kit, HE),
    pos: [0.235, -0.27, -0.46],
    rot: [0.012, 0.05, 0],
    recoil: { back: 0.1, lift: 0.024, pitch: 0.12, yaw: 0.016, roll: 0.05, omega: 28, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.16,
    animate: clip(SHORT_RECOIL),
    readout: a => drawCount(a, 'ammo', 1, 5, '#ffb43a'),
  };
}

/** Slot 4's second member. More travel in the hands and in the barrel than the Thirty: nothing bleeds the recoil off at the muzzle. */
export function sabotDef(kit: Kit): ViewDef {
  return {
    id: 'sabot',
    model: buildCannon(kit, AP),
    pos: [0.235, -0.27, -0.46],
    rot: [0.012, 0.05, 0],
    recoil: { back: 0.12, lift: 0.02, pitch: 0.1, yaw: 0.012, roll: 0.04, omega: 30, zeta: 0.46 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.2,
    animate: clip(LONG_RECOIL),
    readout: a => drawCount(a, 'ammo', 1, 5, '#5ac8ff'),
  };
}
