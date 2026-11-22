/**
 * The Ultramag: a long-slide hand cannon after the FK BRNO Field Pistol, built big. A deep rounded slide in gunmetal nitride
 * over a black dust-cover frame that runs flush to the muzzle, a deep flute down each side of the dust cover with the
 * counterweight rod riding in it over a red inset line, slanted serrations fore and aft, a CZ-style frame with a hooked
 * hammer, a round trigger guard with a forward spur, and a long raked grip in chunky red anodized panels.
 *
 * Every shot runs the slide far back and lets it hang there: the case leaves through the port, the next round climbs out of
 * the magazine, and the slide strips it forward into the chamber you can see through the port. Origin at the top of the grip.
 *
 * Its mods (weapons/mods.ts), each a part shown while fitted, all four stacking: a square suppressor on a barrel stub, its top
 * under the sight line; a chunky reflex sight on the slide ahead of the rear sight, close to the eye for a wide window; a laser module
 * under the dust cover; and an extended magazine standing out of the grip. A compensator takes the can's place on the barrel.
 * Authored a tenth larger than it is built: the whole mesh is scaled by `S` before it becomes a model, so every number below is in the authored size and `k()` scales the rest.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher, type PartNode, type V3 } from '../kit/mesher';
import { circle, curve, poly, rect, slot, slotRow, type P2, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, round } from './common';
import { OPTIC_GLOWS } from './optics';
import { TORCH, weaponLight } from './light';
import { COMP } from '../../mods';

/** Built size against authored: the owner found it too big for the hands at full size. */
const S = 0.9;
/** An authored point at the built size. */
const k = (v: V3): V3 => [v[0] * S, v[1] * S, v[2] * S];
const BORE = 0.0475;
const MUZZLE = -0.335;
/** Slide underside and top, and its half width. */
const SY0 = 0.024;
const SY1 = 0.066;
const SW = 0.0195;
/** Where the breech face rests (the back of the chamber), and the front of the ejection port. */
const BREECH = 0.012;
const PORT = -0.064;
const SLIDE_REAR = 0.106;
/** Length of the low step behind the breech face. */
const SCOOP = 0.026;
/** The sight line: the three dots sit on it. The rear blade's middle and the front post along the slide. */
const SIGHT_Y = 0.0725;
const REAR_Z = 0.089;
const POST_Z = MUZZLE + 0.018;
/** Exaggerated travel: long enough that a whole round fits between the breech face and the chamber. */
const TRAVEL = 0.074;
/** Half width of the frame at the dust cover, and of its core inside the flutes. */
const FW = 0.0206;
const CORE = 0.016;
const ROUND_R = 0.0072;
const CASE = 0.031;
const BULLET = 0.016;
/** The top round in the magazine: head just ahead of the breech face at full travel. */
const FEED_Y = 0.017;
const FEED_Z = BREECH + TRAVEL - 0.002;
const MAG_Y = 0.014;
const MAG_Z = 0.056;
/** The oversized offset-monolith suppressor: from the muzzle face forward, half width, height above bore (under SIGHT_Y) and deep belly below bore. */
const CAN_LEN = 0.35;
const CAN_W = 0.0265;
const CAN_TOP = 0.0186;
const CAN_BOT = 0.062;
/** The reflex sight on the slide just ahead of the rear sight, as an optic cut has it: its centre along the slide, and its dot. */
/** The compensator's length from the muzzle face forward. Its section is the slide's over the frame's. */
const COMP_LEN = 0.08;
const RMR_Z = 0.057;
const DOT_Y = SY1 + 0.02;
const DOT_Z = RMR_Z - 0.008;

const NITRIDE: Finish = { color: 0x737b85, rough: 0.32, metal: 0.9, wear: 0.18, kind: Kind.brushed };
const FRAME: Finish = { color: 0x1e2024, rough: 0.5, metal: 0.55, wear: 0.3 };
const STAINLESS: Finish = { color: 0xc3c8cd, rough: 0.22, metal: 1, wear: 0.05, kind: Kind.brushed };
const RED: Finish = { color: 0xa8231c, rough: 0.4, metal: 0.55, wear: 0.55 };
const RED_TEXTURE: Finish = { ...RED, rough: 0.62, kind: Kind.stipple };
/** The compensator's nitride: the slide's, a shade darker, so it reads as a part of its own. */
const COMP_NITRIDE: Finish = { ...NITRIDE, color: 0x5d646d };
/** Suppressor outer shroud (matte dark carbon/anodized weave) and machined dark-titanium collar, clamps and muzzle hardware. */
const CAN_SHROUD: Finish = { color: 0x23262c, rough: 0.42, metal: 0.38, wear: 0.35, kind: Kind.carbon };
const CAN_TITANIUM: Finish = { color: 0x4c535e, rough: 0.29, metal: 0.92, wear: 0.22, kind: Kind.brushed };

/** Slide section, seen from behind: flat sides, a steep facet, then a rounded top flat. */
function slideSection(): V2[] {
  return poly([
    [-SW + 0.0016, SY0], [SW - 0.0016, SY0], [SW, SY0 + 0.005], [SW, 0.053], [SW - 0.0042, 0.0635, 0.003],
    [SW - 0.0085, SY1, 0.004], [-SW + 0.0085, SY1, 0.004], [-SW + 0.0042, 0.0635, 0.003], [-SW, 0.053], [-SW, SY0 + 0.005],
  ], 0.0016);
}

