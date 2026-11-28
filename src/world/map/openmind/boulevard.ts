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
      g.use('emissiveWhite').tint(0.95).box(sx - Math.sign(sx) * 1.4, 7.22, sz, 0.45, 0.05, 0.16, FACE.ny);
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

/** Build one destructible multi-story downtown storefront & colonnade cluster (`blvd.west1..3`, `blvd.east1..2`). */
function buildStorefrontCluster(
  spec: MapSpec,
  s: (typeof BOULEVARD.storefronts)[number],
): void {
  const streetSign = s.x < 0 ? 1 : -1; // +1 faces east toward boulevard, -1 faces west
  const hw = s.w / 2;
  const hd = s.d / 2;
  const midH = 5.2;
  const colX = s.x + streetSign * (hw - 0.65);
  const backX = s.x - streetSign * (hw - 0.5);
  const colHp = s.tier === 2 ? 360 : 220;
  const wallHp = s.tier === 2 ? 300 : 180;

  const nodes: StructuralNodeSpec[] = [
    // 3 street-facing anchored colonnade columns (shearing these drops the cantilevered upper floor!)
    {
      id: `${s.tag}_col_n`,
      pos: [colX, midH / 2, s.z - hd + 1.0],
      half: [0.55, midH / 2, 0.55],
      mat: 'concrete',
      color: 0xdce4ee,
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
      half: [0.55, midH / 2, 0.55],
      mat: 'concrete',
      color: 0xdce4ee,
      hp: colHp,
      tier: s.tier,
      anchored: true,
      kind: 'column',
      supports: [`${s.tag}_slab`],
      label: `${s.label} COLUMN M`,
    },
    {
      id: `${s.tag}_col_s`,
      pos: [colX, midH / 2, s.z + hd - 1.0],
      half: [0.55, midH / 2, 0.55],
      mat: 'concrete',
      color: 0xdce4ee,
      hp: colHp,
      tier: s.tier,
      anchored: true,
      kind: 'column',
      supports: [`${s.tag}_slab`],
      label: `${s.label} COLUMN S`,
    },
    // Rear structural bearing wall
    {
      id: `${s.tag}_back`,
      pos: [backX, midH / 2, s.z],
      half: [0.5, midH / 2, hd - 0.4],
      mat: 'concreteDark',
      color: 0x6c7788,
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
      pos: [colX - streetSign * 1.4, midH / 2, s.z],
      half: [0.22, midH / 2 - 0.2, hd - 1.4],
      mat: 'glass',
      color: 0x86c8e8,
      hp: 90,
      tier: 1,
      anchored: true,
      supportRole: 'infill',
      kind: 'wall',
      supports: [`${s.tag}_slab`],
      label: `${s.label} STOREFRONT GLASS`,
    },
    // Heavy 2nd-story cantilevered floor slab
    {
      id: `${s.tag}_slab`,
      pos: [s.x, midH + 0.35, s.z],
      half: [hw, 0.35, hd],
      mat: 'concrete',
      color: 0xe6edf5,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'slab',
      supports: [`${s.tag}_col_n`, `${s.tag}_col_m`, `${s.tag}_col_s`, `${s.tag}_back`, `${s.tag}_upper_front`, `${s.tag}_upper_back`],
      impactRadius: 5.5,
      impactDamage: 240,
      label: `${s.label} MEZZANINE SLAB`,
    },
    // Upper curtain wall facade & rear wall
    {
      id: `${s.tag}_upper_front`,
      pos: [colX, (midH + 0.7 + s.h) / 2, s.z],
      half: [0.45, (s.h - midH - 0.7) / 2, hd - 0.3],
      mat: 'glass',
      color: 0x7cbde0,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER FACADE`,
    },
    {
      id: `${s.tag}_upper_back`,
      pos: [backX, (midH + 0.7 + s.h) / 2, s.z],
      half: [0.45, (s.h - midH - 0.7) / 2, hd - 0.3],
      mat: 'panel',
      color: 0xbac6d6,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'wall',
      supports: [`${s.tag}_slab`, `${s.tag}_roof`],
      label: `${s.label} UPPER BACK`,
    },
    // Roof cornice deck
    {
      id: `${s.tag}_roof`,
      pos: [s.x, s.h + 0.35, s.z],
      half: [hw + 0.2, 0.35, hd + 0.2],
      mat: 'steelDark',
      color: 0x3b4554,
      hp: wallHp,
      tier: s.tier,
      anchored: false,
      kind: 'roof',
      supports: [`${s.tag}_upper_front`, `${s.tag}_upper_back`],
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

  spec.plan?.blocks.push({ x0: s.x - hw, z0: s.z - hd, x1: s.x + hw, z1: s.z + hd });
}

/** Destructible Pedestrian Skybridge (`blvd.skybridge`) spanning Grand Boulevard at z = +86 (clearance 8.5 m). */
function buildPedestrianSkybridge(spec: MapSpec): void {
  const sb = BOULEVARD.skybridge;
  const hd = sb.depth / 2;
  const deckH = 0.55;
  const galH = sb.topY - (sb.deckY + deckH);

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
      // 3 Suspended structural deck & glass-tube spans across the boulevard (y = 8.5..12.6)
      {
        id: 'skybridge_span_w',
        pos: [-13.5, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'steel',
        color: 0x9aa8b8,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'catwalk',
        supports: ['skybridge_pier_w', 'skybridge_span_c', 'skybridge_glass_w'],
        impactRadius: 6.5,
        impactDamage: 280,
        label: 'SKYBRIDGE WEST DECK',
      },
      {
        id: 'skybridge_span_c',
        pos: [0, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'steel',
        color: 0x9aa8b8,
        hp: 300,
        tier: 2,
        anchored: false,
        keyNode: true,
        kind: 'catwalk',
        supports: ['skybridge_span_w', 'skybridge_span_e', 'skybridge_glass_c'],
        impactRadius: 7.5,
        impactDamage: 320,
        label: 'SKYBRIDGE CENTER SPAN',
      },
      {
        id: 'skybridge_span_e',
        pos: [13.5, sb.deckY, sb.z],
        half: [6.8, deckH, hd],
        mat: 'steel',
        color: 0x9aa8b8,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'catwalk',
        supports: ['skybridge_pier_e', 'skybridge_span_c', 'skybridge_glass_e'],
        impactRadius: 6.5,
        impactDamage: 280,
        label: 'SKYBRIDGE EAST DECK',
      },
      // Glass enclosure canopies atop each span
      {
        id: 'skybridge_glass_w',
        pos: [-13.5, sb.deckY + deckH + galH / 2, sb.z],
        half: [6.6, galH / 2, hd - 0.15],
        mat: 'glass',
        color: 0x86d0f2,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_w'],
        label: 'SKYBRIDGE WEST GLASS',
      },
      {
        id: 'skybridge_glass_c',
        pos: [0, sb.deckY + deckH + galH / 2, sb.z],
        half: [6.6, galH / 2, hd - 0.15],
        mat: 'glass',
        color: 0x86d0f2,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_c'],
        label: 'SKYBRIDGE CENTER GLASS',
      },
      {
        id: 'skybridge_glass_e',
        pos: [13.5, sb.deckY + deckH + galH / 2, sb.z],
        half: [6.6, galH / 2, hd - 0.15],
        mat: 'glass',
        color: 0x86d0f2,
        hp: 150,
        tier: 1,
        anchored: false,
        supportRole: 'infill',
        kind: 'roof',
        supports: ['skybridge_span_e'],
        label: 'SKYBRIDGE EAST GLASS',
      },
    ],
  });
}

/** 4 Destructible Corner Office Buildings (`corner.nw..se`) with load-bearing street stagger columns for Stage 2. */
function buildIntersectionCorners(spec: MapSpec): void {
  for (const c of BOULEVARD.intersection.corners) {
    const hw = c.w / 2; // 7
    const hd = c.d / 2; // 6
    const midH = 5.8;
    const faceXSign = c.x < 0 ? 1 : -1;
    const faceZSign = c.z < 109 ? 1 : -1;
    const colCornerX = c.x + faceXSign * (hw - 0.7);
    const colCornerZ = c.z + faceZSign * (hd - 0.7);
    const rearX = c.x - faceXSign * (hw - 0.6);
    const rearZ = c.z - faceZSign * (hd - 0.6);

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
          half: [0.72, midH / 2, 0.72],
          mat: 'concrete',
          color: 0xe2e9f2,
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
          half: [0.65, midH / 2, 0.65],
          mat: 'concrete',
          color: 0xe2e9f2,
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
          half: [0.65, midH / 2, 0.65],
          mat: 'concrete',
          color: 0xe2e9f2,
          hp: 380,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} BOULEVARD COLUMN`,
        },
        // Rear core pier
        {
          id: `${c.tag}_core`,
          pos: [rearX, midH / 2, rearZ],
          half: [1.4, midH / 2, 1.4],
          mat: 'concreteDark',
          color: 0x5c6878,
          hp: 460,
          tier: 2,
          anchored: true,
          kind: 'column',
          supports: [`${c.tag}_slab`],
          label: `${c.label} REAR CORE`,
        },
        // Heavy cantilevered 2nd-story concrete office slab (falls on ORION when columns shear!)
        {
          id: `${c.tag}_slab`,
          pos: [c.x, midH + 0.45, c.z],
          half: [hw, 0.45, hd],
          mat: 'concrete',
          color: 0xe8eff7,
          hp: 400,
          tier: 2,
          anchored: false,
          kind: 'slab',
          supports: [`${c.tag}_col_corner`, `${c.tag}_col_x`, `${c.tag}_col_z`, `${c.tag}_core`, `${c.tag}_upper_n`, `${c.tag}_upper_s`],
          impactRadius: 6.5,
          impactDamage: 340,
          label: `${c.label} OVERHANG SLAB`,
        },
        // Upper glass-and-concrete office story
        {
          id: `${c.tag}_upper_n`,
          pos: [c.x, (midH + 0.9 + c.h) / 2, c.z - hd + 0.6],
          half: [hw - 0.3, (c.h - midH - 0.9) / 2, 0.5],
          mat: 'glass',
          color: 0x7ac4e8,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL N`,
        },
        {
          id: `${c.tag}_upper_s`,
          pos: [c.x, (midH + 0.9 + c.h) / 2, c.z + hd - 0.6],
          half: [hw - 0.3, (c.h - midH - 0.9) / 2, 0.5],
          mat: 'glass',
          color: 0x7ac4e8,
          hp: 260,
          tier: 2,
          anchored: false,
          kind: 'wall',
          supports: [`${c.tag}_slab`, `${c.tag}_roof`],
          label: `${c.label} UPPER WALL S`,
        },
        // Heavy concrete crown roof
        {
          id: `${c.tag}_roof`,
          pos: [c.x, c.h + 0.45, c.z],
          half: [hw + 0.25, 0.45, hd + 0.25],
          mat: 'steelDark',
          color: 0x354050,
          hp: 360,
          tier: 2,
          anchored: false,
          kind: 'roof',
          supports: [`${c.tag}_upper_n`, `${c.tag}_upper_s`],
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

/** Sunlit white/blue-glass downtown skyscraper canyon framing Grand Boulevard & Spire Plaza (visual only). */
function buildDowntownSkylineBackdrop(k: Kit): void {
  const g = k.geo;
  const towers: readonly [number, number, number, number, number, Mat][] = [
    [-76, 36, 24, 24, 58, 'glass'],
    [-78, 72, 26, 24, 66, 'concrete'],
    [-78, 138, 26, 28, 62, 'glass'],
    [76, 36, 24, 24, 60, 'concrete'],
    [78, 74, 26, 24, 70, 'glass'],
    [78, 138, 26, 28, 56, 'panel'],
    [-46, 186, 28, 24, 68, 'glass'],
    [0, 192, 34, 26, 76, 'concrete'],
    [48, 186, 28, 24, 64, 'glass'],
  ];
  for (const [cx, cz, w, d, h, mat] of towers) {
    const tint = mat === 'glass' ? GLASS_TINT : WHITE;
    g.use(mat).tint(tint[0], tint[1], tint[2]).box(cx, h / 2 - 2, cz, w / 2, h / 2 + 2, d / 2, FACE.noBottom);
    g.use('concrete').tint(...WHITE).box(cx, h + 1.4, cz, w * 0.36, 1.4, d * 0.36, FACE.noBottom);
    g.use('emissiveCyan').tint(0.75).box(cx, h - 1.5, cz, w / 2 + 0.12, 0.2, d / 2 + 0.12, FACE.sides);
  }
  g.tint(1);
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
  for (const s of BOULEVARD.storefronts) buildStorefrontCluster(spec, s);
  buildPedestrianSkybridge(spec);
  buildIntersectionCorners(spec);
  buildSpirePlaza(k, spec);
  buildSubwayEntrances(k);
  buildDowntownSkylineBackdrop(k);
  buildBoulevardLighting(k);
}
