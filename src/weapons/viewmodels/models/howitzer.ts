/**
 * Shoulder-Fired 105mm Howitzer: recoilless single-shot portable field artillery on key 3.
 * Matte olive-drab & brushed ordnance steel, dark parkerized forged breech & heat-shield clamps, and machined brass
 * pressure rings, locking lugs, and 105 mm cartridge. Features a flared rear venturi, hinged breech cradle, hydraulic
 * long-recoil barrel with oversized 3-baffle artillery muzzle brake, side optical rangefinder, and twin pistol grips.
 * Origin sits at the top of the rear grip; the 105 mm bore rides above it on the shoulder.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { circle, curve, ngon, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { clampBand, hexX, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

const AXIS = 0.088;
const R = 0.056;
const BREECH_Z0 = -0.005;
const BREECH_Z1 = -0.245;
/** How far the hinged breech cover swings open to the right during reload. */
const BREECH_OPEN = 2.05;
/** Hydraulic recoil travel of the 105 mm barrel and muzzle brake on each shot. */
const RECOIL_SLAM = 0.095;

function arcShell(m: Mesher, r: number, z0: number, z1: number, a0: number, a1: number, thick: number): void {
  const zc = (z0 + z1) / 2;
  const n = 18;
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([Math.cos(a) * (r - thick), Math.sin(a) * (r - thick)]);
  }
  m.at([0, 0, zc], null, () => m.prism(pts, Math.abs(z1 - z0), { bevel: 0.0014, smooth: 30 }));
}

