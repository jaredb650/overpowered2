/**
 * The Billhook: SPAS-12-inspired semi-auto combat shotgun.
 *
 * Boxy stamped-steel parkerized receiver with recessed right-side ejection port and hooked reciprocating charging handle,
 * wide flat-topped perforated steel barrel heat shield over a heavy blued 12-gauge barrel, chunky ribbed combat forend,
 * fat 8-shell tubular magazine (extensible to 11 past the muzzle via `billhookTube`), ergonomic stippled pistol grip, and
 * signature perforated top-folding metal skeleton stock with the curved arm-brace J-hook at the butt.
 *
 * Mods: `billhookDot` (open reflex sight on the top rail, hiding the rear ghost-ring iron), `billhookLam` (right-mounted
 * red laser aiming module), `billhookLight` (left-mounted weapon light), `billhookTube` (11-shell extended tube + clamp).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { poly, rect } from '../kit/shapes';
import { knurl, rail, rivet, screwX, screwY } from '../kit/details';
import { bump, hold, inOut, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger, shell12 } from './common';
import { TORCH, weaponLight } from './light';
import { OPTIC_GLOWS, openReflex } from './optics';

const BORE = 0.032;
const TUBE = -0.002;
const REC_W = 0.0225;
const REC_TOP = 0.056;
const REC_REAR = 0.072;
const REC_FRONT = -0.175;
const RAIL_TOP = 0.0638;
const MUZZLE = -0.685;
const TUBE_END = -0.635;
const TUBE_EXT_END = -0.785;
const BOLT_TRAVEL = 0.064;

/** Reload shell-in beats matching `WEAPONS.billhook.reloadFoley` in `weapons/data.ts`. */
const SHELLS = [0.08, 0.24, 0.4, 0.56, 0.72] as const;
const FETCH = 0.11;