/** Slanted serrations on both flanks of the slide, from z0 to z1: raised ribs over a dark cut. */
function serrations(m: Mesher, z0: number, z1: number, count: number): void {
  const y = 0.0435;
  m.mirror(() => {
    m.use(F.black);
    m.at([SW + 0.0001, y, (z0 + z1) / 2], null, () => m.box(0.0006, 0.015, z1 - z0, 0.0002));
    m.use(NITRIDE);
    for (let index = 0; index < count; index++) {
      const z = z0 + 0.003 + (index / (count - 1)) * (z1 - z0 - 0.006);
      m.at([SW + 0.0004, y, z], [0.34, 0, 0], () => m.box(0.0014, 0.0155, 0.0026, 0.0005));
    }
  });
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, 0], () => m.at([0, -BORE, 0], null, () => {
    const section = slideSection();
    m.use(NITRIDE);
    // Forward of the port: the bore shows through the face, the barrel crown a step inside it.
    m.at([0, 0, (MUZZLE + PORT) / 2], null, () => m.front(section, PORT - MUZZLE, { bevel: 0.0022, holes: [circle(0, BORE, 0.0122, 22)] }));
    // Behind the breech face the top is scooped down to the bore line for a few centimetres, so the round ahead of the face
    // is not hidden behind the full-height block from the eye.
    const scoop = poly([
      [-SW + 0.0016, SY0], [SW - 0.0016, SY0], [SW, SY0 + 0.005], [SW, 0.0545], [SW - 0.0016, 0.056], [-SW + 0.0016, 0.056], [-SW, 0.0545], [-SW, SY0 + 0.005],
    ], 0.0012);
    m.at([0, 0, BREECH + SCOOP / 2], null, () => m.front(scoop, SCOOP + 0.002, { bevel: 0.0016, capBack: false }));
    m.at([0, 0, (BREECH + SCOOP + SLIDE_REAR) / 2], null, () => m.front(section, SLIDE_REAR - BREECH - SCOOP, { bevel: 0.0022 }));
    // The port is open across the whole top, where the eye is in first person, and the right flank is cut down to a
    // rail for the case to leave by: from behind you see the chamber, and then the next round going into it.
    const left = poly([[-SW + 0.0016, SY0], [-SW + 0.0062, SY0], [-SW + 0.0062, 0.0525], [-SW + 0.0012, 0.053], [-SW, 0.051], [-SW, SY0 + 0.005]], 0.001);
    const rail = poly([[SW - 0.0056, SY0], [SW - 0.0016, SY0], [SW, SY0 + 0.005], [SW, 0.036], [SW - 0.0056, 0.036]], 0.0012);
    m.at([0, 0, (PORT + BREECH) / 2], null, () => {
      m.front(left, BREECH - PORT + 0.002, { capFront: false, capBack: false });
      m.front(rail, BREECH - PORT + 0.002, { capFront: false, capBack: false });
    });
    serrations(m, -0.268, -0.212, 11);
    reflex(m);
    serrations(m, 0.052, 0.1, 10);
    // Rear face: anti-glare grooves across it and a small firing-pin cap, nothing to catch the eye under the sights.
    m.use(F.black);
    for (let index = 0; index < 6; index++) {
      m.at([0, 0.03 + index * 0.0045, SLIDE_REAR + 0.0002], null, () => m.box(SW * 2 - 0.006, 0.0012, 0.0006, 0.0002));
    }
    m.use(STAINLESS);
    m.at([0, BORE, SLIDE_REAR + 0.0012], null, () => m.cyl(0.0021, 0.0016, 10, 0.0004));
    // Breech face inside the port: extractor claw on the right.
    m.use(F.steelDark);
    m.at([0, BORE, BREECH], null, () => m.cyl(0.0078, 0.0014, 16, 0.0003));
    m.use(STAINLESS);
    m.at([SW - 0.0035, BORE + 0.004, BREECH - 0.003], null, () => m.box(0.003, 0.006, 0.012, 0.0005));
    // Sights, three dots on one line (SIGHT_Y): a matte U-notch blade at the back with a dim dot either side of the notch, a
    // flat-topped post at the front with the bright dot. In the picture the post stands in the notch with light both sides.
    m.use(FRAME);
    m.at([0, 0, REAR_Z], null, () => m.front(poly([
      [-0.0105, SY1 - 0.001, 0], [0.0105, SY1 - 0.001, 0], [0.0088, SIGHT_Y + 0.0052, 0.0012], [0.0021, SIGHT_Y + 0.0052, 0.0004],
      [0.0021, SIGHT_Y - 0.0017, 0.0012], [-0.0021, SIGHT_Y - 0.0017, 0.0012], [-0.0021, SIGHT_Y + 0.0052, 0.0004], [-0.0088, SIGHT_Y + 0.0052, 0.0012],
    ], 0.0008), 0.016, { bevel: 0.0009 }));
    m.glow('rear', () => m.mirror(() => m.at([0.0054, SIGHT_Y, REAR_Z + 0.0083], null, () => m.cyl(0.0009, 0.0006, 10, 0))));
    m.at([0, 0, POST_Z], null, () => m.side(poly([
      [0.0045, SY1 - 0.001, 0], [0.0035, SIGHT_Y + 0.004, 0.0007], [-0.003, SIGHT_Y + 0.004, 0.001], [-0.008, SY1 - 0.001, 0],
    ], 0.0008), 0.0055, { bevel: 0.0006 }));
    m.glow('sight', () => m.at([0, SIGHT_Y, POST_Z + 0.0042], null, () => m.cyl(0.0016, 0.0008, 12, 0)));
    // A red inset line low on each flank of the rear slide: the one piece of light on the slide.
    m.use(F.black);
    m.mirror(() => m.at([SW + 0.0001, 0.032, 0.062], null, () => m.box(0.0006, 0.0034, 0.062, 0.0002)));
    m.glow('accent', () => m.mirror(() => m.at([SW + 0.0004, 0.032, 0.062], null, () => m.box(0.0004, 0.0012, 0.058, 0))));
    // Breech block behind the face, with the bolt-head detail the part name keeps for the rig.
    m.part('boltHead', [0, BORE, BREECH + 0.006], () => {
      m.use(F.steelDark);
      m.at([0, -0.004, 0.004], null, () => m.box(0.018, 0.014, 0.004, 0.0005));
    });
  }));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0106, PORT - 0.002, 0], [0.0106, MUZZLE + 0.004], [0.0098, MUZZLE + 0.0015], [0.0068, MUZZLE + 0.0015, 0]], 20);
    m.use(F.black);
    m.lathe([[0.0068, MUZZLE + 0.0015, 0], [0.0064, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 14);
  });
  // Barrel hood in bright steel: the square block the port shows, with the chamber mouth facing back.
  m.use(STAINLESS);
  const hood = poly([[-0.0128, 0.0355], [0.0128, 0.0355], [0.0128, 0.0595], [-0.0128, 0.0595]], 0.0028);
  m.at([0, 0, (PORT - 0.004 + BREECH) / 2], null, () => m.front(hood, BREECH - PORT + 0.004, { bevel: 0.0012, holes: [circle(0, BORE, ROUND_R * 1.14, 20)] }));
  m.use(F.black);
  m.at([0, BORE, BREECH - 0.054], null, () => m.cyl(ROUND_R * 1.16, 0.002, 16, 0));
  m.at([0, 0.0597, -0.02], null, () => m.box(0.0036, 0.0006, 0.026, 0.0002));
  m.glow('accent', () => m.at([0, 0.0599, -0.02], null, () => m.box(0.0014, 0.0004, 0.022, 0)));
}

/** Frame outline in side view, flush with the muzzle in front, the beavertail tang behind. */
const FRAME_TOP: P2[] = [
  [MUZZLE, SY0, 0.002], [0.101, SY0, 0.002], [0.107, 0.012, 0.004], [0.125, 0.0, 0.006], [0.118, -0.007, 0.004], [0.1, -0.012, 0.006],
  [0.034, -0.024, 0.004], [-0.004, -0.022, 0.003], [-0.046, -0.028, 0.005], [MUZZLE, -0.028, 0.004],
];

