/**
 * Shoulder-Fired 105mm Howitzer: massive shoulder-mounted field artillery / siege cannon on key 3.
 * Completely distinct from the rocket launcher in scale, silhouette, and mechanism:
 * - Huge chamfered forged-iron artillery breech monolith (0.22 m wide x 0.23 m tall) with bolted olive trunnion
 *   cheeks, vertical sliding-wedge breech block, and left-flank brass-knobbed breech operating crank.
 * - Heavy reinforced steel recoil cradle with fixed trunnion sleeve, twin giant exposed coiled recoil springs (0.70 m),
 *   and continuous bright chrome hydraulic buffer rods that are dramatically exposed as the 105 mm barrel slams
 *   0.42 m backward on every shot and slowly heaves back into battery over ~1.34 s.
 * - Long menacing stepped 105 mm ordnance barrel (total weapon length ~2.44 m, extending to z = -2.08) with a ribbed
 *   stepped thermal jacket, chunky central bore evacuator (r = 0.106), and a gargantuan 4-baffle tank/siege muzzle brake.
 * - Unique 3-stage artillery reload: crank open & drop the sliding wedge while kicking out the spent 105 mm brass
 *   casing, hoist & ram a forearm-thick fresh 105 mm HE shell straight into the rear breech, then slam the wedge up
 *   to lock the breech.
 * Origin sits at the top of the rear firing grip; the massive 105 mm bore rides high above it on the shoulder.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { coil, hexX, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

const AXIS = 0.138;
const BORE_R = 0.054;
/** Half-width and vertical bounds of the forged rectangular artillery breech monolith (0.22 m W x 0.23 m H). */
const BREECH_HALF = 0.11;
const BREECH_BOT = 0.022;
const BREECH_TOP = 0.252;
const BREECH_Z_REAR = 0.18;
const BREECH_Z_MID = 0.04;
const BREECH_Z_FRONT = -0.16;
/** Vertical travel of the sliding-wedge breech block when opened. */
const WEDGE_DROP = 0.145;
/** Downward rotation of the left-flank breech operating crank (~95 degrees). */
const CRANK_SWING = 1.65;
/** Dramatic hydraulic long-recoil travel of the 105 mm barrel + thermal jacket + bore evacuator + muzzle brake on fire. */
const RECOIL_SLAM = 0.42;
/** Twin exposed coiled recoil springs and gleaming chrome hydraulic buffer rods flanking the barrel beneath the bore. */
const SPRING_Z0 = -0.18;
const SPRING_LEN = 0.70;
const SPRING_X = 0.104;
const SPRING_Y = AXIS - 0.072;
/** Forward fixed bearing bulkhead yoke supporting the lengthened barrel and anchoring the twin chrome buffer rods. */
const YOKE_Z = -0.96;
/** Left-flank armored artillery optical rangefinder axis (high upper-left breech shoulder for 100% unobstructed ADS along the long barrel). */
const OPTIC_X = -0.184;
const OPTIC_Y = AXIS + 0.154;
const OPTIC_Z = -0.115;

function breechMonolith(m: Mesher): void {
  const bhBot = BREECH_BOT - AXIS;
  const bhTop = BREECH_TOP - AXIS;
  const ch = 0.028;

  // Forward forged breech ring & chamber monolith (z = -0.16 to +0.04) with real 105 mm bore punched through.
  m.at([0, AXIS, (BREECH_Z_FRONT + BREECH_Z_MID) / 2], null, () => {
    m.use(F.parkerized);
    m.front(
      poly(
        [
          [-BREECH_HALF + ch, bhBot],
          [BREECH_HALF - ch, bhBot],
          [BREECH_HALF, bhBot + ch],
          [BREECH_HALF, bhTop - ch],
          [BREECH_HALF - ch, bhTop],
          [-BREECH_HALF + ch, bhTop],
          [-BREECH_HALF, bhTop - ch],
          [-BREECH_HALF, bhBot + ch],
        ],
        0.005,
      ),
      BREECH_Z_MID - BREECH_Z_FRONT,
      { bevel: 0.0036, holes: [circle(0, 0, BORE_R + 0.003, 32)] },
    );
  });

  // Rear sliding-wedge breech mortise housing (z = +0.04 to +0.18): heavy left/right armored cheeks + top crown arch,
  // leaving the center bore mouth and vertical wedge path completely open so the wedge drops straight down!
  const mortiseLen = BREECH_Z_REAR - BREECH_Z_MID;
  const mortiseZc = (BREECH_Z_REAR + BREECH_Z_MID) / 2;
  m.at([0, AXIS, mortiseZc], null, () => {
    m.use(F.parkerized);
    // Massive left & right vertical mortise cheeks framing the 0.144 m-wide sliding-wedge slot.
    m.mirror(() => {
      m.at([0.091, 0, 0], null, () =>
        m.front(
          poly(
            [
              [-0.019, bhBot],
              [0.019 - ch * 0.45, bhBot],
              [0.019, bhBot + ch * 0.6],
              [0.019, bhTop - ch * 0.6],
              [0.019 - ch * 0.45, bhTop],
              [-0.019, bhTop],
            ],
            0.004,
          ),
          mortiseLen,
          { bevel: 0.0032 },
        ),
      );
      // Machined brushed-steel vertical wedge guide tracks lining the inner mortise slot.
      m.use(F.steel);
      m.at([0.070, -0.005, 0], null, () => m.box(0.006, 0.19, 0.088, 0.0012));
      m.use(F.parkerized);
    });
    // Heavy armored top crown bridge tying both cheeks above the chamber.
    m.at([0, bhTop - 0.022, 0], null, () =>
      m.front(
        poly(
          [
            [-BREECH_HALF, -0.022],
            [BREECH_HALF, -0.022],
            [BREECH_HALF, 0.004],
            [BREECH_HALF - ch, 0.022],
            [-BREECH_HALF + ch, 0.022],
            [-BREECH_HALF, 0.004],
          ],
          0.004,
        ),
        mortiseLen,
        { bevel: 0.003 },
      ),
    );
  });

  // Machined brass chamber-seal ring & dark rifled 105 mm chamber throat visible whenever the wedge drops.
  m.at([0, AXIS, BREECH_Z_MID], null, () => {
    m.use(F.brass);
    m.lathe(
      [
        [BORE_R + 0.003, 0.011, 0],
        [BORE_R + 0.013, 0.011],
        [BORE_R + 0.013, -0.004],
        [BORE_R + 0.003, -0.004, 0],
      ],
      34,
      { chamfer: 0.0012 },
    );
    m.use(F.black);
    m.lathe([[BORE_R + 0.002, 0.008, 0], [BORE_R, -0.44, 0]], 28);
  });

  // Bolted matte olive-drab armored side trunnion cheeks flanking the entire breech monolith.
  const cheek = poly(
    [
      [BREECH_Z_REAR - 0.014, BREECH_BOT + 0.024],
      [BREECH_Z_REAR - 0.014, BREECH_TOP - 0.032],
      [BREECH_Z_REAR - 0.034, BREECH_TOP - 0.016],
      [BREECH_Z_FRONT + 0.024, BREECH_TOP - 0.016],
      [BREECH_Z_FRONT + 0.01, BREECH_TOP - 0.034],
      [BREECH_Z_FRONT + 0.01, BREECH_BOT + 0.032],
      [BREECH_Z_FRONT + 0.028, BREECH_BOT + 0.016],
      [BREECH_Z_REAR - 0.03, BREECH_BOT + 0.016],
    ],
    0.005,
  );
  m.mirror(() => {
    m.use(F.olive);
    m.at([BREECH_HALF + 0.005, 0, 0], null, () =>
      m.side(cheek, 0.012, {
        bevel: 0.0022,
        holes: slotRow(-0.125, AXIS - 0.055, -0.035, AXIS - 0.055, 3, 0.044, 0.012, Math.PI / 2),
      }),
    );
    m.use(F.black);
    m.at([BREECH_HALF + 0.001, AXIS - 0.055, -0.08], null, () => m.box(0.002, 0.052, 0.11, 0));

    // Heavy circular forged trunnion boss & machined brass cap on both breech flanks.
    m.at([BREECH_HALF + 0.012, AXIS + 0.008, -0.052], [0, Math.PI / 2, 0], () => {
      m.use(F.steelDark);
      m.lathe([[0, 0.016, 0], [0.038, 0.016], [0.044, 0.009], [0.044, 0, 0]], 24, { chamfer: 0.0016 });
      m.use(F.brass);
      m.lathe([[0, 0.021, 0], [0.022, 0.021], [0.025, 0.016], [0.025, 0.012, 0]], 20, { chamfer: 0.0012 });
    });

    // Big structural hex bolts pinning the trunnion plates to the breech core.
    for (const [y, z] of [
      [BREECH_TOP - 0.034, 0.145],
      [BREECH_TOP - 0.034, 0.025],
      [BREECH_TOP - 0.034, -0.125],
      [BREECH_BOT + 0.034, 0.145],
      [BREECH_BOT + 0.034, 0.025],
      [BREECH_BOT + 0.034, -0.125],
    ] as const) {
      hexX(m, BREECH_HALF + 0.011, y, z, 1, 0.0058);
    }
  });

  // Heavy top armor rib deck, brass pressure cap, and rear accessory rail on the breech crown.
  m.use(F.oliveDark);
  m.at([0, BREECH_TOP + 0.004, -0.01], null, () => m.box(0.146, 0.012, 0.28, 0.0024, 0.005));
  m.use(F.steelDark);
  for (const z of [-0.12, -0.02, 0.08]) {
    m.at([0, BREECH_TOP + 0.011, z], null, () => m.box(0.156, 0.01, 0.022, 0.0018, 0.003));
  }
  m.at([0, BREECH_TOP + 0.010, -0.06], null, () => rail(m, 0.055, -0.075, 0.024, F.anodized));
  // Heavy offset artillery lifting handle along the top-right crown edge.
  m.use(F.steelDark);
  const handlePath: V3[] = [
    [0.068, BREECH_TOP + 0.005, -0.135],
    [0.076, BREECH_TOP + 0.044, -0.115],
    [0.076, BREECH_TOP + 0.048, 0.01],
    [0.076, BREECH_TOP + 0.044, 0.125],
    [0.068, BREECH_TOP + 0.005, 0.145],
  ];
  m.tube(handlePath, 0.0072, { seg: 10, samples: 28, tension: 0.4 });
  m.use(F.rubber);
  m.tube([[0.076, BREECH_TOP + 0.048, -0.055], [0.076, BREECH_TOP + 0.048, 0.065]], 0.0115, { seg: 12, samples: 4 });
  m.use(F.brass);
  for (const z of [-0.135, 0.145]) {
    m.at([0.066, BREECH_TOP + 0.006, z], null, () => m.box(0.026, 0.01, 0.028, 0.0016, 0.003));
  }

  // Huge machined brass hydraulic pressure ring around the trunnion jacket throat on the front breech face.
  m.at([0, AXIS, BREECH_Z_FRONT - 0.012], null, () => {
    m.use(F.brass);
    m.lathe(
      [
        [0.088, 0.018, 0],
        [0.097, 0.018],
        [0.100, 0.010],
        [0.100, -0.010],
        [0.096, -0.018],
        [0.088, -0.018, 0],
      ],
      36,
      { chamfer: 0.0016 },
    );
  });

  // Ordnance stencils on the camera-facing left armored breech cheek & top crown.
  const sx = -BREECH_HALF - 0.012;
  m.at([sx, BREECH_TOP - 0.056, 0.085], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.115, 0.016, 0xd4d0b0));
  m.at([sx, BREECH_TOP - 0.078, 0.085], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.11, 0.012, 0xb8b498));
  m.at([sx, AXIS - 0.082, 0.09], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.115, 0.018, 0xc9a227));
  m.at([sx, AXIS + 0.056, -0.052], [0, -Math.PI / 2, 0], () => m.decal('he', 0.048, 0.018, 0xd8c35a));
  m.at([sx, AXIS - 0.082, -0.05], [0, -Math.PI / 2, 0], () => m.decal('warn', 0.026, 0.026, 0xd8c35a));
  m.at([0, BREECH_TOP + 0.0115, 0.08], [-Math.PI / 2, 0, -Math.PI / 2], () => m.decal('hazard', 0.11, 0.022, 0xc9a227));
}

