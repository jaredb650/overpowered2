/**
 * The Shear: AN-94-inspired delayed-blowback hyperburst assault rifle on key 1.
 *
 * Sleek matte charcoal polymer monocoque outer chassis housing a visibly reciprocating gunmetal inner barrel/pulley
 * carriage (`carriage`), signature 15-degree right-canted dark-plum curved magazine (or 60-round casket with `shearMag`),
 * iconic figure-8 dual-chamber muzzle brake, rotary diopter rear sight, side-dovetail optic bridge, and folding stock.
 *
 * Origin near the top of the pistol grip; muzzle toward -Z.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slot, type V2 } from '../kit/shapes';
import { hexX, knurl, rail, screwX, serrations } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ViewDef } from '../def';
import { OPTIC_GLOWS, acog, acogShade, redDot } from './optics';
import { HANDS } from '../poses';
import { TORCH, weaponLight } from './light';
import { LASER_GLOW, RIFLE_LAM_RANGE, lamSocket, weaponLam } from './laser';

const BORE = 0.048;
/** Vertical offset of the lower recoil-spring guide tube beneath the barrel. */
const GUIDE_Y = 0.029;
const GUARD_REAR = -0.155;
const GUARD_FRONT = -0.385;
/** Shoulder of the standard reciprocating barrel where the figure-8 brake / compensator / suppressor seats. */
const TIP_AT = -0.538;
const MUZZLE = -0.598;
/** Long heavy match barrel (`shearLong`) and shortened carbine barrel (`shearShort`). */
const TIP_LONG = -0.648;
const LONG_SHIFT = TIP_LONG - TIP_AT;
const TIP_SHORT = -0.458;
const SHORT_SHIFT = TIP_SHORT - TIP_AT;
/** Lengths of aftermarket muzzle devices measured forward from `muzzleMount` origin (`TIP_AT`). */
const COMP_LEN = 0.086;
const CAN_LEN = 0.168;
/** Right-cant angle (radians) of the AN-94 magazine well and magazines (tilts bottom toward +X). */
const MAG_CANT = 0.25;
/** Top deck of the side-dovetail optic rail bridge. */
const OPTIC_AT = [0, 0.085, -0.025] as const;

/** Sleek matte charcoal glass-filled polyamide outer receiver & folding stock. */
const POLY_DARK: Finish = { color: 0x262930, rough: 0.56, metal: 0.06, wear: 0.34 };
/** Brushed cold-blued gunmetal steel for the reciprocating barrel/pulley carriage & dovetail rail. */
const RECEIVER_STEEL: Finish = { color: 0x424852, rough: 0.35, metal: 0.88, wear: 0.38, kind: Kind.brushed };
/** Classic dark plum-black Izhmash-style polymer for the canted curved & casket magazines. */
const PLUM_MAG: Finish = { color: 0x3b2a33, rough: 0.46, metal: 0.08, wear: 0.26 };
/** Brushed dark titanium alloy for the flared canted `shearMagwell`. */
const MAGWELL_ALLOY: Finish = { color: 0x525864, rough: 0.32, metal: 0.84, wear: 0.34, kind: Kind.brushed };

/**
 * Outer stationary polymer monocoque shell and fore-end sleeve: sleek tapered AN-94 profile with recessed cooling
 * slots, contoured grip shelves, right-canted magazine throat, and folding polymer stock.
 */