function receiver(m: Mesher): void {
  // Heavy boxy stamped-steel receiver: beveled upper shoulders, flat top deck, stepped front collar.
  m.use(F.anodized);
  const body = poly([
    [-REC_W, -0.019], [REC_W, -0.019], [REC_W, 0.044, 0.003],
    [0.017, REC_TOP, 0.004], [-0.017, REC_TOP, 0.004], [-REC_W, 0.044, 0.003],
  ], 0.002);
  // Rear solid section behind the ejection port (z = +0.072 .. -0.022).
  m.at([0, 0, (REC_REAR - 0.022) / 2], null, () => m.front(body, REC_REAR + 0.022, { bevel: 0.0018 }));
  // Front solid throat ahead of the ejection port (z = -0.116 .. -0.175).
  m.at([0, 0, (-0.116 + REC_FRONT) / 2], null, () => m.front(body, -0.116 - REC_FRONT, { bevel: 0.0018 }));
  // Mid section spanning the ejection port (z = -0.022 .. -0.116): left wall, top roof, lower floor open on +X.
  const portLen = 0.116 - 0.022 + 0.004;
  const portZ = (-0.022 - 0.116) / 2;
  const portSection = poly([
    [-REC_W, -0.019], [REC_W, -0.019], [REC_W, 0.014], [0.012, 0.014], [0.012, 0.045],
    [REC_W, 0.045], [0.017, REC_TOP, 0.003], [-0.017, REC_TOP, 0.003], [-REC_W, 0.044, 0.003],
  ], 0.0012);
  m.at([0, 0, portZ], null, () => m.front(portSection, portLen, { bevel: 0.0012, capFront: false, capBack: false }));

  // Dark ejection port cavity floor & subtle angled brass deflector behind the port.
  m.use(F.black);
  m.at([0.008, 0.03, portZ], null, () => m.box(0.01, 0.029, 0.092, 0));
  m.use(F.steelDark);
  m.at([REC_W + 0.002, 0.032, -0.015], null, () => m.side(poly([
    [-0.006, -0.009], [0.008, -0.009], [0.006, 0.012], [-0.004, 0.009],
  ], 0.001), 0.0045, { bevel: 0.0008 }));

  // Sculpted side armour ribs and cross-pins along the receiver flanks.
  m.use(F.parkerized);
  m.at([-REC_W - 0.001, 0.016, -0.048], null, () => m.box(0.0025, 0.042, 0.215, 0.0012));
  m.at([REC_W + 0.001, -0.002, -0.048], null, () => m.box(0.0025, 0.024, 0.215, 0.0012));
  m.use(F.bureauRed);
  m.at([-REC_W - 0.0025, 0.031, -0.05], null, () => m.box(0.0008, 0.003, 0.145, 0.0002));
  m.mirror(() => {
    screwX(m, REC_W + 0.002, 0.006, -0.01, 1, 0.0024, F.steelDark);
    screwX(m, REC_W + 0.002, -0.006, -0.095, 1, 0.0024, F.steelDark);
    screwX(m, REC_W + 0.002, 0.004, -0.15, 1, 0.0024, F.steelDark);
  });

  // Iconic large SPAS-12 right-side bolt-release / carrier-latch button ahead of the trigger guard.
  m.use(F.steel);
  m.at([REC_W + 0.003, -0.007, -0.056], null, () => m.box(0.0048, 0.011, 0.026, 0.001));
  m.use(F.steelDark);
  for (let i = 0; i < 4; i++) {
    m.at([REC_W + 0.0056, -0.007, -0.064 + i * 0.0052], null, () => m.box(0.001, 0.0085, 0.0016, 0));
  }

  // Left-flank recessed shell-counter readout screen (8 shells standard, 11 with extended tube).
  m.use(F.black);
  m.at([-REC_W - 0.0024, 0.014, -0.056], null, () => m.box(0.0012, 0.014, 0.098, 0.0004));
  m.at([-REC_W - 0.0032, 0.014, -0.056], [0, -Math.PI / 2, 0], () => m.screen('ammo', 0.092, 0.0095));

  // Under-receiver loading port trough and silver shell lifter ramp.
  m.use(F.black);
  m.at([0, -0.0205, -0.098], null, () => m.box(0.025, 0.002, 0.098, 0));
  m.use(F.steel);
  m.at([0, -0.019, -0.096], [0.06, 0, 0], () => m.box(0.018, 0.0026, 0.072, 0.0006));

  // Top Picatinny optic rail across the receiver roof.
  m.at([0, REC_TOP + 0.0005, 0], null, () => rail(m, 0.056, -0.142, 0.0212, F.steelDark));

  // Rear protective ghost-ring iron sight (auto-hidden via `irons: 'rearSight'` when `billhookDot` is fitted).
  m.part('rearSight', [0, RAIL_TOP, 0.036], () => {
    m.use(F.anodized);
    m.at([0, 0.0035, 0], null, () => m.box(0.028, 0.007, 0.024, 0.0012));
    // Twin angled protective ears flanking the aperture ring.
    m.mirror(() => m.at([0.0115, 0.0125, 0], null, () => m.side(poly([
      [0.01, -0.007], [-0.01, -0.007], [-0.007, 0.013, 0.002], [0.007, 0.013, 0.002],
    ], 0.001), 0.0038, { bevel: 0.0007 })));
    m.use(F.steelDark);
    m.at([0, 0.0162, 0], null, () => m.pipe(0.0086, 0.006, 0.012, 24));
    m.mirror(() => screwX(m, 0.0148, 0.0035, 0.002, 1, 0.002, F.steel));
  });
}

