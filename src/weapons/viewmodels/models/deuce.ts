/**
 * The Deuce: a side-by-side double twelve-gauge, cut short. A boxlock action in parkerized steel, two fat barrels on a
 * monoblock with a flat rib between them, a walnut beavertail and the Breacher's stock. It breaks open on a hinge pin to
 * load: the top lever goes over, the barrels drop, the ejectors throw both empties and two shells go in by hand.
 * Two mods (src/weapons/mods.ts): the quad barrels, a second pair stacked on the first under a tall breech, and the speed
 * loader, a two-shell clip carried on the stock that the hand pushes into a pair of chambers at once.
 * Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { poly } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { BREAK } from '../../data';
import { HANDS } from '../poses';
import { pullTrigger, shell12 } from './common';
import { stock } from './shotgun';

const BORE = 0.034;
/** Each barrel's axis sits this far either side of the middle: the two touch along the rib. */
const BX = 0.0168;
const R = 0.0165;
const BREECH = -0.012;
const MUZZLE = -0.46;
/** The hinge pin, at the front of the action under the barrels. Barrels-part space is measured from it. */
const HY = 0.004;
const HZ = -0.088;
/** The quad's upper pair: its axis, just clear of the lower barrels. */
const UP = BORE + 2 * R + 0.0012;
/** Radians the barrels drop when it breaks open. */
const OPEN = 0.6;
/** Seconds to bring a shell or a clip from the belt to its chambers. */
const FETCH = 0.195;
/** Chamber `i` in the barrels' frame: 0 and 1 the lower pair (right, left, as they fire), 2 and 3 the quad's upper pair. */
const cx = (i: number) => (i % 2 === 0 ? BX : -BX);
const cy = (i: number) => (i < 2 ? BORE : UP) - HY;

function action(m: Mesher): void {
  m.use(F.parkerized);
  // Standing breech and the water table the barrels close down onto, one piece, rounded into the knuckle at the front.
  m.side(poly([
    [0.074, -0.02], [0.076, 0.03, 0.006], [0.06, 0.052, 0.008], [BREECH, 0.052, 0.003], [BREECH, 0.014],
    [HZ - 0.002, 0.014, 0.002], [HZ - 0.012, 0.004, 0.009], [HZ - 0.006, -0.018, 0.008], [0.02, -0.024, 0.004],
  ], 0.002), 0.064, { bevel: 0.0024 });
  // Fences: the shoulders round each breech, so the action reads as two guns joined.
  m.use(F.steelDark);
  m.mirror(() => m.at([BX, BORE, BREECH + 0.006], null, () => m.lathe([[R + 0.003, 0.006, 0], [R + 0.003, -0.002, 0.002], [R - 0.002, -0.006, 0]], 22, { a0: -0.4, a1: Math.PI + 0.4 })));
  // Side plates with a sunk panel, the hinge pin's head, and screws.
  m.mirror(() => {
    m.at([0.0322, 0, 0], null, () => m.side(poly([[0.06, -0.016], [0.062, 0.04, 0.006], [0.0, 0.046, 0.004], [-0.004, -0.018, 0.004]], 0.002), 0.0018, { bevel: 0.0005 }));
    m.at([0.0329, HY, HZ], [0, Math.PI / 2, 0], () => m.lathe([[0.0062, 0.0012, 0], [0.0062, -0.0006], [0.004, -0.0014, 0]], 18));
    screwX(m, 0.0329, 0.028, 0.038, 1, 0.0022);
    screwX(m, 0.0329, -0.006, 0.012, 1, 0.0022);
  });
  m.at([-0.0333, 0.02, 0.03], [0, -Math.PI / 2, 0], () => m.decal('deuce', 0.044, 0.011, 0xb9bec4));
  m.at([-0.0333, 0.004, 0.03], [0, -Math.PI / 2, 0], () => m.decal('cal12', 0.042, 0.0062, 0x9aa0a6));
  // Trigger guard, the Breacher's, and the rear trigger that fires the left barrel.
  m.use(F.steelDark);
  m.at([0, -0.006, 0], null, () => {
    const out = poly([[-0.03, -0.018], [-0.034, -0.03, 0.006], [-0.022, -0.046, 0.008], [0.028, -0.046, 0.008], [0.042, -0.02, 0.004], [0.042, -0.018]], 0.002);
    const inner = poly([[-0.026, -0.02], [-0.028, -0.029, 0.005], [-0.019, -0.0415, 0.005], [0.024, -0.0415, 0.005], [0.036, -0.021, 0.003], [0.036, -0.02]], 0.002);
    m.side(out, 0.0125, { bevel: 0.0012, holes: [inner] });
  });
  m.at([0, -0.024, 0.014], null, () => m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.008, 0.002], [0.0036, -0.017, 0.0015], [0.0005, -0.018, 0.001], [-0.0035, -0.008, 0.003]], 0.001), 0.006, { bevel: 0.0007 }));
}