function slidingWedgeAndCrank(m: Mesher): void {
  // Vertical sliding-wedge breech block: fits snugly in the rear mortise and drops straight down on reload.
  m.part('wedge', [0, AXIS, 0.11], () => {
    // Forged steel wedge monolith with a top loading trough bevel.
    m.use(F.steelDark);
    m.front(
      poly(
        [
          [-0.066, -0.074],
          [0.066, -0.074],
          [0.066, 0.064],
          [0.046, 0.072],
          [-0.046, 0.072],
          [-0.066, 0.064],
        ],
        0.004,
      ),
      0.104,
      { bevel: 0.0028 },
    );
    // Brushed steel rear breech-plate face & machined brass firing-pin striker assembly.
    m.use(F.steel);
    m.at([0, -0.004, 0.053], null, () => m.box(0.116, 0.122, 0.012, 0.002, 0.004));
    // Heavy machined brass striker nut, firing-pin collar, and lock indicator recess.
    m.at([0, -0.004, 0.059], null, () => {
      m.use(F.brass);
      m.lathe([[0, 0.016, 0], [0.022, 0.016], [0.028, 0.008], [0.028, 0, 0]], 24, { chamfer: 0.0014 });
      m.use(F.steelDark);
      m.lathe([[0, 0.020, 0], [0.011, 0.020], [0.013, 0.015], [0.013, 0.012, 0]], 16, { chamfer: 0.0008 });
    });
    // Corner bolts on the rear face of the sliding wedge.
    m.mirror(() => {
      for (const sy of [-1, 1]) {
        m.at([0.044, sy * 0.046, 0.060], null, () => rivet(m, 0.0045, F.brass));
      }
    });
    // Recessed horizontal amber breech-locked status bar across the upper-rear bevel.
    m.use(F.black);
    m.at([0, 0.054, 0.057], null, () => m.box(0.084, 0.009, 0.004, 0.0008));
    m.glow('breech', () => {
      m.at([0, 0.054, 0.0595], null, () => m.box(0.076, 0.0042, 0.0014, 0));
    });
  });

  // Left-flank rotating artillery breech operating crank: sits cleanly below the optical rangefinder so ADS is 100%
  // unobstructed, and yanks sharply downward (~95 deg) to drop the sliding wedge and slammed back up to seal.
  m.part('crank', [-BREECH_HALF - 0.012, AXIS - 0.056, 0.112], () => {
    // Toothed machined brass gear collar & heavy pivot boss on the lower-left breech cheek.
    m.at([0, 0, 0], [0, -Math.PI / 2, 0], () => {
      m.use(F.brass);
      m.lathe([[0, 0.022, 0], [0.023, 0.022], [0.027, 0.015], [0.027, 0, 0]], 22, { chamfer: 0.0014 });
      m.use(F.parkerized);
      m.lathe([[0, 0.029, 0], [0.014, 0.029], [0.016, 0.022], [0.016, 0.018, 0]], 18, { chamfer: 0.001 });
    });
    // Thick forged steel crank arm reaching forward to the grooved brass operating handle.
    m.use(F.steelDark);
    m.at([-0.024, 0, 0], null, () =>
      m.side(
        poly(
          [
            [0.014, -0.014],
            [-0.082, -0.008],
            [-0.086, 0.016],
            [-0.064, 0.020],
            [0.016, 0.014],
          ],
          0.005,
        ),
        0.014,
        { bevel: 0.0022 },
      ),
    );
    // Watertight turned & grooved machined brass operating handle + heavy rounded ball knob projecting to -X.
    m.at([-0.026, 0.004, -0.074], [0, -Math.PI / 2, 0], () => {
      m.use(F.steelDark);
      m.lathe([[0, 0, 0], [0.015, 0], [0.015, 0.008], [0.0115, 0.009, 0]], 20, { chamfer: 0.0008 });
      m.use(F.brass);
      m.lathe(
        [
          [0.0115, 0.009, 0],
          [0.0135, 0.011],
          [0.0135, 0.016],
          [0.0118, 0.0175],
          [0.0138, 0.019],
          [0.0138, 0.024],
          [0.0118, 0.0255],
          [0.0138, 0.027],
          [0.0138, 0.032],
          [0.0118, 0.0335],
          [0.0138, 0.035],
          [0.0138, 0.040],
          [0.0175, 0.044],
          [0.0195, 0.050],
          [0.0185, 0.057],
          [0.0135, 0.062],
          [0.006, 0.0645],
          [0, 0.065, 0],
        ],
        24,
        { chamfer: 0.0007, smooth: 28 },
      );
    });
  });
}

