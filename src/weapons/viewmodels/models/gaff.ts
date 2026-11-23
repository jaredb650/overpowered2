/**
 * The Gaff: heavy industrial shoulder-fired harpoon cannon on key 0 (beside the Stakegun).
 * Forged dark parkerized chassis with slotted side armour, heavy machined steel twin-rail launch
 * trough with exposed chrome/steel recoil buffer springs, oversized barbed steel harpoon spear
 * riding visibly in the open channel, weathered brass/bronze underslung cable winch drum with
 * steel spool and ratchet wheel, front brass fairlead cable guide eye, shoulder buttpad, and
 * angled support foregrip. Origin sits at the top of the rear firing grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { circle, curve, ngon, poly, rect, slot, slotRow } from '../kit/shapes';
import { coil, hexX, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

const TROUGH_Y = 0.092;
const SPEAR_LEN = 0.98;
const WINCH_Y = -0.052;
const WINCH_Z = -0.175;

/** Oversized barbed steel harpoon spear: heavy shaft, grip flutes, cable shackle, swept broadhead flukes. */
function harpoonSpear(m: Mesher): void {
  const r = 0.0102;
  // Rear forged steel striker collar & cable tow shackle eye at the shaft tail.
  m.use(F.steelDark);
  m.lathe(
    [
      [0, 0.012, 0],
      [0.014, 0.012],
      [0.0155, 0.004],
      [0.0155, -0.014],
      [0.0118, -0.02],
      [r, -0.024, 0],
    ],
    18,
    { chamfer: 0.0009 },
  );
  // Brass cable shackle ring welded underneath the shaft tail.
  m.use(F.brass);
  m.at([0, -0.017, -0.016], [0, Math.PI / 2, 0], () =>
    m.prism(circle(0, 0, 0.011, 14), 0.008, { bevel: 0.001, holes: [circle(0, 0, 0.0055, 10)] }),
  );

  // Heavy machined steel main shaft with recessed weight/grip flutes along its length.
  m.use(F.steel);
  const shaft: [number, number, number?][] = [[r, -0.024, 0], [r, -0.055]];
  for (let i = 0; i < 8; i++) {
    const z = -0.075 - i * 0.058;
    shaft.push([r, z], [r - 0.0016, z - 0.005], [r - 0.0016, z - 0.022], [r, z - 0.027]);
  }
  // Forward bronze-ringed cable slide collar & spearhead shoulder.
  shaft.push([r, -0.60], [r + 0.0038, -0.61], [r + 0.0038, -0.642], [r, -0.652], [r, -0.735, 0]);
  m.lathe(shaft, 18, { chamfer: 0.0005, smooth: 24 });

  // Sliding brass tether collar near the forward launch bridge.
  m.use(F.brass);
  m.at([0, 0, -0.626], null, () =>
    m.lathe(
      [
        [r + 0.0036, 0.018, 0],
        [r + 0.0068, 0.016],
        [r + 0.0068, -0.016],
        [r + 0.0036, -0.018, 0],
      ],
      18,
      { chamfer: 0.0008 },
    ),
  );
  // Lower eyelet lug on the sliding collar where the steel tow cable hooks in.
  m.at([0, -0.019, -0.626], [0, Math.PI / 2, 0], () =>
    m.prism(circle(0, 0, 0.0085, 12), 0.007, { bevel: 0.0008, holes: [circle(0, 0, 0.004, 10)] }),
  );

  // Gleaming forged chrome/steel broadhead tip extending well forward of the muzzle.
  m.use(F.chrome);
  m.lathe(
    [
      [r, -0.735, 0],
      [0.0175, -0.752],
      [0.014, -0.778],
      [0.0115, -0.855],
      [0.0062, -0.935],
      [0.0012, -SPEAR_LEN, 0],
    ],
    14,
    { chamfer: 0.0004 },
  );

  // Twin oversized swept-back locking barbs (flukes) flaring wide with deep maritime hook undercuts.
  m.use(F.chrome);
  const barbProfile = poly(
    [
      [0.004, -0.965, 0.0006],
      [0.058, -0.742, 0.0014],
      [0.048, -0.728, 0.0012],
      [0.022, -0.796, 0.0016],
      [0.009, -0.772, 0.001],
    ],
    0.001,
  );
  m.mirror(() => {
    m.at([0, 0, 0], null, () => m.top(barbProfile, 0.0076, { bevel: 0.0018 }));
    // Secondary swept locking barb pair directly behind the main flukes.
    m.use(F.steel);
    m.at([0.009, 0, -0.70], null, () =>
      m.top(
        poly(
          [
            [0.0, -0.042, 0.0008],
            [0.028, 0.022, 0.0012],
            [0.018, 0.026, 0.001],
            [0.0, -0.002, 0.0008],
          ],
          0.0008,
        ),
        0.0052,
        { bevel: 0.0011 },
      ),
    );
    m.use(F.chrome);
  });

  // Vertical spine keel rib on top and bottom of the broadhead.
  m.use(F.steel);
  m.side(
    poly(
      [
        [-0.955, 0.002],
        [-0.785, 0.022, 0.0014],
        [-0.745, 0.014, 0.0014],
        [-0.745, -0.014, 0.0014],
        [-0.785, -0.022, 0.0014],
        [-0.955, -0.002],
      ],
      0.001,
    ),
    0.0052,
    { bevel: 0.0012 },
  );
}