/** One shell lying in a chamber, head flush with the breech: as a part, so the clip can throw it out or seat it. */
function chambered(m: Mesher, name: string, x: number): void {
  m.part(name, [x, BORE - HY, BREECH - HZ], () => m.at([0, 0, 0.0005], null, () => shell12(m, F.red)));
}

function barrels(m: Mesher): void {
  m.part('barrels', [0, HY, HZ], () => {
    const y = BORE - HY;
    const z = (v: number) => v - HZ;
    m.mirror(() => m.at([BX, y, 0], null, () => {
      m.use(F.barrel);
      m.lathe([[R, z(BREECH), 0], [R, z(-0.09)], [R - 0.0016, z(-0.13)], [R - 0.0022, z(MUZZLE + 0.012)], [R - 0.001, z(MUZZLE + 0.008)], [R - 0.001, z(MUZZLE), 0.0008], [0.0095, z(MUZZLE), 0]], 26);
      m.use(F.black);
      m.lathe([[0.0095, z(MUZZLE), 0], [0.0093, z(MUZZLE + 0.03), 0], [0, z(MUZZLE + 0.0305), 0]], 18);
      // The bore, seen from the breech end when it hangs open.
      m.lathe([[0.0098, z(BREECH) + 0.0004, 0], [0.0098, z(BREECH) - 0.004, 0], [0, z(BREECH) - 0.0045, 0]], 18);
    }));
    // Monoblock: the two breeches in one block, with the lump that locks into the water table.
    m.use(F.parkerized);
    m.at([0, y, z(BREECH - 0.034)], null, () => m.front(poly([[-BX - R - 0.001, -R + 0.002], [BX + R + 0.001, -R + 0.002], [BX + R + 0.001, 0.004, 0.006], [BX + 0.006, R - 0.001, 0.008], [-BX - 0.006, R - 0.001, 0.008], [-BX - R - 0.001, 0.004, 0.006]], 0.002), 0.068, { bevel: 0.0016 }));
    m.at([0, 0.0115 - HY, z(BREECH - 0.034)], null, () => m.box(0.034, 0.008, 0.064, 0.0014));
    // Rib on top between the barrels, bright so the two read apart, with a bead; the groove underneath filled.
    m.use(F.steel);
    m.at([0, y + R - 0.0012, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.0075, 0.0038, BREECH - MUZZLE - 0.06, 0.0009));
    for (let i = 0; i < 18; i++) m.at([0, y + R + 0.0009, z(-0.09 - i * 0.022)], null, () => m.box(0.0064, 0.0005, 0.0012, 0));
    m.at([0, y - R + 0.004, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.008, 0.006, BREECH - MUZZLE - 0.07, 0.0008));
    m.glow('sight', () => m.at([0, y + R + 0.0028, z(MUZZLE + 0.008)], null, () => m.lathe([[0, 0.0026, 0], [0.0022, 0.0018], [0.0024, 0], [0.0022, -0.0018], [0, -0.0026, 0]], 10)));
    // Muzzle band tying the two together.
    m.use(F.steelDark);
    m.at([0, y, z(MUZZLE + 0.016)], null, () => m.front(poly([[-BX - R - 0.0012, -R * 0.6], [BX + R + 0.0012, -R * 0.6], [BX + R + 0.0012, R * 0.6], [-BX - R - 0.0012, R * 0.6]], 0.006), 0.012, { bevel: 0.001 }));
    // Beavertail forend: walnut wrapping the barrels' bellies, checkered where the hand closes, an iron at its back.
    m.use(F.walnut);
    m.side(poly([[z(-0.115), y - 0.004], [z(-0.12), y - R - 0.014, 0.008], [z(-0.3), y - R - 0.012, 0.01], [z(-0.31), y - 0.004, 0.006]], 0.003), 0.072, { bevel: 0.005, smooth: 40 });
    m.use({ ...F.walnutDark, kind: 2 });
    m.mirror(() => m.at([0.0355, 0, 0], null, () => m.side(poly([[z(-0.15), y - 0.006], [z(-0.15), y - R - 0.008], [z(-0.28), y - R - 0.007], [z(-0.28), y - 0.006]], 0.003), 0.003, { bevel: 0.001 })));
    m.use(F.steelDark);
    m.at([0, y - R - 0.006, z(-0.106)], null, () => m.box(0.062, 0.016, 0.022, 0.0016, 0.004));
    m.at([0, y - R - 0.016, z(-0.2)], null, () => m.box(0.012, 0.003, 0.03, 0.0008));
    // Extractor between the chambers.
    m.at([0, y + 0.004, z(BREECH) - 0.002], null, () => m.box(0.008, 0.008, 0.004, 0.0006));
    chambered(m, 'shell0', BX);
    chambered(m, 'shell1', -BX);
    quad(m);
    // The shell in the hand during a reload, in the barrels' frame so it lands in a chamber however far they hang, and the
    // speed loader's clip of two, its middle on the lower pair's.
    m.part('shellIn', [BX, BORE - HY, BREECH - HZ], () => shell12(m, F.red));
    m.part('clipIn', [0, BORE - HY, BREECH - HZ], () => speedClip(m, 'clipShells'));
  });
}