function frame(m: Mesher): void {
  m.use(FRAME);
  m.side(poly(FRAME_TOP, 0.002), CORE * 2, { bevel: 0.0016 });
  // Side plates: everything but the flute, so the flute is a real channel with the core at its floor.
  const plate = poly([
    [MUZZLE, SY0, 0.002], [0.1, SY0, 0.002], [0.106, 0.012, 0.004], [0.11, -0.004, 0.004], [0.096, -0.01, 0.004],
    [0.034, -0.023, 0.004], [-0.004, -0.021, 0.003], [-0.046, -0.028, 0.005], [MUZZLE, -0.028, 0.004],
    [MUZZLE, -0.0005, 0.0015], [-0.112, -0.0005, 0.0068], [-0.104, 0.0075, 0.0001], [-0.112, 0.0155, 0.0068], [MUZZLE, 0.0155, 0.0015],
  ], 0.002);
  m.mirror(() => m.at([CORE + (FW - CORE) / 2 - 0.0002, 0, 0], null, () => m.side(plate, FW - CORE + 0.0004, { bevel: 0.0013 })));
  // The flute floor: a dark cut with a red line, and the counterweight rod riding above it.
  m.use(F.black);
  m.mirror(() => m.at([CORE + 0.0001, 0.0026, -0.22], null, () => m.box(0.0006, 0.0034, 0.22, 0.0002)));
  m.glow('accent', () => m.mirror(() => m.at([CORE + 0.0004, 0.0026, -0.22], null, () => m.box(0.0004, 0.0012, 0.216, 0))));
  m.part('weight', [0, 0.0095, -0.2], () => {
    m.use(STAINLESS);
    m.mirror(() => m.at([CORE + 0.0022, 0, 0], null, () => {
      m.cyl(0.0034, 0.13, 14, 0.0006);
      m.use(F.steelDark);
      for (const z of [-0.061, 0.061]) m.at([0, 0, z], null, () => m.cyl(0.0039, 0.004, 14, 0.0005));
      m.use(STAINLESS);
    }));
  });
  // Magwell mouth under the slide, where the next round comes up.
  m.use(F.black);
  m.at([0, SY0 + 0.0002, FEED_Z - 0.026], null, () => m.box(0.017, 0.0006, 0.056, 0.0002));
  // Controls in bright steel: slide stop on the left, an ambidextrous safety, a takedown pin head on the right.
  m.use(STAINLESS);
  m.at([-FW - 0.0014, 0, 0], null, () => m.side(poly([
    [-0.08, 0.0145, 0.003], [-0.074, 0.023, 0.002], [-0.034, 0.0235, 0.004], [-0.016, 0.019, 0.003], [-0.02, 0.0115, 0.003], [-0.062, 0.012, 0.004],
  ], 0.001), 0.0028, { bevel: 0.0008 }));
  m.at([-FW - 0.0026, 0.0175, -0.022], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.0018, 14, 0.0005));
  m.mirror(() => {
    m.at([FW + 0.0012, 0, 0], null, () => m.side(poly([
      [0.07, 0.0105, 0.003], [0.074, 0.0215, 0.003], [0.094, 0.0225, 0.003], [0.1, 0.017, 0.002], [0.088, 0.012, 0.003],
    ], 0.001), 0.0026, { bevel: 0.0008 }));
  });
  m.at([FW + 0.0012, 0.0175, -0.022], [0, Math.PI / 2, 0], () => m.cyl(0.0032, 0.0016, 12, 0.0005));
  m.mirror(() => {
    screwX(m, FW + 0.0002, -0.018, MUZZLE + 0.035, 1, 0.0022, F.steelDark);
    screwX(m, FW + 0.0002, -0.018, -0.07, 1, 0.0022, F.steelDark);
  });
  // Magazine release behind the trigger guard.
  m.use(STAINLESS);
  m.at([-CORE - 0.0006, -0.031, 0.036], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.003, 14, 0.0006));
}

function guard(m: Mesher): void {
  // A big round bow with a small forward spur at its foot, running back into the front strap.
  const cz = -0.019;
  const cy = -0.045;
  const outer: [number, number][] = [];
  for (let k = 0; k <= 16; k++) {
    const a = Math.PI / 2 + 0.42 + (k / 16) * 2.75;
    outer.push([cz + Math.cos(a) * 0.0285, cy + Math.sin(a) * 0.027]);
    if (k === 11) outer.push([cz - 0.033, cy - 0.027]);
  }
  outer.push([0.03, -0.054], [0.04, -0.036], [0.03, -0.02]);
  const inner: V2[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    inner.push([cz + Math.cos(a) * 0.0215, cy + Math.sin(a) * 0.0205]);
  }
  m.use(FRAME);
  m.side(poly(outer, 0.0015), 0.0115, { bevel: 0.0016, holes: [inner], smooth: 30 });
}