/** Forged dark parkerized main chassis, slotted cheek armour, heavy shoulder buttstock & pad. */
function chassis(m: Mesher): void {
  // Primary forged receiver & shoulder spine (bevelled profile, no plain boxes).
  m.use(F.parkerized);
  m.side(
    poly(
      [
        [0.24, 0.012],
        [0.25, 0.072, 0.01],
        [0.19, 0.092, 0.01],
        [-0.08, 0.086, 0.008],
        [-0.51, 0.080, 0.006],
        [-0.53, 0.038, 0.006],
        [-0.46, 0.020, 0.008],
        [-0.28, 0.018, 0.008],
        [-0.10, -0.006, 0.008],
        [0.09, -0.006, 0.008],
        [0.14, 0.012, 0.008],
      ],
      0.0035,
    ),
    0.068,
    { bevel: 0.0034, smooth: 32 },
  );

  // Slotted bolted dark-steel side armour cheeks with recessed black vents on both flanks.
  const cheek = poly(
    [
      [0.175, 0.016],
      [0.175, 0.076, 0.006],
      [-0.05, 0.074, 0.006],
      [-0.44, 0.068, 0.006],
      [-0.46, 0.034, 0.006],
      [-0.36, 0.026, 0.006],
      [-0.10, 0.004, 0.006],
      [0.09, 0.004, 0.006],
    ],
    0.0025,
  );
  m.mirror(() => {
    m.use(F.anodized);
    m.at([0.036, 0, 0], null, () =>
      m.side(cheek, 0.007, {
        bevel: 0.0016,
        holes: [
          ...slotRow(-0.40, 0.050, -0.14, 0.052, 5, 0.026, 0.009, Math.PI / 2),
          slot(0.01, 0.044, 0.13, 0.044, 0.0085, 4),
        ],
      }),
    );
    m.use(F.black);
    m.at([0.0332, 0.048, -0.14], null, () => m.side(rect(-0.29, -0.022, 0.29, 0.022, 0.002), 0.0014, { bevel: 0 }));

    // Heavy structural hex bolts along the receiver flanks.
    for (const [y, z] of [
      [0.068, 0.155],
      [0.066, -0.04],
      [0.062, -0.43],
      [0.016, 0.09],
      [0.014, -0.09],
      [0.034, -0.43],
    ] as const) {
      hexX(m, 0.0402, y, z, 1, 0.0036, F.steelDark);
    }
    // Weathered brass serial/pressure inspection boss on mid-chassis.
    m.at([0.040, 0.028, -0.02], [0, Math.PI / 2, 0], () => {
      m.use(F.brass);
      m.lathe([[0, 0.005, 0], [0.011, 0.005], [0.013, 0.002], [0.013, 0, 0]], 16, { chamfer: 0.0008 });
      m.use(F.steelDark);
      m.lathe([[0, 0.0065, 0], [0.0048, 0.0065], [0.0048, 0.005, 0]], 6, { chamfer: 0.0004 });
    });
  });

  // Heavy shoulder buttstock extension, cheek saddle, and contoured rubber shoulder buttplate.
  m.use(F.steelDark);
  m.side(
    poly(
      [
        [0.18, 0.016],
        [0.29, -0.016, 0.008],
        [0.29, 0.088, 0.008],
        [0.18, 0.082, 0.006],
      ],
      0.003,
    ),
    0.046,
    {
      bevel: 0.0026,
      holes: [poly([[0.21, 0.014], [0.27, 0.002, 0.005], [0.27, 0.056, 0.005], [0.21, 0.054, 0.005]], 0.004)],
    },
  );
  // Top cheek-rest pad along the shoulder bridge.
  m.use(F.rubber);
  m.at([0, 0.086, 0.22], null, () =>
    m.front(
      poly(
        [
          [-0.025, -0.004],
          [0.025, -0.004],
          [0.027, 0.010, 0.004],
          [0.016, 0.018, 0.005],
          [-0.016, 0.018, 0.005],
          [-0.027, 0.010, 0.004],
        ],
        0.003,
      ),
      0.13,
      { bevel: 0.0024 },
    ),
  );
  // Thick curved ribbed rubber shoulder buttplate.
  m.at([0, 0.036, 0.302], null, () => {
    m.use(F.steelDark);
    m.side(poly([[-0.014, 0.058], [0.004, 0.058], [0.004, -0.058], [-0.014, -0.056]], 0.002), 0.052, { bevel: 0.002 });
    m.use(F.rubber);
    m.side(
      poly(
        [
          [0.002, 0.058],
          [0.028, 0.056, 0.007],
          [0.022, 0.0, 0.01],
          [0.028, -0.056, 0.007],
          [0.002, -0.058],
        ],
        0.003,
      ),
      0.054,
      { bevel: 0.0036 },
    );
  });

  // Industrial markings on the camera-facing left flank (-X).
  const lx = -0.0402;
  m.at([lx, 0.072, 0.075], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.095, 0.013, 0xd8c896));
  m.at([lx, 0.024, 0.07], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.082, 0.010, 0xb8b498));
  m.at([lx, 0.066, -0.27], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.095, 0.015, 0xd0a832));
  m.at([lx, 0.036, -0.34], [0, -Math.PI / 2, 0], () => m.decal('warn', 0.018, 0.018, 0xd8b43c));
  m.at([lx, 0.068, -0.45], [0, -Math.PI / 2, 0], () => m.decal('arrow', 0.026, 0.016, 0xd8d0a4));
}