/** One barrel's tube, muzzle and bores, its axis on the origin, in the barrels' frame. */
function tubeAt(m: Mesher, x: number, y: number): void {
  const z = (v: number) => v - HZ;
  m.at([x, y, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[R, z(BREECH), 0], [R, z(-0.09)], [R - 0.0016, z(-0.13)], [R - 0.0022, z(MUZZLE + 0.012)], [R - 0.001, z(MUZZLE + 0.008)], [R - 0.001, z(MUZZLE), 0.0008], [0.0095, z(MUZZLE), 0]], 26);
    m.use(F.black);
    m.lathe([[0.0095, z(MUZZLE), 0], [0.0093, z(MUZZLE + 0.03), 0], [0, z(MUZZLE + 0.0305), 0]], 18);
    m.lathe([[0.0098, z(BREECH) + 0.0004, 0], [0.0098, z(BREECH) - 0.004, 0], [0, z(BREECH) - 0.0045, 0]], 18);
  });
}

/**
 * The quad's upper pair, in the barrels' frame: two more tubes on their own monoblock, bright side ribs where the rows meet
 * so the four read apart from the eye, the rib and bead moved up onto them, and a band round all four at the muzzle.
 */
function quad(m: Mesher): void {
  m.part('quad', [0, 0, 0], () => {
    const y = UP - HY;
    const lo = BORE - HY;
    const z = (v: number) => v - HZ;
    tubeAt(m, BX, y);
    tubeAt(m, -BX, y);
    // Monoblock: the upper breeches in one block, its foot sunk into the lower one's so the shoulders close up.
    m.use(F.parkerized);
    m.at([0, y, z(BREECH - 0.034)], null, () => m.front(poly([[-BX - R - 0.001, lo - y + 0.004], [BX + R + 0.001, lo - y + 0.004], [BX + R + 0.001, 0.004, 0.006], [BX + 0.006, R - 0.001, 0.008], [-BX - 0.006, R - 0.001, 0.008], [-BX - R - 0.001, 0.004, 0.006]], 0.002), 0.068, { bevel: 0.0016 }));
    // The core between the four, and a bright rib down each side where the rows meet.
    m.use(F.barrelBlack);
    m.at([0, (y + lo) / 2, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.016, 0.016, BREECH - MUZZLE - 0.06, 0.001));
    m.use(F.steel);
    m.mirror(() => m.at([BX + 0.0095, (y + lo) / 2, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.0055, 0.0065, BREECH - MUZZLE - 0.072, 0.0012)));
    // Top rib, its cross-cuts and the bead, now on the upper pair.
    m.at([0, y + R - 0.0012, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.0075, 0.0038, BREECH - MUZZLE - 0.06, 0.0009));
    for (let i = 0; i < 18; i++) m.at([0, y + R + 0.0009, z(-0.09 - i * 0.022)], null, () => m.box(0.0064, 0.0005, 0.0012, 0));
    m.glow('sight', () => m.at([0, y + R + 0.0028, z(MUZZLE + 0.008)], null, () => m.lathe([[0, 0.0026, 0], [0.0022, 0.0018], [0.0024, 0], [0.0022, -0.0018], [0, -0.0026, 0]], 10)));
    // Muzzle band round all four.
    m.use(F.steelDark);
    m.at([0, 0, z(MUZZLE + 0.016)], null, () => m.front(poly([[-BX - R - 0.0014, lo - R * 0.62], [BX + R + 0.0014, lo - R * 0.62], [BX + R + 0.0014, y + R * 0.62], [-BX - R - 0.0014, y + R * 0.62]], 0.007), 0.0125, { bevel: 0.001 }));
    // Extractor between the upper chambers.
    m.at([0, y + 0.004, z(BREECH) - 0.002], null, () => m.box(0.008, 0.008, 0.004, 0.0006));
    chamberedAt(m, 'shell2', BX, y);
    chamberedAt(m, 'shell3', -BX, y);
  });
}