function grip(m: Mesher): void {
  // Ergonomic black polymer SPAS-12 combat pistol grip with finger swells and stippled side panels.
  m.use(F.polymer);
  m.side(poly([
    [0.03, -0.018], [0.076, -0.018, 0.004], [0.114, -0.108, 0.006],
    [0.072, -0.118, 0.006], [0.044, -0.045, 0.006], [0.03, -0.026],
  ], 0.003), 0.031, { bevel: 0.0032 });
  // Stippled side grip scales and heel cap.
  m.use(F.polymerStipple);
  m.mirror(() => m.at([0.0156, 0, 0], null, () => m.side(poly([
    [0.044, -0.034], [0.074, -0.032], [0.105, -0.102, 0.004], [0.076, -0.109, 0.004], [0.052, -0.048],
  ], 0.002), 0.0022, { bevel: 0.0008 })));
  m.use(F.steelDark);
  m.at([0, -0.114, 0.093], [0.22, 0, 0], () => m.box(0.033, 0.006, 0.044, 0.0015));

  // Heavy squared-off combat trigger guard with cross-bolt safety.
  m.use(F.anodized);
  const guardOut = poly([
    [-0.038, -0.018], [-0.044, -0.032, 0.004], [-0.032, -0.054, 0.006],
    [0.036, -0.054, 0.006], [0.046, -0.024, 0.004], [0.046, -0.018],
  ], 0.002);
  const guardHole = poly([
    [-0.032, -0.021], [-0.036, -0.032, 0.004], [-0.026, -0.047, 0.004],
    [0.03, -0.047, 0.004], [0.039, -0.023, 0.003], [0.039, -0.021],
  ], 0.002);
  m.side(guardOut, 0.014, { bevel: 0.0012, holes: [guardHole] });
  // Red-ringed cross-bolt fire selector/safety behind the trigger bow.
  m.use(F.bureauRed);
  m.at([0, -0.026, 0.036], [0, Math.PI / 2, 0], () => m.cyl(0.0046, 0.018, 12, 0.0005));
  m.use(F.steel);
  m.at([0, -0.026, 0.036], [0, Math.PI / 2, 0], () => m.cyl(0.0038, 0.022, 12, 0.0006));
}

/**
 * Iconic SPAS-12 top-folding perforated steel skeleton stock & curved arm-brace J-hook, extended rearward in combat
 * configuration so the top receiver rail and reflex sight stay completely clear while showcasing the unmistakable silhouette.
 */
function stock(m: Mesher): void {
  // Heavy top-folding hinge knuckle block + cross-pivot steel pin at the rear of the receiver.
  m.use(F.steelDark);
  m.at([0, 0.042, REC_REAR + 0.008], null, () => m.box(0.042, 0.026, 0.024, 0.002));
  m.use(F.steel);
  m.at([0, 0.047, REC_REAR + 0.011], [0, Math.PI / 2, 0], () => m.cyl(0.0068, 0.05, 16, 0.0008));

  // Twin stamped-steel skeleton side rails sweeping back from the hinge to the buttplate.
  m.use(F.parkerized);
  const railSide = poly([
    [REC_REAR + 0.012, 0.052], [REC_REAR + 0.012, 0.034],
    [0.348, 0.014, 0.004], [0.348, 0.034, 0.004],
  ], 0.002);
  m.mirror(() => m.at([0.0165, 0, 0], null, () => m.side(railSide, 0.0055, { bevel: 0.0009 })));

  // Lower diagonal stamped-steel skeleton brace struts framing the stock triangle.
  const lowerStrut = poly([
    [REC_REAR + 0.004, 0.004], [REC_REAR + 0.004, -0.012],
    [0.348, -0.068, 0.004], [0.348, -0.052, 0.004],
  ], 0.002);
  m.mirror(() => m.at([0.0145, 0, 0], null, () => m.side(lowerStrut, 0.005, { bevel: 0.0008 })));

  // Perforated flat top bridge spanning the upper rails with 6 real rectangular cutout slots.
  m.use(F.anodized);
  m.at([0, 0.038, 0.214], [0.062, 0, 0], () => {
    const holes: ReturnType<typeof rect>[] = [];
    for (let i = 0; i < 6; i++) {
      const z = -0.104 + i * 0.041;
      holes.push(rect(-0.0088, z - 0.012, 0.0088, z + 0.012, 0.0025));
    }
    m.at([0, 0, 0], [-Math.PI / 2, 0, 0], () => {
      m.front(rect(-0.0185, -0.128, 0.0185, 0.128, 0.002), 0.0042, { bevel: 0.0007, holes });
    });
  });

  // Rear steel buttplate & ribbed rubber recoil pad.
  m.use(F.steelDark);
  m.at([0, -0.018, 0.348], null, () => m.box(0.038, 0.106, 0.012, 0.002));
  m.use(F.rubber);
  m.at([0, -0.018, 0.362], null, () => m.box(0.039, 0.108, 0.018, 0.004));
  m.mirror(() => m.at([0.0195, -0.018, 0.348], [0, Math.PI / 2, 0], () => rivet(m, 0.002)));

  // Signature SPAS-12 curved steel arm-brace J-hook pivoting from the buttplate toe & sweeping forward under the stock!
  m.use(F.steel);
  m.at([0, -0.066, 0.34], [0, Math.PI / 2, 0], () => m.cyl(0.006, 0.044, 14, 0.0008));
  m.use(F.parkerized);
  const hookProfile = poly([
    [0.342, -0.062], [0.342, -0.075], [0.312, -0.116, 0.018], [0.252, -0.124, 0.02],
    [0.214, -0.102, 0.014], [0.222, -0.09, 0.004], [0.256, -0.109, 0.012],
    [0.304, -0.102, 0.012], [0.328, -0.066, 0.006],
  ], 0.002);
  m.side(hookProfile, 0.028, { bevel: 0.0016 });
  // Dark rubber sleeve pad on the hook's curved underside.
  m.use(F.rubber);
  m.at([0, -0.114, 0.268], [0, 0, 0], () => m.box(0.031, 0.009, 0.048, 0.0025));
}