function outerChassis(m: Mesher): void {
  // Main sleek receiver hull (stationary outer sleeve through which the inner steel carriage recoils).
  m.use(POLY_DARK);
  const hull = poly([
    [0.148, 0.012, 0.004], [0.156, 0.056, 0.007], [0.136, 0.074, 0.006],
    [-0.142, 0.074, 0.004], [-0.162, 0.066, 0.004], [GUARD_FRONT, 0.058, 0.005],
    [GUARD_FRONT - 0.014, 0.044, 0.004], [GUARD_FRONT - 0.008, 0.017, 0.005],
    [-0.155, 0.010, 0.004], [0.065, 0.009, 0.004],
  ], 0.0025);
  const vents = [0, 1, 2, 3].map(i => slot(-0.205 - i * 0.042, 0.042, -0.228 - i * 0.042, 0.042, 0.0042, 4));
  m.side(hull, 0.036, { bevel: 0.0022, smooth: 50, holes: vents });

  // Dark inner recess visible behind the fore-end vents & reciprocating slide track.
  m.use(F.black);
  m.at([0, 0.044, -0.275], null, () => m.box(0.028, 0.028, 0.215, 0.001));

  // Tapered polymer dust-cover spine & forward handguard top bevel.
  m.use(POLY_DARK);
  m.at([0, 0.076, -0.005], null, () => m.top(rect(-0.0148, -0.14, 0.0148, 0.14, 0.0045), 0.006, { bevel: 0.0016 }));

  // Sculpted side-receiver reinforcement ribs & grip-shelf stippling along the fore-end.
  m.use(F.polymerStipple);
  m.mirror(() => {
    m.at([0.0185, 0.027, -0.275], null, () => m.box(0.0024, 0.016, 0.185, 0.001));
  });
  m.at([0, 0.011, -0.275], null, () => m.box(0.026, 0.005, 0.195, 0.0018));

  // Left-side steel dovetail mounting plate & thin inset cyan hyperburst-ready status line (CLAUDE.md: thin inset only).
  m.use(RECEIVER_STEEL);
  m.at([-0.0195, 0.046, -0.015], null, () => m.box(0.0036, 0.016, 0.115, 0.001));
  m.use(F.black);
  m.at([-0.0192, 0.062, -0.015], null, () => m.box(0.0012, 0.003, 0.048, 0.0002));
  m.glow('status', () => m.at([-0.0198, 0.062, -0.015], null, () => m.box(0.0007, 0.0013, 0.042, 0)));

  // Side-mounted anodized Picatinny optic bridge wrapping cleanly over the dust cover for Red Dot & ACOG.
  m.use(F.anodized);
  m.at([-0.0215, 0.064, -0.022], null, () => m.box(0.0045, 0.036, 0.078, 0.001));
  m.at([-0.010, 0.081, -0.022], null, () => m.box(0.024, 0.005, 0.112, 0.001));
  m.at([0, 0.0835, 0], null, () => rail(m, 0.052, -0.105, 0.019, F.anodized));

  // Right-side ejection port window with dark inner breech recess.
  m.use(F.black);
  m.at([0.0184, 0.052, -0.024], null, () => m.box(0.0018, 0.016, 0.074, 0.0004));

  // Structural hex pins & rivets along the receiver flanks.
  m.mirror(() => {
    screwX(m, 0.0188, 0.025, 0.118, 1, 0.0022);
    screwX(m, 0.0188, 0.025, -0.132, 1, 0.0022);
    screwX(m, 0.0188, 0.064, 0.095, 1, 0.0018);
    screwX(m, 0.0188, 0.028, -0.365, 1, 0.0018);
  });

  // Left & right mini-rail pads near the fore-end nose for `shearLight` and `shearLam`.
  m.use(F.anodized);
  m.at([-0.0195, 0.036, -0.335], [0, 0, Math.PI / 2], () => rail(m, -0.024, 0.024, 0.014, F.anodized));
  m.at([0.0195, 0.036, -0.335], [0, 0, -Math.PI / 2], () => rail(m, -0.024, 0.024, 0.014, F.anodized));

  // Original stencil markings (no real brands/logos).
  m.at([-0.0188, 0.031, 0.058], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.042, 0.0048, 0x8e95a0));
  m.at([-0.0188, 0.031, -0.112], [0, -Math.PI / 2, 0], () => m.decal('op2', 0.022, 0.0055, 0x8e95a0));

  // Right-canted magazine housing throat under the receiver belly (`z = -0.102`).
  m.use(POLY_DARK);
  m.at([0.004, 0.006, -0.102], [0, 0, MAG_CANT], () => {
    m.top(rect(-0.0165, -0.0355, 0.0165, 0.0355, 0.003), 0.018, {
      bevel: 0.0014,
      holes: [rect(-0.0124, -0.0308, 0.0124, 0.0308, 0.0018)],
    });
  });
  // Steel paddle magazine release behind the canted well.
  m.use(F.steelDark);
  m.at([0.003, -0.008, -0.062], [-0.22, 0, MAG_CANT], () => m.box(0.014, 0.022, 0.007, 0.0012));

  // Sleek AN-94 right-folding polymer stock & ribbed rubber buttpad.
  m.use(F.steelDark);
  m.at([0.014, 0.044, 0.156], null, () => m.cyl(0.0072, 0.048, 14));
  m.use(POLY_DARK);
  const stockProf = poly([
    [0.156, 0.066, 0.005], [0.355, 0.056, 0.007], [0.358, -0.052, 0.007],
    [0.328, -0.054, 0.005], [0.162, 0.016, 0.005],
  ], 0.003);
  const stockCut = poly([
    [0.21, 0.046, 0.004], [0.326, 0.038, 0.004], [0.326, -0.026, 0.004], [0.21, 0.014, 0.004],
  ], 0.003);
  m.side(stockProf, 0.028, { bevel: 0.0026, smooth: 45, holes: [stockCut] });
  m.use(F.rubber);
  m.at([0, 0.002, 0.362], null, () => m.box(0.034, 0.112, 0.014, 0.0032));
}