function rearSaddle(m: Mesher): void {
  // Heavy padded artillery recoil saddle & twin angled blast-diffuser pods beneath the open rear breech.
  // Sits cleanly below y = AXIS - 0.068 so the rear breech mortise above remains 100% open for loading & ejection!
  m.use(F.parkerized);
  m.at([0, 0.036, 0.255], null, () =>
    m.side(
      poly(
        [
          [-0.08, 0.028],
          [0.095, 0.016],
          [0.105, -0.018],
          [0.078, -0.042],
          [-0.08, -0.032],
        ],
        0.006,
      ),
      0.168,
      { bevel: 0.0032 },
    ),
  );
  // Contoured thick ribbed rubber shoulder saddle pad cradling the shooter's shoulder.
  m.use(F.rubber);
  m.at([0, -0.004, 0.268], null, () =>
    m.side(
      poly(
        [
          [0.095, 0.012],
          [0.095, -0.016, 0.008],
          [0.068, -0.036, 0.012],
          [-0.068, -0.036, 0.012],
          [-0.092, -0.014, 0.008],
          [-0.092, 0.012],
        ],
        0.004,
      ),
      0.156,
      { bevel: 0.005 },
    ),
  );
  // Twin angled steel recoil buffer / diffuser pods flanking the rear saddle cheeks.
  m.mirror(() => {
    m.at([0.092, 0.028, 0.242], [0, 0.16, 0], () => {
      m.use(F.steelDark);
      m.box(0.034, 0.056, 0.118, 0.003, 0.006);
      m.use(F.black);
      m.at([0.016, 0, 0.008], null, () => m.box(0.004, 0.036, 0.076, 0));
      m.use(F.steelDark);
      for (const dz of [-0.02, 0.008, 0.036]) {
        m.at([0.017, 0, dz], [0, 0.35, 0], () => m.box(0.005, 0.038, 0.01, 0.0008));
      }
      m.use(F.brass);
      m.at([0, 0, -0.062], null, () => m.cyl(0.014, 0.012, 16));
    });
  });
}

function cradleAndRecoilSprings(m: Mesher): void {
  // Extended reinforced steel recoil cradle girder running from breech front face (z = -0.16) to forward bearing yoke (z = -0.96).
  const cradleLen = BREECH_Z_FRONT - YOKE_Z;
  const cradleZc = (BREECH_Z_FRONT + YOKE_Z) / 2;
  m.use(F.parkerized);
  m.at([0, 0.044, cradleZc], null, () =>
    m.front(
      poly(
        [
          [-0.088, -0.032],
          [0.088, -0.032],
          [0.104, -0.016],
          [0.104, -0.006],
          [0.070, 0.004],
          [0.070, 0.026],
          [-0.070, 0.026],
          [-0.070, 0.004],
          [-0.104, -0.006],
          [-0.104, -0.016],
        ],
        0.003,
      ),
      cradleLen,
      { bevel: 0.0026 },
    ),
  );
  // Perforated olive-drab lower side skirt plates along the extended cradle + gleaming brushed-steel slide guide rails.
  m.mirror(() => {
    m.use(F.olive);
    m.at([0.106, 0.024, cradleZc], null, () =>
      m.side(rect(-0.36, -0.012, 0.36, 0.011, 0.003), 0.006, {
        bevel: 0.0012,
        holes: slotRow(-0.29, -0.0005, 0.29, -0.0005, 7, 0.015, 0.010, Math.PI / 2),
      }),
    );
    m.use(F.black);
    m.at([0.103, 0.0235, cradleZc], null, () => m.box(0.002, 0.018, 0.66, 0));
    // Machined brushed-steel recoil slide rails supporting the heavy recoiling barrel crosshead sled.
    m.use(F.steel);
    m.at([0.062, 0.072, cradleZc], null, () => m.box(0.014, 0.012, cradleLen - 0.04, 0.0014));
  });

  // Fixed reinforced trunnion barrel jacket extending forward from the breech (z = -0.16 to -0.42):
  // the recoiling 105 mm barrel telescopes 0.42 m straight back inside this jacket without ever poking out the rear breech!
  m.at([0, AXIS, 0], null, () => {
    m.use(F.parkerized);
    m.lathe(
      [
        [0.0835, -0.16, 0],
        [0.092, -0.16],
        [0.092, -0.416],
        [0.0835, -0.416, 0],
      ],
      38,
      { chamfer: 0.0014 },
    );
    // Machined reinforcing bands along the trunnion jacket.
    m.use(F.steelDark);
    for (const z of [-0.24, -0.31, -0.38]) {
      m.at([0, 0, z], null, () =>
        m.lathe([[0.091, 0.009, 0], [0.0945, 0.009], [0.0945, -0.009], [0.091, -0.009, 0]], 36, { chamfer: 0.001 }),
      );
    }
    // Gleaming machined brass front dust-seal gland ring at the mouth of the trunnion jacket.
    m.use(F.brass);
    m.at([0, 0, -0.420], null, () =>
      m.lathe([[0.0835, 0.011, 0], [0.0945, 0.011], [0.0955, 0.005], [0.0955, -0.005], [0.092, -0.011], [0.0835, -0.011, 0]], 36, { chamfer: 0.0012 }),
    );
  });

  // Extended central under-barrel hydropneumatic recuperator cylinder with machined brass end-caps and mid-band.
  m.at([0, AXIS - 0.108, cradleZc], null, () => {
    m.use(F.steelDark);
    m.cyl(0.024, cradleLen - 0.02, 22);
    m.use(F.brass);
    m.at([0, 0, cradleLen / 2 - 0.018], null, () => m.cyl(0.028, 0.022, 22));
    m.at([0, 0, 0], null, () => m.cyl(0.027, 0.018, 22));
    m.at([0, 0, -(cradleLen / 2 - 0.018)], null, () => m.cyl(0.028, 0.022, 22));
  });

  // Twin fixed rear spring cups, hydraulic damper sleeves, and continuous gleaming chrome hydraulic buffer rods
  // running all the way from the breech face (z = -0.18) to the forward bearing yoke (z = -0.96).
  // When the barrel slams 0.42 m back on fire, nearly half a meter of gleaming chrome rod is dramatically exposed!
  const rodLen = SPRING_Z0 - YOKE_Z;
  const rodZc = (SPRING_Z0 + YOKE_Z) / 2;
  m.mirror(() => {
    m.at([SPRING_X, SPRING_Y, 0], null, () => {
      // Heavy rear spring seat cup bolted to the front of the breech monolith.
      m.use(F.parkerized);
      m.at([0, 0, SPRING_Z0 + 0.01], null, () => m.cyl(0.034, 0.026, 22));
      m.use(F.brass);
      m.at([0, 0, SPRING_Z0 - 0.004], null, () => m.cyl(0.036, 0.012, 22));
      // Rear dark-steel hydraulic damper cylinder sleeve tucked inside the rear of the coil spring.
      m.use(F.steelDark);
      m.at([0, 0, -0.305], null, () => m.cyl(0.018, 0.25, 20));
      // Continuous bright machined chrome hydraulic buffer/guide rod exposed forward of the crosshead during recoil.
      m.use(F.chrome);
      m.at([0, 0, rodZc], null, () => m.cyl(0.0135, rodLen, 20));
    });
  });

  // Heavy forward bearing bulkhead yoke at z = -0.96 bracing the long barrel, guide rails, and twin chrome buffer rods.
  m.at([0, AXIS, YOKE_Z], null, () => {
    m.use(F.parkerized);
    m.front(
      poly(
        [
          [-0.128, -0.118],
          [0.128, -0.118],
          [0.136, -0.090],
          [0.136, -0.040],
          [0.098, 0.044],
          [0.062, 0.096],
          [-0.062, 0.096],
          [-0.098, 0.044],
          [-0.136, -0.040],
          [-0.136, -0.090],
        ],
        0.006,
      ),
      0.044,
      { bevel: 0.003, holes: [circle(0, 0, 0.0845, 32)] },
    );
    // Gleaming machined chrome barrel-slide bushing ring (inner r = 0.0835 clears the sliding barrel & ribbed thermal jacket).
    m.use(F.chrome);
    m.lathe([[0.0835, 0.024, 0], [0.090, 0.024], [0.090, -0.024], [0.0835, -0.024, 0]], 34, { chamfer: 0.001 });
    m.mirror(() => {
      // Machined brass anchor glands clamping the forward ends of the twin chrome hydraulic buffer rods.
      m.use(F.brass);
      m.at([SPRING_X, SPRING_Y - AXIS, 0], null, () => m.cyl(0.022, 0.056, 20));
      m.use(F.steelDark);
      m.at([SPRING_X, SPRING_Y - AXIS, -0.030], null, () => m.cyl(0.015, 0.010, 16));
      hexX(m, 0.136, -0.050, 0, 1, 0.0055);
      hexX(m, 0.136, -0.086, 0, 1, 0.0055);
    });
  });

  // Giant twin exposed coiled steel recoil springs (0.70 m free length): pivoted at their fixed rear seat (z = -0.18)
  // so scaling scale.z crushes them down to 40% length in exact lockstep with the barrel's 0.42 m recoil slam!
  m.part('springs', [0, SPRING_Y, SPRING_Z0], () => {
    m.mirror(() => {
      m.at([SPRING_X, 0, -SPRING_LEN / 2], null, () => coil(m, 0.026, 0.005, SPRING_LEN, 17, F.steel));
    });
  });
}