function venturiAndBreech(m: Mesher): void {
  m.at([0, AXIS, 0], null, () => {
    // Flared recoilless venturi exhaust cone behind the breech.
    m.use(F.parkerized);
    m.lathe(
      [
        [R - 0.004, 0.37, 0],
        [0.076, 0.362],
        [0.080, 0.336],
        [0.066, 0.275],
        [R + 0.003, 0.235],
        [R + 0.003, 0.16],
        [R + 0.006, 0.155],
        [R + 0.006, 0.132],
        [R + 0.003, 0.128],
        [R + 0.003, BREECH_Z0 + 0.014, 0],
      ],
      36,
      { chamfer: 0.0016, smooth: 24 },
    );
    // Machined brass pressure collar around the venturi throat.
    m.use(F.brass);
    m.lathe(
      [
        [0.068, 0.278, 0],
        [0.0725, 0.274],
        [0.0725, 0.252],
        [0.060, 0.246, 0],
      ],
      36,
      { chamfer: 0.001 },
    );
    // Dark exhaust bore interior.
    m.use(F.black);
    m.lathe([[R - 0.004, 0.37, 0], [0, 0.29, 0]], 24);

    // Lower forged breech cradle: stays fixed while the hinged upper cover swings open.
    m.use(F.steelDark);
    arcShell(m, R + 0.003, BREECH_Z0 + 0.014, BREECH_Z1 - 0.014, Math.PI * 1.02, Math.PI * 1.98, 0.0075);
    m.use(F.black);
    arcShell(m, R - 0.006, BREECH_Z0 + 0.012, BREECH_Z1 - 0.012, Math.PI * 1.0, Math.PI * 2.0, 0.0025);

    // Heavy octagonal breech bulkheads fore and aft of the loading port.
    for (const z of [BREECH_Z0 + 0.016, BREECH_Z1 - 0.016]) {
      m.use(F.parkerized);
      m.at([0, 0, z], null, () => {
        m.front(ngon(0, 0, R + 0.013, 8, Math.PI / 8), 0.022, {
          bevel: 0.0016,
          holes: [circle(0, 0, R - 0.006, 28)],
        });
      });
      // Brass locking lug collars flanking each bulkhead.
      m.use(F.brass);
      m.at([0, 0, z], null, () => {
        m.mirror(() => {
          m.at([R + 0.011, 0, 0], null, () => m.box(0.008, 0.018, 0.014, 0.0012));
        });
      });
    }

    // Perforated olive-drab heat jacket ahead of the breech.
    m.use(F.olive);
    m.at([0, 0, -0.39], null, () => {
      m.front(ngon(0, 0, R + 0.008, 8, Math.PI / 8), 0.26, {
        bevel: 0.0018,
        holes: [circle(0, 0, R - 0.003, 28)],
      });
    });
    // Recessed cooling vent plates along the left and right flanks of the heat shield.
    m.use(F.oliveDark);
    m.mirror(() => {
      m.at([R + 0.0065, 0, -0.39], null, () => {
        m.side(rect(-0.105, -0.024, 0.105, 0.024, 0.003), 0.004, {
          bevel: 0.0009,
          holes: slotRow(-0.088, 0, 0.088, 0, 5, 0.032, 0.009, Math.PI / 2),
        });
      });
    });
    m.use(F.black);
    m.mirror(() => {
      m.at([R + 0.0042, 0, -0.39], null, () => m.box(0.0014, 0.036, 0.196, 0));
    });

    // Heavy forged clamp bands binding the heat jacket and rear venturi.
    for (const z of [0.09, -0.295, -0.49]) {
      m.at([0, 0, z], null, () => clampBand(m, R + 0.008, 0.018, F.steelDark));
    }
    // Hydraulic recuperator cylinders tucked beneath the lower flanks of the heat jacket.
    m.mirror(() => {
      m.at([0.042, -(R + 0.006), -0.405], null, () => {
        m.use(F.parkerized);
        m.cyl(0.014, 0.25, 18);
        m.use(F.brass);
        m.at([0, 0, -0.128], null, () => m.cyl(0.0155, 0.014, 18));
        m.at([0, 0, 0.128], null, () => m.cyl(0.0155, 0.012, 18));
      });
    });

    // Top hazard stencil along the heat jacket.
    m.at([0, R + 0.0095, -0.39], [-Math.PI / 2, 0, -Math.PI / 2], () => m.decal('hazard', 0.11, 0.018, 0xc9a227));
  });

  // Ordnance stencils along the camera-facing left flank.
  const onLeft = (a: number, z: number, fn: () => void) =>
    m.at([-Math.cos(a) * (R + 0.009), AXIS + Math.sin(a) * (R + 0.009), z], [0, -Math.PI / 2, 0], () =>
      m.at([0, 0, 0], [a, 0, 0], fn),
    );
  onLeft(0.35, -0.44, () => m.decal('he', 0.044, 0.016, 0xd8c35a));
  onLeft(0.35, -0.34, () => m.decal('arrow', 0.032, 0.02, 0xd8d0a0));
  onLeft(0.45, 0.06, () => m.decal('crucible', 0.095, 0.013, 0xc8c4a0));
  onLeft(0.12, 0.08, () => m.decal('serial', 0.09, 0.01, 0xb0ad90));
  onLeft(0.12, -0.41, () => m.decal('warn', 0.022, 0.022, 0xd8c35a));
}