/** Ergonomic AK/AN-94 swept polymer pistol grip and generous bevelled trigger guard. */
function gripAndGuard(m: Mesher): void {
  const front = curve([[0.048, 0.010], [0.055, -0.022], [0.062, -0.062], [0.072, -0.104]], 5);
  const back = curve([[0.112, -0.104], [0.100, -0.064], [0.092, -0.024], [0.092, 0.012]], 5);
  m.use(POLY_DARK);
  m.side([...front, [0.075, -0.112], [0.108, -0.112], ...back], 0.032, { bevel: 0.0042, smooth: 55 });

  // Stippled side grip panels for tactile contrast.
  const sF = curve([[0.055, -0.016], [0.063, -0.056], [0.072, -0.094]], 4);
  const sB = curve([[0.104, -0.094], [0.094, -0.056], [0.088, -0.016]], 4);
  m.use(F.polymerStipple);
  m.side([...sF, ...sB], 0.0342, { bevel: 0.002, smooth: 45 });

  // Bevelled trigger guard loop enclosing the trigger.
  m.use(F.steelDark);
  const guard = poly([
    [-0.048, 0.010], [-0.044, -0.020, 0.006], [-0.022, -0.034, 0.008],
    [0.058, -0.034, 0.006], [0.062, -0.018], [0.054, -0.018],
    [0.050, -0.026, 0.004], [-0.018, -0.026, 0.005], [-0.036, -0.014, 0.004], [-0.038, 0.010],
  ], 0.0018);
  m.side(guard, 0.014, { bevel: 0.0012 });

  // Standard left-thumb fire selector lever.
  m.use(F.steelDark);
  m.at([-0.021, 0.024, 0.055], [0.15, 0, 0], () => m.box(0.0038, 0.0065, 0.026, 0.001));
}

/**
 * Reciprocating AN-94 barrel/pulley carriage (`carriage`): the entire barrel, lower spring guide tube, gas block,
 * hooded front sight post, and `muzzleMount` sit inside this part and recoil rearward inside the outer chassis on fire!
 */
