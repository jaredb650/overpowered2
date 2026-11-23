/**
 * Optics a gun takes as a shop mod (src/weapons/mods.ts), built onto any gun's rail: the micro red dot and the ACOG. Each is a
 * part of its own, hidden until its mod is fitted (the ViewDef's `mods`), and returns where its sight picture sits, so a gun
 * fits one with a call and a line in its `mods`. Origins are the top of the rail under the middle of the clamp.
 */
import * as THREE from 'three';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import type { Model } from '../kit/model';
import { poly, rect } from '../kit/shapes';
import { knurl, screwY } from '../kit/details';
import type { ModLook, Tuple3 } from '../def';

/** The glow colours an optic's model needs (`new Model(m, mats, { glows })`). */
export const OPTIC_GLOWS = { dot: [0xff2414, 9], chevron: [0xff3a1c, 8], stadia: [0x000000, 1] } as const;

/**
 * A micro tube red dot on a riser (the Harrow's, first): the tube hollow so it is looked through, the dot floating on its front
 * lens. ADS puts the dot on the eye line, level, 0.26 m out, so the tube frames it.
 */
export function redDot(m: Mesher, at: Tuple3, name = 'reddot'): ModLook {
  m.part(name, at, () => {
    // Clamp over the rail, with its cross bolt, and the riser.
    m.use(F.anodized);
    m.at([0, 0.004, 0], null, () => m.box(0.033, 0.008, 0.042, 0.0012, 0.0016));
    m.mirror(() => m.at([0.0172, 0.003, 0.006], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); m.cyl(0.0042, 0.004, 12); }));
    m.use(F.anodized);
    m.at([0, 0.0135, -0.002], null, () => m.box(0.02, 0.012, 0.034, 0.0016, 0.002));
    m.at([0, DOT_Y, -0.006], null, () => {
      m.use(F.anodized);
      m.pipe(0.0172, 0.0138, 0.046, 28);
      m.use(F.rubber);
      for (const z of [0.0215, -0.0215]) m.at([0, 0, z], null, () => m.pipe(0.0182, 0.0138, 0.005, 28));
      // Turrets: elevation on top, windage on the right, each under a cap.
      m.use(F.anodizedGrey);
      m.at([0, 0.0205, 0.002], [Math.PI / 2, 0, 0], () => m.cyl(0.0068, 0.008, 16));
      m.at([0.0205, 0, 0.002], [0, Math.PI / 2, 0], () => m.cyl(0.0068, 0.008, 16));
      m.at([0.0248, 0, 0.002], [0, Math.PI / 2, 0], () => knurl(m, 0.007, 0.002, F.steelDark, 16, 0.0004));
      m.glass(() => m.at([0, 0, -0.016], null, () => m.cyl(0.0138, 0.0008, 28, 0)));
    });
    m.glow('dot', () => m.at([0, DOT_Y, DOT_Z], null, () => m.cyl(0.00055, 0.0002, 12, 0)));
  });
  return { part: name, sight: [at[0], at[1] + DOT_Y, at[2] + DOT_Z], rear: null, relief: 0.26 };
}

const DOT_Y = 0.0345;
const DOT_Z = -0.0212;

/** The ACOG's axis over the rail, its eyepiece's back face and clear radius, and the plane of its reticle. */
const AXIS = 0.036;
const EYE_END = 0.078;
/** Clear radius of the eyepiece, wider than a real one's for a picture that reads at a glance, and where its glass starts. */
const EYE_R = 0.019;
const EYE_BACK = 0.062;
const RETICLE_Z = -0.03;
/** From the eye to the back of the eyepiece, aimed: the eyepiece's clear circle is 45 percent of the screen's height. */
const EYE_RELIEF = 0.06;

/**
 * A 4x32 ACOG (the Gimlet's, and the Harrow's mod): a forged body on its own mount, an eyepiece with a rubber cup, the objective
 * in a flared bell, two capped turrets, and a red chevron on a black post with four drop bars under it. The camera's zoom is the
 * magnification (the row's `ads`, mods.ts); aimed, the body ahead of the eyepiece (`<name>Front`) is hidden, so the eyepiece
 * frames the picture with the world still seen around it, and its edge darkens as a real exit pupil's does (`acogShade`).
 */