/** Heavy slotted twin-rail machined steel launch trough, recoil buffer springs & iron lead sight. */
function launchTrough(m: Mesher): void {
  // Heavy trough base channel bed.
  m.use(F.steelDark);
  m.at([0, TROUGH_Y - 0.016, -0.19], null, () =>
    m.front(
      poly(
        [
          [-0.032, -0.006],
          [0.032, -0.006],
          [0.032, 0.006],
          [0.014, 0.006],
          [0.011, 0.001],
          [-0.011, 0.001],
          [-0.014, 0.006],
          [-0.032, 0.006],
        ],
        0.0012,
      ),
      0.70,
      { bevel: 0.0014 },
    ),
  );
  // Darkened inner guide track floor.
  m.use(F.black);
  m.at([0, TROUGH_Y - 0.0145, -0.19], null, () =>
    m.front(rect(-0.011, -0.001, 0.011, 0.001, 0.0003), 0.68, { bevel: 0 }),
  );

  // Twin parallel machined steel slotted launch rails flanking the harpoon shaft.
  const railProfile = poly(
    [
      [0.16, TROUGH_Y - 0.012],
      [0.16, TROUGH_Y + 0.017, 0.003],
      [-0.53, TROUGH_Y + 0.017, 0.003],
      [-0.555, TROUGH_Y + 0.006, 0.004],
      [-0.555, TROUGH_Y - 0.012, 0.003],
    ],
    0.002,
  );
  m.mirror(() => {
    m.use(F.steel);
    m.at([0.0235, 0, 0], null, () =>
      m.side(railProfile, 0.0105, {
        bevel: 0.0016,
        holes: slotRow(-0.49, TROUGH_Y + 0.003, 0.06, TROUGH_Y + 0.003, 8, 0.044, 0.0105, 0),
      }),
    );
    // Machined upper guide lip retaining the harpoon shaft while keeping the top wide open.
    m.use(F.steelDark);
    m.at([0.019, TROUGH_Y + 0.0185, -0.20], null, () =>
      m.front(poly([[-0.006, -0.002], [0.008, -0.002], [0.008, 0.003], [-0.004, 0.003]], 0.0008), 0.68, { bevel: 0.0007 }),
    );
  });

  // Heavy forged front muzzle launch yoke & brass wear bushing at z = -0.535.
  m.at([0, TROUGH_Y, -0.535], null, () => {
    m.use(F.parkerized);
    m.front(
      poly(
        [
          [-0.044, -0.024],
          [0.044, -0.024],
          [0.046, 0.016, 0.005],
          [0.032, 0.028, 0.005],
          [0.015, 0.028, 0.003],
          [0.015, 0.008, 0.002],
          [0.012, -0.008, 0.003],
          [-0.012, -0.008, 0.003],
          [-0.015, 0.008, 0.002],
          [-0.015, 0.028, 0.003],
          [-0.032, 0.028, 0.005],
          [-0.046, 0.016, 0.005],
        ],
        0.002,
      ),
      0.044,
      { bevel: 0.002 },
    );
    // Brass lower channel guide liner where the harpoon glides out.
    m.use(F.brass);
    m.at([0, -0.011, 0], null, () =>
      m.front(poly([[-0.013, -0.004], [0.013, -0.004], [0.015, 0.004], [-0.015, 0.004]], 0.0008), 0.048, { bevel: 0.0008 }),
    );
  });

  // Twin exposed chrome hydraulic guide rods & heavy steel recoil buffer springs flanking the rails.
  m.mirror(() => {
    // Front & rear spring bulkhead collars.
    m.use(F.steelDark);
    for (const z of [-0.51, -0.14]) {
      m.at([0.040, TROUGH_Y - 0.002, z], null, () =>
        m.front(circle(0, 0, 0.0135, 16), 0.016, { bevel: 0.0014 }),
      );
      m.use(F.brass);
      m.at([0.040, TROUGH_Y - 0.002, z + (z < -0.3 ? -0.010 : 0.010)], null, () =>
        m.lathe([[0, 0.004, 0], [0.0085, 0.004], [0.0095, -0.004], [0, -0.004, 0]], 12, { chamfer: 0.0007 }),
      );
      m.use(F.steelDark);
    }
    // Gleaming chrome guide rod running inside the coil spring.
    m.use(F.chrome);
    m.at([0.040, TROUGH_Y - 0.002, -0.325], null, () => m.cyl(0.0048, 0.36, 12));
    // Heavy industrial coiled recoil buffer spring.
    m.at([0.040, TROUGH_Y - 0.002, -0.325], null, () => coil(m, 0.0102, 0.0020, 0.33, 18, F.steel));
  });

  // Rear breech pneumatic actuator cylinder & brass cap behind the launch trough.
  m.at([0, TROUGH_Y, 0.195], null, () => {
    m.use(F.anodized);
    m.lathe(
      [
        [0, 0.088, 0],
        [0.025, 0.088],
        [0.0285, 0.078],
        [0.0285, -0.025],
        [0.024, -0.036],
        [0.014, -0.042],
        [0.014, -0.048, 0],
      ],
      24,
      { chamfer: 0.0014 },
    );
    m.use(F.brass);
    m.lathe([[0, 0.098, 0], [0.018, 0.098], [0.020, 0.088], [0, 0.088, 0]], 18, { chamfer: 0.0012 });
    m.use(F.steelDark);
    for (const z of [0.008, 0.042, 0.070]) {
      m.at([0, 0, z], null, () =>
        m.lathe([[0.028, 0.0035, 0], [0.031, 0.0035], [0.031, -0.0035], [0.028, -0.0035, 0]], 24),
      );
    }
  });

  // Short top accessory rail aft of the open channel.
  m.at([0, TROUGH_Y + 0.028, 0.18], null, () => rail(m, 0.04, -0.03, 0.022, F.anodized));

  // Iron lead sight: rugged folding nautical-style ring & post sight on top-left of the muzzle yoke.
  m.at([-0.030, TROUGH_Y + 0.028, -0.525], null, () => {
    m.use(F.steelDark);
    // Mounting stanchion & protective ears.
    m.front(
      poly(
        [
          [-0.012, -0.006],
          [0.012, -0.006],
          [0.014, 0.026, 0.002],
          [0.009, 0.026, 0.0015],
          [0.009, 0.005, 0.0015],
          [-0.009, 0.005, 0.0015],
          [-0.009, 0.026, 0.0015],
          [-0.014, 0.026, 0.002],
        ],
        0.001,
      ),
      0.014,
      { bevel: 0.0009 },
    );
    // Sight post + brass collar + thin inset warm amber glow bead.
    m.use(F.brass);
    m.front(rect(-0.0022, 0.003, 0.0022, 0.021, 0.0006), 0.006, { bevel: 0.0005 });
    m.glow('sight', () =>
      m.at([0, 0.0225, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0018, 0.0024, 10, 0)),
    );
  });

  // Matching rear offset iron peep sight aligned with the front lead sight.
  m.at([-0.030, TROUGH_Y + 0.026, 0.09], null, () => {
    m.use(F.steelDark);
    m.front(
      poly(
        [
          [-0.011, -0.006],
          [0.011, -0.006],
          [0.011, 0.022, 0.002],
          [0.005, 0.022, 0.001],
          [0.004, 0.012, 0.001],
          [-0.004, 0.012, 0.001],
          [-0.005, 0.022, 0.001],
          [-0.011, 0.022, 0.002],
        ],
        0.001,
      ),
      0.012,
      { bevel: 0.0009 },
    );
  });
}

