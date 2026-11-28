/**
 * Downtown Grand Boulevard (`boulevard.ts`, y = 0, z = +18..+162):
 *   - Sunken Plaza Garage (x: +28, z: +44, y: -3.2) with wide Frame exit ramp & breakable glass fountain bay (`plaza.fountainHatch`)
 *   - 5 Destructible storefronts & colonnades (`blvd.west1..3`, `blvd.east1..2`) using real `DestructionManager` clusters
 *   - Destructible Pedestrian Skybridge (`blvd.skybridge`) spanning Grand Boulevard at z = +86 (8.5 m clearance)
 *   - Civic 4-Way Intersection (z = +92..+126) with 4 destructible corner office buildings (`corner.nw..se`) featuring
 *     load-bearing street columns for Stage 2 ORION jet-charge stagger collapses
 *   - Civic Spire Plaza (z = +126..+162): Municipal Power Spire, 3 perimeter Grid Substations (`substation.0..2`),
 *     4 angled wall-run parkour pillars with Gaff grapple bars, and elevated steel catwalks (y = 5.5)
 *   - Glowing green `SUBWAY` stairwell entrances on both sidewalks for fleeing civilians
 *   - Sunlit downtown skyscraper canyon backdrop & perimeter containment
 */
import type { StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import { BOULEVARD, GRAPPLE_ANCHORS, LV, OPENMIND_BOUNDS } from './plan';

const WHITE: readonly [number, number, number] = [0.94, 0.96, 0.99];
const GRANITE: readonly [number, number, number] = [0.76, 0.79, 0.84];
const GRAPHITE: readonly [number, number, number] = [0.22, 0.25, 0.3];
const GLASS_TINT: readonly [number, number, number] = [0.68, 0.87, 0.98];
const ORANGE_PAINT: readonly [number, number, number] = [1.0, 0.42, 0.1];
const SUBWAY_GREEN: readonly [number, number, number] = [0.14, 1.0, 0.46];

function mountSign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 2.6): void {
  const h = w / 4;
  k.push(x, y, z, yaw);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel(0, 0, -0.04, w / 2 + 0.06, h / 2 + 0.06, 0.04, 0.015);
  k.geo.tint(1).use('signs').quadUV(-w / 2, -h / 2, 0.015, w / 2, h / 2, signId(name));
  k.pop();
}

/** Partitioned ground slab around Plaza Garage (x: 20..38, z: 36..52) + exit ramp (x: 20.4..27.6, z: 52..62), roads & curbs. */
function buildGroundAndRoads(k: Kit, spec: MapSpec): void {
  const B = BOULEVARD;
  const pg = B.plazaGarage;
  const r = pg.ramp;
  const rx0 = r.x - r.width / 2; // 20.4
  const rx1 = r.x + r.width / 2; // 27.6
  const y = LV.street;
  const thick = 0.8;

  // Partition y = 0 ground slab cleanly around the sunken Plaza Garage & its south exit ramp!
  k.floor('concrete', B.x0, B.z0, pg.x0, B.z1, y, thick, 6);           // Full West side + Boulevard carriageway (x = -64..20, z = 18..162)
  k.floor('concrete', pg.x0, B.z0, B.x1, pg.z0, y, thick, 5);          // East North of Garage (x = 20..64, z = 18..36)
  k.floor('concrete', pg.x1, pg.z0, B.x1, r.z1, y, thick, 4);          // Far East beside Garage & Ramp (x = 38..64, z = 36..62)
  k.floor('concrete', rx1, pg.z1, pg.x1, r.z1, y, thick, 3);           // East of Ramp (x = 27.6..38, z = 52..62)
  k.floor('concrete', pg.x0, pg.z1, rx0, r.z1, y, thick, 2);           // Narrow strip west of Ramp (x = 20..20.4, z = 52..62)
  k.floor('concrete', pg.x0, r.z1, B.x1, B.z1, y, thick, 6);           // East South of Ramp (x = 20..64, z = 62..162)

  // Asphalt carriageway inlays (visual layers at y = 0.025)
  const g = k.geo;
  g.use('asphalt').tint(0.86, 0.88, 0.92);
  // Grand Boulevard 6-lane avenue (x = -16..+16, z = 18..126)
  g.slab(0, 0.025, 72, B.roadHalfW, 0.015, 54, 6, FACE.py);
  // Civic Cross-Avenue (x = -64..+64, z = 100..118)
  g.slab(0, 0.028, 109, 63.5, 0.015, 9.0, 6, FACE.py);

  // Granite sidewalk paving & curbs flanking Grand Boulevard
  g.use('tile').tint(...GRANITE);
  g.slab(-20.5, 0.04, 59, 4.5, 0.03, 41, 4, FACE.py);
  g.slab(20.5, 0.04, 27, 4.5, 0.03, 9, 4, FACE.py);
  g.slab(20.5, 0.04, 81, 4.5, 0.03, 19, 4, FACE.py);
  // Bright white civic plaza tiles in Civic Spire Plaza (z = 126..162)
  g.use('tile').tint(...WHITE);
  g.slab(0, 0.03, 144, 48, 0.02, 18, 6, FACE.py);

  // Crisp lane markings (double yellow centerlines, white lane dashes, crosswalks)
  g.use('paintYellow');
  for (const dx of [-0.22, 0.22]) {
    g.box(dx, 0.05, 59, 0.09, 0.01, 40, FACE.py);
    g.box(dx, 0.05, 122, 0.09, 0.01, 4, FACE.py);
  }
  for (const dz of [108.78, 109.22]) {
    g.box(-40, 0.05, dz, 22, 0.01, 0.09, FACE.py);
    g.box(40, 0.05, dz, 22, 0.01, 0.09, FACE.py);
  }
  g.use('paintWhite');
  for (const lx of [-10.5, -5.2, 5.2, 10.5]) {
    for (let z = 24; z <= 96; z += 7.5) g.box(lx, 0.05, z, 0.09, 0.01, 2.2, FACE.py);
  }
  // Crosswalks at z = 99 & z = 119 and x = -17 & x = +17
  for (const cz of [99, 119]) {
    for (let x = -14; x <= 14; x += 2.0) g.box(x, 0.05, cz, 0.55, 0.01, 1.8, FACE.py);
  }
  for (const cx of [-17.5, 17.5]) {
    for (let z = 102; z <= 116; z += 2.0) g.box(cx, 0.05, z, 1.8, 0.01, 0.55, FACE.py);
  }
  g.tint(1);

  // Vaultable granite street planters & low transit cover along outer lanes (center x=-7..+7 stays wide open for Frame!).
  for (const [px, pz] of [[-12, 34], [12, 34], [-12, 58], [12, 68], [-12, 78]] as const) {
    k.block('concrete', px - 1.6, 0, pz - 0.7, px + 1.6, 1.05, pz + 0.7, 0.05);
    g.use('dirt').tint(0.2, 0.42, 0.24).bevel(px, 1.18, pz, 1.35, 0.14, 0.48, 0.04);
    g.tint(1);
  }

  // Modernist boulevard streetlamps along sidewalks (visual poles clear of traffic lanes).
  for (const sz of [30, 50, 70, 96, 122, 136, 154]) {
    for (const sx of [-17.2, 17.2]) {
      if (sx > 0 && sz > 34 && sz < 64) continue; // Keep clear of Plaza Garage & Ramp!
      g.use('steelDark').tint(...GRAPHITE);
      g.cyl(sx, 0, sz, sx, 7.4, sz, 0.12, 0.09, 8);
      g.bevel(sx - Math.sign(sx) * 0.9, 7.35, sz, 1.0, 0.09, 0.12, 0.02);
      g.use('emissiveDim').tint(1.0, 0.92, 0.78).box(sx - Math.sign(sx) * 1.4, 7.22, sz, 0.45, 0.05, 0.16, FACE.ny);
    }
  }
  g.tint(1);

  // Low civic perimeter walls + invisible containment around the downtown precinct (keeps rockets & leaps in bounds).
  k.wall(B.x0 + 1, B.z1, B.x1 - 1, B.z1, 0, 2.2, { thick: 0.8, mat: 'concrete', back: true, bay: 12, cap: true });
  k.wall(B.x0 + 1, B.z0, B.x0 + 1, B.z1, 0, 2.2, { thick: 0.8, mat: 'concrete', back: true, bay: 12, cap: true });
  k.wall(B.x1 - 1, B.z1, B.x1 - 1, B.z0, 0, 2.2, { thick: 0.8, mat: 'concrete', back: true, bay: 12, cap: true });
  const midY = (OPENMIND_BOUNDS.y0 + OPENMIND_BOUNDS.y1) / 2;
  const halfY = (OPENMIND_BOUNDS.y1 - OPENMIND_BOUNDS.y0) / 2;
  k.containment(B.x0 - 0.5, midY, 90, 0.5, halfY, 76);
  k.containment(B.x1 + 0.5, midY, 90, 0.5, halfY, 76);
  k.containment(0, midY, B.z1 + 1.0, 66, halfY, 0.5);

  spec.plan?.fills.push(
    { x0: -16, z0: 18, x1: 16, z1: 126, rgb: [82, 88, 98], label: 'GRAND BOULEVARD' },
    { x0: -64, z0: 100, x1: 64, z1: 118, rgb: [82, 88, 98], label: 'CIVIC INTERSECTION' },
    { x0: -48, z0: 126, x1: 48, z1: 162, rgb: [195, 206, 220], label: 'CIVIC SPIRE PLAZA' },
  );
}