function barrelAndShroud(m: Mesher): void {
  // Heavy blued 12-gauge combat barrel running from receiver to muzzle.
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([
      [0.0142, REC_FRONT, 0], [0.0142, -0.215], [0.0124, -0.228],
      [0.012, MUZZLE + 0.044], [0.0146, MUZZLE + 0.04], [0.0146, MUZZLE + 0.004],
      [0.0132, MUZZLE, 0.0008], [0.0096, MUZZLE, 0],
    ], 24);
    // Deep black 12-gauge bore cavity + ported cylinder-choke gas slots near the crown.
    m.use(F.black);
    m.lathe([[0.0096, MUZZLE, 0], [0.0093, MUZZLE + 0.034, 0], [0, MUZZLE + 0.0345, 0]], 18);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      m.at([Math.cos(a) * 0.0142, Math.sin(a) * 0.0142, MUZZLE + 0.022], [0, 0, a], () => m.box(0.0018, 0.0036, 0.016, 0.0003));
    }
    // Machined steel thread-protector collar ring right behind the ported choke.
    m.use(F.steel);
    m.lathe([[0.0148, MUZZLE + 0.042, 0], [0.015, MUZZLE + 0.037], [0.0148, MUZZLE + 0.035, 0]], 24);
  });

  // Wide boxy SPAS-12 perforated barrel heat shield with real open cooling slots exposing the barrel inside!
  // U-channel arched profile in XY around the barrel bore.
  const shieldBridge = poly([
    [-0.0215, 0.014], [-0.0215, 0.044, 0.004], [-0.0145, 0.0545, 0.004],
    [0.0145, 0.0545, 0.004], [0.0215, 0.044, 0.004], [0.0215, 0.014],
    [0.0172, 0.014], [0.0172, 0.041, 0.003], [0.0118, 0.0498, 0.003],
    [-0.0118, 0.0498, 0.003], [-0.0172, 0.041, 0.003], [-0.0172, 0.014],
  ], 0.001);
  m.use(F.parkerized);
  // 13 spaced U-channel cooling bridges (open 14 mm slots between every bridge show the barrel).
  for (let i = 0; i < 13; i++) {
    const z = -0.194 - i * 0.0315;
    m.at([0, 0, z], null, () => m.front(shieldBridge, 0.0155, { bevel: 0.0008 }));
  }
  // Longitudinal side shroud rails and central sight rib tying the cooling bridges into a rigid boxy jacket.
  m.use(F.anodized);
  m.mirror(() => m.at([0.0202, 0.0175, -0.382], null, () => m.box(0.0044, 0.008, 0.415, 0.0009)));
  m.at([0, 0.0535, -0.382], null, () => m.box(0.0135, 0.0045, 0.415, 0.0009));
  // Subtle cooling-vent side rivets along the lower shroud rail.
  m.mirror(() => {
    for (let i = 0; i < 4; i++) screwX(m, 0.0226, 0.0175, -0.22 - i * 0.11, 1, 0.0018, F.steel);
  });

  // Heavy protective front sight ramp, twin sight ears, and glowing green-amber front post bead.
  m.at([0, BORE, -0.618], null, () => {
    m.use(F.anodized);
    m.lathe([[0.0124, 0.014, 0], [0.0154, 0.012], [0.0154, -0.012], [0.0124, -0.014, 0]], 20);
    m.at([0, 0.022, 0], null, () => m.box(0.014, 0.022, 0.022, 0.0014));
    m.mirror(() => m.at([0.0085, 0.035, 0], null, () => m.side(poly([
      [0.011, -0.012], [-0.009, -0.012], [-0.007, 0.014, 0.002], [0.006, 0.014, 0.002],
    ], 0.001), 0.0032, { bevel: 0.0006 })));
    m.use(F.steelDark);
    m.at([0, 0.036, -0.001], null, () => m.box(0.0032, 0.013, 0.006, 0.0005));
    // Glowing front sight dot sitting at world y = BORE + 0.0425 = 0.0745.
    m.glow('sight', () => m.at([0, 0.0425, 0.0024], null, () => m.cyl(0.0015, 0.0018, 10, 0)));
  });
}