/** Underslung steel-cable winch cradle, rotating weathered brass winch drum, ratchet & front fairlead eye. */
function winchAndFairlead(m: Mesher): void {
  // Bolted steel yoke arms holding the winch drum beneath the chassis (open sides so the brass drum shines!).
  const arm = poly(
    [
      [WINCH_Z + 0.055, 0.016],
      [WINCH_Z + 0.024, WINCH_Y - 0.018, 0.008],
      [WINCH_Z - 0.024, WINCH_Y - 0.018, 0.008],
      [WINCH_Z - 0.055, 0.016],
    ],
    0.004,
  );
  m.mirror(() => {
    m.use(F.steelDark);
    m.at([0.044, 0, 0], null, () =>
      m.side(arm, 0.010, {
        bevel: 0.0018,
        holes: [circle(WINCH_Z, WINCH_Y, 0.012, 16)],
      }),
    );
    // Machined brass axle bearing cap outside the yoke arm.
    m.at([0.050, WINCH_Y, WINCH_Z], [0, Math.PI / 2, 0], () => {
      m.use(F.brass);
      m.lathe([[0, 0.009, 0], [0.014, 0.009], [0.016, 0.004], [0.016, 0, 0]], 16, { chamfer: 0.001 });
      m.use(F.steelDark);
      m.lathe([[0, 0.011, 0], [0.006, 0.011], [0.006, 0.009, 0]], 6, { chamfer: 0.0005 });
    });
    hexX(m, 0.0495, 0.006, WINCH_Z + 0.036, 1, 0.0032, F.steel);
    hexX(m, 0.0495, 0.006, WINCH_Z - 0.036, 1, 0.0032, F.steel);
  });

  // Protective arched steel bottom skid bar beneath the winch drum.
  m.use(F.parkerized);
  const skidPath: V3[] = [
    [-0.044, WINCH_Y - 0.010, WINCH_Z + 0.048],
    [-0.034, WINCH_Y - 0.050, WINCH_Z + 0.024],
    [0, WINCH_Y - 0.054, WINCH_Z],
    [0.034, WINCH_Y - 0.050, WINCH_Z + 0.024],
    [0.044, WINCH_Y - 0.010, WINCH_Z + 0.048],
  ];
  m.tube(skidPath, 0.0055, { seg: 8, samples: 16 });

  // Rotating weathered brass/bronze winch drum & wound steel cable spool (`part('winch')`).
  m.part('winch', [0, WINCH_Y, WINCH_Z], () => {
    // Central steel axle.
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.010, 0.088, 16));

    // Wound steel-cable spool wrapped tightly around the drum core (ribbed coils via lathe!).
    m.use(F.steel);
    const cableProf: [number, number, number?][] = [[0.010, 0.031, 0], [0.0285, 0.031]];
    const wraps = 12;
    const span = 0.060;
    const step = span / wraps;
    for (let i = 0; i < wraps; i++) {
      const z0 = 0.030 - i * step;
      cableProf.push(
        [0.0318, z0 - step * 0.18],
        [0.0324, z0 - step * 0.50],
        [0.0318, z0 - step * 0.82],
        [0.0285, z0 - step],
      );
    }
    cableProf.push([0.010, -0.031, 0]);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.lathe(cableProf, 26, { chamfer: 0.0003, smooth: 22 }));

    // Heavy weathered brass/bronze end flanges with lightened radial cutouts & rim bolts so rotation reads!
    m.mirror(() => {
      m.use(F.brass);
      m.at([0.0335, 0, 0], [0, Math.PI / 2, 0], () =>
        m.prism(circle(0, 0, 0.043, 28), 0.0068, {
          bevel: 0.0014,
          holes: [
            circle(0.023, 0, 0.0065, 10),
            circle(-0.023, 0, 0.0065, 10),
            circle(0, 0.023, 0.0065, 10),
            circle(0, -0.023, 0.0065, 10),
          ],
        }),
      );
      // Raised bronze rim collar & 6 perimeter bolt lugs that visibly spin!
      m.use(F.copper);
      m.at([0.037, 0, 0], [0, Math.PI / 2, 0], () =>
        m.lathe([[0.036, 0.0022, 0], [0.0435, 0.0022], [0.0435, -0.0022], [0.036, -0.0022, 0]], 28, { chamfer: 0.0006 }),
      );
      m.use(F.steelDark);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        m.at([0.0385, Math.sin(a) * 0.034, Math.cos(a) * 0.034], [0, Math.PI / 2, 0], () =>
          m.prism(ngon(0, 0, 0.0036, 6), 0.004, { bevel: 0.0006 }),
        );
      }
    });

    // Toothed steel ratchet gear wheel on the camera-facing left flank (-X) of the winch drum.
    m.use(F.steelDark);
    const teeth = 14;
    const gearPts: [number, number][] = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.45) / teeth) * Math.PI * 2;
      const a2 = ((i + 0.72) / teeth) * Math.PI * 2;
      gearPts.push([Math.cos(a0) * 0.030, Math.sin(a0) * 0.030]);
      gearPts.push([Math.cos(a1) * 0.039, Math.sin(a1) * 0.039]);
      gearPts.push([Math.cos(a2) * 0.030, Math.sin(a2) * 0.030]);
    }
    m.at([-0.0385, 0, 0], [0, Math.PI / 2, 0], () => m.prism(gearPts, 0.0042, { bevel: 0.0007 }));
  });

  // Left-flank mechanical winch clutch / tensioning lever (`part('lever')`).
  m.part('lever', [-0.046, 0.016, WINCH_Z + 0.036], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.010, 0.009, 14));
    m.at([-0.008, 0, 0], null, () =>
      m.side(poly([[0.008, -0.008], [-0.056, -0.018, 0.004], [-0.056, 0.002, 0.004], [0.008, 0.008]], 0.002), 0.007, {
        bevel: 0.0012,
      }),
    );
    // Brass knurled grip knob & red ratchet release tab on the lever tip.
    m.at([-0.019, -0.008, -0.050], [0, Math.PI / 2, 0], () => {
      knurl(m, 0.0078, 0.018, F.brass, 18, 0.0006);
      m.use(F.red);
      m.at([0, 0, -0.010], null, () => m.cyl(0.0068, 0.004, 14));
    });
  });

  // Steel cable guide eye / fairlead slung under the muzzle bridge (z = -0.525, y = 0.014).
  m.at([0, 0.022, -0.525], null, () => {
    // Forged steel drop-bracket with side stiffening ribs.
    m.use(F.steelDark);
    m.front(
      poly(
        [
          [-0.024, 0.030],
          [0.024, 0.030],
          [0.022, -0.018, 0.006],
          [0.014, -0.028, 0.006],
          [-0.014, -0.028, 0.006],
          [-0.022, -0.018, 0.006],
        ],
        0.003,
      ),
      0.026,
      { bevel: 0.0018, holes: [circle(0, -0.008, 0.012, 18)] },
    );
    // Machined weathered brass fairlead guide eye lining the cable passage.
    m.use(F.brass);
    m.at([0, -0.008, 0], null, () =>
      m.lathe(
        [
          [0.0072, 0.016, 0],
          [0.0138, 0.016],
          [0.0152, 0.011],
          [0.0122, 0.008],
          [0.0122, -0.008],
          [0.0152, -0.011],
          [0.0138, -0.016],
          [0.0072, -0.016, 0],
        ],
        22,
        { chamfer: 0.0009 },
      ),
    );
  });

  // Visible braided steel cable run routed from the bottom of the winch drum forward through the fairlead eye.
  m.use(F.steel);
  m.tube(
    [
      [0, WINCH_Y - 0.031, WINCH_Z - 0.01],
      [0, WINCH_Y - 0.024, -0.25],
      [0, -0.012, -0.34],
      [0, 0.008, -0.45],
      [0, 0.014, -0.535],
    ],
    0.0034,
    { seg: 8, samples: 20 },
  );
}