export function acog(m: Mesher, at: Tuple3, name = 'acog'): ModLook {
  const front = `${name}Front`;
  m.part(name, at, () => {
    // The mount: a base on the rail, two thumb nuts on the left, and the neck up to the body.
    m.use(F.anodized);
    m.at([0, 0.006, 0], null, () => m.box(0.03, 0.012, 0.076, 0.0014, 0.002));
    m.at([0, 0.017, 0.002], null, () => m.box(0.017, 0.012, 0.056, 0.0016, 0.002));
    for (const z of [-0.022, 0.024]) {
      m.at([-0.0175, 0.006, z], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); m.cyl(0.0034, 0.006, 10); });
      m.at([-0.0215, 0.006, z], [0, Math.PI / 2, 0], () => knurl(m, 0.0058, 0.004, F.anodized, 14, 0.0005));
    }
    // The eyepiece, always in view: housing, rubber cup, and its glass.
    m.at([0, AXIS, 0], null, () => {
      // A neck off the body into a short wide eyepiece, thin walled, so the ring round the picture stays thin.
      m.use(F.anodized);
      // Its back face sits short of the glass, so the mask (VmUniforms.uScope) takes it out of the picture.
      m.lathe([[0, EYE_BACK - 0.006], [0.0176, EYE_BACK - 0.006], [0.0176, 0.046], [0, 0.046]], 28);
      m.at([0, 0, EYE_BACK - 0.004], null, () => m.pipe(0.0198, 0.0176, 0.008, 36));
      m.lathe([[EYE_R, EYE_END - 0.006], [0.0213, EYE_END - 0.006], [0.0213, EYE_BACK + 0.002], [0.0195, EYE_BACK - 0.002], [EYE_R, EYE_BACK - 0.002], [EYE_R, EYE_END - 0.006]], 36);
      m.use(F.rubber);
      m.lathe([[EYE_R + 0.0003, EYE_END], [0.0219, EYE_END - 0.0012], [0.0219, EYE_END - 0.007], [EYE_R + 0.0003, EYE_END - 0.007], [EYE_R + 0.0003, EYE_END]], 36);
      m.glass(() => m.at([0, 0, EYE_BACK + 0.001], null, () => m.cyl(EYE_R, 0.0006, 36, 0)));
    });
    // The reticle on its plane inside the body: the chevron's point is the aim, the post and the drop bars under it.
    m.at([0, AXIS, RETICLE_Z], null, () => {
      const len = 0.0032;
      const tilt = 0.82;
      m.glow('chevron', () => m.mirror(() => m.at([Math.cos(tilt) * len * 0.5, -Math.sin(tilt) * len * 0.5, 0], [0, 0, -tilt], () => m.box(len, 0.0006, 0.0002, 0))));
      // Unlit black, so it is drawn through the eyepiece when the gun's own surfaces there are not (VmUniforms.uScope).
      m.glow('stadia', () => {
        m.at([0, -0.0062, 0], null, () => m.box(0.00034, 0.0076, 0.0002, 0));
        [0.0034, 0.0026, 0.0019, 0.0013].forEach((w, i) => m.at([0, -0.0042 - i * 0.0018, 0], null, () => m.box(w, 0.00028, 0.0002, 0)));
      });
    });
    // Ahead of the eyepiece, hidden once aimed.
    m.part(front, [0, AXIS, 0], () => {
      m.use(F.anodized);
      // The forged body: a rounded box with a flat crown.
      m.at([0, 0, -0.001], null, () => m.front(rect(-0.0165, -0.0165, 0.0165, 0.0185, 0.0055), 0.094, { bevel: 0.0015 }));
      m.at([0, 0.0195, -0.012], null, () => m.box(0.012, 0.004, 0.056, 0.0012, 0.0014));
      // Turrets under caps, elevation on top, windage on the right.
      m.use(F.anodizedGrey);
      m.at([0, 0.0215, 0.022], [Math.PI / 2, 0, 0], () => m.cyl(0.0072, 0.007, 18));
      m.at([0.019, 0, 0.022], [0, Math.PI / 2, 0], () => m.cyl(0.0072, 0.007, 18));
      // The objective bell, flared, its lens set back under a short shade.
      m.use(F.anodized);
      m.lathe([[0, -0.047], [0.0165, -0.047], [0.0165, -0.054], [0.0222, -0.067], [0.0222, -0.09], [0.0192, -0.09], [0.0192, -0.083], [0, -0.083]], 32);
      m.glass(() => m.at([0, 0, -0.084], null, () => m.cyl(0.0192, 0.0006, 32, 0)));
      m.at([-0.0166, -0.002, -0.005], [0, -Math.PI / 2, 0], () => m.decal('optic4x', 0.022, 0.0046, 0xb9bec4));
    });
  });
  return {
    part: name, inner: front, rear: null, eye: { socket: `${name}Eye`, radius: EYE_R },
    sight: [at[0], at[1] + AXIS, at[2] + RETICLE_Z],
    relief: EYE_RELIEF + EYE_END - RETICLE_Z,
  };
}