function reciprocatingCarriage(m: Mesher): void {
  m.part('carriage', [0, 0, 0], () => {
    // Exposed gunmetal internal pulley rail & recoil spring guide rod running beneath the barrel (`GUIDE_Y = 0.029`).
    m.use(RECEIVER_STEEL);
    m.at([0, GUIDE_Y, 0], null, () => {
      m.lathe([
        [0.0072, -0.35, 0], [0.0072, -0.452], [0.0062, -0.458], [0.0062, -0.464], [0, -0.464, 0],
      ], 16);
    });
    // Forward bridge clamp linking barrel and lower guide rod.
    m.use(F.anodized);
    m.at([0, 0.038, -0.432], null, () => m.box(0.016, 0.028, 0.024, 0.0018));

    // Standard reciprocating barrel (`barrelStd`), hidden when `shearLong` or `shearShort` is fitted.
    m.part('barrelStd', [0, BORE, 0], () => {
      m.use(F.barrel);
      m.lathe([
        [0.0102, -0.34, 0], [0.0102, -0.435], [0.0088, -0.442], [0.0088, TIP_AT], [0.0075, TIP_AT, 0],
      ], 22);
      // Forward gas block + iconic AN-94 hooded front sight tower.
      frontSightTower(m, -0.448);
    });

    // Long heavy match reciprocating barrel (`shearLong`, +11 cm).
    m.part('barrelLong', [0, BORE, 0], () => {
      m.use(F.barrel);
      m.lathe([
        [0.0112, -0.34, 0], [0.0112, -0.46], [0.0102, -0.472], [0.0102, TIP_LONG], [0.008, TIP_LONG, 0],
      ], 24);
      // Match barrel cooling flutes.
      m.use(F.steelDark);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        m.at([Math.cos(a) * 0.0101, Math.sin(a) * 0.0101, -0.56], [0, 0, a], () => {
          m.box(0.0012, 0.002, 0.135, 0.0003);
        });
      }
      frontSightTower(m, -0.525);
    });

    // Shortened CQB reciprocating barrel (`shearShort`, -8 cm).
    m.part('barrelShort', [0, BORE, 0], () => {
      m.use(F.barrel);
      m.lathe([
        [0.0102, -0.34, 0], [0.0102, -0.42], [0.009, -0.426], [0.009, TIP_SHORT], [0.0075, TIP_SHORT, 0],
      ], 22);
      frontSightTower(m, -0.415);
    });

    // Muzzle mount anchored at `TIP_AT` inside `carriage` so barrel-length mods shift EVERY muzzle device cleanly!
    m.part('muzzleMount', [0, BORE, TIP_AT], () => {
      // Signature AN-94 figure-8 dual-chamber muzzle brake (`muzzleStd`, hidden by `shearBrake` or `shearCan`).
      m.part('muzzleStd', [0, 0, 0], () => {
        m.use(F.barrelBlack);
        // Threaded collar & upper/lower twin-lobed figure-8 expansion body.
        m.lathe([
          [0.0094, 0.004, 0], [0.0114, -0.002], [0.0114, -0.016], [0.010, -0.018],
          [0.010, -0.056], [0.0092, -0.060], [0.0052, -0.060, 0],
        ], 20);
        // Upper and lower circular figure-8 lobes that define the AN-94 muzzle silhouette.
        m.at([0, 0.0068, -0.036], null, () => m.cyl(0.0086, 0.036, 18));
        m.at([0, -0.0068, -0.036], null, () => m.cyl(0.0086, 0.036, 18));
        // Side gas-vent channels between the two lobes + deep dark bore.
        m.use(F.black);
        m.mirror(() => {
          m.at([0.0092, 0.0068, -0.036], null, () => m.box(0.003, 0.0048, 0.022, 0));
          m.at([0.0092, -0.0068, -0.036], null, () => m.box(0.003, 0.0048, 0.022, 0));
        });
        m.lathe([[0.0052, -0.0598, 0], [0.0046, -0.03, 0], [0, -0.028, 0]], 14);
      });

      // Tuned 4-port linear compensator (`shearBrake`).
      m.part('brakeComp', [0, 0, 0], () => {
        m.use(RECEIVER_STEEL);
        m.at([0, 0, -COMP_LEN / 2], null, () => m.box(0.023, 0.020, COMP_LEN, 0.0026));
        m.use(F.black);
        m.mirror(() => {
          for (let i = 0; i < 4; i++) {
            m.at([0.0112, 0, -0.016 - i * 0.017], null, () => m.box(0.0036, 0.011, 0.0075, 0.0004));
          }
        });
        // Top bleed ports for flat sustained fire.
        for (let i = 0; i < 3; i++) {
          m.at([0, 0.0102, -0.022 - i * 0.018], null, () => m.cyl(0.0024, 0.002, 10));
        }
        m.lathe([[0.0054, -COMP_LEN + 0.0005, 0], [0.0048, -COMP_LEN + 0.032, 0], [0, -COMP_LEN + 0.034, 0]], 14);
      });

      // Fluted dark quick-detach suppressor (`shearCan`).
      m.part('can', [0, 0, 0], () => {
        m.use(F.anodized);
        m.lathe([
          [0.011, 0.004, 0], [0.0168, -0.006], [0.0168, -CAN_LEN + 0.006], [0.015, -CAN_LEN], [0.0056, -CAN_LEN, 0],
        ], 26);
        m.use(F.steelDark);
        m.at([0, 0, -0.016], null, () => knurl(m, 0.0172, 0.016, F.steelDark, 20, 0.0005));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          m.at([Math.cos(a) * 0.0166, Math.sin(a) * 0.0166, -0.098], [0, 0, a], () => {
            m.box(0.0016, 0.0028, 0.112, 0.0004);
          });
        }
        m.use(F.black);
        m.lathe([[0.0056, -CAN_LEN + 0.0005, 0], [0.005, -CAN_LEN + 0.036, 0], [0, -CAN_LEN + 0.038, 0]], 14);
      });
    });
  });
}