/** Rear ergonomic firing pistol grip, trigger guard, trigger, and forward angled support foregrip. */
function grips(m: Mesher): void {
  // Curved pistol grip behind the origin (matching stakegun/rocket right-hand socket ergonomics).
  m.use(F.polymerStipple);
  const front = curve([[0.020, 0.002], [0.022, -0.024], [0.029, -0.052], [0.037, -0.080], [0.045, -0.110]], 4);
  const back = curve([[0.098, -0.110], [0.094, -0.078], [0.086, -0.044], [0.082, 0.002]], 4);
  m.side([...front, [0.047, -0.116], [0.096, -0.116], ...back], 0.034, { bevel: 0.0038, smooth: 50 });

  // Sculpted rubberized grip scales with recessed brass screws on both flanks.
  m.mirror(() => {
    m.use(F.rubber);
    m.at([0.0175, 0, 0], null, () =>
      m.side(
        poly(
          [
            [0.032, -0.022],
            [0.056, -0.024, 0.004],
            [0.088, -0.102, 0.004],
            [0.055, -0.104, 0.004],
          ],
          0.003,
        ),
        0.0045,
        { bevel: 0.0012 },
      ),
    );
    screwX(m, 0.0205, -0.036, 0.048, 1, 0.0024, F.brass);
    screwX(m, 0.0205, -0.092, 0.072, 1, 0.0024, F.brass);
  });

  // Steel grip heel cap & lanyard loop.
  m.use(F.steelDark);
  m.at([0, -0.119, 0.071], null, () => m.front(rect(-0.017, -0.004, 0.017, 0.004, 0.0014), 0.056, { bevel: 0.0014 }));

  // Heavy industrial trigger guard with punched loop.
  m.use(F.parkerized);
  m.side(
    poly(
      [
        [-0.044, 0.002],
        [-0.048, -0.022, 0.006],
        [-0.028, -0.038, 0.008],
        [0.030, -0.038, 0.008],
        [0.050, -0.010, 0.004],
        [0.050, 0.002],
      ],
      0.002,
    ),
    0.014,
    {
      bevel: 0.0014,
      holes: [
        poly(
          [
            [-0.038, -0.002],
            [-0.040, -0.020, 0.005],
            [-0.024, -0.032, 0.005],
            [0.022, -0.032, 0.005],
            [0.041, -0.009, 0.003],
            [0.042, -0.002],
          ],
          0.002,
        ),
      ],
    },
  );

  // Brass/steel animated trigger (`part('trigger')`).
  m.part('trigger', [0, 0.000, -0.003], () => {
    m.use(F.brass);
    m.side(
      poly(
        [
          [-0.0038, 0.002],
          [0.0038, 0.002],
          [0.0022, -0.010, 0.002],
          [0.0042, -0.023, 0.0016],
          [0.0005, -0.024, 0.0012],
          [-0.0038, -0.010, 0.003],
        ],
        0.001,
      ),
      0.0078,
      { bevel: 0.0008 },
    );
  });

  // Angled industrial foregrip / handguard saddle positioned forward of the winch (z = -0.35).
  // Sculpted to sit cleanly in the left hand (`HANDS.support` palm facing up against the angled underside).
  m.use(F.steelDark);
  m.side(
    poly(
      [
        [-0.265, 0.020],
        [-0.455, 0.022, 0.004],
        [-0.468, -0.018, 0.006],
        [-0.420, -0.038, 0.008],
        [-0.295, -0.032, 0.008],
        [-0.262, -0.004, 0.005],
      ],
      0.003,
    ),
    0.048,
    { bevel: 0.0024 },
  );
  // Ribbed rubber angled foregrip hand-pad & front index stop.
  m.use(F.rubber);
  m.side(
    poly(
      [
        [-0.285, -0.012],
        [-0.445, -0.014, 0.005],
        [-0.458, -0.042, 0.007],
        [-0.432, -0.056, 0.007],
        [-0.312, -0.046, 0.008],
        [-0.282, -0.026, 0.006],
      ],
      0.003,
    ),
    0.044,
    { bevel: 0.0032, smooth: 36 },
  );
  // Side grip ribs & brass mounting screws on the foregrip.
  m.mirror(() => {
    m.use(F.steelDark);
    for (let i = 0; i < 4; i++) {
      const z = -0.32 - i * 0.028;
      m.at([0.023, -0.032 - i * 0.002, z], null, () =>
        m.side(rect(-0.005, -0.010, 0.005, 0.010, 0.0014), 0.0035, { bevel: 0.0008 }),
      );
    }
    screwX(m, 0.0248, -0.004, -0.295, 1, 0.0026, F.brass);
    screwX(m, 0.0248, -0.004, -0.435, 1, 0.0026, F.brass);
  });
}