function chamberedAt(m: Mesher, name: string, x: number, y: number): void {
  m.part(name, [x, y, BREECH - HZ], () => m.at([0, 0, 0.0005], null, () => shell12(m, F.red)));
}

/**
 * The speed loader's clip: a moulded plate behind two shell heads a pair's width apart, holding them by the rims, with a
 * tab on top to pull it off by. Origin between the two heads; the shells are their own part (`shells`) so they can stay in
 * the chambers when the plate comes away.
 */
function speedClip(m: Mesher, shells?: string): void {
  m.use(F.anodizedGrey);
  m.at([0, 0, 0.0022], null, () => m.front(poly([[-BX - 0.0125, -0.0105, 0.009], [BX + 0.0125, -0.0105, 0.009], [BX + 0.0125, 0.0105, 0.009], [0.007, 0.0105, 0.003], [0.005, 0.021, 0.002], [-0.005, 0.021, 0.002], [-0.007, 0.0105, 0.003], [-BX - 0.0125, 0.0105, 0.009]], 0.002), 0.003, { bevel: 0.0007 }));
  // Spring steel fingers over each rim, and a grip line across the tab.
  m.use(F.steel);
  for (const x of [BX, -BX]) for (const a of [0.6, Math.PI - 0.6, -Math.PI / 2]) {
    m.at([x + Math.cos(a) * 0.0106, Math.sin(a) * 0.0106, 0.0002], [0, 0, a], () => m.box(0.0018, 0.004, 0.0024, 0.0004));
  }
  m.use(F.polymerGrey);
  m.at([0, 0.0175, 0.0042], null, () => m.box(0.008, 0.0012, 0.0008, 0.0002));
  const pair = () => {
    m.at([BX, 0, 0.0005], null, () => shell12(m, F.red));
    m.at([-BX, 0, 0.0005], null, () => shell12(m, F.red));
  };
  if (shells) m.part(shells, [0, 0, 0], pair);
  else pair();
}