function barrelAndBrake(m: Mesher): void {
  // Recoiling assembly: heavy turned 105 mm ordnance barrel, recuperator rods, and 3-baffle rectangular artillery brake.
  m.part('barrel', [0, AXIS, 0], () => {
    m.use(F.barrel);
    m.lathe(
      [
        [R - 0.006, -0.26, 0],
        [R - 0.005, -0.52],
        [R - 0.008, -0.526],
        [R - 0.008, -0.56],
        [0.046, -0.568],
        [0.043, -0.715],
        [0.048, -0.72],
        [0.048, -0.742],
        [0.037, -0.742],
        [0.037, -0.26, 0],
      ],
      36,
      { chamfer: 0.0012 },
    );
    // Dark rifled bore interior.
    m.use(F.black);
    m.lathe([[0.037, -0.745, 0], [0.0355, -0.26, 0]], 28);

    // Brushed steel recuperator piston rods coupling the barrel collar to the lower cylinders.
    m.mirror(() => {
      m.use(F.steel);
      m.at([0.042, -(R + 0.006), -0.585], null, () => m.cyl(0.0072, 0.13, 14));
      m.use(F.parkerized);
      m.at([0.042, -(R + 0.006) * 0.52, -0.648], null, () => m.box(0.018, 0.068, 0.022, 0.0018, 0.003));
    });

    // Oversized 3-baffle perforated rectangular artillery muzzle brake (z = -0.742 to -0.928).
    const brakeZ = -0.835;
    m.at([0, 0, brakeZ], null, () => {
      // Heavy chamfered top and bottom brake rails framing the 3 blast chambers.
      m.use(F.barrelBlack);
      for (const sy of [-1, 1]) {
        m.at([0, sy * 0.047, 0], null, () => m.box(0.134, 0.022, 0.186, 0.0024, 0.005));
      }
      // Perforated side baffle cheeks with three big rectangular blast vents cut cleanly through.
      m.use(F.barrel);
      m.mirror(() => {
        m.at([0.061, 0, 0], null, () => {
          m.side(rect(-0.093, -0.056, 0.093, 0.056, 0.006), 0.014, {
            bevel: 0.0018,
            holes: [
              rect(-0.074, -0.034, -0.034, 0.034, 0.004),
              rect(-0.020, -0.034, 0.020, 0.034, 0.004),
              rect(0.034, -0.034, 0.074, 0.034, 0.004),
            ],
          });
        });
      });
      // Thick internal baffle divider plates with the 105 mm bore punched straight through them.
      m.use(F.steelDark);
      for (const dz of [-0.084, -0.027, 0.027, 0.084]) {
        m.at([0, 0, dz], null, () => {
          m.front(rect(-0.062, -0.052, 0.062, 0.052, 0.005), 0.014, {
            bevel: 0.0014,
            holes: [circle(0, 0, 0.039, 28)],
          });
        });
      }
      // Corner rivets and brass lock collar on the brake body.
      m.mirror(() => {
        for (const dz of [-0.084, -0.027, 0.027, 0.084]) {
          m.at([0.068, 0.044, dz], [0, Math.PI / 2, 0], () => rivet(m, 0.0022));
          m.at([0.068, -0.044, dz], [0, Math.PI / 2, 0], () => rivet(m, 0.0022));
        }
      });
      m.use(F.brass);
      m.at([0, 0, 0.094], null, () => m.cyl(0.051, 0.011, 30));
    });
  });
}

function breechCover(m: Mesher): void {
  // Hinged on the right so opening it clears the shooter's view into the 105 mm loading cradle.
  m.part('breech', [R + 0.005, AXIS + 0.004, 0], () => {
    m.at([-(R + 0.005), -0.004, 0], null, () => {
      m.use(F.olive);
      arcShell(m, R + 0.0045, BREECH_Z0, BREECH_Z1, -0.04, Math.PI * 1.02, 0.0075);
      // Heavy transverse stiffening ribs.
      m.use(F.oliveDark);
      for (const z of [-0.045, -0.125, -0.205]) {
        m.at([0, 0, z], null, () =>
          m.lathe(
            [
              [R + 0.004, 0.008, 0],
              [R + 0.0085, 0.008],
              [R + 0.0085, -0.008],
              [R + 0.004, -0.008, 0],
            ],
            30,
            { a0: 0, a1: Math.PI, chamfer: 0.0012 },
          ),
        );
      }
      for (let i = 0; i < 5; i++) {
        const a = 0.58 + i * 0.48;
        m.at([Math.cos(a) * (R + 0.005), Math.sin(a) * (R + 0.005), -0.012], [0, Math.PI / 2, a], () => rivet(m, 0.002));
        m.at([Math.cos(a) * (R + 0.005), Math.sin(a) * (R + 0.005), -0.238], [0, Math.PI / 2, a], () => rivet(m, 0.002));
      }
      // Left-side heavy breech latch with red release bar.
      m.use(F.steelDark);
      m.at([-(R + 0.014), 0.012, -0.125], null, () => m.box(0.014, 0.014, 0.056, 0.0018, 0.003));
      m.use(F.red);
      m.at([-(R + 0.022), 0.012, -0.125], null, () => m.box(0.0034, 0.008, 0.04, 0.0009));
    });
    // Machined brass hinge pin running the full breech length.
    m.use(F.brass);
    m.at([0, 0, -0.125], null, () => m.cyl(0.005, 0.245, 14));
  });
}