function buildGaff(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0015;

  chassis(m);
  launchTrough(m);
  winchAndFairlead(m);
  grips(m);

  // Loaded oversized barbed steel harpoon spear (`part('spear')`).
  m.part('spear', [0, TROUGH_Y, 0.145], () => harpoonSpear(m));

  // Reciprocating rear breech striker ram (`part('ram')`).
  m.part('ram', [0, TROUGH_Y, 0.155], () => {
    m.use(F.chrome);
    m.at([0, 0, 0.042], null, () => m.cyl(0.0105, 0.096, 16));
    m.use(F.steelDark);
    m.at([0, 0, 0], null, () =>
      m.lathe(
        [
          [0, 0.008, 0],
          [0.014, 0.008],
          [0.014, -0.008],
          [0.0095, -0.013],
          [0, -0.013, 0],
        ],
        18,
        { chamfer: 0.0008 },
      ),
    );
    m.at([0, 0, 0.044], null, () => coil(m, 0.0142, 0.0016, 0.072, 7, F.steel));
  });

  // Small brass pressure/cable status rivets on the receiver crown.
  m.mirror(() => {
    for (const z of [-0.46, -0.24, -0.04, 0.12]) {
      m.at([0.028, TROUGH_Y + 0.018, z], [-Math.PI / 2, 0, 0], () => rivet(m, 0.0018, F.brass));
    }
  });

  const model = new Model(m, kit.mats, {
    glows: { sight: [0xff7a22, 7] },
  });

  // Key sockets: muzzle at the launch trough mouth, fairlead at the steel cable guide eye under the muzzle.
  model.socket('muzzle', [0, TROUGH_Y, -0.56]);
  model.socket('fairlead', [0, 0.014, -0.535]);
  // Right firing hand on the curved pistol grip; left support hand cradling the angled foregrip (`HANDS.support`).
  model.hand('gripR', [0.018, -0.048, 0.068], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.004, -0.048, -0.36]);
  // Reload animation hand targets parented to the moving spear and winch clutch lever.
  model.hand('spearHold', [-0.026, -0.014, -0.22], [-0.15, 0.08, -0.98], [0.65, -0.68, -0.32], 'spear');
  model.hand('leverHold', [-0.026, -0.008, -0.048], [-0.45, -0.2, -0.85], [0.75, -0.35, -0.55], 'lever');

  return model;
}