function forend(m: Mesher): void {
  // Chunky ribbed SPAS-12 black polymer combat forend wrapping the lower tube (non-pumping in semi-auto).
  const core = poly([
    [-0.023, -0.025, 0.005], [0.023, -0.025, 0.005], [0.0255, -0.01, 0.004],
    [0.0255, 0.012, 0.003], [0.018, 0.0165, 0.002], [-0.018, 0.0165, 0.002],
    [-0.0255, 0.012, 0.003], [-0.0255, -0.01, 0.004],
  ], 0.002);
  m.use(F.polymer);
  m.at([0, 0, -0.32], null, () => m.front(core, 0.265, { bevel: 0.0025 }));

  // 9 aggressive transverse rubberized grip ribs wrapping the belly & flanks of the forend.
  const rib = poly([
    [-0.0248, -0.0272, 0.005], [0.0248, -0.0272, 0.005], [0.0274, -0.01, 0.004],
    [0.0274, 0.008, 0.003], [-0.0274, 0.008, 0.003], [-0.0274, -0.01, 0.004],
  ], 0.002);
  m.use(F.rubber);
  for (let i = 0; i < 9; i++) {
    const z = -0.21 - i * 0.0275;
    m.at([0, 0, z], null, () => m.front(rib, 0.012, { bevel: 0.0015 }));
  }

  // Front stainless/dark gas-port collar & mode-selector ring right ahead of the forend.
  m.at([0, TUBE, -0.462], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.015, 0.012, 0], [0.0195, 0.01], [0.0195, -0.01], [0.015, -0.012, 0]], 20);
    m.use(F.steel);
    m.at([0, -0.019, 0], null, () => m.box(0.014, 0.005, 0.014, 0.001));
  });
}