function grip(m: Mesher): void {
  const front = curve([[0.034, -0.02], [0.036, -0.045], [0.044, -0.085], [0.054, -0.125], [0.06, -0.143]], 4);
  const back = curve([[0.132, -0.138], [0.124, -0.1], [0.113, -0.055], [0.105, -0.02], [0.1, -0.008]], 4);
  const outline: V2[] = [...front, [0.062, -0.148], [0.131, -0.144], ...back];
  m.use(FRAME);
  m.side(outline, CORE * 2, { bevel: 0.0026, smooth: 50 });
  // Front strap grooves.
  m.use(F.steelDark);
  for (let index = 0; index < 12; index++) {
    const t = index / 11;
    const y = -0.05 - t * 0.085;
    const z = 0.0362 + (-0.05 - y) * 0.24;
    m.at([0, y, z], [-0.25, 0, 0], () => m.box(CORE * 1.7, 0.0018, 0.002, 0.0004));
  }
  // Chunky red panels: a plain rim with a raised textured field, one screw, a thumb relief at the top front.
  const panel = poly([[0.044, -0.022, 0.006], [0.103, -0.016, 0.004], [0.118, -0.07, 0.006], [0.125, -0.134, 0.006], [0.066, -0.138, 0.006], [0.05, -0.07, 0.01]], 0.004);
  const field = poly([[0.052, -0.03, 0.004], [0.099, -0.025, 0.003], [0.112, -0.072, 0.005], [0.118, -0.127, 0.004], [0.071, -0.13, 0.004], [0.058, -0.072, 0.008]], 0.003);
  m.mirror(() => {
    m.use(RED);
    m.at([CORE + 0.0024, 0, 0], null, () => m.side(panel, 0.0054, { bevel: 0.0024 }));
    m.use(RED_TEXTURE);
    m.at([CORE + 0.0052, 0, 0], null, () => m.side(field, 0.0016, { bevel: 0.0006 }));
    screwX(m, CORE + 0.006, -0.112, 0.108, 1, 0.0028, F.steelDark);
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, MAG_Y, MAG_Z], () => {
    // The body follows the grip's rake; it only shows when it is out of the gun.
    m.at([0, 0, 0], [-0.26, 0, 0], () => {
      m.use(F.steelDark);
      m.side(poly([[-0.028, 0], [0.028, 0], [0.028, -0.166], [-0.028, -0.166]], 0.002), 0.024, { bevel: 0.001 });
      m.mirror(() => m.at([0.0105, 0.001, 0.004], null, () => m.box(0.003, 0.006, 0.04, 0.0006)));
    });
    // Base pad: frame black with a red sole, standing proud under the grip.
    const pad = () => {
      m.use(FRAME);
      m.side(poly([[-0.036, 0.006], [0.036, 0.006], [0.04, -0.004], [-0.034, -0.005]], 0.003), 0.037, { bevel: 0.0018 });
      m.use(RED);
      m.at([0, -0.0058, 0.002], null, () => m.box(0.03, 0.0018, 0.062, 0.0006));
    };
    m.at([0, -0.166, 0.042], [-0.1, 0, 0], pad);
    // The extended magazine (four more rounds): a ribbed sleeve hangs under the stock pad, a window on the stack in it, and a
    // second pad under that. Built onto the stock one, so the shop's studio, which poses the gun without its clip, shows it right.
    m.part('magExt', [0, 0, 0], () => {
      m.at([0, 0, 0], [-0.26, 0, 0], () => {
        m.use(FRAME);
        m.side(poly([[-0.03, -0.168], [0.03, -0.168], [0.03, -0.222], [-0.03, -0.222]], 0.003), 0.03, { bevel: 0.0016, holes: [rect(-0.012, -0.214, 0.006, -0.18, 0.003)] });
        m.use(F.brass);
        for (let index = 0; index < 3; index++) m.at([0, -0.186 - index * 0.0122, -0.003], null, () => m.box(0.026, 0.0105, 0.02, 0.003));
        m.use(RED);
        m.mirror(() => {
          for (let index = 0; index < 3; index++) m.at([0.0152, -0.176 - index * 0.006, 0.019], null, () => m.box(0.0012, 0.0024, 0.018, 0.0005));
        });
      });
      m.at([0, -0.2185, 0.0582], [-0.1, 0, 0], pad);
    });
    // The rest of the stack under the top round, so the well is never empty when the top one climbs out.
    m.part('stack', [0, FEED_Y - MAG_Y - 0.0144, FEED_Z - MAG_Z + 0.004], () => round(m, ROUND_R, CASE, BULLET));
    m.part('feedRound', [0, FEED_Y - MAG_Y, FEED_Z - MAG_Z], () => round(m, ROUND_R, CASE, BULLET));
  });
}

/**
 * An oversized brutalist offset-monolith suppressor on a heavy barrel stub: eccentric chamfered carbon-weave body hanging deep
 * below the bore so its top stays under the sight line, machined dark-titanium QD locking collar and mid-body structural clamp,
 * vented armor flanks with fluted belly ribs over a recessed red inset line, anti-glare top sight channel, and recessed muzzle crown.
 */