let shadeMap: THREE.CanvasTexture | null = null;

/**
 * The dark rim inside the ACOG's eyepiece: clear in the middle, closing to black at its edge, as an exit pupil looks with the
 * eye a little off it. Built once, a disc on the eyepiece's glass. Call after the Model is made.
 */
export function acogShade(model: Model, name = 'acog'): void {
  if (!shadeMap && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.7, '#000');
    grad.addColorStop(0.86, '#555');
    grad.addColorStop(0.97, '#eee');
    grad.addColorStop(1, '#fff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    shadeMap = new THREE.CanvasTexture(c);
  }
  const part = model.parts[name];
  if (!part) return;
  model.socket(`${name}Eye`, [0, AXIS, EYE_BACK], [0, 0, 0], name);
  if (!shadeMap) return;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(EYE_R, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadeMap, transparent: true, depthWrite: false }),
  );
  disc.position.set(0, AXIS, EYE_BACK + 0.0025);
  disc.renderOrder = 2;
  part.add(disc);
}

/** Local dot offset (y above slide top, z ahead of mount centre) for `openReflex` at scale 1. */
export const OPEN_REFLEX_DOT_Y = 0.013;
export const OPEN_REFLEX_DOT_Z = -0.0103;

export interface OpenReflexOpts {
  /** Part name (defaults to `'rmr'`). */
  name?: string;
  /** Uniform scale of the optic mesh in the caller's coordinate space (defaults to 1). */
  scale?: number;
  /** Eye relief in metres when aimed (defaults to 0.17). */
  relief?: number;
  /** Housing body finish (defaults to `F.anodized`). */
  finish?: Finish;
  /** Accent trim finish for bevel bands and buttons (defaults to `F.steelDark`). */
  accent?: Finish;
  /** Offset from model root to the caller's current part space when computing model-space `sight`. */
  worldOffset?: Tuple3;
  /** Post-build uniform model scale (e.g. Ultramag's `S = 0.9`). */
  modelScale?: number;
  /** Optional low-profile slide-cut adapter riser height in caller units (clears tall backup irons). */
  riser?: number;
}

/**
 * Low-profile open reflex sight (RMR/SRO-inspired): a thin bevelled deck sunk cleanly into the slide cut, a single
 * slender arched hood with a wide panoramic window (no rear hoop or top bridge blocking the view), recessed rear LED
 * emitter cradle, flush Torx mounting screws, tactile side buttons, and a crisp floating red dot.
 */
