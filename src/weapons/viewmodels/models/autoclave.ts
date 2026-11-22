/**
 * The Autoclave: industrial directed-microwave sterilizer emitter. Heavy dark-steel and off-white ceramic magnetron
 * chassis, twin profiled cooling fin arrays, exposed copper waveguides, analog thermal pressure gauge, angled kW/cell
 * readout screen, underslung high-voltage capacitor cell pack, and an open flared parabolic horn dish with concentric
 * copper dipole rings and porcelain insulator standoffs. No laser glow at rest — only a warm amber-red magnetron coil
 * pulse while firing or hot. Origin at the top of the rear grip.
 */
import * as THREE from 'three';
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { clampBand, coil, hexBolt, hexX, hose, rivet, screwX } from '../kit/details';
import { hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { fill, pullTrigger } from './common';

const BORE_Y = 0.056;
/** Industrial autoclave enamel: warm off-white sterilizer ceramic contrasting dark steel and raw copper. */
const CERAMIC: Finish = { color: 0xd6d2c8, rough: 0.38, metal: 0.05, wear: 0.85 };
const CERAMIC_TRIM: Finish = { color: 0x30343a, rough: 0.48, metal: 0.25, wear: 0.55 };

/** Analog thermal/pressure dial leaned back toward the camera eye; needle rotates around that lean. */
const DIAL_TILT = -Math.PI / 2 + 0.42;
const DIAL_AXIS = new THREE.Vector3(0, -Math.sin(DIAL_TILT), Math.cos(DIAL_TILT));
const DIAL_POS: readonly [number, number, number] = [-0.022, 0.125, 0.048];
const DIAL_SWEEP = 3.8;

const GLOWS: Record<string, readonly [number, number]> = {
  coil: [0xff6a1a, 2.4],
  ventGlow: [0xff5014, 1.8],
  cellLed: [0xffa030, 2.2],
};

function chassis(m: Mesher): void {
  // Heavy dark-steel magnetron receiver spine: stepped industrial block tapering forward to the waveguide collar.
  m.use(F.steelDark);
  m.side(
    poly([
      [0.19, 0.004], [0.195, 0.088, 0.008], [0.155, 0.114, 0.012],
      [0.01, 0.116, 0.014], [-0.21, 0.112, 0.012], [-0.285, 0.096, 0.008],
      [-0.31, 0.068, 0.006], [-0.31, 0.024, 0.006], [-0.275, 0.002, 0.008],
      [-0.04, -0.004, 0.008], [0.025, 0.004, 0.006],
    ], 0.003),
    0.068,
    { bevel: 0.0026, smooth: 34 },
  );

  // Off-white sterilizer ceramic side cowls with slotted magnetron vent cut-outs over glowing warm chamber backing.
  const cowlProfile = poly([
    [0.155, 0.022], [0.155, 0.084, 0.008], [0.128, 0.104, 0.008],
    [-0.03, 0.105, 0.008], [-0.055, 0.088, 0.006], [-0.055, 0.022, 0.006],
  ], 0.003);
  const ventSlots = slotRow(0.0, 0.064, 0.092, 0.064, 5, 0.032, 0.0065, Math.PI / 2);
  m.use(CERAMIC);
  m.mirror(() => {
    m.at([0.0345, 0, 0], null, () => m.side(cowlProfile, 0.0042, { bevel: 0.0012, holes: ventSlots }));
    // Forward ceramic nose saddle capping the waveguide block.
    m.at([0.029, 0.098, -0.175], null, () =>
      m.side(poly([[-0.082, -0.012], [0.082, -0.012], [0.072, 0.016, 0.005], [-0.072, 0.016, 0.005]], 0.002), 0.014, { bevel: 0.0014 }),
    );
  });

  // Dark recess & subtle internal magnetron heater glow visible only through the vent slots when firing/hot.
  m.use(F.black);
  m.mirror(() => m.at([0.0332, 0.064, 0.046], null, () => m.box(0.0014, 0.038, 0.108, 0)));
  m.glow('ventGlow', () => {
    m.mirror(() => m.at([0.0338, 0.064, 0.046], null, () => m.box(0.0012, 0.028, 0.094, 0)));
  });

  // Top sterilizer pressure deck bridging the rear telemetry bay and forward magnetron block.
  m.use(CERAMIC);
  m.at([0, 0.116, -0.04], null, () =>
    m.front(poly([[-0.031, -0.004], [0.031, -0.004], [0.026, 0.006, 0.003], [-0.026, 0.006, 0.003]], 0.002), 0.25, { bevel: 0.0014 }),
  );
  // Industrial rivets & hex fasteners along both flanks.
  m.mirror(() => {
    hexX(m, 0.0368, 0.096, 0.132, 1, 0.0028, F.steel);
    hexX(m, 0.0368, 0.03, 0.132, 1, 0.0028, F.steel);
    screwX(m, 0.0368, 0.095, -0.036, 1, 0.0022);
    screwX(m, 0.0368, 0.03, -0.036, 1, 0.0022);
    screwX(m, 0.0352, 0.088, -0.255, 1, 0.0022);
    screwX(m, 0.0352, 0.024, -0.255, 1, 0.0022);
  });

  // Camera-facing industrial decals on the left ceramic cowl and forward steel cheek.
  m.at([-0.0372, 0.035, 0.056], [0, -Math.PI / 2, 0], () => m.decal('hv', 0.068, 0.011, 0xd8b246));
  m.at([-0.0372, 0.094, 0.052], [0, -Math.PI / 2, 0], () => m.decal('press', 0.07, 0.0105, 0x2c3036));
  m.at([-0.0372, 0.035, -0.018], [0, -Math.PI / 2, 0], () => m.decal('warn', 0.016, 0.016, 0xd8b246));
  m.at([-0.0352, 0.056, -0.278], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.034, 0.012, 0xd8b246));

  // Twin lateral cooling fin arrays along the magnetron body (profiled bevelled fins, not plain boxes).
  const finShape: V2[] = poly([
    [0.032, 0.024], [0.052, 0.032, 0.003], [0.054, 0.078, 0.003], [0.044, 0.092, 0.003], [0.032, 0.092],
  ], 0.0018);
  for (let i = 0; i < 11; i++) {
    const z = -0.078 - i * 0.0155;
    m.use(i % 2 === 0 ? F.steelDark : CERAMIC_TRIM);
    m.mirror(() => m.at([0, 0, z], null, () => m.front(finShape, 0.0042, { bevel: 0.0009 })));
  }

  // Twin copper waveguide heat-exchanger rails threading through the cooling fins and looping into the emitter throat.
  m.mirror(() => {
    m.use(F.copper);
    m.tube(
      [
        [0.028, 0.088, -0.052],
        [0.046, 0.084, -0.085],
        [0.048, 0.084, -0.245],
        [0.044, 0.076, -0.295],
        [0.034, BORE_Y + 0.018, -0.335],
      ],
      0.0044,
      { seg: 10, samples: 26 },
    );
    m.tube(
      [
        [0.028, 0.036, -0.052],
        [0.045, 0.038, -0.085],
        [0.046, 0.038, -0.245],
        [0.039, 0.042, -0.295],
        [0.032, BORE_Y - 0.018, -0.335],
      ],
      0.0038,
      { seg: 10, samples: 26 },
    );
    // Brass hex compression unions anchoring the copper tubes at both ends.
    m.use(F.brass);
    for (const y of [0.084, 0.038]) {
      for (const z of [-0.072, -0.252]) {
        m.at([0.046, y, z], null, () =>
          m.lathe([[0.0044, 0.006, 0], [0.0074, 0.006], [0.0074, -0.006], [0.0044, -0.006, 0]], 6, { chamfer: 0.0007 }),
        );
      }
    }
    // Wound copper induction coil sitting atop the mid-chassis waveguide bridge.
    m.at([0.021, 0.118, -0.175], null, () => coil(m, 0.0095, 0.0014, 0.11, 13, F.copperCoil));
  });

  // Top carry/heat-guard arch bar framing the copper induction coils.
  m.use(F.steelDark);
  m.mirror(() => {
    m.tube(
      [[0.028, 0.116, -0.095], [0.03, 0.136, -0.115], [0.03, 0.136, -0.24], [0.026, 0.112, -0.268]],
      0.0034,
      { seg: 8, samples: 16 },
    );
  });
  for (const z of [-0.125, -0.23]) {
    m.at([0, 0.136, z], [0, Math.PI / 2, 0], () => m.cyl(0.0036, 0.062, 10));
  }
}