function suppressor(m: Mesher): void {
  m.part('can', [0, BORE, MUZZLE], () => {
    const section = (w: number, top: number, bot: number, cTop: number, cBot: number) => poly([
      [-w + cBot, -bot], [w - cBot, -bot],
      [w, -bot + cBot], [w, top - cTop],
      [w - cTop, top], [-w + cTop, top],
      [-w, top - cTop], [-w, -bot + cBot],
    ], 0.0018, 2);

    // Heavy threaded barrel adapter stub & stainless indexing shoulder emerging from the Ultramag muzzle.
    m.use(F.barrel);
    m.at([0, 0, -0.005], null, () => m.cyl(0.0114, 0.014, 18, 0.0004));
    m.use(STAINLESS);
    m.at([0, 0, -0.0055], null, () => m.cyl(0.014, 0.0036, 18, 0.0004));

    // Rear quick-detach machined dark-titanium locking collar: stepped transition mating tightly to the Ultramag front face.
    m.use(CAN_TITANIUM);
    m.at([0, 0, -0.01], null, () => m.front(section(CAN_W - 0.0052, CAN_TOP - 0.0028, CAN_BOT - 0.018, 0.0075, 0.007), 0.009, { bevel: 0.0016 }));
    m.at([0, 0, -0.0265], null, () => m.front(section(CAN_W - 0.0016, CAN_TOP - 0.0014, CAN_BOT - 0.0065, 0.009, 0.0085), 0.026, { bevel: 0.0016 }));
    // Deep radial grip grooves milled around the locking collar flanks + stainless QD latch tab.
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 5; i++) {
        m.at([CAN_W - 0.0015, -0.018, -0.018 - i * 0.0042], null, () => m.box(0.0008, CAN_TOP + CAN_BOT - 0.028, 0.0016, 0));
      }
    });
    m.use(STAINLESS);
    m.mirror(() => m.at([CAN_W - 0.001, -0.036, -0.0265], null, () => m.box(0.0018, 0.0085, 0.014, 0.0006)));
    m.mirror(() => screwX(m, CAN_W - 0.0014, -0.003, -0.0265, 1, 0.0022, F.steelDark));

    // Continuous dark recessed pressure-vessel core spanning both baffle modules.
    const zStart = -0.039;
    const zEnd = -CAN_LEN + 0.038; // -0.312
    const zMidA = -0.172;
    const zMidB = -0.199;
    m.use(FRAME);
    m.at([0, 0, (zStart + zEnd) / 2], null, () => m.front(section(CAN_W - 0.0034, CAN_TOP - 0.0024, CAN_BOT - 0.0024, 0.0092, 0.009), zStart - zEnd + 0.002, { bevel: 0.0014 }));

    // Twin chamfered matte carbon/anodized outer shroud modules (rear expansion chamber & forward baffle housing).
    const moduleBody = (za: number, zb: number, vents: number) => {
      const len = za - zb;
      const zc = (za + zb) / 2;
      m.use(CAN_SHROUD);
      m.at([0, 0, zc], null, () => m.front(section(CAN_W - 0.0012, CAN_TOP - 0.0016, CAN_BOT - 0.0008, 0.0096, 0.0095), len, { bevel: 0.0018 }));
      // Sculpted titanium flank armor plates with slanted cooling vents over a dark recessed chamber.
      m.use(F.black);
      m.mirror(() => m.at([CAN_W - 0.0022, -0.007, zc], null, () => m.box(0.0008, 0.026, len - 0.012, 0)));
      m.use(CAN_TITANIUM);
      m.mirror(() => m.at([CAN_W - 0.0008, 0, 0], null, () => m.side(poly([
        [za - 0.004, -0.022], [za - 0.004, 0.0075], [zb + 0.004, 0.0075], [zb + 0.004, -0.022],
      ], 0.0018, 2), 0.0026, { bevel: 0.0007, holes: slotRow(za - 0.018, -0.007, zb + 0.018, -0.007, vents, 0.0175, 0.0046, 1.22) })));
      // Deep lower expansion-belly flute channel with twin machined cooling ribs and a thin glowing red accent line.
      m.use(F.black);
      m.mirror(() => m.at([CAN_W - 0.0014, -0.0375, zc], null, () => m.box(0.0008, 0.019, len - 0.01, 0)));
      m.glow('accent', () => m.mirror(() => m.at([CAN_W - 0.001, -0.0375, zc], null, () => m.box(0.0004, 0.0012, len - 0.016, 0))));
      m.use(CAN_TITANIUM);
      m.mirror(() => {
        for (const ry of [-0.0312, -0.0438]) {
          m.at([CAN_W - 0.0004, ry, zc], null, () => m.box(0.0022, 0.0042, len - 0.01, 0.0007));
        }
      });
      // Top spine twin chamfered side rails framing a dark anti-glare sight trough with milled anti-mirage cross-ribs.
      m.use(CAN_TITANIUM);
      m.mirror(() => m.at([0.0118, CAN_TOP - 0.001, zc], null, () => m.box(0.0068, 0.002, len - 0.004, 0.0006)));
      m.use(F.black);
      m.at([0, CAN_TOP - 0.0021, zc], null, () => m.box(0.0148, 0.0008, len - 0.004, 0));
      m.use(CAN_SHROUD);
      for (let i = 0; i < 4; i++) {
        const rz = za - 0.016 - (i / 3) * (len - 0.032);
        m.at([0, CAN_TOP - 0.0015, rz], null, () => m.box(0.0132, 0.0012, 0.0036, 0.0003));
      }
      // Heavy machined ventral keel skid bar with transverse cooling slots along the underside.
      m.use(CAN_TITANIUM);
      m.at([0, -CAN_BOT + 0.0002, zc], null, () => m.box(0.025, 0.0026, len - 0.006, 0.0008));
      m.use(F.black);
      for (let i = 0; i < 4; i++) {
        const kz = za - 0.018 - (i / 3) * (len - 0.036);
        m.at([0, -CAN_BOT - 0.0009, kz], null, () => m.box(0.022, 0.0008, 0.0036, 0));
      }
    };

    moduleBody(zStart - 0.002, zMidA, 6);
    moduleBody(zMidB, zEnd, 5);

    // Mid-body machined dark-titanium structural clamp collar joining the two baffle modules.
    const zMid = (zMidA + zMidB) / 2;
    m.use(CAN_TITANIUM);
    m.at([0, 0, zMid], null, () => m.front(section(CAN_W + 0.0004, CAN_TOP - 0.0004, CAN_BOT + 0.0006, 0.01, 0.0095), zMidA - zMidB + 0.004, { bevel: 0.0018 }));
    m.use(F.black);
    m.mirror(() => m.at([CAN_W + 0.0005, -0.023, zMid], null, () => m.box(0.0006, 0.022, 0.016, 0)));
    m.mirror(() => {
      screwX(m, CAN_W + 0.0005, -0.004, zMid, 1, 0.0022, F.steelDark);
      screwX(m, CAN_W + 0.0005, -0.042, zMid, 1, 0.0022, F.steelDark);
    });

    // Heavy stepped front end-cap, angled nose shroud, lower baffle plug detail, and recessed circular muzzle crown.
    const zCap0 = zEnd; // -0.312
    const zCap1 = -CAN_LEN + 0.015; // -0.335
    const zNose = -CAN_LEN + 0.0055; // -0.3445
    m.use(CAN_TITANIUM);
    m.at([0, 0, (zCap0 + zCap1) / 2], null, () => m.front(section(CAN_W, CAN_TOP - 0.0004, CAN_BOT, 0.01, 0.0095), zCap0 - zCap1, { bevel: 0.0018, holes: [circle(0, 0, 0.0098, 20)] }));
    m.mirror(() => {
      screwX(m, CAN_W + 0.0001, -0.004, (zCap0 + zCap1) / 2, 1, 0.0022, F.steelDark);
      screwX(m, CAN_W + 0.0001, -0.04, (zCap0 + zCap1) / 2, 1, 0.0022, F.steelDark);
    });
    m.use(CAN_SHROUD);
    m.at([0, 0, (zCap1 + zNose) / 2 + 0.001], null, () => m.front(section(CAN_W - 0.0024, CAN_TOP - 0.002, CAN_BOT - 0.005, 0.0094, 0.009), zCap1 - zNose + 0.002, { bevel: 0.002, holes: [circle(0, 0, 0.0098, 20)] }));
    // Lower front baffle-chamber plug detail on the deep monolith nose face.
    m.use(F.black);
    m.at([0, -0.033, zNose - 0.0002], null, () => m.box(0.025, 0.019, 0.001, 0));
    m.use(CAN_TITANIUM);
    m.at([0, -0.033, zNose - 0.0009], null, () => m.box(0.02, 0.014, 0.0018, 0.0006));
    m.use(F.steelDark);
    m.at([0, -0.033, zNose - 0.0018], null, () => m.cyl(0.0042, 0.0014, 6, 0.0003));
    // Machined circular muzzle aperture crown protruding cleanly to -CAN_LEN, with stainless inner chamfer and deep dark bore.
    m.use(CAN_TITANIUM);
    m.lathe([
      [0.0136, zCap1 + 0.001, 0],
      [0.0136, zNose - 0.0005, 0.0008],
      [0.0118, -CAN_LEN + 0.0005, 0.0007],
      [0.0094, -CAN_LEN + 0.0005, 0.0004],
      [0.0094, zNose + 0.001, 0],
    ], 22);
    m.use(STAINLESS);
    m.lathe([
      [0.0094, -CAN_LEN + 0.0018, 0],
      [0.0094, -CAN_LEN, 0.0004],
      [0.0076, -CAN_LEN, 0.0004],
      [0.0076, -CAN_LEN + 0.0025, 0],
    ], 20);
    m.use(F.black);
    m.lathe([
      [0.0076, -CAN_LEN + 0.0022, 0],
      [0.0074, zCap0 + 0.004, 0],
      [0, zCap0 + 0.005, 0],
    ], 16);
    // Four spanner-wrench relief notches around the muzzle crown face.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      m.at([Math.cos(a) * 0.0112, Math.sin(a) * 0.0112, -CAN_LEN + 0.0007], [0, 0, a], () => m.box(0.0028, 0.0016, 0.0018, 0));
    }
  });
}