/** The top lever: thumbed over to the right to break it open. */
function lever(m: Mesher, name: string, at: readonly [number, number, number]): void {
  m.part(name, [...at], () => {
    m.use(F.steel);
    m.top(poly([[-0.004, -0.008], [0.004, -0.008], [0.006, 0.02, 0.002], [0.016, 0.036, 0.004], [0.008, 0.04, 0.003], [-0.004, 0.022, 0.002]], 0.001), 0.004, { bevel: 0.0008 });
    m.at([0, 0.002, 0], null, () => m.cyl(0.004, 0.006, 12));
  });
}

/** The plain gun's top: the tang, the safety on it and the lever. The quad's tall breech takes its place. */
function top(m: Mesher): void {
  m.part('top', [0, 0, 0], () => {
    m.use(F.steelDark);
    m.at([0, 0.053, 0.05], null, () => m.box(0.016, 0.004, 0.05, 0.0012));
    m.at([0, 0.056, 0.064], null, () => m.box(0.008, 0.004, 0.012, 0.0012));
    lever(m, 'lever', [0, 0.056, 0.006]);
  });
}

/**
 * The quad's standing breech, on the action: as tall as the upper pair and rounded over the shoulders, fenced round its
 * breeches, flat on top for the lever, then a fairing swept down to the wrist, with an inset panel each side.
 */
function quadTop(m: Mesher): void {
  const crest = UP + R + 0.005;
  m.part('quadTop', [0, 0, 0], () => {
    m.use(F.parkerized);
    m.at([0, 0, (BREECH + 0.046) / 2], null, () => m.front(poly([[-0.032, 0.046], [0.032, 0.046], [0.032, UP, 0.004], [0.022, crest, 0.013], [-0.022, crest, 0.013], [-0.032, UP, 0.004]], 0.002), 0.046 - BREECH, { bevel: 0.0022 }));
    m.side(poly([[0.04, 0.046], [0.04, crest - 0.002, 0.004], [0.056, crest - 0.008, 0.014], [0.084, 0.052, 0.01], [0.084, 0.046]], 0.002), 0.046, { bevel: 0.004, smooth: 40 });
    // Fences round the upper breeches, and a bright strap down the crest.
    m.use(F.steelDark);
    m.mirror(() => m.at([BX, UP, BREECH + 0.006], null, () => m.lathe([[R + 0.003, 0.006, 0], [R + 0.003, -0.002, 0.002], [R - 0.002, -0.006, 0]], 22, { a0: -0.5, a1: Math.PI + 0.5 })));
    m.mirror(() => {
      m.at([0.0322, 0, 0.012], null, () => m.side(poly([[-0.016, 0.054], [-0.016, UP + 0.006, 0.003], [0.026, UP + 0.006, 0.006], [0.026, 0.054, 0.003]], 0.002), 0.0018, { bevel: 0.0005 }));
      screwX(m, 0.0329, UP + 0.001, 0.03, 1, 0.0022);
    });
    m.use(F.steel);
    m.at([0, crest + 0.0004, 0.044], null, () => m.box(0.012, 0.003, 0.03, 0.001));
    m.use(F.steelDark);
    m.at([0, crest + 0.0035, 0.05], null, () => m.box(0.007, 0.004, 0.01, 0.0012));
    lever(m, 'leverQ', [0, crest + 0.002, 0.004]);
  });
}