function instruments(m: Mesher): void {
  // 1) Analog thermal/pressure dial on the upper-left shoulder (tilted toward the player eye).
  m.use(F.steelDark);
  m.at([DIAL_POS[0], DIAL_POS[1] - 0.012, DIAL_POS[2] - 0.003], null, () =>
    m.lathe([[0, 0.01, 0], [0.015, 0.01], [0.018, -0.008], [0, -0.008, 0]], 16),
  );
  m.at([DIAL_POS[0], DIAL_POS[1], DIAL_POS[2]], [DIAL_TILT, 0, 0], () => {
    m.use(F.brass);
    m.lathe([[0.0185, 0.003, 0], [0.0218, 0.0022], [0.0218, -0.008], [0.0185, -0.008, 0]], 26);
    m.use(F.white);
    m.cyl(0.0184, 0.002, 24, 0);
    m.at([0, 0, 0.0012], null, () => m.decal('dial', 0.033, 0.033, 0x20242a));
    m.glass(() => m.at([0, 0, 0.0036], null, () => m.cyl(0.0184, 0.0004, 24, 0)));
  });

  // Live rotating needle part on the pressure/thermal dial.
  m.part('needle', [DIAL_POS[0], DIAL_POS[1] + 0.0012, DIAL_POS[2] - 0.0004], () => {
    m.at([0, 0, 0], [DIAL_TILT, 0, 0], () => {
      m.use(F.red);
      m.at([0, 0.0064, 0.0026], null, () => m.box(0.0011, 0.0145, 0.0005, 0));
      m.use(F.steelDark);
      m.at([0, 0, 0.0026], null, () => m.cyl(0.002, 0.001, 10, 0));
    });
  });

  // 2) Angled digital cell charge / magnetron kW readout screen on the rear deck.
  m.at([0.008, 0.118, 0.132], [-Math.PI / 2 + 0.34, 0, 0], () => {
    m.use(CERAMIC_TRIM);
    m.prism(rect(-0.029, -0.019, 0.029, 0.019, 0.003), 0.0042, { bevel: 0.001 });
    m.use(F.black);
    m.at([0, 0, 0.0016], null, () => m.prism(rect(-0.026, -0.016, 0.026, 0.016, 0.0014), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.0026], null, () => m.screen('ammo', 0.05, 0.03));
  });
}