/** Hooded AN-94 front sight tower (built in barrel-local coordinates where y = 0 is BORE). */
function frontSightTower(m: Mesher, z: number): void {
  m.at([0, 0, z], null, () => {
    m.use(F.steelDark);
    m.at([0, 0.017, 0], null, () => m.box(0.012, 0.026, 0.022, 0.0014));
    // Protective circular hood around the luminous green tritium front post.
    m.at([0, 0.044, 0], null, () => m.pipe(0.0115, 0.0092, 0.018, 22));
    m.at([0, 0.039, 0], null, () => m.box(0.0024, 0.009, 0.003, 0.0004));
    m.glow('sight', () => m.at([0, 0.045, 0.001], null, () => m.box(0.002, 0.0022, 0.0014, 0)));
  });
}

/** Rear AN-94 star-wheel diopter iron sight (`irons`, hidden when Red Dot or ACOG is fitted). */
function ironRearSight(m: Mesher): void {
  m.part('irons', [0, 0.084, 0.122], () => {
    m.use(F.steelDark);
    m.box(0.024, 0.010, 0.026, 0.0012);
    // Protective angled side ears flanking the rotary diopter wheel.
    m.mirror(() => {
      m.at([0.011, 0.011, 0], null, () => m.box(0.0032, 0.018, 0.018, 0.0008));
    });
    // Signature AN-94 star-aperture diopter drum.
    m.use(RECEIVER_STEEL);
    m.at([0, 0.010, 0], null, () => m.pipe(0.0068, 0.0034, 0.005, 16));
    m.at([0.0145, 0.003, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0052, 0.004, F.steelDark, 10, 0.0004));
  });
}

/**
 * Right-canted 15-degree dark-plum curved 30-round magazine (`magStd`) and wide quad-stack 60-round casket magazine
 * (`magExt` for `shearMag`).
 */
function magazine(m: Mesher): void {
  m.part('mag', [0.004, 0.006, -0.102], () => {
    m.at([0, 0, 0], [0, 0, MAG_CANT], () => {
      // Standard 30-round gently curved plum-polymer magazine.
      m.part('magStd', [0, 0, 0], () => {
        m.use(PLUM_MAG);
        const front = curve([[-0.028, 0.024], [-0.030, -0.045], [-0.038, -0.115], [-0.052, -0.185]], 6);
        const back = curve([[0.004, -0.195], [0.016, -0.122], [0.024, -0.048], [0.026, 0.024]], 6);
        m.side([...front, ...back], 0.0235, { bevel: 0.0024, smooth: 45 });
        // Molded spine ribs & steel floorplate.
        m.use(F.steelDark);
        m.at([0, -0.192, -0.024], [0.22, 0, 0], () => m.box(0.026, 0.009, 0.058, 0.0016));
        m.use(F.brass);
        m.part('follower', [0, -0.012, -0.004], () => {
          m.box(0.016, 0.006, 0.042, 0.001);
        });
      });

      // Extended 60-round quad-stack casket magazine (`shearMag`): wider lower body, iconic AN-94 pairing.
      m.part('magExt', [0, 0, 0], () => {
        m.use(PLUM_MAG);
        // Upper double-stack neck fitting the receiver throat.
        m.at([0, -0.012, 0], null, () => m.box(0.024, 0.068, 0.056, 0.002));
        // Wide flared quad-stack casket belly.
        const front = curve([[-0.029, -0.036], [-0.034, -0.102], [-0.046, -0.172], [-0.060, -0.222]], 6);
        const back = curve([[-0.002, -0.232], [0.012, -0.174], [0.022, -0.104], [0.026, -0.036]], 6);
        m.side([...front, ...back], 0.042, { bevel: 0.0032, smooth: 45 });
        // Structural waffle ribs on the wide casket flanks.
        m.use(F.polymer);
        m.mirror(() => {
          for (let i = 0; i < 4; i++) {
            m.at([0.0215, -0.075 - i * 0.038, -0.006 - i * 0.007], [0.18, 0, 0], () => {
              m.box(0.0022, 0.0055, 0.052, 0.0006);
            });
          }
        });
        m.use(F.steelDark);
        m.at([0, -0.228, -0.030], [0.22, 0, 0], () => m.box(0.045, 0.010, 0.062, 0.0018));
      });
    });
  });
}