export function openReflex(m: Mesher, at: Tuple3, opts: OpenReflexOpts = {}): ModLook {
  const name = opts.name ?? 'rmr';
  const sc = opts.scale ?? 1;
  const relief = opts.relief ?? 0.17;
  const body = opts.finish ?? F.anodized;
  const accent = opts.accent ?? F.steelDark;
  const off = opts.worldOffset ?? [0, 0, 0];
  const ms = opts.modelScale ?? 1;
  const riser = opts.riser ?? 0;

  m.part(name, at, () => {
    if (riser > 0) {
      // Flush bevelled slide-adapter plate bridging the slide top up to the reflex mounting deck.
      const pw = 0.0128 * sc;
      const pl = 0.039 * sc;
      m.use(accent);
      m.at([0, riser * 0.5 - 0.0008, 0], null, () => m.box(pw * 2, riser + 0.0016, pl, 0.0008 * sc));
      m.use(F.steelDark);
      m.at([0, riser - 0.0004, 0], null, () => m.box(pw * 1.9, 0.0014, pl * 0.94, 0.0004 * sc));
    }
    m.at([0, riser, 0], null, () => m.scaled(sc, () => {
    const hw = 0.0134;
    // Sunk mounting skirt nesting into the slide optic cut so there is zero daylight under the deck.
    m.use(F.steelDark);
    m.at([0, -0.0005, 0], null, () => m.box(hw * 1.84, 0.0026, 0.037, 0.0004));

    // Low sculpted mounting deck: only 4.1 mm tall above the slide surface, bevelled nose and tail.
    m.use(body);
    m.side(poly([
      [-0.0205, 0.0002, 0.0008], [-0.0205, 0.0036, 0.001], [0.0202, 0.0041, 0.001], [0.0208, 0.0002, 0.0008],
    ], 0.0008), hw * 2, { bevel: 0.00065 });

    // Subtle recessed deck tray behind the lens for the emitter and mounting screws.
    m.use(F.black);
    m.at([0, 0.0039, 0.0055], null, () => m.box(0.0192, 0.0005, 0.022, 0));

    // Single thin arched front/mid hood: wide open window with 2.5 mm slim forged aluminum frame.
    const hoodOuter = poly([
      [-hw, 0.0020], [hw, 0.0020],
      [hw, 0.0175, 0.0045], [0.0092, 0.0238, 0.006],
      [-0.0092, 0.0238, 0.006], [-hw, 0.0175, 0.0045],
    ], 0.001);
    const win = poly([
      [-0.0108, 0.0046, 0.0022], [0.0108, 0.0046, 0.0022],
      [0.0108, 0.0168, 0.0038], [0.0074, 0.0213, 0.005],
      [-0.0074, 0.0213, 0.005], [-0.0108, 0.0168, 0.0038],
    ], 0.0012);
    m.use(body);
    m.at([0, 0, -0.0108], null, () => m.front(hoodOuter, 0.0046, { bevel: 0.00055, holes: [win] }));

    // Sleek swept side cheeks tapering down from the lower hood flanks to the rear deck (outside the window).
    const cheek = poly([
      [-0.009, 0.0036], [-0.009, 0.0086, 0.0015], [0.002, 0.0066, 0.003], [0.0195, 0.0046, 0.001], [0.0195, 0.0036],
    ], 0.0008);
    m.mirror(() => m.at([hw - 0.0011, 0, 0], null, () => m.side(cheek, 0.0021, { bevel: 0.0004 })));

    // Subtle machined side accent bevel strip along the lower deck flanks.
    m.use(accent);
    m.mirror(() => m.at([hw + 0.0002, 0.0021, -0.001], null, () => m.box(0.0008, 0.0016, 0.029, 0.00025)));

    // Rear LED emitter housing pod on the deck with dark lens facing forward onto the glass.
    m.use(body);
    m.at([0, 0.0048, 0.0156], null, () => m.box(0.0074, 0.0026, 0.0072, 0.0005));
    m.use(F.black);
    m.at([0, 0.0050, 0.0118], null, () => m.cyl(0.0014, 0.0006, 10, 0));

    // Flush Torx deck mounting screws, elevation dial on top deck, windage dial on right, brightness buttons on left.
    m.mirror(() => screwY(m, 0.0072, 0.0040, 0.0036, 0.0017, F.steel));
    screwY(m, 0, 0.0041, 0.0076, 0.0015, F.steelDark);
    m.use(F.steel);
    m.at([hw + 0.0003, 0.0025, 0.0095], [0, Math.PI / 2, 0], () => m.cyl(0.0015, 0.0008, 10, 0.0002));
    m.use(F.rubber);
    for (const z of [0.002, 0.0095]) {
      m.at([-hw - 0.0005, 0.0026, z], null, () => m.box(0.001, 0.0024, 0.0042, 0.0003));
    }

    // Clear panoramic glass window and crisp glowing red dot.
    m.glass(() => m.at([0, 0, -0.0108], null, () => m.front(win, 0.0005, { bevel: 0 })));
    m.glow('dot', () => m.at([0, OPEN_REFLEX_DOT_Y, OPEN_REFLEX_DOT_Z], null, () => m.cyl(0.00048, 0.00018, 12, 0)));
  }));
  });

  return {
    part: name,
    sight: [
      (off[0] + at[0]) * ms,
      (off[1] + at[1] + riser + OPEN_REFLEX_DOT_Y * sc) * ms,
      (off[2] + at[2] + OPEN_REFLEX_DOT_Z * sc) * ms,
    ],
    rear: null,
    relief,
  };
}