function emitter(m: Mesher): void {
  // Open flared parabolic microwave dish emitter (industrial radar/sterilizer horn, NOT a laser barrel).
  m.at([0, BORE_Y, 0], null, () => {
    // Heavy bolted waveguide flange collar joining the receiver to the horn throat.
    m.use(F.steelDark);
    m.lathe(
      [
        [0.024, -0.305, 0], [0.044, -0.305], [0.046, -0.312],
        [0.046, -0.326], [0.036, -0.33], [0.034, -0.352], [0.026, -0.352, 0],
      ],
      28,
      { chamfer: 0.0012 },
    );
    // 6 perimeter hex bolts clamping the flange.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      m.at([Math.cos(a) * 0.039, Math.sin(a) * 0.039, -0.327], [0, Math.PI, 0], () => hexBolt(m, 0.0026, F.steel));
    }

    // Exterior parabolic dish shell (dark steel with rolled heavy lip) + deep concave reflective cavity.
    m.use(F.steelDark);
    m.lathe(
      [
        [0.025, -0.348, 0],
        [0.034, -0.352],
        [0.049, -0.382],
        [0.064, -0.422],
        [0.077, -0.468],
        [0.082, -0.494],
        [0.081, -0.508],
        [0.073, -0.508],
        [0.07, -0.492],
        [0.058, -0.45],
        [0.042, -0.402],
        [0.027, -0.366],
        [0.016, -0.352, 0],
      ],
      32,
      { chamfer: 0.0012, smooth: 36 },
    );

    // Off-white ceramic thermal jacket band clamped around the outer waist of the horn.
    m.use(CERAMIC);
    m.lathe(
      [
        [0.047, -0.376, 0],
        [0.052, -0.379],
        [0.067, -0.424],
        [0.062, -0.427, 0],
      ],
      32,
      { chamfer: 0.0009, smooth: 30 },
    );
    m.at([0, 0, -0.402], null, () => clampBand(m, 0.0595, 0.0085, F.steel));

    // Inner reflective copper parabolic liner & concentric waveguide dipole baffles.
    m.use(F.copper);
    m.lathe(
      [
        [0.014, -0.353, 0],
        [0.026, -0.367],
        [0.041, -0.403],
        [0.057, -0.45],
        [0.0685, -0.491],
        [0.071, -0.493],
        [0.067, -0.493],
        [0.0555, -0.451],
        [0.0395, -0.404],
        [0.0245, -0.368],
        [0.0125, -0.354, 0],
      ],
      32,
      { chamfer: 0.0006, smooth: 36 },
    );

    // Three concentric copper dipole emitter rings suspended across the open horn aperture.
    const dipoleRings: readonly [number, number, number][] = [
      [0.025, -0.435, 0.0024],
      [0.044, -0.474, 0.0028],
      [0.063, -0.506, 0.0032],
    ];
    for (const [r, z, thick] of dipoleRings) {
      m.use(F.copper);
      m.lathe(
        [
          [r - thick, z + thick, 0],
          [r + thick, z + thick],
          [r + thick, z - thick],
          [r - thick, z - thick],
          [r - thick, z + thick, 0],
        ],
        28,
        { chamfer: 0.0007, smooth: 28 },
      );
    }

    // Central magnetron feed-horn probe projecting out of the dish focal point.
    m.use(F.steelDark);
    m.lathe(
      [
        [0, -0.35, 0], [0.014, -0.35], [0.011, -0.39], [0.0085, -0.445],
        [0.0135, -0.462], [0.0135, -0.472], [0.007, -0.476], [0, -0.476, 0],
      ],
      20,
      { chamfer: 0.0008, smooth: 24 },
    );
    // Copper magnetron winding wrapped around the central emitter probe.
    m.at([0, 0, -0.41], null, () => coil(m, 0.0118, 0.0014, 0.068, 9, F.copperCoil));
    // Porcelain dielectric tip cap on the probe nose.
    m.use(CERAMIC);
    m.lathe([[0, -0.476, 0], [0.0078, -0.476], [0.0062, -0.487], [0, -0.489, 0]], 16, { chamfer: 0.0005 });

    // Subtle warm amber-red magnetron coil indicator deep inside the dish throat (OFF/dim at rest, pulses when firing/hot).
    m.glow('coil', () => {
      m.lathe(
        [
          [0.0092, -0.376, 0], [0.0108, -0.376], [0.0108, -0.444], [0.0092, -0.444, 0],
        ],
        16,
        { chamfer: 0 },
      );
      // Warm inner throat ring around the waveguide aperture.
      m.lathe(
        [
          [0.016, -0.36, 0], [0.022, -0.362], [0.022, -0.368], [0.016, -0.366, 0],
        ],
        20,
        { chamfer: 0 },
      );
    });

    // Four diagonal ribbed porcelain ceramic insulator standoffs bracing the outer dipole ring & rim.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      m.at([0, 0, 0], [0, 0, a], () => {
        // Steel strut from inner horn to outer dipole ring + probe tip.
        m.use(F.steelDark);
        m.tube(
          [[0.011, 0, -0.455], [0.026, 0, -0.44], [0.045, 0, -0.475], [0.064, 0, -0.506], [0.078, 0, -0.5]],
          0.0024,
          { seg: 6, samples: 12 },
        );
        // External high-voltage porcelain insulator standoff on the horn shoulder.
        m.at([0.074, 0, -0.468], [0, Math.PI / 2, 0], () => {
          m.use(CERAMIC);
          m.lathe(
            [
              [0.0032, -0.006, 0], [0.007, -0.005], [0.0042, -0.002], [0.0078, 0.0],
              [0.0042, 0.0025], [0.0078, 0.005], [0.0042, 0.0075], [0.0068, 0.01], [0.0028, 0.011, 0],
            ],
            14,
            { chamfer: 0.0004 },
          );
          m.use(F.copper);
          m.at([0, 0, 0.011], null, () => m.cyl(0.003, 0.0045, 10));
        });
      });
    }
  });
}