/**
 * Mechanical mod parts visible in both first-person and shop studio:
 * - `burst3` (`shearBurst3`): sleek low-profile steel pulley-clockwork rib & brass tension wheel (stays AN-94, never boxy!).
 * - `fastSear` (`shearFast`): overdrive full-auto sear block with red indicator bar.
 * - `magwell` (`shearMagwell`): flared CNC alloy funnel canted at `MAG_CANT`.
 */
function modParts(m: Mesher): void {
  // Sleek 3-round pulley-clockwork tensioner housing along the upper-left receiver flank (`shearBurst3`).
  m.part('burst3', [0, 0, 0], () => {
    m.use(RECEIVER_STEEL);
    m.at([-0.020, 0.068, -0.115], null, () => m.box(0.006, 0.012, 0.148, 0.0016));
    // Exposed brass pulley wheel & steel tension cable rib.
    m.use(F.brass);
    m.at([-0.0235, 0.068, -0.172], [0, Math.PI / 2, 0], () => knurl(m, 0.0065, 0.0036, F.brass, 12, 0.0005));
    m.at([-0.0235, 0.068, -0.058], [0, Math.PI / 2, 0], () => knurl(m, 0.0058, 0.0036, F.brass, 12, 0.0005));
    m.use(F.steel);
    m.at([-0.0235, 0.068, -0.115], null, () => m.box(0.0018, 0.0022, 0.106, 0.0004));
    // Three brass index notches for 3-round hyperburst.
    m.use(F.brass);
    for (let i = 0; i < 3; i++) {
      m.at([-0.0232, 0.0725, -0.095 - i * 0.007], null, () => m.box(0.0012, 0.0032, 0.0028, 0.0003));
    }
  });

  // Overdrive 800 RPM sear & selector housing (`shearFast`), mutually exclusive with `shearBurst3`.
  m.part('fastSear', [0, 0, 0], () => {
    m.mirror(() => {
      m.use(F.steelDark);
      m.at([0.0205, 0.024, 0.048], null, () => m.box(0.0052, 0.020, 0.044, 0.0012));
      m.use(F.bureauRed);
      m.at([0.0234, 0.020, 0.048], null, () => m.box(0.001, 0.0036, 0.024, 0.0002));
      hexX(m, 0.0232, 0.030, 0.062, 1, 0.0015);
      hexX(m, 0.0232, 0.018, 0.034, 1, 0.0015);
    });
  });

  // Flared CNC titanium-alloy canted magwell funnel (`shearMagwell`).
  m.part('magwell', [0.004, 0.006, -0.102], () => {
    m.at([0, 0, 0], [0, 0, MAG_CANT], () => {
      m.use(MAGWELL_ALLOY);
      m.at([0, -0.006, 0], null, () => m.top(rect(-0.020, -0.039, 0.020, 0.039, 0.004), 0.012, {
        bevel: 0.0016,
        holes: [rect(-0.0135, -0.0315, 0.0135, 0.0315, 0.002)],
      }));
      m.at([0, -0.016, 0], null, () => m.top(rect(-0.025, -0.044, 0.025, 0.044, 0.0055), 0.010, {
        bevel: 0.0022,
        holes: [rect(-0.0145, -0.0325, 0.0145, 0.0325, 0.0024)],
      }));
      m.use(F.steelDark);
      m.mirror(() => {
        hexX(m, 0.021, -0.006, 0.026, 1, 0.0016);
        hexX(m, 0.021, -0.006, -0.026, 1, 0.0016);
      });
    });
  });
}

interface Built {
  model: Model;
  mods: ViewDef['mods'];
}