/**
 * Recoil, winch spin, and reload clip for the Gaff harpoon cannon.
 * STRICT ZERO ROLL / TWIST: `gunR.z` and `gunR.y` are NEVER written — only clean linear travel and pitch.
 */
function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09);
  a.glow('sight', 1);

  const t = a.sinceFire;
  const p = a.reload;
  const loaded = a.mag > 0;

  // Rear striker ram slams forward on fire and returns as the pressure cylinder resets.
  const drive = t < 0.48 ? 1 - inOut(seg(t, 0.06, 0.44)) : 0;
  P.ram!.position.z -= drive * 0.22;

  // Harpoon spear is hidden when launched/away (`mag === 0` or right after firing) and slides back in on reload.
  P.spear!.visible = loaded && (t > 0.04 || p >= 0);

  // Brass winch drum visibly spins rapidly forward when paying out cable on fire,
  // or spins steadily backward when reeling in (`a.charge > 0` / `a.spin`).
  let winchAngle = 0;
  if (t < 0.72) {
    winchAngle -= outCubic(seg(t, 0, 0.72)) * Math.PI * 6;
  }
  if (a.charge > 0.01) {
    winchAngle += a.time * 16 * a.charge;
  }
  winchAngle += a.spin;

  // Draw animation: clean vertical lift & pitch only (ZERO roll or twist!).
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.06;
    a.gunP.z += k * 0.04;
    a.gunR.x -= k * 0.14;
    P.ram!.position.z += bump(a.draw, 0.25, 0.95) * 0.045;
  }

  if (p < 0) {
    P.winch!.rotation.x += winchAngle;
    return;
  }

  // Reload sequence (1.9 s):
  // 1) 0.00..0.46: Winch drum winds rapidly backward to retract/spool cable while left hand fetches a fresh harpoon.
  // 2) 0.20..0.64: Left hand brings the oversized barbed spear up into the open twin-rail trough and slides it home.
  // 3) 0.64..0.88: Left hand throws the winch clutch lever to tension the cable and lock the striker ram.
  // 4) 0.88..1.00: Left hand returns to the angled foregrip, gun levels cleanly.
  const windIn = inOut(seg(p, 0.05, 0.48));
  const tensionWind = inOut(seg(p, 0.66, 0.86));
  P.winch!.rotation.x += winchAngle + windIn * Math.PI * 7 + tensionWind * Math.PI * 2.5;

  const sp = P.spear!;
  sp.visible = p >= 0.20 || loaded;
  if (p >= 0.20) {
    const hoist = 1 - inOut(seg(p, 0.20, 0.38));
    const slide = 1 - outCubic(seg(p, 0.36, 0.64));
    sp.position.x += hoist * -0.14;
    sp.position.y += hoist * -0.24 + slide * 0.014;
    sp.position.z += slide * -0.14;
  }

  const seat = p >= 0.62 ? thud(seg(p, 0.62, 0.75)) : 0;
  const rack = hold(p, 0.68, 0.78, 0.84, 0.90);
  P.lever!.rotation.x += rack * 0.45;
  P.ram!.position.z += rack * 0.095;

  // Clean linear + pitch presentation during reload — strictly ZERO roll (`gunR.z`) and ZERO yaw twist (`gunR.y`).
  const present = hold(p, 0.0, 0.14, 0.86, 1.0);
  a.gunP.x -= present * 0.032;
  a.gunP.y -= present * 0.022;
  a.gunP.z += present * 0.055 + seat * 0.018 + rack * 0.010;
  a.gunR.x += present * 0.11 + seat * 0.028;

  const h = a.left;
  h.fingerRate = 34;
  h.to('pouchL', inOut(seg(p, 0.03, 0.18)));
  h.to('spearHold', inOut(seg(p, 0.21, 0.31)));
  h.to('leverHold', inOut(seg(p, 0.63, 0.71)));
  h.to('gripL', inOut(seg(p, 0.88, 1.0)));
  h.shape(HANDS.cup, hold(p, 0.22, 0.30, 0.58, 0.64));
  h.shape(HANDS.pinch, hold(p, 0.66, 0.72, 0.86, 0.91));
}

export function gaffDef(kit: Kit): ViewDef {
  return {
    id: 'gaff',
    model: buildGaff(kit),
    pos: [0.195, -0.172, -0.34],
    rot: [0.022, 0.088, 0],
    sight: [-0.030, TROUGH_Y + 0.0505, -0.525],
    rear: [-0.030, TROUGH_Y + 0.044, 0.09],
    relief: 0.44,
    // Crisp heavy kickback with ZERO roll/yaw twist.
    recoil: { back: 0.082, lift: 0.016, pitch: 0.105, yaw: 0, roll: 0, omega: 26, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.05,
    animate: clip,
  };
}