/** Sunken Plaza Garage (x: +28, z: +44, y: -3.2) with Distraint Frame bay, exit ramp & breakable glass fountain hatch. */
function buildPlazaGarage(k: Kit, spec: MapSpec): void {
  const pg = BOULEVARD.plazaGarage;
  const r = pg.ramp;
  const fy = pg.floorY; // -3.2
  const g = k.geo;

  // Garage floor slab (x: 20..38, z: 36..52, y = -3.2).
  k.floor('concreteDark', pg.x0, pg.z0, pg.x1, pg.z1, fy, 0.6, 4);

  // Sunken retaining walls enclosing N, W, E, and S (leaving ramp mouth x = 20.4..27.6 open!).
  k.block('concreteDark', pg.x0 - 0.5, fy, pg.z0 - 0.5, pg.x1 + 0.5, 0, pg.z0, 0.04);     // North
  k.block('concreteDark', pg.x0 - 0.5, fy, pg.z0, pg.x0, 0, pg.z1, 0.04);                 // West
  k.block('concreteDark', pg.x1, fy, pg.z0, pg.x1 + 0.5, 0, pg.z1, 0.04);                 // East
  k.block('concreteDark', r.x + r.width / 2, fy, pg.z1, pg.x1 + 0.5, 0, pg.z1 + 0.5, 0.04); // South east of ramp

  // Wide Frame Exit Ramp rising south from garage (24, -3.2, 52) up to street grade (24, 0, 62)!
  k.ramp(r.x, r.z0, r.y0, r.x, r.z1, r.y1, r.width, 'concrete', 0.6, true);
  // Retaining cheek walls flanking the exit ramp
  k.sideWall(r.x - r.width / 2 - 0.35, r.z0, 0.35, r.x - r.width / 2 - 0.35, r.z1, 0.35, fy, 'concrete', 0.5);
  k.sideWall(r.x + r.width / 2 + 0.35, r.z0, 0.35, r.x + r.width / 2 + 0.35, r.z1, 0.35, fy, 'concrete', 0.5);

  // Sculpted granite plaza fountain rim around the garage opening at y = 0.
  g.use('concrete').tint(...WHITE);
  g.bevel((pg.x0 + pg.x1) / 2, 0.25, pg.z0 - 0.35, (pg.x1 - pg.x0) / 2 + 0.5, 0.25, 0.35, 0.05);
  g.bevel(pg.x0 - 0.35, 0.25, (pg.z0 + pg.z1) / 2, 0.35, 0.25, (pg.z1 - pg.z0) / 2, 0.05);
  g.bevel(pg.x1 + 0.35, 0.25, (pg.z0 + pg.z1) / 2, 0.35, 0.25, (pg.z1 - pg.z0) / 2, 0.05);

  // Illuminated Distraint Frame kneeling pad at (28, -3.2, 44).
  const [fx, , fz] = pg.framePos;
  g.use('steelDark').tint(...GRAPHITE).box(fx, fy + 0.04, fz, 3.6, 0.04, 3.6, FACE.py);
  g.use('hazard').box(fx, fy + 0.06, fz - 3.4, 3.6, 0.02, 0.26, FACE.py);
  g.use('hazard').box(fx, fy + 0.06, fz + 3.4, 3.6, 0.02, 0.26, FACE.py);
  g.use('emissiveCyan').tint(1).box(fx, fy + 0.07, fz, 2.4, 0.015, 2.4, FACE.py);
  g.tint(1);
  k.light(fx, fy + 2.6, fz, 'cyan', 52, 18);
  mountSign(k, 37.6, fy + 2.4, 44, -Math.PI / 2, 'MOTOR POOL', 3.4);

  // Openable/Destructible Glass Fountain Bay Hatch (`plaza.fountainHatch`) covering the overhead skylight opening!
  spec.cluster({
    id: pg.hatchTag,
    tag: pg.hatchTag,
    kind: 'hatch',
    label: 'PLAZA FOUNTAIN BAY HATCH',
    value: 35_000,
    collapseThreshold: 0.35,
    nodes: [
      {
        id: 'hatch_leaf_w',
        pos: [25.5, 0.16, 44],
        half: [4.2, 0.14, 7.2],
        mat: 'glass',
        color: 0x7fd8f7,
        hp: 100,
        tier: 1,
        anchored: true,
        kind: 'roof',
        supports: ['hatch_leaf_e'],
        label: 'FOUNTAIN GLASS WEST',
      },
      {
        id: 'hatch_leaf_e',
        pos: [33.0, 0.16, 44],
        half: [4.2, 0.14, 7.2],
        mat: 'glass',
        color: 0x7fd8f7,
        hp: 100,
        tier: 1,
        anchored: true,
        keyNode: true,
        kind: 'roof',
        supports: ['hatch_leaf_w'],
        label: 'FOUNTAIN GLASS EAST',
      },
    ],
  });

  spec.plan?.fills.push({ x0: pg.x0, z0: pg.z0, x1: pg.x1, z1: pg.z1, rgb: [90, 155, 195], label: 'PLAZA GARAGE' });
}

const AWNING_COLORS = [0x1c7a8c, 0xc84b31, 0x2a548a, 0x267a58, 0xb87624] as const;
const FACADE_STONE_COLORS = [0xd4cdc2, 0xc6d1dd, 0xdad3c6, 0xbcc7d4, 0xcab5a2] as const;