function buildShear(kit: Kit): Built {
  const m = kit.mesher();
  m.bevel = 0.0014;
  outerChassis(m);
  gripAndGuard(m);
  reciprocatingCarriage(m);
  ironRearSight(m);
  magazine(m);
  modParts(m);

  const dot = redDot(m, OPTIC_AT);
  const scope = acog(m, OPTIC_AT);

  // Reciprocating bolt carrier visible in the right ejection port.
  m.part('bolt', [0.0165, 0.052, -0.024], () => {
    m.use(F.steel);
    m.box(0.0036, 0.014, 0.056, 0.0008);
  });

  // Left-side non-reciprocating ergonomic charging handle for fast left-hand bolt racks.
  m.part('charge', [-0.021, 0.056, -0.145], () => {
    m.use(F.steelDark);
    m.box(0.007, 0.0055, 0.014, 0.0008);
    m.at([-0.0085, 0, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0048, 0.015, F.anodized, 14, 0.0005));
    m.at([-0.0165, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0054, 0.0022, 12));
  });

  // Crisp curved trigger.
  m.part('trigger', [0, 0.006, 0.006], () => {
    m.use(F.steelDark);
    m.side(poly([
      [-0.0035, 0.002], [0.0035, 0.002], [0.0022, -0.010, 0.002], [0.004, -0.023, 0.0015],
      [0.0006, -0.024, 0.001], [-0.0035, -0.010, 0.003],
    ], 0.001), 0.0064, { bevel: 0.0007 });
  });

  // Weapon light & laser sight on opposite fore-end rails.
  weaponLight(m, [-0.0355, 0.036, -0.335], -Math.PI / 2);
  weaponLam(m, [0.0355, 0.036, -0.335], Math.PI / 2);

  const model = new Model(m, kit.mats, {
    glows: { sight: [0x7dff5a, 6], status: [0x39e0ff, 4], torch: TORCH, laser: LASER_GLOW, ...OPTIC_GLOWS },
  });
  acogShade(model);
  lamSocket(model);

  // Muzzle sockets parented inside `muzzleMount` / devices so they follow both the reciprocating carriage AND barrel shifts!
  model.socket('muzzle', [0, 0, MUZZLE - TIP_AT - 0.004], [0, 0, 0], 'muzzleMount');
  model.socket('muzzleBrake', [0, 0, -COMP_LEN - 0.004], [0, 0, 0], 'brakeComp');
  model.socket('muzzleCan', [0, 0, -CAN_LEN - 0.004], [0, 0, 0], 'can');
  model.socket('eject', [0.021, 0.054, -0.024]);

  // Hand poses: right hand on the swept pistol grip, left hand cradling the contoured polymer fore-end.
  model.hand('gripR', [0.018, -0.054, 0.072], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.001, 0.011, -0.275]);
  model.hand('magHold', [-0.016, -0.072, -0.006], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.grasp('chargeHold', [-0.018, -0.006, 0.004], [0.95, 0.26, -0.15], [0.2, 0.12, -0.97], 'charge');

  const mods: ViewDef['mods'] = {
    shearDot: dot,
    shearAcog: scope,
    shearBurst3: { part: 'burst3' },
    shearFast: { part: 'fastSear' },
    shearMag: { part: 'magExt', hides: 'magStd' },
    shearMagwell: { part: 'magwell' },
    shearLight: { part: 'light' },
    shearLam: { part: 'lam', laser: 'lam', laserRange: RIFLE_LAM_RANGE },
    // Muzzle devices before barrels so `muzzleCan` / `muzzleBrake` win when combined with long or short barrel.
    shearBrake: { part: 'brakeComp', hides: 'muzzleStd', muzzle: 'muzzleBrake' },
    shearCan: { part: 'can', hides: 'muzzleStd', muzzle: 'muzzleCan' },
    shearLong: { part: 'barrelLong', hides: 'barrelStd', moves: { part: 'muzzleMount', z: LONG_SHIFT } },
    shearShort: { part: 'barrelShort', hides: 'barrelStd', moves: { part: 'muzzleMount', z: SHORT_SHIFT } },
  };
  return { model, mods };
}

/** Travel of the reciprocating barrel/pulley carriage and bolt carrier. */
const CARRIAGE_TRAVEL = 0.034;
const BOLT_TRAVEL = 0.056;