/**
 * A ramjet compensator on the same barrel stub as the can, carrying the gun's own lines forward: over the bore it is the slide's
 * section (its flats, facets and corners) in a darker nitride, under it the frame's width and flute in the frame's black, its foot
 * raked back with a lightening window cut through. Three deep ports cut down through the top, each deeper than the last toward
 * the muzzle, their chambers dark, the rails beside them (the slide's facets) cut down with them so the steps show from the side.
 * A steel crown round the bore.
 */
function compensator(m: Mesher): void {
  m.part('comp', [0, BORE, MUZZLE], () => {
    m.use(F.barrel);
    m.at([0, 0, -0.004], null, () => m.cyl(0.0106, 0.01, 18, 0.0004));
    m.at([0, -BORE, 0], null, () => compBody(m));
  });
}

/** The compensator in the slide's frame (y from the frame's origin, z from the muzzle face). */
function compBody(m: Mesher): void {
  const z0 = -0.0008;
  const z1 = -COMP_LEN;
  const span = (a: number, b: number, fn: () => void) => m.at([0, 0, (a + b) / 2], null, fn);
  /** The ports' half width, where their walls meet the facets, and each port's span and floor: deeper toward the muzzle. */
  const pw = 0.0125;
  const rim = 0.0651;
  /** Each port's span, its floor, and how far down it cuts the rails beside it: all deeper toward the muzzle. */
  const ports: [number, number, number, number][] = [
    [-0.012, -0.028, BORE - 0.009, 0.0585], [-0.034, -0.051, BORE - 0.0135, 0.0555], [-0.057, -0.072, BORE - 0.018, 0.0525],
  ];
  const floor = Math.min(...ports.map(p => p[2]));
  m.use(COMP_NITRIDE);
  // Under the ports, the slide's section to the deepest floor, in one piece.
  span(z0, z1, () => m.front(poly([[-SW + 0.0016, SY0], [SW - 0.0016, SY0], [SW, SY0 + 0.005], [SW, floor, 0], [-SW, floor, 0], [-SW, SY0 + 0.005]], 0.0016), z0 - z1, { bevel: 0.0018 }));
  // Over it a rail each side, the slide's flank and facet; beside each port cut down, so the steps show in the side view.
  const rail = poly([[pw, floor, 0], [SW, floor, 0], [SW, 0.053], [SW - 0.0042, 0.0635, 0.003], [pw, rim, 0.0006]], 0.0016);
  const cutRail = (y: number) => poly([[pw, floor, 0], [SW, floor, 0], [SW, y, 0.0014], [pw, y, 0.0006]], 0.0016);
  // Between the rails: the solid bars round the bore, and a floor under each port up to its depth.
  const middle = (top: number) => poly([[-pw, floor, 0], [pw, floor, 0], [pw, rim, 0], [SW - 0.0085, SY1, 0.004], [-SW + 0.0085, SY1, 0.004], [-pw, rim, 0]].map(p => [p[0], Math.min(p[1], top), p[2]] as P2), 0.0016);
  const bars: [number, number][] = [[z0, ports[0]![0]], [ports[0]![1], ports[1]![0]], [ports[1]![1], ports[2]![0]], [ports[2]![1], z1]];
  for (const [a, b] of bars) {
    span(a, b, () => {
      m.front(middle(SY1 + 1), a - b, { bevel: 0.0016, holes: [circle(0, BORE, 0.0072, 20)] });
      m.mirror(() => m.front(rail, a - b, { bevel: 0.0016 }));
    });
  }
  for (const [a, b, y, cut] of ports) {
    span(a, b, () => {
      if (y > floor + 0.0005) m.front(poly([[-pw, floor, 0], [pw, floor, 0], [pw, y, 0], [-pw, y, 0]], 0.001), a - b, { bevel: 0.0006 });
      m.mirror(() => m.front(cutRail(cut), a - b, { bevel: 0.0012 }));
    });
  }
  // The chambers' walls and floors in black, a rim's width down from the top so the chamfered edges stay bright.
  m.use(F.black);
  for (const [a, b, y, cut] of ports) {
    const len = a - b - 0.0036;
    const h = rim - y - 0.0035;
    const side = cut - y - 0.0028;
    m.mirror(() => m.at([pw - 0.0003, y + side / 2, (a + b) / 2], null, () => m.box(0.0006, side, len, 0.0001)));
    for (const z of [a - 0.0003, b + 0.0003]) m.at([0, y + h / 2, z], null, () => m.box(pw * 2 - 0.0036, h, 0.0006, 0.0001));
    m.at([0, y + 0.0003, (a + b) / 2], null, () => m.box(pw * 2 - 0.001, 0.0006, len, 0.0001));
  }
  // The crown: a bright steel ring set into the front face round the bore.
  m.use(STAINLESS);
  m.at([0, BORE, z1 - 0.0002], null, () => m.lathe([[0.0072, 0.0016, 0], [0.0094, 0.0012], [0.0098, -0.0006], [0.0072, -0.0006, 0]], 22));
  // Under the slide: the frame's width and black, raked back at the front, the flute carried on, a window cut through, two screws.
  const cut = slot(-0.018, -0.0145, -0.05, -0.0145, 0.0055, 10);
  m.use(FRAME);
  m.side(poly([[z0, SY0, 0.002], [z0, -0.028, 0.004], [z1 + 0.017, -0.028, 0.005], [z1, SY0 - 0.006, 0.005], [z1, SY0, 0.002]], 0.002), FW * 2, { bevel: 0.0016, holes: [cut] });
  m.use(F.black);
  m.mirror(() => {
    m.at([FW + 0.0001, 0.0075, (z0 + z1) / 2 + 0.004], null, () => m.box(0.0006, 0.0034, z0 - z1 - 0.014, 0.0002));
    screwX(m, FW + 0.0002, -0.0225, -0.006, 1, 0.0021, F.steelDark);
    screwX(m, FW + 0.0002, -0.0065, -0.006, 1, 0.0021, F.steelDark);
  });
}

/**
 * A chunky reflex sight (an RMR's shape at the gun's scale) on the slide, riding it: a slanted hood over a wide window, a
 * rear frame, the base on the slide's flat, a button on each flank, the dot floating at the window's middle.
 */