function barrelEvacuatorAndBrake(m: Mesher): void {
  // Entire massive lengthened 105 mm recoiling ordnance assembly: slams 0.42 m straight back along +Z on every shot
  // and slowly, powerfully heaves back into battery over ~1.34 s!
  m.part('barrel', [0, AXIS, 0], () => {
    // Long menacing stepped 105 mm turned ordnance barrel extending all the way to the brake at z = -1.80.
    // Rear starts at z = -0.40 (seated inside the fixed trunnion jacket) so +0.42 m recoil ends at z = +0.02 inside the chamber!
    m.use(F.barrel);
    m.lathe(
      [
        [0.082, -0.40, 0],
        [0.082, -0.98],
        [0.0785, -1.00],
        [0.0785, -1.42],
        [0.076, -1.44],
        [0.076, -1.66],
        [0.073, -1.685],
        [0.0715, -1.775],
        [0.076, -1.785],
        [0.076, -1.805],
        [BORE_R, -1.805],
        [BORE_R, -0.40, 0],
      ],
      40,
      { chamfer: 0.0016, smooth: 28 },
    );

    // Deep dark 105 mm bore interior running the entire length of the barrel tube.
    m.use(F.black);
    m.lathe([[BORE_R, -1.81, 0], [BORE_R - 0.0015, -0.40, 0]], 30);

    // Stepped ribbed thermal jacket (z = -1.00 to -1.41, max r = 0.0818 < 0.0835 yoke bushing):
    // gives the long forward barrel an unmistakable heavy field-artillery thermal shroud AND slides cleanly through the yoke!
    m.use(F.oliveDark);
    m.lathe(
      [
        [0.0785, -1.00, 0],
        [0.0812, -1.012],
        [0.0812, -1.398],
        [0.0785, -1.410, 0],
      ],
      38,
      { chamfer: 0.0012 },
    );
    m.use(F.barrelBlack);
    for (const z of [-1.04, -1.11, -1.18, -1.25, -1.32, -1.38]) {
      m.at([0, 0, z], null, () =>
        m.lathe([[0.0805, 0.011, 0], [0.0820, 0.011], [0.0820, -0.011], [0.0805, -0.011, 0]], 36, { chamfer: 0.0009 }),
      );
    }
    m.use(F.brass);
    m.at([0, 0, -1.402], null, () =>
      m.lathe([[0.080, 0.008, 0], [0.0820, 0.008], [0.0820, -0.008], [0.080, -0.008, 0]], 36, { chamfer: 0.0008 }),
    );

    // Chunky central bore evacuator / fume extractor bulge (r = 0.106, z = -1.42 to -1.66):
    // pushed proportionally forward along the long 105 mm barrel; on +0.42 m recoil it slams to z = -1.00 right before the yoke!
    m.use(F.olive);
    m.lathe(
      [
        [0.078, -1.42, 0],
        [0.099, -1.442],
        [0.106, -1.462],
        [0.106, -1.618],
        [0.099, -1.638],
        [0.076, -1.66, 0],
      ],
      40,
      { chamfer: 0.0018, smooth: 30 },
    );
    // Gunmetal clamp bands & machined brass purge collar ringing the bore evacuator.
    m.use(F.barrelBlack);
    for (const z of [-1.462, -1.618]) {
      m.at([0, 0, z], null, () =>
        m.lathe([[0.105, 0.011, 0], [0.110, 0.011], [0.110, -0.011], [0.105, -0.011, 0]], 38, { chamfer: 0.0012 }),
      );
    }
    m.use(F.brass);
    m.at([0, 0, -1.495], null, () =>
      m.lathe([[0.1055, 0.009, 0], [0.109, 0.009], [0.109, -0.009], [0.1055, -0.009, 0]], 38, { chamfer: 0.001 }),
    );
    // Forward stepped thermal reinforcement ring ahead of the bore evacuator.
    m.use(F.barrelBlack);
    m.at([0, 0, -1.685], null, () =>
      m.lathe([[0.072, 0.012, 0], [0.080, 0.010], [0.080, -0.010], [0.072, -0.012, 0]], 36, { chamfer: 0.001 }),
    );
    // Cluster Shell (`howitzerCluster`) muzzle-side inductive fuze-setter ring riding the recoiling barrel.
    m.part('clusterBand', [0, 0, -1.685], () => {
      m.use(F.parkerized);
      m.lathe([[0.079, 0.024, 0], [0.093, 0.021], [0.093, -0.021], [0.079, -0.024, 0]], 36, { chamfer: 0.0014 });
      m.use(F.yellow);
      m.at([0, 0, -0.015], null, () => m.lathe([[0.092, 0.006, 0], [0.095, 0.005], [0.095, -0.005], [0.092, -0.006, 0]], 34, { chamfer: 0.0005 }));
      // Four copper inductive programming coils around the barrel circumference.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        m.at([0, 0, 0], [0, 0, a], () => {
          m.use(F.copperCoil);
          m.at([0.094, 0, 0.004], null, () => m.box(0.012, 0.022, 0.032, 0.0015));
          m.use(F.steelDark);
          m.at([0.098, 0, -0.008], null, () => m.box(0.008, 0.014, 0.012, 0.001));
        });
      }
    });
    // Subtle ordnance stripes on the camera-facing left side of the bore evacuator.
    m.at([-0.107, 0.012, -1.555], [0, -Math.PI / 2, 0], () => m.decal('he', 0.056, 0.022, 0xd8c35a));
    m.at([-0.107, -0.018, -1.555], [0, -Math.PI / 2, 0], () => m.decal('arrow', 0.044, 0.026, 0xd8d0a0));

    // Recoiling front recoil-spring yoke crosshead & sled at z = -0.88:
    // rides the cradle guide rails, crushes the twin coil springs back to z = -0.46, and wipes along the gleaming chrome rods!
    m.at([0, 0, SPRING_Z0 - SPRING_LEN], null, () => {
      m.use(F.parkerized);
      m.at([0, -0.056, -0.014], null, () =>
        m.front(
          poly(
            [
              [-0.136, -0.048],
              [0.136, -0.048],
              [0.142, -0.016],
              [0.126, 0.038],
              [-0.126, 0.038],
              [-0.142, -0.016],
            ],
            0.005,
          ),
          0.028,
          { bevel: 0.0024, holes: [circle(0, 0.056, 0.0825, 30)] },
        ),
      );
      m.mirror(() => {
        // Rear-facing brass collar bearing directly on the front of the giant coil spring.
        m.use(F.brass);
        m.at([SPRING_X, SPRING_Y - AXIS, 0.004], null, () => m.cyl(0.034, 0.014, 22));
        // Forward hydraulic wiper gland & brass seal sliding cleanly along the continuous gleaming chrome buffer rod.
        m.use(F.steelDark);
        m.at([SPRING_X, SPRING_Y - AXIS, -0.034], null, () => m.cyl(0.022, 0.020, 20));
        m.use(F.brass);
        m.at([SPRING_X, SPRING_Y - AXIS, -0.046], null, () => m.cyl(0.019, 0.008, 18));
        // Heavy machined steel slide shoe riding along the cradle guide rail.
        m.use(F.steelDark);
        m.at([0.062, 0.072 - AXIS, -0.014], null, () => m.box(0.022, 0.018, 0.058, 0.0018, 0.003));
      });
    });

    // Gargantuan 4-baffle tank / siege muzzle brake (z = -1.80 to -2.08, 0.22 m wide x 0.17 m tall x 0.28 m long!).
    const brakeZ = -1.94;
    m.at([0, 0, brakeZ], null, () => {
      // Heavy machined brass mounting collar locking the brake to the lengthened barrel chase.
      m.use(F.brass);
      m.at([0, 0, 0.144], null, () =>
        m.lathe([[0.072, 0.014, 0], [0.086, 0.014], [0.088, 0.007], [0.088, -0.007], [0.084, -0.014], [0.072, -0.014, 0]], 34, { chamfer: 0.0014 }),
      );
      // Massive chamfered top & bottom armored blast rails spanning all 4 chambers.
      m.use(F.barrelBlack);
      for (const sy of [-1, 1]) {
        m.at([0, sy * 0.072, 0], null, () => m.box(0.220, 0.028, 0.280, 0.0036, 0.008));
      }
      // Perforated brushed-steel side baffle cheeks with 4 huge blast chambers cut cleanly through.
      m.use(F.barrel);
      m.mirror(() => {
        m.at([0.100, 0, 0], null, () => {
          m.side(rect(-0.140, -0.084, 0.140, 0.084, 0.008), 0.020, {
            bevel: 0.0024,
            holes: [
              rect(-0.120, -0.052, -0.074, 0.052, 0.005),
              rect(-0.056, -0.052, -0.010, 0.052, 0.005),
              rect(0.010, -0.052, 0.056, 0.052, 0.005),
              rect(0.074, -0.052, 0.120, 0.052, 0.005),
            ],
          });
        });
      });
      // Five heavy internal baffle divider plates with the gaping 105 mm bore punched straight through them.
      m.use(F.steelDark);
      for (const dz of [-0.130, -0.065, 0.0, 0.065, 0.130]) {
        m.at([0, 0, dz], null, () => {
          m.front(rect(-0.102, -0.076, 0.102, 0.076, 0.006), 0.018, {
            bevel: 0.0018,
            holes: [circle(0, 0, BORE_R + 0.003, 30)],
          });
        });
      }
      // Dark interior muzzle throat liner inside the front crown.
      m.use(F.black);
      m.at([0, 0, 0], null, () => m.lathe([[BORE_R + 0.002, 0.14, 0], [BORE_R + 0.002, -0.14, 0]], 26));
      // Heavy rivets lining the side baffle cheeks along top and bottom rails.
      m.mirror(() => {
        for (const dz of [-0.130, -0.065, 0.0, 0.065, 0.130]) {
          m.at([0.111, 0.070, dz], [0, Math.PI / 2, 0], () => rivet(m, 0.0036));
          m.at([0.111, -0.070, dz], [0, Math.PI / 2, 0], () => rivet(m, 0.0036));
        }
      });
    });
  });
}