/** Build one destructible multi-story downtown storefront & colonnade cluster (`blvd.west1..3`, `blvd.east1..2`). */
function buildStorefrontCluster(
  k: Kit,
  spec: MapSpec,
  s: (typeof BOULEVARD.storefronts)[number],
  index: number,
): void {
  const streetSign = s.x < 0 ? 1 : -1; // +1 faces east toward boulevard, -1 faces west
  const hw = s.w / 2;
  const hd = s.d / 2;
  const midH = 5.2;
  const colX = s.x + streetSign * (hw - 0.65);
  const backX = s.x - streetSign * (hw - 0.5);
  const colHp = s.tier === 2 ? 360 : 220;
  const wallHp = s.tier === 2 ? 300 : 180;
  const upperH = s.h - midH - 0.7;
  const upperCy = midH + 0.7 + upperH / 2;
  const awningColor = AWNING_COLORS[index % AWNING_COLORS.length]!;
  const facadeColor = FACADE_STONE_COLORS[index % FACADE_STONE_COLORS.length]!;

  const nodes: StructuralNodeSpec[] = [
    // 3 street-facing anchored colonnade columns (shearing these drops the cantilevered upper floor!)
    {
      id: `${s.tag}_col_n`,
      pos: [colX, midH / 2, s.z - hd + 0.8],
      half: [0.6, midH / 2, 0.6],
      mat: 'concrete',
      color: 0xe2e8f0,
      hp: colHp,
      tier: s.tier,
      anchored: true,
      kind: 'column',
      supports: [`${s.tag}_slab`],
      label: `${s.label} COLUMN N`,
    },
    {
      id: `${s.tag}_col_m`,
      pos: [colX, midH / 2, s.z],
      half: [0.58, midH / 2, 0.58],
      mat: 'concrete',
      color: 0xe2e8f0,
      hp: colHp,
      tier: s.tier,
      anchored: true,
      kind: 'column',
      supports: [`${s.tag}_slab`],
      label: `${s.label} COLUMN M`,
    },
    {
      id: `${s.tag}_col_s`,
      pos: [colX, midH / 2, s.z + hd - 0.8],
      half: [0.6, midH / 2, 0.6],
      mat: 'concrete',
      color: 0xe2e8f0,
      hp: colHp,
      tier: s.tier,
      anchored: true,
      kind: 'column',
      supports: [`${s.tag}_slab`],
      label: `${s.label} COLUMN S`,
    },
    // Ground-floor North & South enclosed side walls (real closed retail bay, NOT a bare table on stilts!)
    {
      id: `${s.tag}_side_n`,
      pos: [s.x - streetSign * 0.4, midH / 2, s.z - hd + 0.45],
      half: [hw - 0.6, midH / 2, 0.45],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: true,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`],
      label: `${s.label} SIDE WALL N`,
    },
    {
      id: `${s.tag}_side_s`,
      pos: [s.x - streetSign * 0.4, midH / 2, s.z + hd - 0.45],
      half: [hw - 0.6, midH / 2, 0.45],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: true,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`],
      label: `${s.label} SIDE WALL S`,
    },
    // Rear structural bearing wall (warm boutique interior wall)
    {
      id: `${s.tag}_back`,
      pos: [backX, midH / 2, s.z],
      half: [0.55, midH / 2, hd - 0.4],
      mat: 'concrete',
      color: 0x9aa4b0,
      hp: wallHp + 80,
      tier: s.tier,
      anchored: true,
      kind: 'wall',
      supports: [`${s.tag}_slab`],
      label: `${s.label} REAR WALL`,
    },
    // Ground-floor glass storefront infill (breaks cleanly without holding up the roof)
    {
      id: `${s.tag}_glass_low`,
      pos: [colX - streetSign * 1.15, midH / 2, s.z],
      half: [0.2, midH / 2 - 0.15, hd - 1.2],
      mat: 'glass',
      color: 0x76bce0,
      hp: 90,
      tier: 1,
      anchored: true,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`],
      label: `${s.label} STOREFRONT GLASS`,
    },
    // Cantilevered architectural retail awning & signage fascia projecting over the sidewalk!
    {
      id: `${s.tag}_awning`,
      pos: [colX + streetSign * 1.1, midH - 0.25, s.z],
      half: [1.15, 0.22, hd - 0.2],
      mat: 'concrete',
      color: awningColor,
      hp: 120,
      tier: 1,
      anchored: false,
      supportRole: 'infill',
      kind: 'roof',
      supports: [`${s.tag}_slab`],
      label: `${s.label} RETAIL AWNING`,
    },
    // Heavy 2nd-story cantilevered floor slab
    {
      id: `${s.tag}_slab`,
      pos: [s.x, midH + 0.35, s.z],
      half: [hw + 0.12, 0.35, hd + 0.1],
      mat: 'concrete',
      color: 0xe6edf5,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'slab',
      supports: [
        `${s.tag}_col_n`,
        `${s.tag}_col_m`,
        `${s.tag}_col_s`,
        `${s.tag}_back`,
        `${s.tag}_upper_pier_n`,
        `${s.tag}_upper_pier_m`,
        `${s.tag}_upper_pier_s`,
        `${s.tag}_upper_back`,
        `${s.tag}_upper_n`,
        `${s.tag}_upper_s`,
      ],
      impactRadius: 5.5,
      impactDamage: 240,
      label: `${s.label} MEZZANINE SLAB`,
    },
    // Upper front architectural piers framing two wide recessed 2nd-story office window bays!
    {
      id: `${s.tag}_upper_pier_n`,
      pos: [colX, upperCy, s.z - hd + 1.1],
      half: [0.55, upperH / 2, 1.1],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER PIER N`,
    },
    {
      id: `${s.tag}_upper_pier_m`,
      pos: [colX, upperCy, s.z],
      half: [0.55, upperH / 2, 0.85],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER PIER M`,
    },
    {
      id: `${s.tag}_upper_pier_s`,
      pos: [colX, upperCy, s.z + hd - 1.1],
      half: [0.55, upperH / 2, 1.1],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER PIER S`,
    },
    // Recessed 2nd-floor architectural tinted glass window bays between the limestone piers
    {
      id: `${s.tag}_upper_win_n`,
      pos: [colX - streetSign * 0.25, upperCy, s.z - hd * 0.44],
      half: [0.2, upperH / 2 - 0.15, Math.max(1.2, hd * 0.34)],
      mat: 'glass',
      color: 0x7ac4e6,
      hp: 100,
      tier: 1,
      anchored: false,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER WINDOW N`,
    },
    {
      id: `${s.tag}_upper_win_s`,
      pos: [colX - streetSign * 0.25, upperCy, s.z + hd * 0.44],
      half: [0.2, upperH / 2 - 0.15, Math.max(1.2, hd * 0.34)],
      mat: 'glass',
      color: 0x7ac4e6,
      hp: 100,
      tier: 1,
      anchored: false,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER WINDOW S`,
    },
    // Upper North & South enclosed side walls
    {
      id: `${s.tag}_upper_n`,
      pos: [s.x, upperCy, s.z - hd + 0.45],
      half: [hw - 0.3, upperH / 2, 0.45],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER SIDE N`,
    },
    {
      id: `${s.tag}_upper_s`,
      pos: [s.x, upperCy, s.z + hd - 0.45],
      half: [hw - 0.3, upperH / 2, 0.45],
      mat: 'concrete',
      color: facadeColor,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER SIDE S`,
    },
    {
      id: `${s.tag}_upper_back`,
      pos: [backX, upperCy, s.z],
      half: [0.5, upperH / 2, hd - 0.3],
      mat: 'concrete',
      color: 0xb8c2ce,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER BACK`,
    },
    // Crisp light-architectural roof cornice deck
    {
      id: `${s.tag}_roof`,
      pos: [s.x, s.h + 0.4, s.z],
      half: [hw + 0.32, 0.42, hd + 0.32],
      mat: 'concrete',
      color: 0xdfe5ec,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'roof',
      supports: [
        `${s.tag}_upper_pier_n`,
        `${s.tag}_upper_pier_m`,
        `${s.tag}_upper_pier_s`,
        `${s.tag}_upper_back`,
        `${s.tag}_upper_n`,
        `${s.tag}_upper_s`,
      ],
      impactRadius: 6.0,
      impactDamage: 280,
      label: `${s.label} ROOF CORNICE`,
    },
  ];

  spec.cluster({
    id: s.tag,
    tag: s.tag,
    kind: 'storefront',
    label: s.label,
    value: s.tier === 2 ? 160_000 : 110_000,
    collapseThreshold: 0.45,
    nodes,
  });

  // Warm interior retail lighting strip tucked inside the ground-floor shop ceiling (soft non-blooming emissiveDim)
  const g = k.geo;
  g.use('emissiveDim').tint(1.0, 0.9, 0.74);
  g.box(s.x - streetSign * 1.2, midH - 0.22, s.z, 1.4, 0.04, hd - 1.8, FACE.ny);
  g.tint(1);

  spec.plan?.blocks.push({ x0: s.x - hw, z0: s.z - hd, x1: s.x + hw, z1: s.z + hd });
}

/** Destructible Pedestrian Skybridge (`blvd.skybridge`) spanning Grand Boulevard at z = +86 (clearance 8.5 m). */
function buildPedestrianSkybridge(spec: MapSpec): void {
  const sb = BOULEVARD.skybridge;
  const hd = sb.depth / 2;
  const deckH = 0.55;
  const galH = sb.topY - (sb.deckY + deckH);
  const galCy = sb.deckY + deckH + galH / 2;

  spec.cluster({
    id: sb.tag,
    tag: sb.tag,
    kind: 'skybridge',
    label: sb.label,
    value: 220_000,
    collapseThreshold: 0.35,
    nodes: [
      // Anchored West & East concrete/steel bridge piers outside the carriageway (x = ±21.5)
      {
        id: 'skybridge_pier_w',
        pos: [sb.x0 + 0.5, sb.clearanceY / 2, sb.z],
        half: [1.1, sb.clearanceY / 2, hd],
        mat: 'concrete',
        color: 0xd8e0ea,
        hp: 420,
        tier: 2,
        anchored: true,
        kind: 'column',
        supports: ['skybridge_span_w'],
        label: 'SKYBRIDGE WEST PIER',
      },
      {
        id: 'skybridge_pier_e',
        pos: [sb.x1 - 0.5, sb.clearanceY / 2, sb.z],
        half: [1.1, sb.clearanceY / 2, hd],
        mat: 'concrete',
        color: 0xd8e0ea,
        hp: 420,
        tier: 2,
        anchored: true,
        kind: 'column',
        supports: ['skybridge_span_e'],
        label: 'SKYBRIDGE EAST PIER',
      },
      // 3 Suspended structural deck spans across the boulevard (y = 8.5..12.6)
      {
        id: 'skybridge_span_w',
        pos: [-13.5, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'concrete',
        color: 0xd0d8e2,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'catwalk',
        supports: ['skybridge_pier_w', 'skybridge_span_c', 'skybridge_glass_w', 'skybridge_roof_w', 'skybridge_rib_wn', 'skybridge_rib_ws'],
        impactRadius: 6.5,
        impactDamage: 280,
        label: 'SKYBRIDGE WEST DECK',
      },
      {
        id: 'skybridge_span_c',
        pos: [0, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'concrete',
        color: 0xd0d8e2,
        hp: 300,
        tier: 2,
        anchored: false,
        keyNode: true,
        kind: 'catwalk',
        supports: ['skybridge_span_w', 'skybridge_span_e', 'skybridge_glass_c', 'skybridge_roof_c', 'skybridge_rib_cln', 'skybridge_rib_cls', 'skybridge_rib_crn', 'skybridge_rib_crs'],
        impactRadius: 7.5,
        impactDamage: 320,
        label: 'SKYBRIDGE CENTER SPAN',
      },
      {
        id: 'skybridge_span_e',
        pos: [13.5, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'concrete',
        color: 0xd0d8e2,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'catwalk',
        supports: ['skybridge_pier_e', 'skybridge_span_c', 'skybridge_glass_e', 'skybridge_roof_e', 'skybridge_rib_en', 'skybridge_rib_es'],
        impactRadius: 6.5,
        impactDamage: 280,
        label: 'SKYBRIDGE EAST DECK',
      },
      // Architectural exterior steel mullions framing the glass tube along North & South faces (walkway stays wide open!)
      {
        id: 'skybridge_rib_wn',
        pos: [-13.5, galCy, sb.z - hd + 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_w', 'skybridge_roof_w'],
        label: 'SKYBRIDGE WEST MULLION N',
      },
      {
        id: 'skybridge_rib_ws',
        pos: [-13.5, galCy, sb.z + hd - 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_w', 'skybridge_roof_w'],
        label: 'SKYBRIDGE WEST MULLION S',
      },
      {
        id: 'skybridge_rib_cln',
        pos: [-6.7, galCy, sb.z - hd + 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_c', 'skybridge_roof_c'],
        label: 'SKYBRIDGE CENTER-W MULLION N',
      },
      {
        id: 'skybridge_rib_cls',
        pos: [-6.7, galCy, sb.z + hd - 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_c', 'skybridge_roof_c'],
        label: 'SKYBRIDGE CENTER-W MULLION S',
      },
      {
        id: 'skybridge_rib_crn',
        pos: [6.7, galCy, sb.z - hd + 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_c', 'skybridge_roof_c'],
        label: 'SKYBRIDGE CENTER-E MULLION N',
      },
      {
        id: 'skybridge_rib_crs',
        pos: [6.7, galCy, sb.z + hd - 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_c', 'skybridge_roof_c'],
        label: 'SKYBRIDGE CENTER-E MULLION S',
      },
      {
        id: 'skybridge_rib_en',
        pos: [13.5, galCy, sb.z - hd + 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_e', 'skybridge_roof_e'],
        label: 'SKYBRIDGE EAST MULLION N',
      },
      {
        id: 'skybridge_rib_es',
        pos: [13.5, galCy, sb.z + hd - 0.06],
        half: [0.22, galH / 2, 0.22],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 160,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'column',
        supports: ['skybridge_span_e', 'skybridge_roof_e'],
        label: 'SKYBRIDGE EAST MULLION S',
      },
      // Glass gallery walls atop each span
      {
        id: 'skybridge_glass_w',
        pos: [-13.5, galCy, sb.z],
        half: [6.5, galH / 2, hd - 0.18],
        mat: 'glass',
        color: 0x76c4e8,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'wall',
        supports: ['skybridge_span_w', 'skybridge_roof_w'],
        label: 'SKYBRIDGE WEST GLASS',
      },
      {
        id: 'skybridge_glass_c',
        pos: [0, galCy, sb.z],
        half: [6.5, galH / 2, hd - 0.18],
        mat: 'glass',
        color: 0x76c4e8,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'wall',
        supports: ['skybridge_span_c', 'skybridge_roof_c'],
        label: 'SKYBRIDGE CENTER GLASS',
      },
      {
        id: 'skybridge_glass_e',
        pos: [13.5, galCy, sb.z],
        half: [6.5, galH / 2, hd - 0.18],
        mat: 'glass',
        color: 0x76c4e8,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'wall',
        supports: ['skybridge_span_e', 'skybridge_roof_e'],
        label: 'SKYBRIDGE EAST GLASS',
      },
      // Crisp bright architectural fascia roof caps crowning the skybridge tube
      {
        id: 'skybridge_roof_w',
        pos: [-13.5, sb.topY + 0.35, sb.z],
        half: [6.8, 0.38, hd + 0.22],
        mat: 'concrete',
        color: 0xdce4ee,
        hp: 200,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_w'],
        label: 'SKYBRIDGE WEST ROOF',
      },
      {
        id: 'skybridge_roof_c',
        pos: [0, sb.topY + 0.35, sb.z],
        half: [6.8, 0.38, hd + 0.22],
        mat: 'concrete',
        color: 0xdce4ee,
        hp: 200,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_c'],
        label: 'SKYBRIDGE CENTER ROOF',
      },
      {
        id: 'skybridge_roof_e',
        pos: [13.5, sb.topY + 0.35, sb.z],
        half: [6.8, 0.38, hd + 0.22],
        mat: 'concrete',
        color: 0xdce4ee,
        hp: 200,
        tier: 2,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_e'],
        label: 'SKYBRIDGE EAST ROOF',
      },
    ],
  });
}

/** 4 Destructible Corner Office Buildings (`corner.nw..se`) with load-bearing street stagger columns for Stage 2. */
function buildIntersectionCorners(spec: MapSpec): void {
  const cornerFacades = [0xd2dae4, 0xd8d1c5, 0xc2cedc, 0xcbc3b8] as const;
  for (let ci = 0; ci < BOULEVARD.intersection.corners.length; ci++) {
    const c = BOULEVARD.intersection.corners[ci]!;
    const hw = c.w / 2; // 7
    const hd = c.d / 2; // 6
    const midH = 5.8;
    const faceXSign = c.x < 0 ? 1 : -1;
    const faceZSign = c.z < 109 ? 1 : -1;
    const colCornerX = c.x + faceXSign * (hw - 0.7);
    const colCornerZ = c.z + faceZSign * (hd - 0.7);
    const rearX = c.x - faceXSign * (hw - 0.6);
    const rearZ = c.z - faceZSign * (hd - 0.6);
    const upperH = c.h - midH - 0.9;
    const upperCy = midH + 0.9 + upperH / 2;
    const facadeCol = cornerFacades[ci % cornerFacades.length]!;
    const spandrelY = midH + 0.9 + upperH * 0.5;

    spec.cluster({
      id: c.tag,
      tag: c.tag,
      kind: 'cornerBuilding',
      label: c.label,
      value: 240_000,
      collapseThreshold: 0.4,
      nodes: [
        // Primary intersection-facing corner stagger column (ORION jet-charge target!)
        {
          id: `${c.tag}_col_corner`,
          pos: [colCornerX, midH / 2, colCornerZ],
          half: [0.75, midH / 2, 0.75],
          mat: 'concrete',
          color: 0xe6edf5,
          hp: 380,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} CORNER COLUMN`,
        },
        // Flanking street-facing load-bearing column along X
        {
          id: `${c.tag}_col_x`,
          pos: [c.x - faceXSign * 1.5, midH / 2, colCornerZ],
          half: [0.68, midH / 2, 0.68],
          mat: 'concrete',
          color: 0xe6edf5,
          hp: 380,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} AVENUE COLUMN`,
        },
        // Flanking street-facing load-bearing column along Z
        {
          id: `${c.tag}_col_z`,
          pos: [colCornerX, midH / 2, c.z - faceZSign * 1.5],
          half: [0.68, midH / 2, 0.68],
          mat: 'concrete',
          color: 0xe6edf5,
          hp: 380,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} BOULEVARD COLUMN`,
        },
        // Rear structural core pier
        {
          id: `${c.tag}_core`,
          pos: [rearX, midH / 2, rearZ],
          half: [1.5, midH / 2, 1.5],
          mat: 'concrete',
          color: 0x9aa4b2,
          hp: 460,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} REAR CORE`,
        },
        // Recessed architectural ground-floor lobby core tucked cleanly behind the stagger columns
        {
          id: `${c.tag}_lobby`,
          pos: [c.x - faceXSign * 1.4, midH / 2, c.z - faceZSign * 1.3],
          half: [hw - 2.2, midH / 2 - 0.1, hd - 2.0],
          mat: 'concrete',
          color: 0x627386,
          hp: 260,
          tier: 1,
          anchored: true,
          supportRole: 'infill',
          kind: 'wall',
          supports: [`${c.tag}_slab`],
          label: `${c.label} LOBBY CORE`,
        },
        // Heavy cantilevered 2nd-story concrete office slab (falls on ORION when columns shear!)
        {
          id: `${c.tag}_slab`,
          pos: [c.x, midH + 0.45, c.z],
          half: [hw + 0.18, 0.45, hd + 0.18],
          mat: 'concrete',
          color: 0xeaf0f7,
          hp: 400,
          tier: 2,
          anchored: false,
          kind: 'slab',
          supports: [
            `${c.tag}_col_corner`,
            `${c.tag}_col_x`,
            `${c.tag}_col_z`,
            `${c.tag}_core`,
            `${c.tag}_upper_n`,
            `${c.tag}_upper_s`,
            `${c.tag}_upper_w`,
            `${c.tag}_upper_e`,
          ],
          impactRadius: 6.5,
          impactDamage: 340,
          label: `${c.label} OVERHANG SLAB`,
        },
        // ALL 4 solid architectural limestone/precast upper walls (N, S, W, E) + mid-level floor spandrel belt!
        {
          id: `${c.tag}_upper_n`,
          pos: [c.x, upperCy, c.z - hd + 0.5],
          half: [hw - 0.2, upperH / 2, 0.5],
          mat: 'concrete',
          color: facadeCol,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL N`,
        },
        {
          id: `${c.tag}_upper_s`,
          pos: [c.x, upperCy, c.z + hd - 0.5],
          half: [hw - 0.2, upperH / 2, 0.5],
          mat: 'concrete',
          color: facadeCol,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL S`,
        },
        {
          id: `${c.tag}_upper_w`,
          pos: [c.x - hw + 0.5, upperCy, c.z],
          half: [0.5, upperH / 2, hd - 0.9],
          mat: 'concrete',
          color: facadeCol,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL W`,
        },
        {
          id: `${c.tag}_upper_e`,
          pos: [c.x + hw - 0.5, upperCy, c.z],
          half: [0.5, upperH / 2, hd - 0.9],
          mat: 'concrete',
          color: facadeCol,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL E`,
        },
        // Mid-tower architectural floor spandrel & recessed tinted corner window belt
        {
          id: `${c.tag}_belt`,
          pos: [c.x, spandrelY, c.z],
          half: [hw + 0.22, 0.35, hd + 0.22],
          mat: 'concrete',
          color: 0xecf1f8,
          hp: 200,
          tier: 2,
          anchored: false,
          supportRole: 'infill',
          kind: 'slab',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} FLOOR BELT`,
        },
        {
          id: `${c.tag}_win_band`,
          pos: [c.x + faceXSign * 0.16, spandrelY + 1.45, c.z + faceZSign * 0.16],
          half: [hw - 0.15, 0.9, hd - 0.15],
          mat: 'glass',
          color: 0x6ab4d8,
          hp: 120,
          tier: 1,
          anchored: false,
          supportRole: 'infill',
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} RIBBON GLAZING`,
        },
        // Heavy architectural concrete crown roof cornice
        {
          id: `${c.tag}_roof`,
          pos: [c.x, c.h + 0.45, c.z],
          half: [hw + 0.34, 0.48, hd + 0.34],
          mat: 'concrete',
          color: 0xe2e8f0,
          hp: 360,
          tier: 2,
          anchored: false,
          kind: 'roof',
          supports: [`${c.tag}_upper_n`, `${c.tag}_upper_s`, `${c.tag}_upper_w`, `${c.tag}_upper_e`],
          impactRadius: 7.0,
          impactDamage: 360,
          label: `${c.label} CROWN ROOF`,
        },
      ],
    });

    spec.plan?.blocks.push({ x0: c.x - hw, z0: c.z - hd, x1: c.x + hw, z1: c.z + hd });
  }
}

/** Civic Spire Plaza: Municipal Power Spire, 3 Grid Substations (`substation.0..2`), wall-run pillars & elevated catwalks. */
function buildSpirePlaza(k: Kit, spec: MapSpec): void {
  const sp = BOULEVARD.spirePlaza;
  const [sx, sy, sz] = sp.spireCenter; // [0, 0, 144]
  const g = k.geo;

  // --- Central Municipal Power Spire (28 m tall futuristic white/cyan energy spire!) ---
  // Stepped octagonal granite plinth
  g.use('concrete').tint(...WHITE);
  g.cyl(sx, sy, sz, sx, sy + 0.65, sz, 4.8, 4.5, 8, true, true);
  g.use('steelDark').tint(...GRAPHITE);
  g.cyl(sx, sy + 0.65, sz, sx, sy + 2.2, sz, 3.6, 3.2, 8, true, true);
  // Tapered white-steel & cyan glass energy core rising to y = 24
  g.use('glass').tint(0.55, 0.9, 1.0).cyl(sx, sy + 2.2, sz, sx, 23.5, sz, 2.35, 1.35, 12, false, false);
  g.use('emissiveCyan').tint(1).cyl(sx, sy + 2.4, sz, sx, 24.5, sz, 0.85, 0.45, 12, false, false);
  // 4 sculpted steel capacitor rings & vertical white buttress fins
  for (const ry of [6.5, 12.0, 17.5, 22.8]) {
    const r = 3.2 - (ry / 28) * 1.1;
    g.use('steelDark').tint(...GRAPHITE).cyl(sx, ry - 0.25, sz, sx, ry + 0.25, sz, r, r, 12, true, true);
    g.use('emissiveCyan').tint(1).cyl(sx, ry - 0.08, sz, sx, ry + 0.08, sz, r + 0.14, r + 0.14, 12, false, false);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fx = sx + Math.cos(a) * 2.55, fz = sz + Math.sin(a) * 2.55;
    k.beam(fx, sy + 0.6, fz, sx + Math.cos(a) * 1.5, 23.5, sz + Math.sin(a) * 1.5, 0.26, 0.34, 'concrete', false);
  }
  // Lightning pinnacle (y = 23.5 .. 28)
  g.use('steel').tint(...WHITE).cyl(sx, 23.5, sz, sx, sp.spireHeight, sz, 0.38, 0.06, 8, false, true);
  g.use('emissiveCyan').tint(1).box(sx, sp.spireHeight + 0.25, sz, 0.28, 0.28, 0.28, FACE.all);
  g.tint(1);
  k.collidePrism(sx, sz, sy, 24, 3.1, 8, 'metal');
  k.light(sx, 12, sz, 'cyan', 90, 32);

  // Glowing cyan floor conduit trenches radiating from Spire to all 3 Grid Substations!
  for (const sub of sp.substations) {
    k.stripLine([sx, 0.04, sz, sub.pos[0], 0.04, sub.pos[2]], 0.36, 'emissiveCyan');
  }

  // --- 3 Perimeter Grid Substations (`substation.0..2`) ---
  for (const sub of sp.substations) {
    const [bx, by, bz] = sub.pos;
    spec.cluster({
      id: sub.tag,
      tag: sub.tag,
      kind: 'substation',
      label: sub.label,
      value: 95_000,
      collapseThreshold: 0.4,
      nodes: [
        {
          id: `${sub.tag}_pad`,
          pos: [bx, by + 0.9, bz],
          half: [2.4, 0.9, 1.8],
          mat: 'steelDark',
          color: 0x2d3846,
          hp: 260,
          tier: 1,
          anchored: true,
          yaw: sub.yaw,
          kind: 'wall',
          supports: [`${sub.tag}_conduit`],
          label: `${sub.label} TRANSFORMER`,
        },
        {
          id: `${sub.tag}_conduit`,
          pos: [bx, by + 3.2, bz],
          half: [1.2, 1.4, 1.2],
          mat: 'emissiveCyan',
          color: 0x4fd7ff,
          hp: 300,
          tier: 1,
          anchored: false,
          keyNode: true,
          yaw: sub.yaw,
          kind: 'hazard',
          hazardRadius: 6.5,
          hazardDamage: 150,
          supports: [`${sub.tag}_pad`, `${sub.tag}_crown`],
          label: `${sub.label} GRID CONDUIT`,
        },
        {
          id: `${sub.tag}_crown`,
          pos: [bx, by + 5.1, bz],
          half: [1.6, 0.5, 1.4],
          mat: 'steel',
          color: 0x8ea0b6,
          hp: 180,
          tier: 1,
          anchored: false,
          yaw: sub.yaw,
          kind: 'roof',
          supports: [`${sub.tag}_conduit`],
          label: `${sub.label} INSULATOR CAP`,
        },
      ],
    });
    // Adjacent breakable generator for extra electrical blast punch
    const gx = bx + Math.cos(sub.yaw) * 3.8;
    const gz = bz - Math.sin(sub.yaw) * 3.8;
    spec.breakable('generator', gx, by, gz, sub.yaw);
    mountSign(k, bx, by + 5.8, bz, sub.yaw, 'HIGH VOLTAGE', 2.8);
    k.light(bx, by + 4.5, bz, 'cyan', 42, 18);
  }

  // --- 4 Angled Wall-Run Parkour Pillars + Top Gaff Grapple Bars (Stage 3B Eject + Gaff Finisher!) ---
  const spireAnchors = GRAPPLE_ANCHORS.filter(a => a.section === 'boss_stage3');
  for (let i = 0; i < sp.wallRunPillars.length; i++) {
    const p = sp.wallRunPillars[i]!;
    const h = p.y1 - p.y0;
    const cy = (p.y0 + p.y1) / 2;
    k.push(p.x, 0, p.z, p.yaw);
    // Single unbroken smooth wall-run surface facing the Power Spire!
    k.collide(0, cy, 0, p.length / 2, h / 2, 0.42, 'concrete', false);
    g.use('concrete').tint(...WHITE).bevel(0, cy, 0, p.length / 2, h / 2, 0.42, 0.06);
    // Steel support piers beneath the wall-run panel
    g.use('steelDark').tint(...GRAPHITE);
    g.bevel(-p.length * 0.38, p.y0 / 2, 0, 0.45, p.y0 / 2, 0.48, 0.04);
    g.bevel(p.length * 0.38, p.y0 / 2, 0, 0.45, p.y0 / 2, 0.48, 0.04);
    // Vivid warm-orange wall-run runner stripes on both faces
    g.use('paintRed').tint(...ORANGE_PAINT).box(0, p.y1 + 0.14, 0, p.length / 2 + 0.08, 0.16, 0.48, FACE.all);
    g.use('emissiveOrange').tint(1).box(0, cy, 0.44, p.length / 2 - 0.3, 0.12, 0.03, FACE.pz);
    g.use('emissiveOrange').tint(1).box(0, cy, -0.44, p.length / 2 - 0.3, 0.12, 0.03, FACE.nz);
    g.tint(1);
    k.pop();

    // Solid bright-orange Gaff Grapple Anchor beam crowning each Spire Pillar!
    const anchor = spireAnchors[i];
    if (anchor) {
      const [ax0, ay0, az0, ax1, ay1, az1] = anchor.beam;
      const acx = (ax0 + ax1) / 2, acy = (ay0 + ay1) / 2, acz = (az0 + az1) / 2;
      const ahx = (ax1 - ax0) / 2, ahy = (ay1 - ay0) / 2, ahz = (az1 - az0) / 2;
      g.use('paintRed').tint(...ORANGE_PAINT).bevel(acx, acy, acz, ahx, ahy, ahz, 0.05);
      g.use('emissiveOrange').tint(1).box(acx, ay1 + 0.05, acz, ahx - 0.1, 0.05, ahz - 0.1, FACE.py);
      g.tint(1);
      k.collide(acx, acy, acz, ahx, ahy, ahz, 'metal', false);
    }
  }

  // --- Flanking Elevated Steel Catwalks (y = 5.5) with Walkable Stairs for Stage 3B Finisher ---
  const cy = sp.catwalkY; // 5.5
  for (const side of [-1, 1] as const) {
    const cx = side * 21;
    k.catwalk(cx, 134, cx, 154, cy, 3.2, 'both', false);
    for (const cz of [135, 144, 153]) k.column(cx, cz, 0, cy - 0.15, 0.5, 'steelDark');
    // Walkable steel staircase descending north to plaza grade (z = 134 -> 122, run = 12, rise = 5.5, slope = 0.46!)
    k.stairs(cx, 122, 0, cx, 134, cy, 2.8, 'steel', true);
    spec.plan?.decks.push({ x0: cx - 1.6, z0: 134, x1: cx + 1.6, z1: 154 });
  }
}

/** Glowing green `SUBWAY` stairwell entrances along both sidewalks for fleeing civilians. */
function buildSubwayEntrances(k: Kit): void {
  const g = k.geo;
  for (const sub of BOULEVARD.subwayEntrances) {
    k.push(sub.x, 0, sub.z, sub.yaw);
    // Low granite stairwell parapet cheeks (left & right of stairs)
    g.use('concrete').tint(...GRANITE);
    g.bevel(-1.7, 0.55, 0, 0.2, 0.55, 2.2, 0.03);
    g.bevel(1.7, 0.55, 0, 0.2, 0.55, 2.2, 0.03);
    g.bevel(0, 0.55, -2.1, 1.9, 0.55, 0.2, 0.03);
    // Dark recessed stairwell drop backing (visual descending shelter)
    g.use('steelDark').tint(0.12, 0.15, 0.18).box(0, 0.05, -0.3, 1.45, 0.05, 1.65, FACE.py);
    // Sleek cantilevered steel canopy & glowing emerald-green SUBWAY beacon header!
    g.use('steelDark').tint(...GRAPHITE);
    g.cyl(-1.6, 1.1, -1.9, -1.6, 3.1, -1.9, 0.08, 0.08, 8);
    g.cyl(1.6, 1.1, -1.9, 1.6, 3.1, -1.9, 0.08, 0.08, 8);
    g.cyl(-1.6, 1.1, 1.8, -1.6, 3.1, 1.8, 0.08, 0.08, 8);
    g.cyl(1.6, 1.1, 1.8, 1.6, 3.1, 1.8, 0.08, 0.08, 8);
    g.bevel(0, 3.22, 0, 1.95, 0.18, 2.25, 0.04);
    g.use('emissiveCyan').tint(...SUBWAY_GREEN).box(0, 3.22, 2.28, 1.75, 0.14, 0.05, FACE.pz);
    g.use('emissiveCyan').tint(...SUBWAY_GREEN).box(0, 3.0, 0, 1.5, 0.04, 1.8, FACE.ny);
    g.tint(1);
    k.collide(0, 0.55, -2.1, 1.9, 0.55, 0.22, 'concrete');
    k.pop();

    mountSign(k, sub.x + Math.sin(sub.yaw) * 2.32, 3.65, sub.z + Math.cos(sub.yaw) * 2.32, sub.yaw, 'EXIT', 1.8);
    k.light(sub.x, 2.6, sub.z, 0x22ff77, 26, 12);
  }
}

type CityFacadeStyle = 'glass_blue' | 'white_modern' | 'slate_corporate' | 'warm_stone' | 'terracotta_brick';

const CORE_SLATE: readonly [number, number, number] = [0.16, 0.23, 0.32];
const WARM_OFFICE: readonly [number, number, number] = [0.92, 0.84, 0.7];
const COOL_OFFICE: readonly [number, number, number] = [0.54, 0.66, 0.78];

/**
 * Builds a realistic multi-story solid-core architectural building (zero hollow glass shells!).
 * Includes solid opaque body, ground-floor stone/retail podium, horizontal spandrels, recessed
 * glazing + varied warm/cool lit office bays, vertical mullions, cornice parapet & rooftop HVAC.
 */
function buildRealCityBuilding(
  k: Kit,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  style: CityFacadeStyle,
  seed: number,
  withCollider = false,
  withSetback = true,
): void {
  const g = k.geo;
  const hw = w / 2;
  const hd = d / 2;

  const bodyMat: Mat = style === 'glass_blue' || style === 'slate_corporate' ? 'panel' : 'concrete';
  const bodyTint: readonly [number, number, number] =
    style === 'glass_blue'
      ? [0.22, 0.35, 0.5]
      : style === 'slate_corporate'
        ? [0.26, 0.3, 0.37]
        : style === 'warm_stone'
          ? [0.84, 0.8, 0.74]
          : style === 'terracotta_brick'
            ? [0.68, 0.45, 0.36]
            : [0.9, 0.93, 0.97];
  const trimTint: readonly [number, number, number] =
    style === 'slate_corporate'
      ? [0.48, 0.54, 0.62]
      : style === 'warm_stone'
        ? [0.74, 0.7, 0.63]
        : style === 'terracotta_brick'
          ? [0.82, 0.78, 0.72]
          : WHITE;

  const tier1H = withSetback && h >= 28 ? h * 0.75 : h;
  const tier2H = h - tier1H;
  const hw2 = hw * 0.82;
  const hd2 = hd * 0.82;

  // Ground-floor architectural granite podium base (y = 0..5.2)
  g.use('concrete').tint(...GRANITE).box(cx, 2.6, cz, hw + 0.12, 2.6, hd + 0.12, FACE.sides | FACE.py);
  // Dark ground-floor lobby/retail window recessed ribbon with soft warm interior glow
  g.use('panel').tint(0.12, 0.16, 0.22).box(cx, 2.5, cz, hw + 0.16, 1.55, hd - 1.2, FACE.px | FACE.nx);
  g.use('panel').tint(0.12, 0.16, 0.22).box(cx, 2.5, cz, hw - 1.2, 1.55, hd + 0.16, FACE.pz | FACE.nz);
  g.use('emissiveDim').tint(...WARM_OFFICE).box(cx, 3.1, cz, hw + 0.19, 0.55, hd - 1.8, FACE.px | FACE.nx);
  g.use('emissiveDim').tint(...WARM_OFFICE).box(cx, 3.1, cz, hw - 1.8, 0.55, hd + 0.19, FACE.pz | FACE.nz);

  // Primary solid opaque tower shaft
  g.use(bodyMat).tint(...bodyTint).box(cx, 5.2 + (tier1H - 5.2) / 2, cz, hw, (tier1H - 5.2) / 2, hd, FACE.sides | FACE.py);

  // Optional stepped upper tower tier
  if (tier2H > 2.5) {
    g.use(bodyMat).tint(...bodyTint).box(cx, tier1H + tier2H / 2, cz, hw2, tier2H / 2, hd2, FACE.sides | FACE.py);
  }

  // Horizontal architectural floor spandrel bands + recessed dark window strips + segmented warm/cool office bays
  const floorStep = h > 42 ? 6.2 : 4.8;
  for (let y = 9.5, fi = 0; y < h - 1.2; y += floorStep, fi++) {
    const isUpper = tier2H > 2.5 && y > tier1H;
    const rw = isUpper ? hw2 : hw;
    const rd = isUpper ? hd2 : hd;

    g.use('concrete').tint(...trimTint).box(cx, y, cz, rw + 0.15, 0.34, rd + 0.15, FACE.sides);

    // Continuous dark architectural glazing band behind floor spandrels
    g.use('panel').tint(...CORE_SLATE).box(cx, y - floorStep * 0.44, cz, rw + 0.04, floorStep * 0.28, rd + 0.04, FACE.sides);

    // Varied segmented warm & cool lit office bays (never blinding pure-white bars!)
    for (let bi = -1; bi <= 1; bi++) {
      if (((fi * 5 + bi * 3 + seed) % 5) === 0 || ((fi + bi + seed) % 4) === 0) continue;
      const warm = ((fi + bi + seed) & 1) === 0;
      g.use(warm ? 'emissiveDim' : 'screen').tint(...(warm ? WARM_OFFICE : COOL_OFFICE));
      const bx = cx + bi * (rw * 0.56);
      const bz = cz + bi * (rd * 0.56);
      const wy = y - floorStep * 0.44;
      const wh = Math.min(0.75, floorStep * 0.16);
      g.box(bx, wy, cz + rd + 0.08, rw * 0.21, wh, 0.02, FACE.pz);
      g.box(bx, wy, cz - rd - 0.08, rw * 0.21, wh, 0.02, FACE.nz);
      g.box(cx + rw + 0.08, wy, bz, 0.02, wh, rd * 0.21, FACE.px);
      g.box(cx - rw - 0.08, wy, bz, 0.02, wh, rd * 0.21, FACE.nx);
    }
  }

  // Structural corner piers & crisp vertical facade pilasters on primary shaft
  g.use('concrete').tint(...trimTint);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.box(cx + sx * (hw - 0.38), tier1H / 2, cz + sz * (hd - 0.38), 0.52, tier1H / 2, 0.52, FACE.sides);
    }
  }
  // Rooftop coping parapet & mechanical HVAC penthouse
  const topW = tier2H > 2.5 ? hw2 : hw;
  const topD = tier2H > 2.5 ? hd2 : hd;
  g.use('steelDark').tint(...GRAPHITE).box(cx, h + 0.35, cz, topW + 0.18, 0.35, topD + 0.18, FACE.sides | FACE.py);
  g.use('concrete').tint(...trimTint).box(cx, h + 1.5, cz, topW * 0.48, 1.25, topD * 0.48, FACE.noBottom);
  if (style === 'glass_blue' && (seed % 3) === 0) {
    g.use('screen').tint(0.55, 0.76, 0.92).box(cx, h - 0.6, cz, topW + 0.2, 0.14, topD + 0.2, FACE.sides);
  }
  if (h >= 54 && seed % 3 === 0) {
    g.use('steel').tint(...WHITE).cyl(cx, h + 2.7, cz, cx, h + 12.0, cz, 0.24, 0.06, 6);
    g.use('emissiveRed').tint(0.95).box(cx, h + 12.2, cz, 0.2, 0.2, 0.2, FACE.all);
  }
  g.tint(1);

  if (withCollider) {
    k.collide(cx, h / 2, cz, hw, h / 2, hd, 'concrete');
  }
}

/**
 * Continuous finished multi-story downtown street-wall buildings lining Grand Boulevard behind the
 * destructible storefronts, framing all 4 Cross-Avenue flanks, and enclosing Civic Spire Plaza
 * with monumental Civic Hall colonnade wings (ZERO empty desert void or fake half-buildings!).
 */
function buildDowntownStreetWall(k: Kit): void {
  const g = k.geo;

  // --- 1. Grand Boulevard Mid-Rise & High-Rise Street-Wall Buildings behind Destructible Storefronts ---
  // West side sits cleanly at x = -62..-38 (behind storefronts x = -37..-25)
  // East side sits cleanly at x = +39..+62 (behind storefronts x = +25..+37 AND Plaza Garage x = 20..38!)
  const blocks: readonly [number, number, number, number, number, CityFacadeStyle][] = [
    // West Boulevard row (north -> south)
    [-50, 29, 23, 18, 36, 'glass_blue'],
    [-50, 50, 23, 20, 44, 'warm_stone'],
    [-50, 71, 23, 18, 32, 'slate_corporate'],
    // West Cross-Avenue north & south flanks (behind corner.nw & corner.sw, clear of cross-ave z = 100..118)
    [-50, 90, 24, 17, 38, 'white_modern'],
    [-50, 128, 24, 17, 34, 'terracotta_brick'],
    // East Boulevard row (north -> south, cleanly east of Plaza Garage x=38)
    [51, 28, 22, 18, 38, 'white_modern'],
    [51, 50, 22, 22, 46, 'glass_blue'],
    [51, 72, 22, 18, 34, 'terracotta_brick'],
    // East Cross-Avenue north & south flanks (behind corner.ne & corner.se)
    [50, 90, 24, 17, 42, 'slate_corporate'],
    [50, 128, 24, 17, 36, 'warm_stone'],
  ];
  for (let i = 0; i < blocks.length; i++) {
    const [cx, cz, w, d, h, style] = blocks[i]!;
    buildRealCityBuilding(k, cx, cz, w, d, h, style, i + 10, true, true);
  }

  // --- 2. Monumental Civic Hall / Municipal Parliament Enclosing Civic Spire Plaza (W, E, and South!) ---
  // West & East Civic Colonnade Wings (x = ±56, z = 138..164 — completely clear of substations at x = ±28!)
  for (const side of [-1, 1] as const) {
    const wx = side * 56;
    buildRealCityBuilding(k, wx, 150, 15, 26, 26, 'warm_stone', side > 0 ? 41 : 42, true, false);
    // Classical-modern travertine colonnade portico facing Spire Plaza
    g.use('concrete').tint(...WHITE);
    const faceX = side * 48.2;
    g.bevel(faceX, 11.4, 150, 0.9, 0.7, 12.6, 0.05);
    for (let pz = 140; pz <= 160; pz += 4.0) {
      g.cyl(faceX, 0, pz, faceX, 11.0, pz, 0.42, 0.36, 10);
    }
    g.tint(1);
  }

  // South Monumental Civic Parliament Facade spanning the entire southern edge of Spire Plaza (z = 164..180)!
  // Centered cleanly behind the z = 162 containment wall so players see a grand sunlit civic palace + towers behind it.
  g.use('concrete').tint(0.9, 0.89, 0.86);
  // Central rotunda & grand main hall block (x = -46..+46, z = 165..180, y = 0..24)
  g.box(0, 12.0, 173, 46, 12.0, 7.5, FACE.sides | FACE.py);
  // Upper sculpted clerestory attic (y = 24..30)
  g.box(0, 27.0, 174, 28, 3.0, 5.5, FACE.sides | FACE.py);
  // Recessed dark bronze-glass monumental facade bays behind the colonnade with soft golden-amber interior glow
  g.use('panel').tint(...CORE_SLATE).box(0, 11.5, 165.4, 42, 8.8, 0.2, FACE.nz);
  for (let wx = -36; wx <= 36; wx += 9) {
    g.use('emissiveDim').tint(0.88, 0.78, 0.62);
    g.box(wx, 14.5, 165.12, 2.4, 1.35, 0.03, FACE.nz);
    g.box(wx, 7.5, 165.12, 2.4, 1.35, 0.03, FACE.nz);
    // Dark bronze vertical window mullion dividing each tall Civic Hall bay
    g.use('steelDark').tint(...GRAPHITE);
    g.box(wx, 11.0, 165.06, 0.14, 5.4, 0.06, FACE.nz);
  }
  // Grand colonnade portico columns along z = 163.5 facing Spire Plaza!
  g.use('concrete').tint(...WHITE);
  g.bevel(0, 0.45, 163.8, 44, 0.45, 1.8, 0.06);
  g.bevel(0, 18.8, 164.0, 44.5, 1.1, 2.0, 0.08);
  g.bevel(0, 24.4, 173, 46.6, 0.55, 8.0, 0.06);
  for (let px = -40; px <= 40; px += 5.0) {
    g.cyl(px, 0.9, 163.6, px, 18.0, 163.6, 0.56, 0.46, 10);
  }
  g.use('screen').tint(0.55, 0.8, 0.95).box(0, 19.95, 162.05, 36, 0.12, 0.06, FACE.nz);
  g.tint(1);
}

/** Sculpted TV Broadcast News Van with windshield, wheels, LIVE lightbar, and rooftop satellite uplink dish! */
function buildNewsVan(k: Kit, x: number, z: number, yaw: number, accentRgb: readonly [number, number, number]): void {
  k.push(x, 0, z, yaw);
  const g = k.geo;
  // Chassis & white commercial van body (length 5.6 m along Z, width 2.2 m along X)
  g.use('concrete').tint(...WHITE).bevel(0, 1.38, -0.25, 1.06, 0.95, 2.45, 0.08);
  // Sloped front cab hood & dark tinted windshield
  g.use('concrete').tint(...WHITE).bevel(0, 0.92, 2.45, 1.02, 0.48, 0.55, 0.08);
  g.use('panel').tint(0.1, 0.14, 0.2).bevel(0, 1.62, 2.22, 0.95, 0.44, 0.16, 0.04);
  // Side cab windows
  g.box(-1.07, 1.62, 1.55, 0.04, 0.38, 0.55, FACE.nx);
  g.box(1.07, 1.62, 1.55, 0.04, 0.38, 0.55, FACE.px);
  // Bold broadcast network stripe along both sides + front bumper
  g.use('panel').tint(accentRgb[0], accentRgb[1], accentRgb[2]);
  g.box(-1.08, 1.05, -0.35, 0.04, 0.22, 2.25, FACE.nx);
  g.box(1.08, 1.05, -0.35, 0.04, 0.22, 2.25, FACE.px);
  g.use('steelDark').tint(...GRAPHITE).bevel(0, 0.48, 2.98, 1.06, 0.16, 0.14, 0.04);
  g.bevel(0, 0.48, -2.72, 1.06, 0.16, 0.14, 0.04);
  // 4 rubber tires with steel hubs
  for (const wx of [-1.02, 1.02]) {
    for (const wz of [-1.65, 1.85]) {
      g.use('rubber').tint(0.14, 0.15, 0.18).cyl(wx - 0.14, 0.42, wz, wx + 0.14, 0.42, wz, 0.42, 0.42, 10);
    }
  }
  // Headlights & red taillights
  g.use('emissiveDim').tint(1.0, 0.95, 0.84);
  g.box(-0.74, 0.85, 3.01, 0.2, 0.12, 0.04, FACE.pz);
  g.box(0.74, 0.85, 3.01, 0.2, 0.12, 0.04, FACE.pz);
  g.use('emissiveRed').tint(0.95);
  g.box(-0.78, 0.95, -2.74, 0.18, 0.18, 0.04, FACE.nz);
  g.box(0.78, 0.95, -2.74, 0.18, 0.18, 0.04, FACE.nz);
  // Rooftop equipment rack, glowing cyan/red LIVE broadcast bar, and telescoping parabolic satellite dish!
  g.use('steelDark').tint(...GRAPHITE).bevel(0, 2.42, -0.3, 0.92, 0.09, 1.9, 0.03);
  g.use('screen').tint(0.75, 0.92, 1.0).box(0, 2.58, 1.45, 0.65, 0.12, 0.14, FACE.all);
  g.use('emissiveRed').tint(1).box(-0.74, 2.58, 1.45, 0.12, 0.12, 0.14, FACE.all);
  g.use('emissiveRed').tint(1).box(0.74, 2.58, 1.45, 0.12, 0.12, 0.14, FACE.all);
  // Satellite uplink mast + tilted white dish
  g.use('steel').tint(...WHITE).cyl(0, 2.48, -1.25, 0, 4.35, -1.25, 0.09, 0.06, 8);
  g.use('concrete').tint(...WHITE).cyl(0, 4.35, -1.25, 0, 4.85, -0.55, 0.72, 0.82, 12);
  g.use('steelDark').tint(...GRAPHITE).cyl(0, 4.6, -0.9, 0, 5.2, -0.25, 0.05, 0.03, 6);
  g.tint(1);
  k.collide(0, 1.25, 0.1, 1.12, 1.25, 2.85, 'metal');
  k.pop();
}

/** Sculpted civilian parked sedan (purely visual curb dressing outside combat lanes, low profile). */
function buildParkedCar(k: Kit, x: number, z: number, yaw: number, paint: readonly [number, number, number]): void {
  k.push(x, 0, z, yaw);
  const g = k.geo;
  // Lower body
  g.use('panel').tint(paint[0], paint[1], paint[2]).bevel(0, 0.64, 0, 0.94, 0.36, 2.25, 0.08);
  // Cabin greenhouse
  g.use('panel').tint(paint[0] * 0.9, paint[1] * 0.9, paint[2] * 0.9).bevel(0, 1.2, -0.18, 0.8, 0.28, 1.05, 0.07);
  // Tinted windshield & rear glass
  g.use('panel').tint(0.11, 0.15, 0.22);
  g.box(0, 1.18, 0.88, 0.72, 0.24, 0.04, FACE.pz);
  g.box(0, 1.18, -1.24, 0.72, 0.24, 0.04, FACE.nz);
  g.box(-0.81, 1.18, -0.18, 0.03, 0.22, 0.88, FACE.nx);
  g.box(0.81, 1.18, -0.18, 0.03, 0.22, 0.88, FACE.px);
  // 4 tires
  g.use('rubber').tint(0.13, 0.14, 0.17);
  for (const wx of [-0.9, 0.9]) {
    for (const wz of [-1.35, 1.38]) {
      g.cyl(wx - 0.12, 0.34, wz, wx + 0.12, 0.34, wz, 0.34, 0.34, 8);
    }
  }
  g.use('emissiveDim').tint(1.0, 0.94, 0.82).box(-0.62, 0.68, 2.26, 0.18, 0.09, 0.03, FACE.pz);
  g.box(0.62, 0.68, 2.26, 0.18, 0.09, 0.03, FACE.pz);
  g.use('emissiveRed').tint(0.9).box(-0.62, 0.68, -2.26, 0.18, 0.09, 0.03, FACE.nz);
  g.box(0.62, 0.68, -2.26, 0.18, 0.09, 0.03, FACE.nz);
  g.tint(1);
  k.pop();
}

/** Stylized urban street tree in a chamfered granite planter (visual only, lush green foliage). */
function buildStreetTree(k: Kit, x: number, z: number, scale = 1.0): void {
  const g = k.geo;
  // Granite planter rim & soil
  g.use('concrete').tint(...GRANITE).bevel(x, 0.32, z, 1.05, 0.32, 1.05, 0.05);
  g.use('dirt').tint(0.28, 0.22, 0.17).box(x, 0.65, z, 0.86, 0.05, 0.86, FACE.py);
  // Tapered bark trunk
  g.use('dirt').tint(0.32, 0.24, 0.17).cyl(x, 0.65, z, x, 3.1 * scale, z, 0.22 * scale, 0.14 * scale, 8);
  // Layered architectural green foliage crown
  g.use('dirt').tint(0.18, 0.44, 0.24).cyl(x, 2.9 * scale, z, x, 4.4 * scale, z, 1.55 * scale, 1.25 * scale, 8, true, true);
  g.use('dirt').tint(0.22, 0.52, 0.27).cyl(x, 4.2 * scale, z, x, 5.45 * scale, z, 1.2 * scale, 0.55 * scale, 8, true, true);
  g.tint(1);
}

/** Modern steel-and-glass downtown transit bus shelter with glowing ad lightbox & bench. */
function buildTransitShelter(k: Kit, x: number, z: number, yaw: number): void {
  k.push(x, 0, z, yaw);
  const g = k.geo;
  g.use('steelDark').tint(...GRAPHITE);
  for (const sx of [-2.0, 0, 2.0]) {
    g.cyl(sx, 0, -0.75, sx, 2.85, -0.75, 0.07, 0.07, 8);
  }
  // Roof canopy
  g.bevel(0, 2.92, 0.1, 2.25, 0.1, 1.1, 0.03);
  // Back glass panel + illuminated side ad display box (soft non-blooming screen/emissiveDim posters)
  g.use('glass').tint(...GLASS_TINT).box(0, 1.45, -0.72, 1.95, 1.25, 0.04, FACE.all);
  g.use('steelDark').tint(...GRAPHITE).bevel(2.1, 1.45, 0.05, 0.14, 1.32, 0.72, 0.03);
  g.use('screen').tint(0.65, 0.82, 0.94).box(2.26, 1.5, 0.05, 0.03, 1.0, 0.55, FACE.px);
  g.use('emissiveDim').tint(0.92, 0.86, 0.76).box(1.94, 1.5, 0.05, 0.03, 1.0, 0.55, FACE.nx);
  // Waiting bench
  g.use('steel').tint(...GRANITE).bevel(-0.3, 0.5, -0.25, 1.45, 0.06, 0.28, 0.02);
  g.use('steelDark').tint(...GRAPHITE);
  g.box(-1.3, 0.24, -0.25, 0.08, 0.24, 0.24, FACE.all);
  g.box(0.7, 0.24, -0.25, 0.08, 0.24, 0.24, FACE.all);
  g.tint(1);
  k.pop();
}

/** 4-Way Intersection overhead cantilevered traffic signal gantry. */
function buildTrafficSignal(k: Kit, x: number, z: number, yaw: number): void {
  k.push(x, 0, z, yaw);
  const g = k.geo;
  g.use('steelDark').tint(...GRAPHITE);
  g.cyl(0, 0, 0, 0, 7.6, 0, 0.15, 0.11, 8);
  // Cantilevered signal arm reaching over the carriageway (+X in local coords)
  g.cyl(0, 7.1, 0, 6.2, 7.1, 0, 0.1, 0.08, 8);
  // Two vertical signal housings with glowing red/amber/green lights
  for (const ax of [2.6, 5.2]) {
    g.use('steelDark').tint(...GRAPHITE).bevel(ax, 6.55, 0, 0.22, 0.56, 0.18, 0.03);
    g.use('emissiveRed').tint(1).box(ax, 6.84, 0.19, 0.11, 0.11, 0.03, FACE.pz);
    g.use('emissiveOrange').tint(0.45).box(ax, 6.55, 0.19, 0.11, 0.11, 0.03, FACE.pz);
    g.use('emissiveCyan').tint(...SUBWAY_GREEN).box(ax, 6.26, 0.19, 0.11, 0.11, 0.03, FACE.pz);
  }
  g.tint(1);
  k.pop();
}

/**
 * Lived-in downtown street dressing: OpenMind Plaza Press Broadcast Zone (News Vans, press barricades,
 * broadcast tripods), urban street trees, transit shelters, traffic signals, and curb-parked cars.
 */
function buildUrbanStreetLife(k: Kit): void {
  const g = k.geo;

  // --- 1. OpenMind Plaza Press Corps Broadcast Zone (z = 22..32, flanking x = -7..+7 breakout lane!) ---
  buildNewsVan(k, -13.2, 27.5, 0.32, [0.12, 0.42, 0.85]); // Channel 4 Blue News Van
  buildNewsVan(k, 13.4, 28.0, -0.34, [0.85, 0.18, 0.22]); // Metro Live Red News Van

  // Steel press crowd-control barricades & broadcast camera tripods framing the HQ steps
  for (const side of [-1, 1] as const) {
    for (const bx of [8.4, 11.4]) {
      const x = side * bx;
      g.use('steel').tint(0.75, 0.8, 0.86);
      g.bevel(x, 0.95, 22.8, 1.35, 0.06, 0.05, 0.01);
      g.bevel(x, 0.32, 22.8, 1.35, 0.05, 0.05, 0.01);
      for (const rx of [-1.2, -0.6, 0, 0.6, 1.2]) {
        g.cyl(x + rx, 0.08, 22.8, x + rx, 0.95, 22.8, 0.035, 0.035, 6);
      }
      g.bevel(x - 1.15, 0.05, 22.8, 0.06, 0.05, 0.36, 0.01);
      g.bevel(x + 1.15, 0.05, 22.8, 0.06, 0.05, 0.36, 0.01);
    }
    // Tripod TV news camera aimed north at OpenMind HQ doors (with glowing red ON-AIR tally LED!)
    const tx = side * 9.8;
    const tz = 24.4;
    g.use('steelDark').tint(...GRAPHITE);
    g.cyl(tx - 0.35, 0, tz + 0.25, tx, 1.48, tz, 0.03, 0.025, 6);
    g.cyl(tx + 0.35, 0, tz + 0.25, tx, 1.48, tz, 0.03, 0.025, 6);
    g.cyl(tx, 0, tz - 0.35, tx, 1.48, tz, 0.03, 0.025, 6);
    g.bevel(tx, 1.62, tz, 0.16, 0.15, 0.32, 0.02);
    g.cyl(tx, 1.62, tz - 0.32, tx, 1.62, tz - 0.56, 0.09, 0.11, 8);
    g.use('emissiveRed').tint(1).box(tx, 1.8, tz - 0.18, 0.06, 0.05, 0.05, FACE.all);
  }
  g.tint(1);

  // --- 2. 4-Way Financial Intersection Traffic Signal Gantries ---
  buildTrafficSignal(k, -17.4, 99.0, 0);
  buildTrafficSignal(k, 17.4, 119.0, Math.PI);
  buildTrafficSignal(k, 17.4, 99.0, -Math.PI / 2);
  buildTrafficSignal(k, -17.4, 119.0, Math.PI / 2);

  // --- 3. Modern Glass Transit Bus Shelters on Grand Boulevard Sidewalks ---
  buildTransitShelter(k, -18.8, 62.0, Math.PI / 2);
  buildTransitShelter(k, 18.8, 66.0, -Math.PI / 2);

  // --- 4. Urban Street Trees lining Sidewalks & Civic Spire Plaza Perimeter ---
  const treeSpots: readonly [number, number, number][] = [
    [-18.4, 34, 1.0],
    [-18.4, 52, 1.05],
    [-18.4, 74, 0.95],
    [18.4, 32, 1.0],
    [18.4, 88, 1.0],
    [-36.5, 134, 1.15],
    [-36.5, 152, 1.1],
    [36.5, 134, 1.1],
    [36.5, 152, 1.15],
    [-16.0, 160.2, 1.05],
    [16.0, 160.2, 1.05],
  ];
  for (const [tx, tz, sc] of treeSpots) {
    buildStreetTree(k, tx, tz, sc);
  }

  // --- 5. Parked Civilian Cars tucked along Outer Curb Lanes & Cross-Avenue (clear of combat lanes/spawns/pickups) ---
  buildParkedCar(k, -13.4, 46.5, 0.03, [0.22, 0.3, 0.44]);
  buildParkedCar(k, -13.5, 68.5, -0.04, [0.76, 0.78, 0.82]);
  buildParkedCar(k, 13.5, 76.0, Math.PI + 0.05, [0.58, 0.18, 0.2]);
  buildParkedCar(k, -42.0, 102.2, Math.PI / 2, [0.26, 0.28, 0.32]);
  buildParkedCar(k, -50.5, 115.6, -Math.PI / 2, [0.82, 0.84, 0.88]);
  buildParkedCar(k, 43.0, 102.2, Math.PI / 2, [0.18, 0.38, 0.46]);
  buildParkedCar(k, 51.0, 115.6, -Math.PI / 2, [0.36, 0.4, 0.46]);
}

/** Dense 360° solid-core sunlit downtown skyscraper skyline framing Grand Boulevard & Spire Plaza (visual only). */
function buildDowntownSkylineBackdrop(k: Kit): void {
  const towers: readonly [number, number, number, number, number, CityFacadeStyle][] = [
    // West downtown skyline ring
    [-82, 24, 24, 24, 62, 'glass_blue'],
    [-86, 56, 26, 26, 74, 'white_modern'],
    [-82, 88, 24, 24, 58, 'slate_corporate'],
    [-86, 128, 26, 26, 68, 'glass_blue'],
    [-84, 162, 28, 26, 60, 'warm_stone'],
    [-116, 44, 28, 28, 86, 'slate_corporate'],
    [-118, 108, 30, 28, 80, 'glass_blue'],
    [-114, 168, 28, 28, 72, 'white_modern'],
    [-162, 82, 34, 30, 92, 'glass_blue'],
    [-158, 152, 34, 30, 84, 'warm_stone'],
    // East downtown skyline ring
    [82, 24, 24, 24, 66, 'warm_stone'],
    [86, 56, 26, 26, 78, 'glass_blue'],
    [82, 88, 24, 24, 62, 'white_modern'],
    [86, 128, 26, 26, 70, 'slate_corporate'],
    [84, 162, 28, 26, 58, 'glass_blue'],
    [116, 44, 28, 28, 84, 'glass_blue'],
    [118, 108, 30, 28, 76, 'warm_stone'],
    [114, 168, 28, 28, 74, 'slate_corporate'],
    [162, 82, 34, 30, 94, 'slate_corporate'],
    [158, 152, 34, 30, 86, 'glass_blue'],
    // South downtown skyline rising majestically behind Civic Parliament Hall!
    [-64, 198, 28, 26, 70, 'glass_blue'],
    [-30, 202, 28, 26, 82, 'white_modern'],
    [6, 206, 32, 28, 92, 'glass_blue'],
    [40, 200, 28, 26, 76, 'slate_corporate'],
    [72, 196, 28, 26, 66, 'warm_stone'],
    [-94, 206, 30, 28, 64, 'terracotta_brick'],
    [104, 208, 30, 28, 72, 'white_modern'],
    [-44, 248, 36, 30, 104, 'slate_corporate'],
    [26, 252, 38, 30, 110, 'glass_blue'],
  ];
  for (let i = 0; i < towers.length; i++) {
    const [cx, cz, w, d, h, style] = towers[i]!;
    buildRealCityBuilding(k, cx, cz, w, d, h, style, i + 100, false, true);
  }
}

/** Crisp daylight downtown sunlight washes down Grand Boulevard, Intersection, and Civic Spire Plaza. */
function buildBoulevardLighting(k: Kit): void {
  const SUN = 0xfff6e5;
  const SKY = 0xdcf0ff;
  const lights: readonly [number, number, number, number, number, number][] = [
    [0, 16, 34, SUN, 120, 42],
    [0, 16, 66, SUN, 120, 42],
    [0, 16, 94, SKY, 110, 40],
    [-26, 16, 109, SUN, 95, 36],
    [26, 16, 109, SUN, 95, 36],
    [0, 18, 144, SUN, 130, 46],
    [-30, 16, 144, SKY, 85, 34],
    [30, 16, 144, SKY, 85, 34],
  ];
  for (const [x, y, z, col, intensity, radius] of lights) {
    k.light(x, y, z, col, intensity, radius);
  }
}

export function authorBoulevard(k: Kit, spec: MapSpec): void {
  buildGroundAndRoads(k, spec);
  buildPlazaGarage(k, spec);
  for (let i = 0; i < BOULEVARD.storefronts.length; i++) {
    buildStorefrontCluster(k, spec, BOULEVARD.storefronts[i]!, i);
  }
  buildPedestrianSkybridge(spec);
  buildIntersectionCorners(spec);
  buildSpirePlaza(k, spec);
  buildSubwayEntrances(k);
  buildDowntownStreetWall(k);
  buildUrbanStreetLife(k);
  buildDowntownSkylineBackdrop(k);
  buildBoulevardLighting(k);
}