function tubeAndClamps(m: Mesher): void {
  // Base 8-shell under-barrel tubular magazine.
  m.at([0, TUBE, 0], null, () => {
    m.use(F.blued);
    m.lathe([[0.0144, REC_FRONT, 0], [0.0144, -0.612, 0]], 22);
    // Standard short knurled magazine tube cap (hidden via `hides: 'tubeCap'` when `billhookTube` is fitted).
    m.part('tubeCap', [0, 0, 0], () => {
      m.use(F.steelDark);
      m.at([0, 0, -0.622], null, () => knurl(m, 0.0172, 0.018, F.steelDark, 24, 0.0006));
      m.lathe([
        [0.0144, -0.612, 0], [0.0175, -0.614], [0.0175, -0.632, 0],
        [0.0148, TUBE_END], [0, TUBE_END, 0],
      ], 22);
      m.use(F.steel);
      m.at([0, -0.003, TUBE_END - 0.003], null, () => m.cyl(0.0038, 0.006, 10, 0.0006));
    });
  });

  // Heavy figure-8 barrel-to-magazine clamp collar at z = -0.585 with twin side accessory rail stubs.
  const figure8 = poly([
    [-0.019, -0.02, 0.005], [0.019, -0.02, 0.005], [0.021, -0.002, 0.004],
    [0.0175, 0.015, 0.003], [0.02, 0.032, 0.005], [0.0155, 0.048, 0.005],
    [-0.0155, 0.048, 0.005], [-0.02, 0.032, 0.005], [-0.0175, 0.015, 0.003], [-0.021, -0.002, 0.004],
  ], 0.002);
  m.use(F.anodized);
  m.at([0, 0, -0.585], null, () => {
    m.front(figure8, 0.024, { bevel: 0.0014 });
    m.mirror(() => {
      screwX(m, 0.0205, 0.015, 0, 1, 0.0025, F.steel);
      // Short side accessory rail lug for light (-X) and laser (+X).
      m.use(F.steelDark);
      m.at([0.0225, 0.014, 0], null, () => m.box(0.005, 0.014, 0.032, 0.0008));
    });
  });

  // Extended 11-shell magazine tube mod (`billhookTube`, hides `tubeCap`): extends prominently past the muzzle!
  m.part('tubeExt', [0, 0, 0], () => {
    m.at([0, TUBE, 0], null, () => {
      // Heavy knurled coupling nut joining the extension onto the factory tube at z = -0.612.
      m.use(F.steelDark);
      m.at([0, 0, -0.614], null, () => knurl(m, 0.0178, 0.02, F.steelDark, 26, 0.0007));
      m.lathe([[0.0144, -0.602, 0], [0.0176, -0.604], [0.0176, -0.624], [0.0146, -0.626, 0]], 22);
      // Extended blued steel tube protruding past the barrel muzzle to -0.766.
      m.use(F.blued);
      m.lathe([[0.0144, -0.624, 0], [0.0144, -0.766, 0]], 22);
      // Ribbed steel extended end cap with protective bumper ring at -0.785.
      m.use(F.steelDark);
      m.at([0, 0, -0.773], null, () => knurl(m, 0.0172, 0.014, F.steelDark, 24, 0.0006));
      m.lathe([
        [0.0144, -0.764, 0], [0.0172, -0.766], [0.0172, -0.78, 0],
        [0.0142, TUBE_EXT_END], [0, TUBE_EXT_END, 0],
      ], 22);
      m.use(F.brass);
      m.at([0, 0, -0.758], null, () => m.lathe([[0.0148, 0.0018, 0], [0.015, 0], [0.0148, -0.0018, 0]], 22));
    });
    // Forward support clamp locking the extended tube to the barrel right behind the muzzle collar.
    m.use(F.parkerized);
    m.at([0, 0, -0.666], null, () => {
      m.front(figure8, 0.018, { bevel: 0.0012 });
      m.mirror(() => screwX(m, 0.0202, 0.015, 0, 1, 0.0023, F.steel));
    });
  });
}

/** Right-side tactical laser aiming module (`billhookLam`), opposite the left-side weapon light. */
function laserModule(m: Mesher): void {
  m.part('lam', [0.025, 0.014, -0.585], () => {
    // Clamp bracket gripping the right rail stub.
    m.use(F.anodized);
    m.at([0.003, 0, 0], null, () => m.box(0.008, 0.018, 0.044, 0.0012));
    // Sculpted aluminum laser housing pod extending outboard on +X.
    m.at([0.014, 0, -0.004], null, () => {
      m.box(0.019, 0.022, 0.062, 0.0022);
      // Windage & elevation adjustment turrets.
      m.use(F.steel);
      screwY(m, 0, 0.0114, 0.006, 0.0024, F.steel);
      screwX(m, 0.0098, 0, 0.006, 1, 0.0024, F.steel);
      // Rear rubber activation pad.
      m.use(F.rubber);
      m.at([0, 0, 0.032], null, () => m.box(0.013, 0.015, 0.004, 0.001));
      // Front black bezel, lens glass, and glowing red laser diode.
      m.use(F.black);
      m.at([0, 0, -0.0315], null, () => m.cyl(0.0066, 0.0036, 18, 0.0005));
      m.glass(() => m.at([0, 0, -0.0334], null, () => m.cyl(0.0052, 0.0006, 18, 0)));
      m.glow('laser', () => m.at([0, 0, -0.0338], null, () => m.cyl(0.0013, 0.0003, 10, 0)));
    });
  });
}