function powerCell(m: Mesher): void {
  // Heavy underslung cradle & braided HV power cables feeding the capacitor bay.
  m.use(F.steelDark);
  for (const z of [-0.072, -0.188]) {
    m.at([0, -0.008, z], null, () => {
      const saddle = poly([
        [-0.033, 0.016], [0.033, 0.016], [0.035, -0.014, 0.004],
        [0.022, -0.018, 0.003], [-0.022, -0.018, 0.003], [-0.035, -0.014, 0.004],
      ], 0.002);
      m.front(saddle, 0.016, { bevel: 0.0012 });
    });
  }
  // Twin corrugated HV power hoses running cleanly under the side cowl into the lower magnetron bus (clear of decals).
  m.mirror(() => {
    hose(
      m,
      [[0.028, -0.018, -0.078], [0.044, -0.012, -0.052], [0.044, 0.008, -0.028], [0.035, 0.018, -0.014]],
      0.0046,
      14,
      F.rubber,
    );
    m.use(F.brass);
    m.at([0.035, 0.018, -0.014], [0, Math.PI / 2, 0], () => m.cyl(0.0058, 0.007, 8));
  });

  // Detachable underslung high-voltage capacitor cell pack (slides straight down/up during reload — zero twist).
  m.part('cell', [0, -0.042, -0.13], () => {
    // Chamfered core housing.
    m.use(CERAMIC_TRIM);
    m.front(
      poly([
        [-0.025, 0.026], [0.025, 0.026], [0.03, 0.012, 0.004],
        [0.028, -0.022, 0.005], [0.019, -0.028, 0.004],
        [-0.019, -0.028, 0.004], [-0.028, -0.022, 0.005], [-0.03, 0.012, 0.004],
      ], 0.002),
      0.112,
      { bevel: 0.0018 },
    );

    // Twin cylindrical capacitor cells flanking the pack in off-white ceramic with copper end caps.
    m.mirror(() => {
      m.at([0.022, -0.003, 0], null, () => {
        m.use(CERAMIC);
        m.lathe(
          [[0, 0.049, 0], [0.0135, 0.049], [0.0135, -0.049], [0, -0.049, 0]],
          18,
          { chamfer: 0.001 },
        );
        m.use(F.copper);
        for (const z of [-0.044, 0.044]) {
          m.at([0, 0, z], null, () => m.lathe([[0.0128, 0.0065, 0], [0.0146, 0.0065], [0.0146, -0.0065], [0.0128, -0.0065, 0]], 16));
        }
        for (const z of [-0.02, 0.02]) {
          m.at([0, 0, z], null, () => clampBand(m, 0.0137, 0.0055, F.steelDark));
        }
      });
    });

    // Top copper bus terminals that mate into the magnetron cradle.
    m.use(F.copper);
    for (const z of [-0.028, 0.028]) {
      m.at([0, 0.029, z], null, () => m.box(0.028, 0.007, 0.012, 0.001));
    }

    // Ribbed rubber bottom grip bumper for pulling the cell straight down.
    m.use(F.rubber);
    for (let i = 0; i < 5; i++) {
      m.at([0, -0.0285, -0.038 + i * 0.019], null, () => m.box(0.034, 0.0048, 0.0085, 0.0012));
    }

    // Camera-facing amber charge indicator bar on the left side of the cell.
    m.use(F.black);
    m.at([-0.0355, 0.004, 0], null, () => m.box(0.002, 0.008, 0.05, 0));
    m.glow('cellLed', () => m.at([-0.0362, 0.004, 0], null, () => m.box(0.0014, 0.0048, 0.044, 0)));
  });

  // Left-side HV discharge / capacitor interlock latch bolt forward on the magnetron flank (matched to 0.78 reload_bolt).
  m.part('bolt', [-0.037, 0.098, -0.092], () => {
    m.use(F.steelDark);
    m.at([-0.004, 0, 0], null, () => m.box(0.009, 0.011, 0.022, 0.0012));
    m.use(F.brass);
    m.at([-0.012, 0, 0], [0, Math.PI / 2, 0], () =>
      m.lathe([[0, 0.0062, 0], [0.007, 0.0062], [0.0056, 0.001], [0.007, -0.004], [0.007, -0.008], [0, -0.008, 0]], 14),
    );
  });
}