function artilleryShell(m: Mesher): void {
  // Huge 105 mm brass-and-steel artillery shell: base at z = 0, pointed HE ogive forward along -Z.
  m.part('shell', [0, AXIS, -0.015], () => {
    // Turned brass cartridge casing with rimmed extractor flange.
    m.use(F.brass);
    m.lathe(
      [
        [0, 0.002, 0],
        [0.045, 0.002],
        [0.045, -0.008],
        [0.041, -0.012],
        [0.042, -0.018],
        [0.0415, -0.145],
        [0.039, -0.16, 0],
      ],
      30,
      { chamfer: 0.0008 },
    );
    // Copper driving band.
    m.use(F.copper);
    m.lathe([[0.039, -0.16, 0], [0.0405, -0.163], [0.0405, -0.175], [0.0385, -0.178, 0]], 30, { chamfer: 0.0004 });
    // Olive-drab HE projectile body & ogive.
    m.use({ ...F.olive, color: 0x5c6642 });
    const ogive: [number, number, number?][] = [[0.0385, -0.178, 0], [0.0385, -0.235]];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      ogive.push([0.0385 * (1 - t ** 1.65) + 0.007, -0.235 - t * 0.115, 0]);
    }
    m.lathe(ogive, 28, { chamfer: 0, smooth: 40 });
    // Yellow high-explosive identification band.
    m.use(F.yellow);
    m.lathe([[0.0389, -0.215, 0], [0.0393, -0.218], [0.0393, -0.234], [0.0388, -0.236, 0]], 28, { chamfer: 0 });
    // Brushed steel point-detonating nose fuze.
    m.use(F.steel);
    m.lathe([[0.0072, -0.35, 0], [0.006, -0.372], [0.0025, -0.382], [0, -0.384, 0]], 16, { chamfer: 0 });
  });
}

function optic(m: Mesher): void {
  // Side-mounted artillery optical rangefinder on the left flank so ADS aligns cleanly down the bore.
  m.at([-0.068, AXIS + 0.04, -0.17], null, () => {
    // Forged bracket out from the left breech wall.
    m.use(F.parkerized);
    m.at([0.024, -0.032, 0], null, () =>
      m.side(poly([[0.058, 0], [-0.058, 0], [-0.046, 0.022, 0.006], [0.046, 0.022, 0.006]], 0.002), 0.034, { bevel: 0.0014 }),
    );
    m.at([0.034, -0.032, 0], null, () => {
      m.use(F.steelDark);
      m.box(0.026, 0.009, 0.115, 0.0012);
    });
    // Hollow optical body so the eye looks cleanly through the bore during ADS.
    m.use(F.anodized);
    m.front(rect(-0.024, -0.02, 0.024, 0.032, 0.006), 0.16, {
      bevel: 0.0016,
      holes: [circle(0, 0.006, 0.017, 26)],
    });
    m.use(F.polymerGrey);
    m.mirror(() =>
      m.at([0.0248, 0, 0], null, () =>
        m.side(rect(-0.064, -0.013, 0.064, 0.023, 0.003), 0.0024, {
          bevel: 0.0008,
          holes: [rect(-0.052, -0.006, -0.012, 0.016, 0.0018), rect(0.0, -0.006, 0.052, 0.016, 0.0018)],
        }),
      ),
    );
    m.mirror(() => {
      screwX(m, 0.0258, 0.019, 0.058, 1, 0.0018);
      screwX(m, 0.0258, -0.009, -0.058, 1, 0.0018);
    });
    // Objective bell & coated glass lens forward.
    m.at([0, 0.006, -0.08], null, () => {
      m.use(F.rubber);
      m.lathe([[0.022, 0.004, 0], [0.0255, 0], [0.026, -0.02], [0.024, -0.032], [0.0205, -0.033], [0.0195, -0.02, 0]], 26);
      m.glass(() => m.at([0, 0, -0.013], null, () => m.cyl(0.0194, 0.0006, 20, 0)));
    });
    // Rubber eyecup and thin warm-amber inset reticle at the rear.
    m.at([0, 0.006, 0.08], null, () => {
      m.use(F.rubber);
      m.lathe([[0.0195, 0.032, 0], [0.0235, 0.032], [0.0245, 0.012], [0.0215, 0], [0.0185, 0, 0]], 24);
      m.glow('reticle', () =>
        m.at([0, 0, 0.0052], null, () => {
          m.prism(rect(-0.0085, -0.00032, 0.0085, 0.00032, 0), 0.0002, { bevel: 0 });
          m.prism(rect(-0.00032, -0.0085, 0.00032, 0.006, 0), 0.0002, { bevel: 0 });
          // Two subtle ballistic stadia ticks below center.
          m.prism(rect(-0.004, -0.0036, 0.004, -0.003, 0), 0.0002, { bevel: 0 });
          m.prism(rect(-0.0025, -0.0064, 0.0025, -0.0058, 0), 0.0002, { bevel: 0 });
        }),
      );
    });
    // Left-flank ballistic readout screen.
    m.at([-0.0256, 0.004, 0.02], [0, -Math.PI / 2, 0], () => {
      m.use(F.polymerGrey);
      m.prism(rect(-0.028, -0.014, 0.028, 0.014, 0.002), 0.0018, { bevel: 0.0006 });
      m.use(F.black);
      m.at([0, 0, 0.0008], null, () => m.prism(rect(-0.0256, -0.0118, 0.0256, 0.0118, 0.0012), 0.0008, { bevel: 0 }));
      m.at([0, 0, 0.0014], null, () => m.screen('range', 0.048, 0.022));
    });
    // Knurled elevation drum with brass vernier cap on top of the optic.
    m.at([0, 0.032, -0.012], [Math.PI / 2, 0, 0], () => {
      knurl(m, 0.0105, 0.011, F.steelDark, 22, 0.0005);
      m.use(F.brass);
      m.at([0, 0, -0.006], null, () => m.cyl(0.0108, 0.0022, 20));
    });
  });

  // Braided fire-control conduit down from the optic to the trigger box.
  m.use(F.rubber);
  m.tube(
    [[-0.052, AXIS + 0.02, -0.10], [-0.062, AXIS - 0.018, -0.04], [-0.054, AXIS - 0.062, 0.025], [-0.024, -0.002, 0.05], [-0.018, 0.002, 0.062]],
    0.0026,
    { seg: 8, samples: 26 },
  );
  m.use(F.brass);
  m.at([-0.018, 0.0, 0.062], [0.9, 0, 0], () => m.cyl(0.0044, 0.012, 12));
}