function buildBillhook(kit: Kit): { model: Model; dotLook: NonNullable<ViewDef['mods']>['billhookDot'] } {
  const m = kit.mesher();
  m.bevel = 0.0014;
  receiver(m);
  grip(m);
  stock(m);
  barrelAndShroud(m);
  forend(m);
  tubeAndClamps(m);
  laserModule(m);

  // Low-profile open reflex sight (`billhookDot`) on a slim rail clamp riser over the receiver Picatinny rail.
  m.part('rmrBase', [0, RAIL_TOP, -0.048], () => {
    m.use(F.anodized);
    m.at([0, 0.0022, 0], null, () => m.box(0.028, 0.0052, 0.044, 0.001));
    m.mirror(() => screwX(m, 0.0146, 0.0022, 0.004, 1, 0.0022, F.steelDark));
  });
  const dotLook = openReflex(m, [0, RAIL_TOP + 0.0042, -0.048], {
    name: 'rmr', scale: 1.18, relief: 0.25, finish: F.anodized, accent: F.steelDark,
  });

  // Left-side weapon light (`billhookLight`), mounted opposite `billhookLam` so both stack cleanly with zero collision.
  weaponLight(m, [-0.0345, 0.014, -0.585], -Math.PI / 2);

  // Reciprocating semi-auto steel bolt carrier & signature hooked charging handle.
  m.part('bolt', [0.002, BORE - 0.001, -0.068], () => {
    m.use(F.steel);
    m.box(0.028, 0.025, 0.082, 0.0015);
    m.use(F.steelDark);
    m.at([0.0142, 0.003, -0.004], null, () => m.box(0.0016, 0.008, 0.052, 0.0005));
    // Hooked SPAS-12 charging handle jutting cleanly to the right (+X).
    m.use(F.anodized);
    m.at([0.024, 0, -0.018], null, () => {
      m.box(0.022, 0.009, 0.011, 0.0014);
      m.at([0.01, 0, 0.006], [0, Math.PI / 2, 0], () => knurl(m, 0.0062, 0.012, F.steelDark, 14, 0.0005));
    });
  });

  // Curved steel trigger.
  m.part('trigger', [0, -0.02, -0.002], () => {
    m.use(F.steel);
    m.side(poly([
      [-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.01, 0.002],
      [0.0042, -0.022, 0.0015], [0.0008, -0.023, 0.001], [-0.0036, -0.011, 0.003],
    ], 0.001), 0.0065, { bevel: 0.0007 });
  });

  // 12-gauge shell carried by the off-hand during reload.
  m.part('shell', [0, -0.032, -0.105], () => shell12(m, F.red));

  const model = new Model(m, kit.mats, {
    glows: { sight: [0x9cff3a, 6], dot: OPTIC_GLOWS.dot, laser: [0xff3020, 7], torch: TORCH },
    screens: { ammo: [240, 22] },
  });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  model.socket('eject', [REC_W + 0.004, BORE + 0.002, -0.068]);
  model.socket('lam', [0.014, 0, -0.038], [0, 0, 0], 'lam');
  model.hand('gripR', [0.019, -0.064, 0.074], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.002, -0.026, -0.32]);
  model.hand('shellHold', [-0.017, 0.0, -0.03], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'shell');
  model.hand('boltHold', [0.034, -0.004, -0.018], [0, -0.9, 0.4], [-0.25, -0.35, -0.9], 'bolt');
  return { model, dotLook: { ...dotLook, also: 'rmrBase' } };
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a);
  a.glow('sight', 1);
  a.glow('dot', 1);
  a.glow('laser', 1);

  // Snappy semi-auto bolt reciprocation on every shot (fits cleanly inside the 0.26 s refire).
  let boltBack = a.sinceFire < 0.14 ? bump(a.sinceFire, 0, 0.12) : 0;

  // Crisp combat bring-up on draw with a quick charging-handle rack.
  if (a.draw < 1) {
    const down = 1 - outCubic(a.draw);
    a.gunP.y -= down * 0.075;
    a.gunR.x -= down * 0.34;
    boltBack = Math.max(boltBack, hold(a.draw, 0.35, 0.56, 0.62, 0.88));
  }

  P.shell!.visible = false;
  const p = a.reload;
  if (p >= 0) {
    // Clean, readable reload pose: slight lift and gentle tilt so the under-receiver loading port stays clear without awkward twisting.
    const present = hold(p, 0, 0.06, 0.76, 0.85);
    let seat = 0;
    let hand = 0;
    for (const at of SHELLS) {
      const k = seg(p, at - FETCH, at);
      if (p > at - FETCH && p < at + 0.045) {
        P.shell!.visible = p < at + 0.01;
        const u = inOut(k);
        const sh = P.shell!;
        sh.position.x += (1 - u) * -0.14;
        sh.position.y += (1 - u) * -0.26 - 0.012 * u;
        sh.position.z += (1 - u) * 0.1 + (p > at ? seg(p, at, at + 0.01) * -0.048 : 0);
        sh.rotation.x += (1 - u) * 1.15;
        sh.rotation.y += (1 - u) * -0.4;
        hand = Math.max(hand, hold(p, at - FETCH, at - FETCH + 0.04, at + 0.02, at + 0.055));
      }
      seat = Math.max(seat, p >= at ? thud(seg(p, at, at + 0.07)) : 0);
    }
    a.gunR.z -= present * 0.34;
    a.gunR.x += present * 0.16 + seat * 0.02;
    a.gunR.y -= present * 0.06;
    a.gunP.x -= present * 0.022;
    a.gunP.y += present * 0.04 + seat * 0.005;
    a.gunP.z += present * 0.035;

    // Final bolt-rack beat synced with `[0.88, 'reload_bolt']` in `weapons/data.ts`.
    const rack = bump(p, 0.82, 0.96);
    boltBack = Math.max(boltBack, rack);
    a.gunR.x -= rack * 0.035;
    a.gunP.z += rack * 0.012;

    a.left.fingerRate = 44;
    a.left.to('shellHold', hand);
    a.left.shape(HANDS.pinch, hand);
    // Reach up to charge the bolt handle on the final beat if needed, otherwise return cleanly to forend.
    const chargeHand = hold(p, 0.8, 0.85, 0.91, 0.97);
    if (chargeHand > 0.01) {
      a.right.to('boltHold', chargeHand);
      a.right.shape(HANDS.pinch, chargeHand);
    }
  }

  P.bolt!.position.z += boltBack * BOLT_TRAVEL;
}

export function billhookDef(kit: Kit): ViewDef {
  const { model, dotLook } = buildBillhook(kit);
  return {
    id: 'billhook',
    model,
    irons: 'rearSight',
    pos: [0.145, -0.115, -0.39],
    rot: [0.03, 0.08, 0],
    // ADS irons: tall front sight post bead through the rear ghost ring.
    sight: [0, 0.0745, -0.618],
    rear: [0, 0.08, 0.036],
    relief: 0.78,
    recoil: { back: 0.056, lift: 0.012, pitch: 0.09, yaw: 0.012, roll: 0.024, omega: 33, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.08,
    animate: clip,
    readout: a => drawCount(a, 'ammo', 2, a.magSize, '#ff8c2a'),
    mods: {
      billhookDot: dotLook,
      billhookLam: { part: 'lam', laser: 'lam' },
      billhookLight: { part: 'light' },
      billhookTube: { part: 'tubeExt', hides: 'tubeCap' },
    },
  };
}