/** The speed loader fitted: a moulded carrier on the stock's left with two clips of two under elastic. The hand still loads from the belt. */
function carrier(m: Mesher): void {
  m.part('carrier', [0, 0, 0], () => {
    m.use(F.polymerGrey);
    m.at([-0.0195, 0, 0], null, () => m.side(poly([[0.11, -0.05], [0.11, 0.02, 0.008], [0.262, 0.016, 0.008], [0.262, -0.064, 0.008]], 0.003), 0.004, { bevel: 0.001 }));
    for (const z of [0.168, 0.256]) {
      m.at([-0.0215 - 0.0112, -0.012, z], [0, 0, Math.PI / 2], () => speedClip(m));
      m.use(F.webbing);
      m.at([-0.033, -0.012, z - 0.034], null, () => m.box(0.0236, 0.064, 0.012, 0.002));
    }
    screwX(m, -0.0216, 0.008, 0.124, -1, 0.002);
    screwX(m, -0.0216, -0.052, 0.25, -1, 0.002);
  });
}

function buildDeuce(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  action(m);
  stock(m);
  barrels(m);
  top(m);
  quadTop(m);
  carrier(m);
  m.part('trigger', [0, -0.024, -0.004], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0xffb43a, 5] } });
  // Right barrel first, on the front trigger; the left on the rear. Weapons asks for `muzzle1` on the second shot, and on
  // the quad `muzzle2` and `muzzle3`, the upper pair's.
  model.socket('muzzle', [BX, BORE, MUZZLE - 0.002]);
  model.socket('muzzle1', [-BX, BORE, MUZZLE - 0.002]);
  model.socket('muzzle2', [BX, UP, MUZZLE - 0.002]);
  model.socket('muzzle3', [-BX, UP, MUZZLE - 0.002]);
  model.socket('eject', [0, BORE + 0.01, BREECH]);
  model.hand('gripR', [0.019, -0.06, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('foreL', [-0.004, BORE - R - 0.012 - HY, -0.21 - HZ], 'barrels');
  model.hand('shellHold', [-0.017, 0.0, -0.03], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'shellIn');
  model.hand('clipHold', [-BX - 0.028, 0.004, -0.01], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'clipIn');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a);
  a.glow('sight', 1);
  // Barrels together rock the whole gun up and back, past what the spring does with one.
  const t = a.sinceFire;
  if (a.strength > 1.5 && t < 0.32) {
    const k = bump(t, 0, 0.32) * Math.min(a.strength / 1.8, 1.6);
    a.gunR.x += k * 0.07;
    a.gunP.z += k * 0.018;
  }
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.08;
    a.gunR.x += k * 0.45;
    a.gunR.z += k * 0.3;
  }
  P.shellIn!.visible = P.clipIn!.visible = false;
  const shells = [P.shell0!, P.shell1!, P.shell2!, P.shell3!];
  const p = a.reload;
  if (p < 0) {
    for (const sh of shells) sh.visible = false;
    return;
  }

  // The reload in seconds of the gun's own timing (BREAK in weapons/data.ts), so a faster reload is the same moves sped up.
  // A hand goes in once a shell, or once a pair with the speed loader: two on the plain gun, four or two on the quad.
  const chambers = a.mods?.has('deuceQuad') ? 4 : 2;
  const per = a.mods?.has('deuceLoader') ? 2 : 1;
  const inserts = chambers / per;
  const T = BREAK.open + BREAK.insert * inserts + BREAK.close;
  const s = p * T;
  /** When the close starts: the stock comes up. */
  const c = T - 0.48;
  const home = (i: number) => BREAK.open + BREAK.insert * (i + 1);

  // Lever over, barrels down on the hinge, held open while it loads, then the stock swung up to shut it.
  const lever = hold(s, 0, 0.09, c + 0.09, c + 0.18) * 0.6;
  P.lever!.rotation.y -= lever;
  P.leverQ!.rotation.y -= lever;
  const shut = s >= c + 0.12 ? thud(seg(s, c + 0.12, c + 0.3)) : 0;
  const drop = inOut(seg(s, 0.075, 0.225)) * (1 - inQuad(seg(s, c, c + 0.12)));
  P.barrels!.rotation.x -= drop * OPEN - shut * 0.02;

  // The ejectors throw the empties up and back over the shoulder; each chamber shows a new shell once its hand is home.
  const out = seg(s, 0.24, 0.39);
  for (let i = 0; i < chambers; i++) {
    const sh = shells[i]!;
    if (s < 0.39) {
      sh.visible = true;
      sh.position.z += inQuad(out) * 0.16 + out * 0.03;
      sh.position.y += out * 0.06;
      sh.position.x += (i % 2 === 0 ? 1 : -1) * out * 0.03;
      sh.rotation.x += out * (3.5 + i * 0.4);
    } else sh.visible = s >= home(Math.floor(i / per));
  }

  // From the belt, past the extractor and home: a shell into its chamber, or the clip onto its pair, which pulls away bare.
  let hand = 0;
  let seat = 0;
  for (let k = 0; k < inserts; k++) {
    const at = home(k);
    if (s > at - FETCH && s < at + (per > 1 ? 0.1 : 0.018)) {
      const first = k * per;
      const sh = per > 1 ? P.clipIn! : P.shellIn!;
      sh.visible = true;
      if (per > 1) P.clipShells!.visible = s < at;
      else sh.visible = s < at;
      const u = inOut(seg(s, at - FETCH, at - 0.06));
      const back = inOut(seg(s, at, at + 0.1));
      sh.position.x += per > 1 ? 0 : cx(first) - BX;
      sh.position.y += cy(first) - cy(0);
      // In the barrels' frame, which hangs open: this is down from the breech and a little ahead, not toward the eye.
      sh.position.x += (1 - u) * -0.05 - back * 0.03;
      sh.position.y += (1 - u) * -0.22 + back * 0.03;
      sh.position.z += (1 - u) * -0.12 + (1 - inOut(seg(s, at - 0.06, at))) * 0.064 + back * 0.05;
      sh.rotation.x += (1 - u) * 1.2;
      sh.rotation.y += (1 - u) * -0.5;
    }
    hand = Math.max(hand, hold(s, at - FETCH, at - FETCH + 0.075, at + 0.015, at + 0.075));
    seat = Math.max(seat, s >= at ? thud(seg(s, at, at + 0.12)) : 0);
  }

  // Brought in and rolled a little so the chambers face the eye; a flick up to dump, and a lift to close.
  const present = hold(s, 0.06, 0.24, c - 0.03, c + 0.21);
  const dump = bump(s, 0.225, 0.45);
  const lift = bump(s, c - 0.03, c + 0.18);
  a.gunR.x += dump * 0.18 + present * 0.05 + lift * 0.14 + shut * 0.03 + seat * 0.015;
  a.gunR.z -= present * 0.28;
  a.gunR.y -= present * 0.06;
  a.gunP.x -= present * 0.03;
  a.gunP.y += present * 0.012 + dump * 0.01 + seat * 0.004;
  a.gunP.z -= present * 0.02;

  const h = a.left;
  h.fingerRate = 42;
  h.to('pouchL', inOut(seg(s, 0.3, 0.405)));
  h.to(per > 1 ? 'clipHold' : 'shellHold', hand);
  h.to('foreL', inOut(seg(s, c - 0.09, c + 0.03)));
  h.shape(HANDS.pinch, hand);
}

export function deuceDef(kit: Kit): ViewDef {
  return {
    id: 'deuce',
    model: buildDeuce(kit),
    pos: [0.14, -0.118, -0.39],
    rot: [0.03, 0.08, 0],
    recoil: { back: 0.07, lift: 0.016, pitch: 0.13, yaw: 0.014, roll: 0.035, omega: 26, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'foreL', pose: HANDS.support },
    heatPerShot: 0.05,
    animate: clip,
    mods: { deuceQuad: { part: 'quad', also: 'quadTop', hides: 'top' }, deuceLoader: { part: 'carrier' } },
  };
}