function clip(a: Anim): void {
  const P = a.parts;

  // Signature AN-94 delayed-blowback pulse: the entire barrel + front sight + muzzle carriage slides rearward cleanly!
  const cycle = 0.072;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const kick = Math.sin(c * Math.PI);
  P.carriage!.position.z += kick * CARRIAGE_TRAVEL;
  P.bolt!.position.z += kick * BOLT_TRAVEL;
  pullTrigger(a, 0.055, 0.28);

  if (P.follower) P.follower.position.y -= fill(a) * 0.11;
  a.glow('sight', a.mods?.has('shearAcog') || a.mods?.has('shearDot') ? 0 : 1);
  a.glow('status', 0.8 + (1 - c) * 0.7);

  // Clean draw lift with ZERO roll or yaw twist.
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.062;
    a.gunR.x -= k * 0.42;
  }

  const p = a.reload;
  if (p < 0) return;

  // Clean reload with strictly ZERO roll (gunR.z === 0) and ZERO yaw twist (gunR.y === 0).
  const fromEmpty = a.reloadFromEmpty || a.mag <= 0;
  const mag = P.mag!;
  const h = a.left;
  h.fingerRate = 38;

  if (fromEmpty) {
    const out = seg(p, 0.05, 0.22);
    const inn = seg(p, 0.36, 0.52);
    const away = inQuad(out) * (1 - outCubic(inn));
    mag.rotation.x -= Math.min(1, away * 3) * 0.28;
    mag.position.y -= away * 0.34;
    mag.position.x += away * 0.08;
    mag.position.z -= away * 0.04;
    if (p > 0.24 && p < 0.35) mag.visible = false;
    const seat = p >= 0.515 ? thud(seg(p, 0.515, 0.64)) : 0;
    const rack = bump(p, 0.73, 0.90);
    P.charge!.position.z += rack * BOLT_TRAVEL;
    P.bolt!.position.z += rack * BOLT_TRAVEL;
    P.carriage!.position.z += rack * 0.014;

    const present = hold(p, 0.0, 0.14, 0.88, 1);
    a.gunR.x += present * 0.14 + seat * 0.05 - rack * 0.04;
    a.gunP.x -= present * 0.025;
    a.gunP.y += present * 0.032 + seat * 0.012;
    a.gunP.z += present * 0.045 + rack * 0.014;

    h.to('magHold', inOut(seg(p, 0.0, 0.07)));
    h.to('pouchL', inOut(seg(p, 0.20, 0.30)));
    h.to('magHold', inOut(seg(p, 0.35, 0.46)));
    h.to('chargeHold', inOut(seg(p, 0.63, 0.73)));
    h.to('gripL', inOut(seg(p, 0.90, 1)));
    h.shape(HANDS.cup, hold(p, 0.01, 0.07, 0.56, 0.62));
    h.shape(HANDS.pinch, hold(p, 0.67, 0.73, 0.88, 0.94));
  } else {
    const out = seg(p, 0.06, 0.26);
    const inn = seg(p, 0.44, 0.63);
    const away = inQuad(out) * (1 - outCubic(inn));
    mag.rotation.x -= Math.min(1, away * 3) * 0.28;
    mag.position.y -= away * 0.34;
    mag.position.x += away * 0.08;
    mag.position.z -= away * 0.04;
    if (p > 0.28 && p < 0.42) mag.visible = false;
    const seat = p >= 0.625 ? thud(seg(p, 0.625, 0.76)) : 0;

    const present = hold(p, 0.0, 0.14, 0.80, 1);
    a.gunR.x += present * 0.12 + seat * 0.05;
    a.gunP.x -= present * 0.022;
    a.gunP.y += present * 0.028 + seat * 0.012;
    a.gunP.z += present * 0.038;

    h.to('magHold', inOut(seg(p, 0.0, 0.08)));
    h.to('pouchL', inOut(seg(p, 0.24, 0.36)));
    h.to('magHold', inOut(seg(p, 0.42, 0.54)));
    h.to('gripL', inOut(seg(p, 0.72, 0.96)));
    h.shape(HANDS.cup, hold(p, 0.02, 0.08, 0.68, 0.76));
  }
}

export function shearDef(kit: Kit): ViewDef {
  const { model, mods } = buildShear(kit);
  return {
    id: 'shear',
    model,
    pos: [0.138, -0.132, -0.42],
    rot: [0.02, 0.075, 0],
    // Base ADS: hooded tritium front post centered inside the rear AN-94 star-wheel diopter aperture.
    sight: [0, BORE + 0.045, -0.448],
    rear: [0, 0.094, 0.122],
    relief: 0.62,
    // Crisp straight-back shifted-pulse recoil feel (tight pitch, minimal yaw/roll).
    recoil: { back: 0.028, lift: 0.002, pitch: 0.012, yaw: 0.004, roll: 0.004, omega: 54, zeta: 0.68 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.015,
    mods,
    irons: 'irons',
    animate: clip,
  };
}