function artilleryShellAndSpentCasing(m: Mesher): void {
  // Gigantic forearm-thick 105 mm brass-cased HE artillery shell (r = 0.052, length 0.362 m!).
  // Rest position is cleanly seated inside the 105 mm chamber (base at z = +0.04, nose at z = -0.322).
  m.part('shell', [0, AXIS, BREECH_Z_MID], () => {
    // Gleaming turned brass cartridge case with heavy rimmed extractor flange.
    m.use(F.brass);
    m.lathe(
      [
        [0, 0.002, 0],
        [0.0545, 0.002],
        [0.0545, -0.010],
        [0.0505, -0.014],
        [0.052, -0.022],
        [0.051, -0.165],
        [0.049, -0.180, 0],
      ],
      34,
      { chamfer: 0.001 },
    );
    // Detailed rear percussion primer boss visible right as the shell rams home.
    m.use(F.copper);
    m.lathe([[0, 0.004, 0], [0.015, 0.004], [0.016, 0.001, 0]], 18, { chamfer: 0.0005 });
    m.use(F.steelDark);
    m.lathe([[0.016, 0.003, 0], [0.023, 0.003], [0.023, 0.001, 0]], 18);

    // Copper driving band.
    m.use(F.copper);
    m.lathe([[0.049, -0.180, 0], [0.0508, -0.184], [0.0508, -0.198], [0.0485, -0.202, 0]], 32, { chamfer: 0.0006 });

    // Olive-drab HE projectile body & ogive.
    m.use({ ...F.olive, color: 0x5c6642 });
    const ogive: [number, number, number?][] = [[0.0485, -0.202, 0], [0.0485, -0.252]];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      ogive.push([0.0485 * (1 - t ** 1.65) + 0.009, -0.252 - t * 0.086, 0]);
    }
    m.lathe(ogive, 30, { chamfer: 0, smooth: 40 });

    // Bright yellow high-explosive identification band.
    m.use(F.yellow);
    m.lathe([[0.0489, -0.218, 0], [0.0494, -0.221], [0.0494, -0.244], [0.0488, -0.246, 0]], 30, { chamfer: 0 });

    // Brushed steel point-detonating nose fuze.
    m.use(F.steel);
    m.lathe([[0.0092, -0.338, 0], [0.0076, -0.354], [0.003, -0.362], [0, -0.364, 0]], 18, { chamfer: 0 });

    // Cluster submunition identification ring & electronic standoff nose cap (`howitzerCluster`, visible during reload).
    m.part('clusterShell', [0, 0, 0], () => {
      m.use(F.yellow);
      m.lathe([[0.0462, -0.268, 0], [0.0472, -0.271], [0.0445, -0.289], [0.0432, -0.292, 0]], 28, { chamfer: 0 });
      m.use(F.red);
      m.lathe([[0.0492, -0.204, 0], [0.050, -0.206], [0.050, -0.215], [0.0492, -0.217, 0]], 28, { chamfer: 0 });
      m.use(F.brass);
      m.lathe([[0.011, -0.336, 0], [0.010, -0.356], [0.005, -0.366], [0, -0.368, 0]], 18, { chamfer: 0.0005 });
    });
  });

  // Spent 105 mm brass casing kicked straight backward out of the open breech when the wedge drops.
  // Rests inside the chamber (hidden at idle) so restingModel bounds stay clean.
  m.part('spent', [0, AXIS, BREECH_Z_MID], () => {
    m.use(F.brass);
    m.lathe(
      [
        [0, 0.002, 0],
        [0.0545, 0.002],
        [0.0545, -0.010],
        [0.0505, -0.014],
        [0.052, -0.022],
        [0.0505, -0.155],
        [0.0485, -0.192],
        [0.0445, -0.192],
        [0.0445, -0.03, 0],
      ],
      30,
      { chamfer: 0.0009 },
    );
    // Scorched neck & hollow smoked brass interior.
    m.use(F.barrelBlack);
    m.lathe([[0.0505, -0.155, 0], [0.050, -0.190], [0.0485, -0.193, 0]], 26);
    m.use(F.black);
    m.lathe([[0.0445, -0.192, 0], [0.043, -0.04, 0]], 22);
    // Struck central primer dimple on the rear base.
    m.use(F.steelDark);
    m.lathe([[0, 0.003, 0], [0.015, 0.003], [0.016, 0.001, 0]], 16);
  });
}