function curveGrip(): V2[] {
  const f = curve([[-0.018, 0], [-0.021, -0.032], [-0.022, -0.064], [-0.018, -0.102]], 4);
  const b = curve([[0.022, -0.102], [0.024, -0.064], [0.022, -0.032], [0.018, 0]], 4);
  return [...f, ...b];
}

function gripsAndHardware(m: Mesher): void {
  // Rear fire-control housing and trigger grip under the breech.
  m.use(F.parkerized);
  m.side(poly([[0.105, 0.032], [0.105, 0, 0.006], [0.09, -0.012, 0.006], [-0.078, -0.012, 0.006], [-0.105, 0.032]], 0.003), 0.048, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.01], [0.021, -0.036], [0.028, -0.06], [0.036, -0.082], [0.044, -0.112]], 4);
  const back = curve([[0.098, -0.112], [0.094, -0.08], [0.086, -0.045], [0.08, -0.01]], 4);
  m.side([...front, [0.046, -0.118], [0.096, -0.118], ...back], 0.033, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1205, 0.071], null, () => m.box(0.033, 0.006, 0.056, 0.0014, 0.003));
  // Heavy trigger guard.
  m.use(F.steelDark);
  m.side(
    poly([[-0.038, -0.012], [-0.042, -0.03, 0.006], [-0.024, -0.044, 0.008], [0.03, -0.044, 0.008], [0.05, -0.016, 0.004], [0.05, -0.012]], 0.002),
    0.013,
    {
      bevel: 0.0013,
      holes: [poly([[-0.032, -0.014], [-0.034, -0.028, 0.005], [-0.021, -0.038, 0.005], [0.022, -0.038, 0.005], [0.041, -0.0155, 0.003], [0.042, -0.014]], 0.002)],
    },
  );
  m.at([0, 0.032, 0], null, () => {
    m.use(F.steelDark);
    m.box(0.054, 0.014, 0.22, 0.0014);
  });
  m.mirror(() => {
    hexX(m, 0.0245, 0.01, 0.078, 1, 0.0036);
    hexX(m, 0.0245, 0.01, -0.056, 1, 0.0036);
  });

  // Brass-and-red arming selector lever on the left side.
  m.part('lever', [-0.0255, 0.012, 0.012], () => {
    m.use(F.brass);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0065, 0.0034, 14));
    m.use(F.red);
    m.at([-0.002, 0, -0.013], null, () => m.box(0.003, 0.0054, 0.026, 0.0009));
  });

  // Forward support grip clamped to the front of the heat jacket.
  const fgZ = -0.34;
  m.at([0, AXIS, fgZ], null, () => {
    m.use(F.parkerized);
    m.lathe([[R + 0.007, 0.018, 0], [R + 0.012, 0.018], [R + 0.012, -0.018], [R + 0.007, -0.018, 0]], 36, { chamfer: 0.0014 });
  });
  m.use(F.parkerized);
  m.at([0, AXIS - R - 0.016, fgZ], null, () => m.box(0.034, 0.018, 0.04, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, AXIS - R - 0.024, fgZ], null, () => {
    m.side(curveGrip(), 0.031, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, AXIS - R - 0.132, fgZ + 0.006], null, () => m.box(0.035, 0.006, 0.048, 0.0014, 0.003));

  // Heavy contoured rubber shoulder rest under the rear tube.
  m.use(F.rubber);
  m.at([0, AXIS - R - 0.009, 0.135], null, () =>
    m.side(poly([[0.095, 0.006], [0.095, -0.01, 0.006], [0.078, -0.026, 0.008], [-0.078, -0.026, 0.008], [-0.095, -0.01, 0.006], [-0.095, 0.006]], 0.002), 0.056, {
      bevel: 0.003,
    }),
  );

  // Top-right steel carry handle with rubber grip sleeve, plus short rear accessory rail.
  m.use(F.steelDark);
  const path: V3[] = [
    [0.036, AXIS + R + 0.004, -0.34],
    [0.042, AXIS + R + 0.034, -0.315],
    [0.042, AXIS + R + 0.038, -0.22],
    [0.042, AXIS + R + 0.034, -0.12],
    [0.036, AXIS + R + 0.004, -0.09],
  ];
  m.tube(path, 0.0052, { seg: 10, samples: 28, tension: 0.4 });
  m.use(F.rubber);
  m.tube([[0.042, AXIS + R + 0.038, -0.265], [0.042, AXIS + R + 0.038, -0.165]], 0.008, { seg: 12, samples: 4 });
  m.use(F.parkerized);
  for (const z of [-0.34, -0.09]) {
    m.at([0.034, AXIS + R + 0.002, z], null, () => m.box(0.024, 0.007, 0.024, 0.0014, 0.003));
  }
  m.at([0, AXIS + R + 0.004, 0.14], null, () => rail(m, 0.055, -0.055, 0.0212, F.anodized));
}