function reflex(m: Mesher): void {
  m.part('rmr', [0, SY1, RMR_Z], () => {
    const w = 0.0205;
    const win = rect(-0.0145, DOT_Y - SY1 - 0.0105, 0.0145, DOT_Y - SY1 + 0.0095, 0.004);
    m.use(FRAME);
    // Base on the slide's top flat, and the low body between the two frames.
    m.at([0, 0.0025, 0], null, () => m.box(w * 2, 0.005, 0.046, 0.0014, 0.003));
    m.side(poly([[0.022, 0.003], [0.022, 0.0095], [-0.022, 0.0095], [-0.022, 0.003]], 0.001), w * 2, { bevel: 0.0014 });
    // Front hood: thick, its face raked back; the rear frame thinner. Both carry the window. The band over the window is 5 mm
    // and more: a bevel insets the face's outline and widens the window's, and where the two cross the face fills the window in.
    const hood = poly([[-w, 0.003], [w, 0.003], [w, 0.028, 0.006], [w - 0.007, 0.036, 0.005], [-w + 0.007, 0.036, 0.005], [-w, 0.028, 0.006]], 0.002);
    m.at([0, 0, -0.016], null, () => m.front(hood, 0.013, { bevel: 0.0018, holes: [win] }));
    m.at([0, 0, 0.019], null, () => m.front(hood, 0.007, { bevel: 0.0014, holes: [win] }));
    // The bridge over the window from hood to rear frame, clear of the window's top edge, and the flanks under the window.
    m.at([0, DOT_Y - SY1 + 0.0138, 0.0015], null, () => m.box(0.026, 0.0032, 0.03, 0.0012));
    m.mirror(() => m.at([w - 0.0015, 0.0105, 0.0015], null, () => m.box(0.003, 0.006, 0.03, 0.0008)));
    m.use(NITRIDE);
    m.mirror(() => m.at([w + 0.0004, 0.006, -0.002], null, () => m.box(0.0012, 0.004, 0.03, 0.0004)));
    m.use(STAINLESS);
    m.mirror(() => m.at([w + 0.0008, 0.0155, -0.016], null, () => m.box(0.0016, 0.006, 0.008, 0.0006)));
    m.mirror(() => screwX(m, w + 0.0002, 0.006, 0.016, 1, 0.0016, F.steelDark));
    m.glass(() => m.at([0, 0, -0.0105], null, () => m.front(win, 0.0008, { bevel: 0 })));
    m.glow('dot', () => m.at([0, DOT_Y - SY1, DOT_Z - RMR_Z + 0.0004], null, () => m.cyl(0.0007, 0.0002, 12, 0)));
  });
}

/** A laser module under the dust cover: a squared housing on a clamp, the lens and its pinpoint, two pressure pads. */
function laser(m: Mesher): void {
  m.part('lam', [0, -0.028, -0.236], () => m.scaled(1.25, () => {
    m.use(FRAME);
    m.at([0, -0.003, 0], null, () => m.box(0.03, 0.006, 0.062, 0.0012, 0.002));
    m.side(poly([[0.032, -0.005], [0.032, -0.02, 0.004], [-0.026, -0.022, 0.004], [-0.034, -0.012, 0.004], [-0.034, -0.005]], 0.0015), 0.028, { bevel: 0.0018 });
    m.use(NITRIDE);
    m.mirror(() => m.at([0.0142, 0, 0], null, () => m.side(poly([[0.026, -0.008], [0.026, -0.018], [-0.022, -0.019], [-0.026, -0.012], [-0.026, -0.008]], 0.0012), 0.0016, { bevel: 0.0005 })));
    m.use(STAINLESS);
    m.mirror(() => m.at([0.0148, -0.0135, 0.02], null, () => m.box(0.0016, 0.006, 0.008, 0.0005)));
    // The lens in a black bezel on the front face, and beside it the dark eye of the second emitter.
    m.use(F.black);
    m.at([-0.006, -0.0135, -0.0345], null, () => m.cyl(0.0058, 0.003, 18, 0.0005));
    m.at([0.0075, -0.0135, -0.0345], null, () => m.cyl(0.0034, 0.003, 14, 0.0004));
    m.glass(() => m.at([-0.006, -0.0135, -0.0362], null, () => m.cyl(0.0046, 0.0006, 18, 0)));
    m.glow('laser', () => m.at([-0.006, -0.0135, -0.0366], null, () => m.cyl(0.0011, 0.0003, 10, 0)));
  }));
}