function artilleryRangefinder(m: Mesher): void {
  // Armored left-flank artillery rangefinder & mechanical dial block on an upper-left breech cantilevered pedestal.
  m.at([OPTIC_X, OPTIC_Y, OPTIC_Z], null, () => {
    // Rugged L-shaped cantilevered parkerized riser bracket tying the high sight solidly into the upper-left breech monolith.
    m.use(F.parkerized);
    m.at([0, 0, 0.01], null, () =>
      m.front(
        poly(
          [
            [0.010, -0.018],
            [0.046, -0.018],
            [0.086, -0.044],
            [0.086, -0.096],
            [0.056, -0.096],
            [0.056, -0.056],
            [0.010, -0.036],
          ],
          0.004,
        ),
        0.128,
        { bevel: 0.002 },
      ),
    );
    // Heavy bolted dark-steel clamp rail pinning the riser to the upper-left breech cheek.
    m.use(F.steelDark);
    m.at([0.066, -0.076, 0.01], null, () => m.box(0.024, 0.046, 0.136, 0.0018));
    hexX(m, 0.054, -0.076, -0.032, -1, 0.0042);
    hexX(m, 0.054, -0.076, 0.052, -1, 0.0042);

    // Hollow chamfered armored optical housing so ADS looks cleanly through the warm amber ballistic reticle.
    m.use(F.anodized);
    m.front(rect(-0.028, -0.024, 0.028, 0.036, 0.007), 0.175, {
      bevel: 0.002,
      holes: [circle(0, 0.006, 0.0175, 28)],
    });
    // Olive-drab bolted armor cheek plates along the sight body.
    m.use(F.oliveDark);
    m.mirror(() =>
      m.at([0.029, 0.004, 0], null, () =>
        m.side(rect(-0.072, -0.016, 0.072, 0.024, 0.003), 0.0034, {
          bevel: 0.001,
          holes: [rect(-0.058, -0.008, -0.014, 0.016, 0.002), rect(0.004, -0.008, 0.058, 0.016, 0.002)],
        }),
      ),
    );
    m.mirror(() => {
      screwX(m, 0.031, 0.022, 0.066, 1, 0.0022);
      screwX(m, 0.031, -0.010, -0.066, 1, 0.0022);
    });

    // Objective bell & coated glass lens forward.
    m.at([0, 0.006, -0.088], null, () => {
      m.use(F.rubber);
      m.lathe([[0.024, 0.004, 0], [0.0285, 0], [0.029, -0.024], [0.026, -0.036], [0.022, -0.037], [0.021, -0.022, 0]], 26);
      m.glass(() => m.at([0, 0, -0.014], null, () => m.cyl(0.0212, 0.0006, 22, 0)));
    });

    // Rear rubber eyecup & crisp warm-amber artillery stadia reticle (at z = +0.080 relative -> OPTIC_Z + 0.080 = -0.035).
    m.at([0, 0.006, 0.086], null, () => {
      m.use(F.rubber);
      m.lathe([[0.021, 0.034, 0], [0.0255, 0.034], [0.027, 0.014], [0.0235, 0], [0.020, 0, 0]], 26);
      m.glow('reticle', () =>
        m.at([0, 0, 0.004], null, () => {
          m.prism(rect(-0.0095, -0.00032, 0.0095, 0.00032, 0), 0.0002, { bevel: 0 });
          m.prism(rect(-0.00032, -0.0095, 0.00032, 0.0065, 0), 0.0002, { bevel: 0 });
          // Descending ballistic drop stadia ticks below the main crosshair.
          m.prism(rect(-0.0048, -0.0034, 0.0048, -0.0028, 0), 0.0002, { bevel: 0 });
          m.prism(rect(-0.0032, -0.0062, 0.0032, -0.0056, 0), 0.0002, { bevel: 0 });
          m.prism(rect(-0.0018, -0.0086, 0.0018, -0.0080, 0), 0.0002, { bevel: 0 });
        }),
      );
    });

    // Left-facing recessed artillery status display (`105MM` readiness & reserve readout).
    m.at([-0.030, 0.004, 0.022], [0, -Math.PI / 2, 0], () => {
      m.use(F.parkerized);
      m.prism(rect(-0.032, -0.016, 0.032, 0.016, 0.0024), 0.0024, { bevel: 0.0008 });
      m.use(F.black);
      m.at([0, 0, 0.001], null, () => m.prism(rect(-0.029, -0.0135, 0.029, 0.0135, 0.0014), 0.001, { bevel: 0 }));
      m.at([0, 0, 0.0018], null, () => m.screen('range', 0.054, 0.025));
    });

    // Heavy knurled elevation range drum with machined brass vernier cap on top of the sight.
    m.at([0, 0.036, -0.012], [Math.PI / 2, 0, 0], () => {
      knurl(m, 0.013, 0.014, F.steelDark, 24, 0.0006);
      m.use(F.brass);
      m.at([0, 0, -0.008], null, () => m.cyl(0.0136, 0.0032, 22));
    });
  });

  // Armored fire-control conduit running from the sight bracket down to the trigger box.
  m.use(F.rubber);
  m.tube(
    [
      [OPTIC_X + 0.024, OPTIC_Y - 0.022, OPTIC_Z + 0.055],
      [OPTIC_X + 0.018, OPTIC_Y - 0.082, 0.005],
      [-0.082, 0.016, 0.042],
      [-0.028, 0.004, 0.058],
    ],
    0.0036,
    { seg: 8, samples: 24 },
  );
  m.use(F.brass);
  m.at([-0.028, 0.004, 0.058], [0, Math.PI / 2, 0], () => m.cyl(0.0058, 0.012, 12));
}

function curveGrip(): V2[] {
  const f = curve([[-0.021, 0], [-0.025, -0.032], [-0.026, -0.066], [-0.021, -0.108]], 4);
  const b = curve([[0.025, -0.108], [0.027, -0.066], [0.025, -0.032], [0.021, 0]], 4);
  return [...f, ...b];
}