function gripsAndStock(m: Mesher): void {
  // Contoured ergonomic rear pistol grip.
  m.use(F.polymerStipple);
  const front = curve([[0.02, 0.008], [0.021, -0.02], [0.028, -0.052], [0.036, -0.08], [0.044, -0.108]], 4);
  const back = curve([[0.098, -0.108], [0.094, -0.078], [0.086, -0.042], [0.082, 0.008]], 4);
  m.side([...front, [0.046, -0.114], [0.096, -0.114], ...back], 0.033, { bevel: 0.0036, smooth: 50 });

  m.use(CERAMIC_TRIM);
  m.at([0, -0.1165, 0.071], null, () => m.box(0.034, 0.006, 0.058, 0.0014, 0.003));

  // Hollowed industrial trigger guard.
  m.use(F.steelDark);
  m.side(
    poly([
      [-0.036, 0.006], [-0.042, -0.018, 0.006], [-0.024, -0.034, 0.008],
      [0.03, -0.034, 0.008], [0.05, -0.006, 0.004], [0.05, 0.006],
    ], 0.002),
    0.013,
    {
      bevel: 0.0012,
      holes: [
        poly([
          [-0.031, 0.002], [-0.035, -0.016, 0.005], [-0.021, -0.0285, 0.005],
          [0.022, -0.0285, 0.005], [0.041, -0.0055, 0.003], [0.042, 0.002],
        ], 0.002),
      ],
    },
  );

  // Trigger part.
  m.part('trigger', [0, 0.003, -0.002], () => {
    m.use(F.steelDark);
    m.side(
      poly([
        [-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002],
        [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003],
      ], 0.001),
      0.0065,
      { bevel: 0.0007 },
    );
  });

  // Forward lower support cradle ahead of the capacitor cell pack for left-hand HANDS.support grip.
  m.use(F.polymerStipple);
  m.at([0, 0.004, -0.256], null, () => {
    const cradle = poly([
      [-0.026, 0.014], [0.026, 0.014], [0.028, -0.002, 0.004],
      [0.02, -0.014, 0.006], [-0.02, -0.014, 0.006], [-0.028, -0.002, 0.004],
    ], 0.003);
    m.front(cradle, 0.092, { bevel: 0.0026 });
  });
  // Ribbed ceramic heat-insulator strips on the support cradle.
  m.use(CERAMIC);
  for (let i = 0; i < 4; i++) {
    m.at([0, -0.01, -0.226 - i * 0.02], null, () => m.box(0.036, 0.004, 0.007, 0.001));
  }

  // Heavy industrial skeletonized buttstock frame + rubber shoulder pad.
  m.use(F.steelDark);
  m.side(
    poly([[0.185, 0.088], [0.34, 0.082, 0.008], [0.34, 0.018, 0.008], [0.185, 0.01]], 0.003),
    0.026,
    {
      bevel: 0.002,
      holes: [poly([[0.21, 0.072], [0.312, 0.068, 0.004], [0.312, 0.032, 0.004], [0.21, 0.026]], 0.003)],
    },
  );
  m.use(F.rubber);
  m.at([0, 0.048, 0.352], null, () => m.front(rect(-0.02, -0.056, 0.02, 0.056, 0.01), 0.022, { bevel: 0.003 }));
  m.at([0, 0.088, 0.25], [-Math.PI / 2, 0, 0], () => rivet(m, 0.002, F.steel));
  m.at([0, 0.086, 0.3], [-Math.PI / 2, 0, 0], () => rivet(m, 0.002, F.steel));
}