function buildUltramag(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0012;
  frame(m);
  guard(m);
  grip(m);
  barrel(m);
  slide(m);
  magazine(m);
  suppressor(m);
  compensator(m);
  laser(m);
  // The shop's weapon light (weapons/mods.ts LIGHT_GUNS), hidden until fitted: on the dust cover's left, as the laser has the rail.
  weaponLight(m, [-0.0333, -0.0089, -0.2396], -Math.PI / 2, 0.95);
  // Hooked hammer, cocked: the spur curls back over the web of the hand.
  m.part('hammer', [0, 0.013, 0.111], () => {
    m.use(STAINLESS);
    m.side(poly([
      [-0.005, -0.006, 0.002], [0.005, -0.006, 0.002], [0.008, 0.005, 0.002], [0.017, 0.01, 0.004], [0.026, 0.019, 0.003],
      [0.024, 0.023, 0.001], [0.019, 0.019, 0.003], [0.008, 0.0165, 0.004], [-0.004, 0.012, 0.003],
    ], 0.001), 0.0085, { bevel: 0.0012 });
    m.use(F.black);
    m.at([0, 0.006, 0.002], null, () => m.side(circle(0, 0, 0.0028, 12), 0.0088, { bevel: 0.0004 }));
  });
  m.part('trigger', [0, -0.022, -0.006], () => {
    m.use(STAINLESS);
    m.side(poly([[-0.0035, 0.002], [0.004, 0.002], [0.0015, -0.012, 0.004], [0.006, -0.027, 0.002], [0.0025, -0.0285, 0.001], [-0.004, -0.014, 0.005]], 0.001), 0.0068, { bevel: 0.0008 });
  });
  shrink(m.tree, S);
  const model = new Model(m, kit.mats, {
    glows: { sight: [0xff6a1a, 7], rear: [0xffe2c4, 2], accent: [0xff2a1c, 3.2], laser: [0xff3020, 7], dot: OPTIC_GLOWS.dot, torch: TORCH },
  });
  model.socket('muzzle', k([0, BORE, MUZZLE - 0.004]));
  model.socket('muzzleCan', k([0, BORE, MUZZLE - CAN_LEN - 0.002]));
  model.socket('muzzleComp', k([0, BORE, MUZZLE - COMP_LEN - 0.002]));
  // The laser's lens (laser(): the part's pivot and its 1.25 scale), facing down the bore.
  model.socket('laser', k([-0.0075, -0.028 - 0.0135 * 1.25, -0.236 - 0.0367 * 1.25]));
  model.socket('eject', k([SW + 0.004, BORE + 0.014, -0.022]));
  model.hand('gripR', k([0.024, -0.07, 0.077]), [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.pistolSupport('gripL', k([-0.034, -0.072, 0.07]));
  model.hand('magHold', k([-0.017, -0.1, 0.022]), [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.hand('boltHold', k([-0.023, 0.0, 0.07]), [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'slide');
  return model;
}

/** Scales a built mesh tree about the origin: every vertex and every part's pivot. Normals keep under a uniform scale. */
function shrink(node: PartNode, s: number): void {
  node.pivot.multiplyScalar(s);
  for (const layer of node.layers.values()) for (let i = 0; i < layer.p.length; i++) layer.p[i] = layer.p[i]! * s;
  for (const child of node.children) shrink(child, s);
}

/** Fire-cycle timing, seconds after the shot: back, hang, home. Done well inside the 0.36 s interval. */
const BACK_END = 0.04;
const HOME_START = 0.13;
const HOME_END = 0.245;

function clip(a: Anim): void {
  const parts = a.parts;
  const time = a.sinceFire;
  const reload = a.reload;
  const fired = a.shots > 0 && time < HOME_END + 0.04 && reload < 0;
  // Slide position, 0 home to 1 at full travel, and how far the round has been stripped forward (0 in the magazine).
  let back = fired ? outQuad(seg(time, 0.004, BACK_END)) * (1 - inOut(seg(time, HOME_START, HOME_END))) : 0;
  let lift = inOut(seg(time, BACK_END + 0.01, 0.11));
  let feeding = fired && a.mag > 0 && time >= BACK_END && time < HOME_END;
  // The last shot locks it back.
  if (a.mag <= 0 && a.shots > 0) back = time < BACK_END ? outQuad(seg(time, 0.004, BACK_END)) : 1;
  if (reload >= 0) {
    const locked = a.mag <= 0;
    const charging = locked ? 1 : inOut(seg(reload, 0.66, 0.76));
    const closing = inOut(seg(reload, 0.8, 0.92));
    back = charging * (1 - closing);
    lift = inOut(seg(reload, 0.76, 0.8));
    feeding = reload >= 0.76 && reload < 0.92;
  }
  parts.slide!.position.z += back * TRAVEL * S;
  parts.weight!.position.z -= back * 0.026 * S;
  parts.hammer!.rotation.x += back * 0.42;
  const cartridge = parts.feedRound!;
  // At rest the slide covers the top round, so it can always show while there is one.
  cartridge.visible = reload >= 0.2 ? reload >= 0.52 : a.mag > 0;
  parts.stack!.visible = reload >= 0.2 ? reload >= 0.52 : a.mag > 1;
  if (feeding) {
    // The spring throws it up a touch over the bore line, nose high, while the slide hangs, where the eye sees it through the
    // open top with the gun held level; then the breech face strips it forward, down onto the line and home.
    const home = 1 - back;
    const ramp = inOut(seg(home, 0, 0.4));
    cartridge.position.y += (lift * (BORE + 0.002 - FEED_Y) - ramp * 0.002) * S;
    cartridge.position.z -= home * TRAVEL * S;
    cartridge.rotation.x += 0.16 * lift * (1 - inOut(seg(home, 0.15, 0.55)));
  }
  pullTrigger(a, 0.06, 0.36);
  // The irons' three dots go dark under a fitted optic, so only its dot shows in the window.
  const irons = a.mods?.has('ultramagDot') ? 0 : 1;
  a.glow('sight', irons);
  a.glow('rear', irons);
  a.glow('accent', 1 + (fired ? (1 - Math.min(1, time / HOME_END)) * 1.6 : 0));
  if (fired) {
    // A magnum's flip: the muzzle snaps up and the gun drives back into the hand in 20 ms, then eases down to level, never
    // below it. On top of the rig's recoil spring; half of it while aiming, so the sights come back sooner.
    // A compensator's ports hold it down (`COMP.flip`); the slide still runs its whole cycle.
    const comp = a.mods?.has('ultramagComp') ? COMP.flip : 1;
    const flip = (time < 0.02 ? outQuad(time / 0.02) : Math.exp(-(time - 0.02) / 0.07)) * (1 - a.aim * 0.5) * comp;
    a.gunR.x += flip * 0.12;
    a.gunP.z += flip * 0.022;
    a.gunP.y += flip * 0.006;
  }
  if (a.draw < 1) {
    const lower = 1 - outCubic(a.draw);
    a.gunP.y -= lower * 0.1;
    a.gunP.z += lower * 0.07;
    a.gunR.x += lower * 0.6;
  }
  if (reload < 0) return;
  const mag = parts.mag!;
  const away = inQuad(seg(reload, 0.05, 0.2)) * (1 - outCubic(seg(reload, 0.4, 0.55)));
  mag.position.y -= away * 0.34;
  mag.position.z += away * 0.09;
  if (reload > 0.22 && reload < 0.38) mag.visible = false;
  const seat = reload >= 0.55 ? thud(seg(reload, 0.55, 0.66)) : 0;
  const present = hold(reload, 0, 0.12, 0.91, 1);
  a.gunR.z -= present * 0.48;
  a.gunR.x += present * 0.16 + seat * 0.06;
  a.gunR.y += present * 0.1;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.044 + seat * 0.01;
  a.gunP.z += present * 0.05;
  const hand = a.left;
  hand.fingerRate = 44;
  hand.to('magHold', inOut(seg(reload, 0, 0.06)));
  hand.to('pouchL', inOut(seg(reload, 0.12, 0.25)));
  hand.to('magHold', inOut(seg(reload, 0.32, 0.46)));
  hand.to('boltHold', inOut(seg(reload, 0.59, 0.68)));
  hand.to('gripL', inOut(seg(reload, 0.81, 0.91)));
  hand.shape(HANDS.cup, hold(reload, 0.26, 0.4, 0.56, 0.62));
  hand.shape(HANDS.pinch, hold(reload, 0.6, 0.67, 0.78, 0.84));
}

export function ultramagDef(kit: Kit): ViewDef {
  return {
    id: 'ultramag', model: buildUltramag(kit),
    pos: [0.13, -0.138, -0.41], rot: [0.02, 0.06, 0],
    sight: k([0, SIGHT_Y, POST_Z + 0.0042]), rear: k([0, SIGHT_Y, REAR_Z]), relief: 0.66,
    mods: {
      ultramagCan: { part: 'can', muzzle: 'muzzleCan' },
      // Level, the dot on the eye line, the eye close for a window about 10 degrees wide with the rear blade under it.
      ultramagDot: { part: 'rmr', sight: k([0, DOT_Y, DOT_Z]), rear: null, relief: 0.14 },
      ultramagLam: { part: 'lam', laser: 'laser' },
      ultramagMag: { part: 'magExt' },
      ultramagComp: { part: 'comp', muzzle: 'muzzleComp', flip: COMP.flip },
      ultramagLight: { part: 'light' },
    },
    // Damped near critical, so the kick settles without the muzzle dipping below level on the rebound. Straight up and back:
    // no yaw, no roll.
    recoil: { back: 0.05, lift: 0.022, pitch: 0.19, yaw: 0, roll: 0, omega: 24, zeta: 0.8 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.pistolSupport },
    heatPerShot: 0.06, animate: clip,
  };
}