function buildHowitzer(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  venturiAndBreech(m);
  barrelAndBrake(m);
  breechCover(m);
  artilleryShell(m);
  optic(m);
  gripsAndHardware(m);
  m.part('trigger', [0, -0.0125, -0.002], () => {
    m.use(F.steelDark);
    m.side(
      poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001),
      0.0065,
      { bevel: 0.0007 },
    );
  });

  const model = new Model(m, kit.mats, {
    glows: { reticle: [0xffa828, 2.4] },
    screens: { range: [168, 76] },
  });
  model.socket('muzzle', [0, AXIS, -0.94]);
  model.socket('eject', [0.05, AXIS + 0.045, -0.10]);
  model.hand('gripR', [0.018, -0.052, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.foregrip('gripL', [-0.018, AXIS - R - 0.08, -0.34]);
  model.hand('latch', [-0.084, AXIS + 0.024, -0.125], [-0.1, 0.3, -0.95], [0.9, -0.3, -0.25], 'breech');
  model.hand('shellHold', [-0.032, -0.038, -0.16], [-0.1, 0.1, -0.98], [0.75, 0.55, -0.1], 'shell');
  model.hand('leverHold', [-0.036, 0.014, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'lever');
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
  pullTrigger(a, 0.11);
  const p = a.reload;
  const loaded = a.mag > 0;
  P.shell!.visible = loaded;
  a.glow('reticle', loaded ? 0.96 + 0.04 * Math.sin(a.time * 9) : 0.25);

  // Hydraulic barrel recoil: slams straight back into the recuperators, then runs smoothly forward.
  if (a.sinceFire < 0.45) {
    const back = outCubic(seg(a.sinceFire, 0, 0.055)) * (1 - inOut(seg(a.sinceFire, 0.075, 0.42)));
    P.barrel!.position.z += back * RECOIL_SLAM;
    const rock = bump(a.sinceFire, 0.015, 0.45);
    a.gunR.z -= rock * 0.045;
    a.gunP.y -= rock * 0.012;
  }

  if (a.draw < 1) {
    // Heaved smoothly onto the shoulder without rolling or twisting.
    const d = 1 - outCubic(a.draw);
    a.gunP.x += d * 0.065;
    a.gunP.y -= d * 0.04;
    a.gunR.y -= d * 0.26;
    P.lever!.rotation.x -= bump(a.draw, 0.55, 1) * 0.75;
  }
  if (p < 0) return;

  // Timed to reloadFoley: [[0.12, 'reload_bolt'], [0.55, 'reload_shell_in'], [0.84, 'metal_clang']].
  const open = outCubic(seg(p, 0.07, 0.17)) * (1 - inQuad(seg(p, 0.74, 0.84)));
  const slam = p >= 0.84 ? thud(seg(p, 0.84, 0.94)) : 0;
  P.breech!.rotation.z -= (open + slam * 0.03) * BREECH_OPEN;

  // Fresh 105 mm brass shell lifted from the hip, laid in the cradle, and shoved forward into the chamber.
  const rise = inOut(seg(p, 0.22, 0.48));
  const shove = inOut(seg(p, 0.50, 0.66));
  P.shell!.visible = p > 0.20;
  const sh = P.shell!;
  sh.position.y += (1 - rise) * -0.40 + (1 - shove) * 0.055;
  sh.position.x += (1 - rise) * -0.19;
  sh.position.z += (1 - shove) * 0.20 + (1 - rise) * 0.04;
  sh.rotation.x += (1 - rise) * 0.55;
  sh.rotation.z += (1 - rise) * 0.6;

  // Subtle tilt toward the left hand during loading, settling cleanly on the breech slam.
  const present = hold(p, 0, 0.14, 0.82, 0.96);
  a.gunR.z += present * 0.24;
  a.gunR.x += present * 0.05 + slam * 0.022;
  a.gunP.x -= present * 0.06;
  a.gunP.y -= present * 0.042 - slam * 0.012;
  a.gunP.z += present * 0.075;

  const lever = bump(p, 0.86, 0.97);
  P.lever!.rotation.x -= lever * 0.9;

  const h = a.left;
  h.fingerRate = 36;
  h.to('latch', inOut(seg(p, 0.0, 0.08)));
  h.to('shellHold', inOut(seg(p, 0.11, 0.26)));
  h.to('latch', inOut(seg(p, 0.70, 0.76)));
  h.to('leverHold', inOut(seg(p, 0.84, 0.89)));
  h.to('gripL', inOut(seg(p, 0.93, 1)));
  h.shape(HANDS.cup, hold(p, 0.20, 0.27, 0.65, 0.70));
  h.shape(HANDS.foregrip, hold(p, 0.02, 0.06, 0.08, 0.12));
  h.shape(HANDS.foregrip, hold(p, 0.72, 0.76, 0.93, 0.98));
}

export function howitzerDef(kit: Kit): ViewDef {
  return {
    id: 'howitzer',
    model: buildHowitzer(kit),
    pos: [0.26, -0.22, -0.37],
    rot: [0.01, 0.07, 0],
    // ADS: eye aligned cleanly through the side optical rangefinder's amber reticle.
    sight: [-0.068, AXIS + 0.046, -0.0848],
    relief: 0.1,
    recoil: { back: 0.105, lift: 0.022, pitch: 0.095, yaw: 0.014, roll: 0.032, omega: 20, zeta: 0.54 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.65,
    animate: clip,
    readout,
  };
}