function buildAutoclave(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  chassis(m);
  instruments(m);
  emitter(m);
  powerCell(m);
  gripsAndStock(m);

  const model = new Model(m, kit.mats, {
    glows: GLOWS,
    screens: { ammo: [180, 104] },
  });
  model.socket('muzzle', [0, BORE_Y, -0.52]);
  model.socket('eject', [0, BORE_Y, 0]);
  model.hand('gripR', [0.018, -0.046, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.004, -0.012, -0.256]);
  model.hand('cellHold', [-0.034, -0.01, 0.0], [-0.12, 0.15, -0.98], [0.92, 0.18, -0.18], 'cell');
  model.hand('boltHold', [-0.024, -0.004, -0.004], [-0.28, 0.14, -0.95], [0.85, -0.05, -0.45], 'bolt');
  return model;
}

function drawScreen(a: Anim): void {
  const s = a.model?.screens.ammo;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const frac = fill(a);
  const low = frac < 0.25;
  const hot = a.heat > 0.55 || a.sinceFire < 0.09;

  g.fillStyle = '#090705';
  g.fillRect(0, 0, w, h);

  // Header strip: industrial autoclave microwave status.
  g.fillStyle = low ? '#ff4626' : hot ? '#ff8b2b' : '#e6a838';
  g.font = '800 18px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(hot ? 'EMIT 2.45GHz' : 'STBY 2.45GHz', 8, 6);

  // Cell charge counter.
  g.font = '800 38px "Courier New", monospace';
  g.fillStyle = low ? '#ff5533' : '#ffd27a';
  g.fillText(String(a.mag).padStart(3, '0'), 8, 28);
  g.font = '700 20px "Courier New", monospace';
  g.fillStyle = '#a8844c';
  g.fillText(`/${a.magSize}`, 84, 42);

  // Segmented capacitor charge bar.
  const barX = 8;
  const barY = 74;
  const barW = w - 16;
  const barH = 18;
  g.fillStyle = '#241a10';
  g.fillRect(barX, barY, barW, barH);
  const segs = 12;
  const lit = Math.round(frac * segs);
  const segW = (barW - (segs - 1) * 3) / segs;
  for (let i = 0; i < segs; i++) {
    g.fillStyle = i < lit ? (low ? '#ff4626' : '#f29f2e') : '#2e2115';
    g.fillRect(barX + i * (segW + 3), barY + 2, segW, barH - 4);
  }
  texture.needsUpdate = true;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09, 0.25);

  const firing = a.sinceFire < 0.09 ? 1 : 0;
  const warm = Math.min(1, Math.max(a.heat, firing * 0.65));

  // Analog pressure/thermal gauge needle sweeps up with magnetron load + high-frequency hum shiver while firing.
  const needle = P.needle!;
  const sweep = (-0.45 + warm * 0.9) * DIAL_SWEEP + Math.sin(a.time * 74) * 0.035 * firing;
  needle.rotateOnAxis(DIAL_AXIS, sweep);

  // Magnetron coil & vent glow: dormant at rest (NOT a laser!), warm amber-red pulse ONLY while firing or hot.
  const pulse = 0.85 + 0.15 * Math.sin(a.time * 52);
  const coilLvl = firing > 0 ? (0.55 + warm * 0.65) * pulse : a.heat * 0.55;
  a.glow('coil', coilLvl);
  a.glow('ventGlow', firing > 0 ? (0.38 + warm * 0.52) * pulse : a.heat * 0.42);
  a.glow('cellLed', a.reload >= 0 ? (a.reload > 0.3 && a.reload < 0.66 ? 0.04 : 0.45) : 0.35 + fill(a) * 0.35 + firing * 0.3);

  // Subtle magnetron hum vibration in the hands while emitting — translation only, ZERO roll or twist.
  const hum = (firing * 0.00085 + warm * 0.00045) * (0.75 + 0.25 * Math.sin(a.time * 27));
  a.gunP.x += Math.sin(a.time * 97) * hum;
  a.gunP.y += Math.sin(a.time * 113 + 1.1) * hum;

  // Draw: straight vertical lift into position — ZERO roll (gunR.z === 0) and ZERO twist (gunR.y === 0).
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.14;
    a.gunP.z += k * 0.06;
    a.gunR.x -= k * 0.14;
  }

  const p = a.reload;
  if (p < 0) return;

  // Underslung capacitor cell swap timed to reloadFoley: [[0.12, 'reload_cell'], [0.78, 'reload_bolt']].
  // Strictly ZERO roll (gunR.z === 0) and ZERO yaw twist (gunR.y === 0) on both weapon and cell!
  const drop = inQuad(seg(p, 0.12, 0.33));
  const rise = 1 - outCubic(seg(p, 0.42, 0.64));
  const away = p < 0.37 ? drop : rise;
  const cl = P.cell!;
  cl.position.y -= away * 0.27;
  cl.position.z += away * 0.018;
  if (p > 0.33 && p < 0.41) cl.visible = false;

  const seat = p >= 0.635 ? thud(seg(p, 0.635, 0.74)) : 0;
  const rack = hold(p, 0.75, 0.81, 0.85, 0.91);
  P.bolt!.position.z += rack * 0.038;

  // Subtle straight raise/pitch to present the underslung bay without any roll or yaw twist.
  const present = hold(p, 0, 0.11, 0.88, 1);
  a.gunP.y += present * 0.022 + seat * 0.005;
  a.gunP.z += present * 0.04 + rack * 0.008;
  a.gunR.x += present * 0.08 + seat * 0.025;

  const h = a.left;
  h.fingerRate = 34;
  h.to('cellHold', inOut(seg(p, 0.03, 0.11)));
  h.to('pouchL', inOut(seg(p, 0.27, 0.37)));
  h.to('cellHold', inOut(seg(p, 0.41, 0.49)));
  h.to('boltHold', inOut(seg(p, 0.67, 0.75)));
  h.to('gripL', inOut(seg(p, 0.9, 1)));
  h.shape(HANDS.cup, hold(p, 0.04, 0.1, 0.62, 0.67));
  h.shape(HANDS.pinch, hold(p, 0.69, 0.75, 0.88, 0.93));
}

export function autoclaveDef(kit: Kit): ViewDef {
  return {
    id: 'autoclave',
    model: buildAutoclave(kit),
    pos: [0.205, -0.178, -0.425],
    rot: [0.015, 0.082, 0],
    recoil: { back: 0.005, lift: 0.0015, pitch: 0.005, yaw: 0, roll: 0, omega: 34, zeta: 0.75 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.012,
    animate: clip,
    readout: drawScreen,
  };
}
