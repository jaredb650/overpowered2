/**
 * The Retraining Annex shantytown ("Graduation"): a complete, warmly lit, lived-in settlement built inside a
 * Bureau weapons-proving crater directly north of the glass observation balcony.
 *
 * Every major structure is physics-destructible (multi-node destruction clusters + destructible shacks, stalls,
 * fuel tanks, and barrel dumps), so the Tactical Nuke shockwave obliterates the entire town in a cascading chain
 * reaction right in front of the player.
 */
import {
  buildFountainCluster,
  buildMunitionsShedCluster,
  buildShantyHouseCluster,
  buildWatchtowerCluster,
} from '../../destruction';
import { FACE } from '../../kit/geo';
import { Kit } from '../../kit/kit';
import { fence, signPanel, tank, truck, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import {
  brazier, bulbs, bunting, cableSpool, drumCluster, dryingRack, flag, handcart, loudspeaker,
  marketCanopy, palletStack, rustedWreck, scrapLeanTo, utilityPole, waterTankStilt, wireSpan,
} from '../holdfast/props';
import type { MapSpec } from '../spec';
import { SHACKS, STAND, TOWN, TOWN_HOUSES, TOWN_STALLS, TOWN_SUBJECTS, YARD } from './plan';

type Rgb = readonly [number, number, number];

/** Weathered human settlement paint palette — warm contrast against the cold blue Council facility. */
const PAINTS: readonly Rgb[] = [
  [0.78, 0.56, 0.34], // faded ochre
  [0.72, 0.36, 0.28], // terracotta rust
  [0.44, 0.58, 0.64], // dusty slate teal
  [0.82, 0.76, 0.62], // sun-bleached plaster
  [0.52, 0.62, 0.46], // weathered sage
  [0.76, 0.48, 0.36], // coral clay
  [0.56, 0.48, 0.60], // muted plum
];

const DYES: readonly Rgb[] = [
  [0.86, 0.36, 0.22], // burnt sienna
  [0.92, 0.68, 0.22], // saffron gold
  [0.26, 0.62, 0.68], // coastal cyan
  [0.78, 0.24, 0.32], // crimson cloth
  [0.34, 0.64, 0.44], // market green
  [0.88, 0.50, 0.24], // tangerine
];

const T = 1.2;

/** Ensures decorative clutter never overlaps any of the 20 standing town subjects. */
function clearOfSubjects(x: number, z: number, r: number): boolean {
  for (const [sx, sz] of TOWN_SUBJECTS) {
    if (Math.hypot(x - sx, z - sz) < r + 1.4) return false;
  }
  return true;
}

/** Ground grading: dusty central avenue, cross-street, paved central market plaza, and weathered curbs. */
function streets(k: Kit): void {
  const { x0, x1, z0, cx, cz } = TOWN;
  const g = k.geo;

  // Base packed-earth town ground.
  k.floor('dirt', x0, z0, x1, STAND.z0, 0, 0.6, 4);

  // Main north-south avenue from the south gate into the town square and beyond.
  g.use('asphalt').tint(0.56, 0.52, 0.48);
  g.slab(cx, 0.014, -372, 4.4, 0.014, 24, 4, FACE.py);
  // East-west market cross-street.
  g.slab(cx, 0.012, cz, 38, 0.012, 3.6, 4, FACE.py);
  // Paved central market square surrounding the fountain.
  g.use('concrete').tint(0.68, 0.64, 0.58);
  g.slab(cx, 0.018, cz, 10.5, 0.018, 10.5, 3, FACE.py);
  g.tint(1);

  // Subtle curb borders around the central square and avenue shoulders.
  g.use('concreteDark').tint(0.75);
  for (const sx of [-1, 1]) {
    g.bevel(sx * 4.7, 0.08, -354.5, 0.22, 0.08, 6.2, 0.03);
    g.bevel(sx * 10.7, 0.08, cz, 0.22, 0.08, 10.5, 0.03);
  }
  g.tint(1);
}

/** Ominous Bureau proving-ground containment wall, perimeter fencing, watch masts, and distant telemetry pylons. */
function perimeter(k: Kit): void {
  const { x0, x1, z0 } = TOWN;
  const g = k.geo;
  const wallH = 6.2;

  // Heavy dark Council containment walls framing the proving crater (north, west, east, and south wings flanking the balcony).
  k.mass('concreteDark', x0 - T, 0, z0 - T, x1 + T, wallH, z0, 4);
  k.mass('concreteDark', x0 - T, 0, z0, x0, wallH, YARD.z0, 4);
  k.mass('concreteDark', x1, 0, z0, x1 + T, wallH, YARD.z0, 4);
  k.mass('concreteDark', x0, 0, STAND.z0 - 0.8, STAND.x0, wallH, YARD.z0, 4);
  k.mass('concreteDark', STAND.x1, 0, STAND.z0 - 0.8, x1, wallH, YARD.z0, 4);

  // Angled steel containment buttresses & top chain-link security fence along the north/east/west perimeter.
  for (let x = x0 + 6; x <= x1 - 6; x += 10) {
    g.use('steelDark').bevel(x, wallH * 0.5, z0 + 0.35, 0.45, wallH * 0.5, 0.45, 0.06);
    k.beam(x, 0.2, z0 + 1.4, x, wallH - 0.4, z0 + 0.3, 0.22, 0.22, 'steelDark');
    g.use('emissiveRed').box(x, wallH + 0.15, z0 + 0.4, 0.24, 0.05, 0.04, FACE.pz);
  }
  for (let z = z0 + 8; z <= YARD.z0 - 6; z += 10) {
    for (const side of [-1, 1]) {
      const wx = side < 0 ? x0 : x1;
      g.use('steelDark').bevel(wx - side * 0.35, wallH * 0.5, z, 0.45, wallH * 0.5, 0.45, 0.06);
      g.use('emissiveRed').box(wx - side * 0.4, wallH + 0.15, z, 0.04, 0.05, 0.24);
    }
  }
  // Security fencing atop the containment wall.
  fence(k, [x0, z0 + 0.15, x1, z0 + 0.15], wallH, 2.4, false);
  fence(k, [x0 + 0.15, z0, x0 + 0.15, YARD.z0], wallH, 2.4, false);
  fence(k, [x1 - 0.15, z0, x1 - 0.15, YARD.z0], wallH, 2.4, false);

  // Distant monolithic Bureau proving-ground blast-sensor pylons looming beyond the north wall (silhouette against night sky!).
  for (const [px, pz, h] of [[-32, -412, 24], [-11, -415, 30], [11, -415, 30], [32, -412, 24]] as const) {
    g.use('steelDark').bevel(px, h / 2, pz, 1.3, h / 2, 1.3, 0.12);
    g.use('steel').tint(0.6, 0.68, 0.78).bevel(px, h * 0.62, pz + 1.25, 0.55, h * 0.32, 0.14, 0.04);
    g.tint(1);
    g.use('emissiveRed').box(px, h + 0.3, pz, 0.28, 0.28, 0.28);
    g.use('emissiveCyan').box(px, h * 0.78, pz + 1.4, 0.6, 0.06, 0.04, FACE.pz);
  }

  // Perimeter floodlight masts bathing the proving ground in crisp contrast.
  for (const [x, z, yaw] of [
    [-42, -350, 0.7], [42, -350, -0.7],
    [-42, -376, 1.45], [42, -376, -1.45],
    [-42, -400, 2.4], [42, -400, -2.4],
    [0, -402, Math.PI],
  ] as const) {
    k.mast(x, z, 0, 13.5, yaw, 'white', 120, 44);
  }
}

/** Physics-destructible buildings, shacks, market stalls, watchtowers, fountain, and volatile fuel dumps. */
function buildings(k: Kit, spec: MapSpec): void {
  // 1. Central Market Square Fountain / Anchor Monument (Tier 1 destructible cluster).
  spec.cluster(buildFountainCluster([TOWN.cx, 0, TOWN.cz], {
    tag: 'annex.town.fountain',
    tier: 1,
    label: 'TOWN FOUNTAIN',
  }));

  // 2. Seven Multi-Piece Painted Shanty Houses (Tier 1 physics clusters — collapse into flying slabs on nuke!).
  TOWN_HOUSES.forEach(([x, z, w, d, h, yaw], i) => {
    spec.cluster(buildShantyHouseCluster([x, 0, z], {
      tag: `annex.town.house.${i}`,
      w,
      d,
      h,
      yaw,
      color: PAINTS[i % PAINTS.length]!,
      tier: 1,
      label: 'SHANTY HOUSE',
    }));
  });

  // 3. Two Timber-and-Steel Lookout Watchtowers overlooking the northern half of the settlement.
  for (const [tag, x, z, yaw] of [
    ['annex.town.watchtower.w', -36, -396, 0.25],
    ['annex.town.watchtower.e', 36, -396, -0.25],
  ] as const) {
    spec.cluster(buildWatchtowerCluster([x, 0, z], { tag, yaw, tier: 1, label: 'LOOKOUT TOWER' }));
  }

  // 4. Two Volatile Munitions / Fuel Sheds with Explosive Fuel Tanks & Barrel Dumps (chain-reaction fireballs!).
  spec.cluster(buildMunitionsShedCluster([-32, 0, -356], {
    tag: 'annex.town.fuel.w',
    yaw: Math.PI * 0.4,
    color: PAINTS[1]!,
    tier: 1,
    label: 'FUEL SHED',
  }));
  spec.cluster(buildMunitionsShedCluster([32, 0, -356], {
    tag: 'annex.town.fuel.e',
    yaw: -Math.PI * 0.4,
    color: PAINTS[2]!,
    tier: 1,
    label: 'FUEL SHED',
  }));
  // Fuel storage tanks & volatile drum clusters positioned to erupt across the skyline when the shockwave hits.
  tank(k, -38, -354, 0, 1.9, 4.2, 'rust', { ladder: true, bands: 2, seg: 16 });
  spec.tank(-38, 4.4, -354);
  tank(k, 38, -354, 0, 1.9, 4.2, 'panel', { ladder: true, bands: 2, seg: 16 });
  spec.tank(38, 4.4, -354);
  for (const [bx, bz] of [[-28, -358], [28, -358], [-15, -370], [15, -370], [-20, -388], [20, -388]] as const) {
    spec.barrels(bx, 0, bz, 3, 0.9);
  }

  // 5. Twelve Painted Plank & Corrugated-Sheet Shacks forming tight residential lanes.
  SHACKS.forEach(([x, z, yaw], i) => {
    spec.shack(x, z, yaw, i % 2 === 0 ? 'planks' : 'sheet', 0, PAINTS[(i + 2) % PAINTS.length]);
  });

  // 6. Ten Dyed-Awning Market Stalls lining the central plaza and avenue.
  TOWN_STALLS.forEach(([x, z, yaw], i) => {
    spec.stall(x, z, yaw, 0, DYES[i % DYES.length]);
  });
}

/** Lived-in human storytelling: string lights, bunting, utility poles, glowing braziers, water tanks, stalls, wrecks. */
function lifeAndAtmosphere(k: Kit): void {
  const { cx, cz } = TOWN;

  // 1. Utility poles & sagging overhead power lines + warm orange string lights crisscrossing the town.
  const westLine: readonly [number, number][] = [[-6.5, -350], [-10.5, -363], [-10.5, -381], [-10.5, -394]];
  const eastLine: readonly [number, number][] = [[6.5, -350], [10.5, -363], [10.5, -381], [10.5, -394]];
  for (const run of [westLine, eastLine]) {
    for (let i = 0; i < run.length; i++) {
      const [px, pz] = run[i]!;
      utilityPole(k, px, pz, 7.2, 0, i % 2 === 1);
      if (i + 1 < run.length) {
        const [nx, nz] = run[i + 1]!;
        wireSpan(k, px, 6.7, pz, nx, 6.7, nz, 0.75);
        bulbs(k, px, 5.7, pz, nx, 5.7, nz, 'emissiveOrange', 14);
      }
    }
  }
  // Cross-avenue & diagonal plaza string lights and festive pennant bunting (reads vividly from the Balcony!).
  const crossSpans: readonly (readonly [number, number, number, number])[] = [
    [-6.5, -350, 6.5, -350],
    [-10.5, -363, 10.5, -363],
    [-10.5, -381, 10.5, -381],
    [-10.5, -363, 10.5, -381],
    [10.5, -363, -10.5, -381],
  ];
  for (const [ax, az, bx, bz] of crossSpans) {
    bunting(k, ax, 6.0, az, bx, 6.0, bz, 0.95);
    bulbs(k, ax, 5.4, az, bx, 5.4, bz, 'emissiveOrange', 16);
  }
  // Outer cross-street power spans.
  utilityPole(k, -28, -371, 7.0, Math.PI / 2, true);
  utilityPole(k, 28, -371, 7.0, Math.PI / 2, true);
  wireSpan(k, -28, 6.5, -371, -10.5, 6.7, -363, 0.8);
  wireSpan(k, 28, 6.5, -371, 10.5, 6.7, -363, 0.8);
  bulbs(k, -28, 5.5, -371, -10.5, 5.7, -363, 'emissiveOrange', 14);
  bulbs(k, 28, 5.5, -371, 10.5, 5.7, -363, 'emissiveOrange', 14);

  // 2. Warm glowing braziers around the central square and residential corners (illuminating the begging subjects!).
  for (const [bx, bz] of [
    [-5.8, -366.5], [5.8, -366.5],
    [-5.8, -377.5], [5.8, -377.5],
    [-16.5, -361.0], [16.5, -361.0],
    [-21.5, -382.5], [21.5, -382.5],
    [0, -356.5], [0, -388.5],
  ] as const) {
    if (clearOfSubjects(bx, bz, 0.7)) brazier(k, bx, bz, 0, 26);
  }

  // 3. Central town loudspeaker pole + hand-painted market sign + flags.
  loudspeaker(k, 9.8, -362.5, 8.6);
  signPanel(k, 0, 3.6, -393.1, 0, 3.4, 0.85, signId('NOODLES'));
  flag(k, -9.8, 0, -363.2, 6.5, 0.4, DYES[0]!);
  flag(k, 9.8, 0, -381.2, 6.5, -0.5, DYES[1]!);

  // 4. Overhead dyed cloth shade canopies over side alleys.
  for (const [mx, mz, yaw, w, d, dye] of [
    [-14.5, -368, 0, 4.4, 3.0, 0],
    [14.5, -368, 0, 4.4, 3.0, 2],
    [-24, -367, Math.PI / 2, 4.2, 2.8, 1],
    [24, -367, Math.PI / 2, 4.2, 2.8, 4],
  ] as const) {
    marketCanopy(k, mx, mz, yaw, w, d, DYES[dye]!);
  }

  // 5. Stilted corrugated water tanks, scrap lean-tos, rusted truck & wrecks.
  for (const [wx, wz, yaw] of [[-29, -369, 0.3], [29, -369, -0.4], [-6.5, -396, 0.1], [6.5, -396, -0.1]] as const) {
    waterTankStilt(k, wx, wz, yaw);
  }
  truck(k, -37, 0, -387, 0.35);
  rustedWreck(k, 36, -386, -0.55);
  rustedWreck(k, -37, -363, 1.15);

  // 6. Human-scale street clutter: scrap lean-tos, drying racks, handcarts, pallets, spools, oil drums, tyres.
  const clutter: readonly (readonly [number, number, number])[] = [
    [-16, -352, 0.2], [16, -352, -0.3],
    [-27, -361, 0.5], [27, -361, -0.5],
    [-13, -383, 0.1], [13, -383, -0.2],
    [-26, -391, 0.4], [26, -391, -0.4],
    [-6.5, -361, 0.3], [6.5, -361, -0.3],
    [-33, -379, 0.8], [33, -379, -0.8],
    [-19, -372, 0.2], [19, -372, -0.2],
  ];
  clutter.forEach(([x, z, yaw], i) => {
    if (!clearOfSubjects(x, z, 1.3)) return;
    const mod = i % 6;
    if (mod === 0) dryingRack(k, x, z, yaw, DYES[i % DYES.length]!);
    else if (mod === 1) handcart(k, x, z, yaw, DYES[(i + 1) % DYES.length]!);
    else if (mod === 2) palletStack(k, x, z, yaw, 2, DYES[(i + 2) % DYES.length]!);
    else if (mod === 3) cableSpool(k, x, z, 0.72, yaw);
    else if (mod === 4) scrapLeanTo(k, x, z, yaw, DYES[(i + 3) % DYES.length]!);
    else {
      drumCluster(k, x, z, 3);
      tyres(k, x + 1.4, 0, z + 0.6, 3);
    }
  });

  // Moderate warm amber ground lights so the town glows warmly before detonation without leaving an orange glow after obliteration.
  k.light(cx, 6.5, cz, 'orange', 55, 26);
  k.light(-20, 5.5, -372, 'orange', 42, 22);
  k.light(20, 5.5, -372, 'orange', 42, 22);
  k.light(0, 6.0, -392, 'orange', 45, 22);
}

/** Builds the complete Retraining Annex shantytown & proving-ground perimeter. */
export function buildAnnexTown(k: Kit, spec: MapSpec): void {
  streets(k);
  perimeter(k);
  buildings(k, spec);
  const fragile = new Kit(k.physics);
  lifeAndAtmosphere(fragile);
  spec.fragile = fragile.geo;
  for (const light of fragile.lights) k.lights.push(light);
}