function gripsAndControls(m: Mesher): void {
  // Rear firing housing & heavy pistol grip anchored firmly beneath the forged breech monolith.
  m.use(F.parkerized);
  m.side(
    poly([[0.115, 0.028], [0.112, -0.008, 0.006], [0.092, -0.016, 0.006], [-0.068, -0.016, 0.006], [-0.088, 0.028]], 0.003),
    0.058,
    { bevel: 0.0022 },
  );
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.014], [0.021, -0.04], [0.028, -0.064], [0.036, -0.086], [0.044, -0.118]], 4);
  const back = curve([[0.1, -0.118], [0.096, -0.084], [0.088, -0.048], [0.082, -0.014]], 4);
  m.side([...front, [0.046, -0.124], [0.098, -0.124], ...back], 0.035, { bevel: 0.0038, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1265, 0.073], null, () => m.box(0.036, 0.007, 0.06, 0.0016, 0.003));
  // Heavy oversized gloved trigger guard.
  m.use(F.steelDark);
  m.side(
    poly([[-0.042, -0.014], [-0.046, -0.034, 0.006], [-0.028, -0.050, 0.008], [0.032, -0.050, 0.008], [0.052, -0.020, 0.004], [0.052, -0.014]], 0.002),
    0.015,
    {
      bevel: 0.0015,
      holes: [poly([[-0.036, -0.016], [-0.038, -0.032, 0.005], [-0.024, -0.044, 0.005], [0.023, -0.044, 0.005], [0.042, -0.0195, 0.003], [0.043, -0.016]], 0.002)],
    },
  );
  m.mirror(() => {
    hexX(m, 0.0295, 0.008, 0.08, 1, 0.0042);
    hexX(m, 0.0295, 0.008, -0.044, 1, 0.0042);
  });

  // Chunky forward support handle clamped to the lower-left side of the massive recoil cradle (zero clipping with springs).
  const fgX = -0.056;
  const fgZ = -0.34;
  m.use(F.parkerized);
  m.at([fgX, 0.006, fgZ], null, () => m.box(0.048, 0.024, 0.072, 0.0024, 0.005));
  m.use(F.brass);
  m.at([fgX - 0.025, 0.006, fgZ], [0, -Math.PI / 2, 0], () => m.cyl(0.008, 0.006, 14));
  m.use(F.polymerStipple);
  m.at([fgX, -0.008, fgZ], null, () => {
    m.side(curveGrip(), 0.036, { bevel: 0.0038, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([fgX, -0.119, fgZ + 0.003], null, () => m.box(0.040, 0.008, 0.054, 0.0016, 0.003));
}

/**
 * Cluster Shell (`howitzerCluster`) standoff-fuze electronics pod & induction range ring clamped onto the forward trunnion
 * jacket (z = -0.25..-0.40), tucked cleanly below/right of the high left artillery optic so ADS stays 100% unobstructed.
 */
function clusterFuze(m: Mesher): void {
  m.part('clusterFuze', [0, AXIS, 0], () => {
    // Heavy machined parkerized induction collar wrapping the forward trunnion jacket mouth (z = -0.355).
    m.use(F.parkerized);
    m.at([0, 0, -0.355], null, () =>
      m.lathe([[0.092, 0.022, 0], [0.103, 0.019], [0.103, -0.019], [0.092, -0.022, 0]], 36, { chamfer: 0.0014 }),
    );
    // Crisp amber-yellow ordnance cluster band & copper induction wire ring on the collar.
    m.use(F.yellow);
    m.at([0, 0, -0.370], null, () =>
      m.lathe([[0.101, 0.006, 0], [0.105, 0.005], [0.105, -0.005], [0.101, -0.006, 0]], 36, { chamfer: 0.0005 }),
    );
    m.use(F.copperCoil);
    m.at([0, 0, -0.342], null, () =>
      m.lathe([[0.101, 0.007, 0], [0.1045, 0.006], [0.1045, -0.006], [0.101, -0.007, 0]], 36, { chamfer: 0.0005 }),
    );

    // Armored standoff-radar transceiver & electronic fuze-setter pod on the upper-left trunnion shoulder (visible in FP & shop).
    m.at([-0.082, 0.072, -0.315], [0, 0, 0.42], () => {
      m.use(F.anodized);
      m.box(0.044, 0.036, 0.125, 0.0024);
      m.use(F.steelDark);
      for (const z of [-0.035, 0, 0.035]) {
        m.at([0, 0.019, z], null, () => m.box(0.036, 0.006, 0.016, 0.001));
      }
      // Forward twin-aperture standoff rangefinder radar face + glass lens.
      m.use(F.black);
      m.at([-0.009, 0, -0.064], null, () => m.cyl(0.0085, 0.006, 16, 0.0006));
      m.at([0.009, 0, -0.064], null, () => m.cyl(0.0085, 0.006, 16, 0.0006));
      m.glass(() => {
        m.at([-0.009, 0, -0.0672], null, () => m.cyl(0.007, 0.0008, 14, 0));
        m.at([0.009, 0, -0.0672], null, () => m.cyl(0.007, 0.0008, 14, 0));
      });
      // Camera-facing amber hazard strip & glowing standoff-fuze sync LED bar.
      m.at([-0.0228, -0.007, 0], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.088, 0.012, 0xf0c428));
      m.use(F.black);
      m.at([-0.0218, 0.008, 0.012], null, () => m.box(0.003, 0.008, 0.042, 0.0006));
      m.glow('clusterLed', () => m.at([-0.0234, 0.008, 0.012], null, () => m.box(0.0014, 0.0046, 0.034, 0)));
      // Brass range dial knob on the rear cap.
      m.use(F.brass);
      m.at([0, 0, 0.066], null, () => m.cyl(0.011, 0.01, 16, 0.0008));
    });

    // Armored braided telemetry cable from the standoff-fuze pod back to the breech crown.
    m.use(F.rubber);
    m.tube(
      [[-0.072, 0.066, -0.252], [-0.078, 0.078, -0.205], [-0.068, 0.098, -0.155], [-0.048, 0.112, -0.115]],
      0.0042,
      { seg: 8, samples: 18 },
    );
  });
}

function buildHowitzer(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0018;
  breechMonolith(m);
  slidingWedgeAndCrank(m);
  rearSaddle(m);
  cradleAndRecoilSprings(m);
  barrelEvacuatorAndBrake(m);
  artilleryShellAndSpentCasing(m);
  artilleryRangefinder(m);
  gripsAndControls(m);
  clusterFuze(m);

  m.part('trigger', [0, -0.016, -0.002], () => {
    m.use(F.steelDark);
    m.side(
      poly([[-0.004, 0.002], [0.004, 0.002], [0.0024, -0.010, 0.002], [0.0042, -0.022, 0.0016], [0.0005, -0.023, 0.001], [-0.004, -0.0105, 0.003]], 0.001),
      0.0075,
      { bevel: 0.0008 },
    );
  });

  const model = new Model(m, kit.mats, {
    glows: {
      reticle: [0xffa828, 2.5],
      breech: [0xff9e22, 2.2],
      clusterLed: [0xffa420, 4.8],
    },
    screens: { range: [168, 76] },
  });

  model.socket('muzzle', [0, AXIS, -2.10]);
  model.socket('eject', [0, AXIS, 0.22]);
  model.hand('gripR', [0.018, -0.056, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.foregrip('gripL', [-0.076, -0.066, -0.34]);
  // Overhand grip on the grooved brass operating crank handle (parented to `crank` so the hand rides the throw!).
  model.hand('crankHold', [-0.054, 0.004, -0.074], [1, 0, 0], [0, 0.45, -0.89], 'crank');
  // Cradling under the forearm-thick 105 mm shell belly during the hoist, then pushing the brass base home into the bore.
  model.hand('shellHold', [-0.044, -0.036, -0.14], [-0.05, 0.25, -0.96], [0.78, 0.56, -0.08], 'shell');
  model.hand('shellRam', [-0.018, -0.014, 0.068], [0.92, -0.35, 0.05], [0.15, 0.45, -0.88], 'shell');
  return model;
}

function readout(a: Anim): void {
  const s = a.model!.screens.range;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const ready = a.mag > 0;
  g.fillStyle = '#120a03';
  g.fillRect(0, 0, w, h);
  g.fillStyle = ready ? '#ffaa2c' : '#7a3f18';
  g.font = '800 30px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(ready ? '105 RDY' : 'BREECH', 8, 8);
  g.font = '700 16px "Courier New", monospace';
  g.fillText(`RES ${String(a.reserve).padStart(2, '0')}`, 8, 48);
  for (let i = 0; i < 4; i++) {
    g.globalAlpha = ready ? 1 - i * 0.16 : 0.2;
    g.fillRect(102 + i * 14, 50, 10, 16);
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.12);
  const p = a.reload;
  const loaded = a.mag > 0;
  P.shell!.visible = loaded;
  P.spent!.visible = false;
  a.glow('reticle', loaded ? 0.96 + 0.04 * Math.sin(a.time * 9) : 0.24);
  a.glow('breech', loaded && p < 0 ? 1.0 : 0.12);
  if (a.mods?.has('howitzerCluster')) {
    a.glow('clusterLed', 0.65 + 0.35 * Math.sin(a.time * 6.5));
  }

  // Dramatic slow hydropneumatic artillery long-recoil: entire barrel + stepped thermal jacket + bore evacuator +
  // 4-baffle muzzle brake slam violently 0.42 m straight back in 0.055 s (crushing the twin 0.70 m coil springs down to
  // 40% length and exposing ~0.48 m of gleaming chrome hydraulic buffer rods!), pause for a heavy mechanical dwell
  // (0.055 -> 0.175 s), then heave slowly and smoothly back into battery over ~1.165 s (1.34 s total travel).
  let barrelBack = 0;
  if (a.sinceFire < 1.46) {
    const t = a.sinceFire;
    let slam: number;
    if (t < 0.055) {
      slam = outCubic(t / 0.055);
    } else if (t < 0.175) {
      // Heavy mechanical bottom-out pause at full rearward travel with a subtle hydraulic buffer settle.
      slam = 1 - bump(t, 0.055, 0.135) * 0.014;
    } else {
      // Slow, weighty damped hydropneumatic recuperator return back into battery.
      slam = 1 - inOut(seg(t, 0.175, 1.34));
    }
    barrelBack = slam * RECOIL_SLAM;
    const rock = bump(t, 0.01, 0.85);
    const seat = t >= 1.30 ? thud(seg(t, 1.30, 1.45)) : 0;
    a.gunP.y -= rock * 0.016;
    a.gunP.z -= seat * 0.008;
    a.gunR.x += rock * 0.024 - seat * 0.008;
  }

  // Unique heavy artillery draw: heaving the massive cannon up from low-right onto the shoulder while the barrel sleigh
  // settles with a solid hydraulic thud. Zero rolling or twisting.
  if (a.draw < 1) {
    const d = 1 - outCubic(a.draw);
    a.gunP.x += d * 0.095;
    a.gunP.y -= d * 0.135;
    a.gunP.z += d * 0.075;
    a.gunR.x -= d * 0.13;
    a.gunR.y -= d * 0.18;
    const settle = thud(seg(a.draw, 0.65, 1.0));
    barrelBack += settle * 0.028;
    a.gunP.y -= settle * 0.012;
  }

  if (p >= 0) {
    // Timed to reloadFoley: [[0.12, 'reload_bolt'], [0.55, 'reload_shell_in'], [0.84, 'metal_clang']].
    // Stage 1 (0.00 -> 0.24): crank yanks down ~100 deg, sliding-wedge breech drops straight down, spent brass kicks out!
    // Stage 2 (0.26 -> 0.68): hoist forearm-thick 105 mm HE shell behind open breech and ram straight forward (-Z) home!
    // Stage 3 (0.70 -> 0.96): slam crank up, driving the sliding wedge straight up into lock with a violent jolt!
    const crankDown = inOut(seg(p, 0.08, 0.21)) * (1 - inQuad(seg(p, 0.75, 0.84)));
    const wedgeOpen = outCubic(seg(p, 0.10, 0.21)) * (1 - inQuad(seg(p, 0.76, 0.84)));
    const unlockJolt = bump(p, 0.10, 0.19);
    const seatThump = p >= 0.64 ? thud(seg(p, 0.64, 0.72)) : 0;
    const lockSlam = p >= 0.84 ? thud(seg(p, 0.84, 0.95)) : 0;

    P.crank!.rotation.x -= crankDown * CRANK_SWING - lockSlam * 0.05;
    P.wedge!.position.y -= wedgeOpen * WEDGE_DROP - lockSlam * 0.005;

    // Breech-locked amber status light snaps bright the instant the sliding wedge seals home at p = 0.84.
    a.glow('breech', p >= 0.84 ? 1.0 + lockSlam * 0.5 : 0.12);
    a.glow('reticle', p >= 0.84 ? 0.96 : 0.24);

    // Spent 105 mm brass casing kicks straight backward (+Z) out of the open breech and tumbles down away.
    const ejecting = p >= 0.12 && p <= 0.36;
    P.spent!.visible = ejecting;
    if (ejecting) {
      const e = seg(p, 0.12, 0.35);
      const kick = outCubic(Math.min(1, e * 1.6));
      const drop = inQuad(Math.max(0, (e - 0.16) / 0.84));
      P.spent!.position.z += kick * 0.34;
      P.spent!.position.y -= drop * 0.52;
      P.spent!.position.x -= drop * 0.08;
      P.spent!.rotation.x += drop * 1.15;
    }

    // Fresh 105 mm brass-and-olive HE shell hoisted up behind the open breech, aligned with the bore, and rammed
    // straight forward (-Z) into the chamber in a weighty two-beat shove!
    P.shell!.visible = p > 0.25;
    if (p > 0.25) {
      const hoist = inOut(seg(p, 0.26, 0.47));
      const beat1 = inOut(seg(p, 0.49, 0.57));
      const beat2 = inOut(seg(p, 0.58, 0.67));
      const ramRemain = 1 - (beat1 * 0.58 + beat2 * 0.42);
      const sh = P.shell!;
      sh.position.z += 0.34 * ramRemain + (1 - hoist) * 0.04;
      sh.position.y += (1 - hoist) * -0.44;
      sh.position.x += (1 - hoist) * -0.18;
      sh.rotation.x += (1 - hoist) * 0.42;
      sh.rotation.y += (1 - hoist) * -0.22;
    }

    // Shift cannon forward and slightly left with a subtle tilt so the open rear breech, crank, and 105 mm shell ram
    // are framed prominently in first-person without wild rolling.
    const present = hold(p, 0.0, 0.12, 0.86, 0.98);
    a.gunP.z -= present * 0.23 + seatThump * 0.018;
    a.gunP.x -= present * 0.13;
    a.gunP.y -= present * 0.035 + unlockJolt * 0.012 - lockSlam * 0.022;
    a.gunR.y += present * 0.16;
    a.gunR.x -= present * 0.06 - lockSlam * 0.032;
    a.gunR.z += present * 0.13;
    barrelBack += lockSlam * 0.018;

    // Left hand choreography: crank down -> hoist 105 mm shell -> shift to brass base & ram -> crank slam up -> gripL.
    const h = a.left;
    h.fingerRate = 36;
    h.to('crankHold', inOut(seg(p, 0.0, 0.08)));
    h.to('shellHold', inOut(seg(p, 0.21, 0.30)));
    h.to('shellRam', inOut(seg(p, 0.46, 0.52)));
    h.to('crankHold', inOut(seg(p, 0.68, 0.75)));
    h.to('gripL', inOut(seg(p, 0.86, 0.97)));
    h.shape(HANDS.ball, hold(p, 0.05, 0.09, 0.20, 0.24));
    h.shape(HANDS.cup, hold(p, 0.25, 0.31, 0.46, 0.50));
    h.shape(HANDS.foregrip, hold(p, 0.49, 0.54, 0.67, 0.71));
    h.shape(HANDS.ball, hold(p, 0.73, 0.76, 0.85, 0.89));
  }

  // Apply barrel recoil & synchronous twin recoil-spring compression (0.70 m -> 0.28 m = 0.40x at full 0.42 m slam).
  if (barrelBack !== 0) {
    P.barrel!.position.z += barrelBack;
    P.springs!.scale.z *= Math.max(0.35, (SPRING_LEN - barrelBack) / SPRING_LEN);
  }
}

export function howitzerDef(kit: Kit): ViewDef {
  return {
    id: 'howitzer',
    model: buildHowitzer(kit),
    pos: [0.32, -0.275, -0.37],
    rot: [0.008, 0.055, 0],
    // ADS: eye aligned cleanly through the left-flank armored artillery rangefinder's warm amber stadia reticle.
    sight: [OPTIC_X, OPTIC_Y + 0.006, OPTIC_Z + 0.090],
    relief: 0.11,
    // Heavy straight-back artillery shove into the shoulder: zero rolling/twisting on fire.
    recoil: { back: 0.145, lift: 0.026, pitch: 0.095, yaw: 0.012, roll: 0.0, omega: 18, zeta: 0.52 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.75,
    mods: {
      howitzerCluster: { part: 'clusterFuze', also: ['clusterBand', 'clusterShell'] },
    },
    animate: clip,
    readout,
  };
}
