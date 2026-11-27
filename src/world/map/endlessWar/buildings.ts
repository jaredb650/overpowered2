/**
 * Enterable, structurally realistic destructible war-zone buildings for Endless War (`map: 'endless_war'`).
 *
 * Every building is authored as a real architectural structural frame (`StructuralClusterSpec`):
 *   - Floor elevations match `ENDLESS_WAR_LEVELS` (`0, 3.6, 7.2, 10.8 m`) with `navWalkable: true` slabs,
 *     interior staircases, and wide driveable parking-garage ramps so players, AI squads, and vehicles can
 *     enter, climb to firing vantage points, and fight floor-to-floor.
 *   - Load-bearing skeletons (`primary` columns, beams, bearing walls) connect cleanly to floor bays;
 *     interior partitions, window glass, and knee-wall parapets are tagged `infill` so they never falsely
 *     hold up upper floors.
 *   - Large panels use `lazyFracture: true` so buildings spawn fast & batched, then fracture locally around
 *     each explosive/vehicle impact with darkened aggregate cores and exposed bent steel rebar stubs.
 *   - Material gating enforces realism: assault rifles cannot destroy concrete offices or timber shacks;
 *     .50 cal / HMGs shred timber watchtowers & shacks; heavy explosives breach concrete offices & parking
 *     garages; tanks smash straight through drywall/timber/masonry houses while bouncing off Tier-3 bunkers.
 */
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import type { MapSpec } from '../spec';

const FLOOR_H = 3.6;
const SLAB_HALF_Y = 0.14;

/** Local-to-world coordinate transformer matching Three.js Euler `'YXZ'` Y-rotation convention. */
function makeTransform(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
}

/** Registers a building footprint into the tactical minimap plan. */
function recordFootprint(spec: MapSpec | undefined, x: number, z: number, hw: number, hd: number, yaw: number): void {
  if (!spec?.plan) return;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = hw * c + hd * s;
  const ez = hw * s + hd * c;
  spec.plan.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
}

/** Adds an undirected structural edge `[a, b]` to `edges`. */
function link(edges: [string, string][], a: string, b: string): void {
  edges.push([a, b]);
}

// ---------------------------------------------------------------------------
// 1. Enterable Multi-Story Poured-Concrete War Office Building (2 or 3 Floors)
// ---------------------------------------------------------------------------

export function buildWarOfficeCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
  floors: 2 | 3 = 3,
  opts?: { tint?: [number, number, number]; spec?: MapSpec; label?: string },
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const nodes: StructuralNodeSpec[] = [];
  const edges: [string, string][] = [];

  const W = 16;
  const D = 12;
  const hw = W / 2; // 8
  const hd = D / 2; // 6
  const wt = 0.24; // half thickness (0.48 m thick concrete facade)
  const colHalf = 0.34;
  const baseTint = opts?.tint ?? [0.48, 0.50, 0.52];
  const darkTint: [number, number, number] = [baseTint[0] * 0.78, baseTint[1] * 0.78, baseTint[2] * 0.8];
  const slabTint: [number, number, number] = [0.38, 0.40, 0.42];
  const interiorTint: [number, number, number] = [0.66, 0.64, 0.59];

  const colXs = [-hw + 0.35, 0, hw - 0.35] as const;
  const colZs = [-hd + 0.35, hd - 0.35] as const;
  const colId = (f: number, ix: number, iz: number) => `col_f${f}_${ix}_${iz}`;

  // Build structural stories f = 0..floors-1
  for (let f = 0; f < floors; f++) {
    const y0 = f * FLOOR_H;
    const clearH = FLOOR_H - SLAB_HALF_Y * 2; // 3.32 m clear below upper slab
    const colCy = y0 + clearH / 2;
    const anchored = f === 0;

    // 6 reinforced poured-concrete structural columns (3x2 grid)
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        const cid = colId(f, ix, iz);
        nodes.push({
          id: cid,
          pos: pt(colXs[ix]!, colCy, colZs[iz]!),
          half: [colHalf, clearH / 2, colHalf],
          mat: 'concreteDark',
          color: darkTint,
          hp: f === 0 ? 520 : 420,
          tier: 2,
          anchored,
          kind: 'column',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'load_bearing',
          loadCapacity: f === 0 ? 185_000 : 120_000,
        });
        if (f > 0) {
          link(edges, colId(f - 1, ix, iz), cid);
        }
      }
    }

    // Upper floor / roof slab at top of story f (walkable surface at exact (f+1) * FLOOR_H)
    const slabTopY = (f + 1) * FLOOR_H;
    const slabCy = slabTopY - SLAB_HALF_Y;
    const isRoof = f === floors - 1;

    // East bay slab (full depth z in [-hd, +hd], x in [0, +hw])
    const eastSlabId = `slab_f${f + 1}_e`;
    nodes.push({
      id: eastSlabId,
      pos: pt(hw / 2, slabCy, 0),
      half: [hw / 2 - 0.04, SLAB_HALF_Y, hd - 0.04],
      mat: isRoof ? 'concreteDark' : 'concrete',
      color: slabTint,
      hp: 620,
      tier: 2,
      anchored: false,
      kind: isRoof ? 'roof' : 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [3, 2],
      navWalkable: true,
      impactRadius: 7.5,
    });
    // East bay rests on center & east columns
    link(edges, colId(f, 1, 0), eastSlabId);
    link(edges, colId(f, 1, 1), eastSlabId);
    link(edges, colId(f, 2, 0), eastSlabId);
    link(edges, colId(f, 2, 1), eastSlabId);

    // West-front bay slab (x in [-hw, 0], z in [-2.6, +hd] -> leaves z in [-hd, -2.6] open for the interior stairwell!)
    const westFrontId = `slab_f${f + 1}_wf`;
    const wfZ0 = -2.6;
    const wfZ1 = hd - 0.04;
    nodes.push({
      id: westFrontId,
      pos: pt(-hw / 2, slabCy, (wfZ0 + wfZ1) / 2),
      half: [hw / 2 - 0.04, SLAB_HALF_Y, (wfZ1 - wfZ0) / 2],
      mat: isRoof ? 'concreteDark' : 'concrete',
      color: slabTint,
      hp: 580,
      tier: 2,
      anchored: false,
      kind: isRoof ? 'roof' : 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [3, 2],
      navWalkable: true,
      impactRadius: 7.0,
    });
    link(edges, colId(f, 0, 1), westFrontId);
    link(edges, colId(f, 1, 1), westFrontId);
    link(edges, colId(f, 0, 0), westFrontId);
    link(edges, colId(f, 1, 0), westFrontId);
    link(edges, westFrontId, eastSlabId);

    // West-north landing strip at the top of the stairs (x in [-hw, -5.6], z in [-hd, -2.6])
    const landingId = `slab_f${f + 1}_wl`;
    const landX0 = -hw + 0.04;
    const landX1 = -5.4;
    nodes.push({
      id: landingId,
      pos: pt((landX0 + landX1) / 2, slabCy, (-hd + 0.04 + wfZ0) / 2),
      half: [(landX1 - landX0) / 2, SLAB_HALF_Y, (wfZ0 - (-hd + 0.04)) / 2],
      mat: 'concrete',
      color: slabTint,
      hp: 420,
      tier: 2,
      anchored: false,
      kind: 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      navWalkable: true,
    });
    link(edges, colId(f, 0, 0), landingId);
    link(edges, westFrontId, landingId);

    // Interior concrete staircase climbing along the north bay (z = -4.2, width 2.5 m)
    // Runs from x = +1.8 (bottom at y0) up to x = -5.4 (top at slabTopY): dx = 7.2 m, dy = 3.6 m -> 26.5 deg!
    const stairRun = 7.2;
    const stairAngle = Math.atan2(FLOOR_H, stairRun); // +0.4636 rad -> slope up toward -X => roll = -stairAngle
    const stairLen = Math.hypot(stairRun, FLOOR_H);
    const stairId = `stair_f${f}`;
    nodes.push({
      id: stairId,
      pos: pt((-5.4 + 1.8) / 2, y0 + FLOOR_H / 2 - SLAB_HALF_Y, -4.2),
      half: [stairLen / 2 + 0.15, 0.14, 1.25],
      mat: 'concreteDark',
      color: [0.36, 0.37, 0.39],
      hp: 460,
      tier: 2,
      anchored: f === 0,
      kind: 'catwalk',
      yaw,
      roll: -stairAngle,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      navWalkable: true,
    });
    link(edges, stairId, landingId);
    link(edges, stairId, eastSlabId);
    if (f > 0) {
      link(edges, stairId, `slab_f${f}_e`);
    }

    // Front (+Z) & Rear (-Z) exterior concrete facades
    const wallBaseY = y0;
    const wallFullH = clearH;
    const sillH = 1.05;
    const headY0 = y0 + 2.68;
    const headH = Math.max(0.42, y0 + wallFullH - headY0);

    if (f === 0) {
      // Ground floor: Wide 3.2 m unobstructed front (+Z) & rear (-Z) entrances in the East bay (x in [+2.2, +5.4]),
      // concrete piers flanking the doorway, and a firing-window bay on the West side (x in [-7.3, -0.35]).
      for (const side of ['s', 'n'] as const) {
        const wz = side === 's' ? hd - wt : -hd + wt;
        const iz = side === 's' ? 1 : 0;
        // East bay doorway piers (left pier x in [0.35, 2.2], right pier x in [5.4, 7.3])
        const pierL = `wall_f0_${side}_el`;
        const pierR = `wall_f0_${side}_er`;
        const lintelId = `lintel_f0_${side}`;
        nodes.push({
          id: pierL,
          pos: pt((0.35 + 2.2) / 2, wallBaseY + wallFullH / 2, wz),
          half: [(2.2 - 0.35) / 2, wallFullH / 2, wt],
          mat: 'concrete',
          color: baseTint,
          hp: 420,
          tier: 2,
          anchored: true,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'load_bearing',
          navBlock: true,
        });
        nodes.push({
          id: pierR,
          pos: pt((5.4 + hw - 0.65) / 2, wallBaseY + wallFullH / 2, wz),
          half: [(hw - 0.65 - 5.4) / 2, wallFullH / 2, wt],
          mat: 'concrete',
          color: baseTint,
          hp: 420,
          tier: 2,
          anchored: true,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'load_bearing',
          navBlock: true,
        });
        nodes.push({
          id: lintelId,
          pos: pt(3.8, headY0 + headH / 2, wz),
          half: [1.65, headH / 2, wt],
          mat: 'concreteDark',
          color: darkTint,
          hp: 340,
          tier: 2,
          anchored: false,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'infill',
        });
        link(edges, pierL, colId(0, 1, iz));
        link(edges, pierR, colId(0, 2, iz));
        link(edges, lintelId, pierL);
        link(edges, lintelId, pierR);

        // West bay ground-floor concrete wall with waist-high firing window & breakable glass
        const wx0 = -hw + 0.65;
        const wx1 = -0.35;
        const wcx = (wx0 + wx1) / 2;
        const whw = (wx1 - wx0) / 2;
        const sillW = `sill_f0_${side}_w`;
        const headW = `head_f0_${side}_w`;
        const glassW = `glass_f0_${side}_w`;
        nodes.push({
          id: sillW,
          pos: pt(wcx, wallBaseY + sillH / 2, wz),
          half: [whw, sillH / 2, wt],
          mat: 'concrete',
          color: baseTint,
          hp: 420,
          tier: 2,
          anchored: true,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'load_bearing',
          lazyFracture: true,
          fractureGrid: [2, 1],
          navBlock: true,
        });
        nodes.push({
          id: headW,
          pos: pt(wcx, headY0 + headH / 2, wz),
          half: [whw, headH / 2, wt],
          mat: 'concreteDark',
          color: darkTint,
          hp: 320,
          tier: 2,
          anchored: false,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'infill',
        });
        nodes.push({
          id: glassW,
          pos: pt(wcx, wallBaseY + sillH + (headY0 - (wallBaseY + sillH)) / 2, wz),
          half: [whw - 0.12, (headY0 - (wallBaseY + sillH)) / 2 - 0.04, 0.05],
          mat: 'glass',
          color: [0.46, 0.56, 0.62],
          hp: 16,
          tier: 0,
          anchored: false,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'glass',
          supportRole: 'infill',
        });
        link(edges, sillW, colId(0, 0, iz));
        link(edges, sillW, colId(0, 1, iz));
        link(edges, headW, colId(0, 0, iz));
        link(edges, headW, colId(0, 1, iz));
        link(edges, glassW, sillW);
      }
    } else {
      // Upper floors: panoramic war-office firing windows along South (+Z) & North (-Z) facades!
      for (const side of ['s', 'n'] as const) {
        const wz = side === 's' ? hd - wt : -hd + wt;
        const iz = side === 's' ? 1 : 0;
        for (const bay of ['w', 'e'] as const) {
          const x0 = bay === 'w' ? -hw + 0.65 : 0.35;
          const x1 = bay === 'w' ? -0.35 : hw - 0.65;
          const cx = (x0 + x1) / 2;
          const halfW = (x1 - x0) / 2;
          const sillId = `sill_f${f}_${side}_${bay}`;
          const headId = `head_f${f}_${side}_${bay}`;
          const glassId = `glass_f${f}_${side}_${bay}`;
          nodes.push({
            id: sillId,
            pos: pt(cx, wallBaseY + sillH / 2, wz),
            half: [halfW, sillH / 2, wt],
            mat: 'concrete',
            color: baseTint,
            hp: 360,
            tier: 2,
            anchored: false,
            kind: 'wall',
            yaw,
            materialClass: 'concrete',
            structuralMaterial: 'concrete',
            supportRole: 'infill',
            lazyFracture: true,
            fractureGrid: [2, 1],
          });
          nodes.push({
            id: headId,
            pos: pt(cx, headY0 + headH / 2, wz),
            half: [halfW, headH / 2, wt],
            mat: 'concreteDark',
            color: darkTint,
            hp: 300,
            tier: 2,
            anchored: false,
            kind: 'wall',
            yaw,
            materialClass: 'concrete',
            structuralMaterial: 'concrete',
            supportRole: 'infill',
          });
          // Breakable office glass window pane (shatters from a single bullet!)
          nodes.push({
            id: glassId,
            pos: pt(cx, wallBaseY + sillH + (headY0 - (wallBaseY + sillH)) / 2, wz),
            half: [halfW - 0.12, (headY0 - (wallBaseY + sillH)) / 2 - 0.04, 0.05],
            mat: 'glass',
            color: [0.46, 0.56, 0.62],
            hp: 16,
            tier: 0,
            anchored: false,
            kind: 'wall',
            yaw,
            materialClass: 'concrete',
            structuralMaterial: 'glass',
            supportRole: 'infill',
          });
          const hostSlab = bay === 'e' ? `slab_f${f}_e` : `slab_f${f}_wf`;
          link(edges, sillId, hostSlab);
          link(edges, sillId, colId(f, bay === 'w' ? 0 : 2, iz));
          link(edges, headId, colId(f, bay === 'w' ? 0 : 2, iz));
          link(edges, headId, colId(f, 1, iz));
          link(edges, glassId, sillId);
        }
      }
    }

    // West (-X) & East (+X) side walls with wide flanking firing window openings on every floor
    for (const side of ['w', 'e'] as const) {
      const wx = side === 'w' ? -hw + wt : hw - wt;
      const ix = side === 'w' ? 0 : 2;
      const sillId = `side_sill_f${f}_${side}`;
      const headId = `side_head_f${f}_${side}`;
      nodes.push({
        id: sillId,
        pos: pt(wx, wallBaseY + sillH / 2, 0),
        half: [wt, sillH / 2, hd - 0.7],
        mat: 'concrete',
        color: baseTint,
        hp: 400,
        tier: 2,
        anchored: f === 0,
        kind: 'wall',
        yaw,
        materialClass: 'concrete',
        structuralMaterial: 'concrete',
        supportRole: 'infill',
        lazyFracture: true,
        fractureGrid: [3, 1],
        navBlock: f === 0,
      });
      nodes.push({
        id: headId,
        pos: pt(wx, headY0 + headH / 2, 0),
        half: [wt, headH / 2, hd - 0.7],
        mat: 'concreteDark',
        color: darkTint,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'wall',
        yaw,
        materialClass: 'concrete',
        structuralMaterial: 'concrete',
        supportRole: 'infill',
      });
      link(edges, sillId, colId(f, ix, 0));
      link(edges, sillId, colId(f, ix, 1));
      link(edges, headId, colId(f, ix, 0));
      link(edges, headId, colId(f, ix, 1));
      if (f > 0) {
        link(edges, sillId, side === 'e' ? `slab_f${f}_e` : `slab_f${f}_wf`);
      }
      // Corner glass panel on upper floors
      if (f > 0) {
        const gId = `side_glass_f${f}_${side}`;
        nodes.push({
          id: gId,
          pos: pt(wx, wallBaseY + sillH + (headY0 - (wallBaseY + sillH)) / 2, 0),
          half: [0.05, (headY0 - (wallBaseY + sillH)) / 2 - 0.04, hd - 0.9],
          mat: 'glass',
          color: [0.46, 0.56, 0.62],
          hp: 18,
          tier: 0,
          anchored: false,
          kind: 'wall',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'glass',
          supportRole: 'infill',
        });
        link(edges, gId, sillId);
      }
    }

    // Interior drywall office partition dividing East & West suites with a wide open doorway (z in [-0.4, +2.0] open!)
    const partId = `drywall_f${f}_mid`;
    nodes.push({
      id: partId,
      pos: pt(0, wallBaseY + wallFullH / 2, 3.8),
      half: [0.11, wallFullH / 2 - 0.04, 1.8],
      mat: 'plaster',
      color: interiorTint,
      hp: 65,
      tier: 0,
      anchored: f === 0,
      kind: 'wall',
      yaw,
      materialClass: 'wood',
      structuralMaterial: 'drywall',
      supportRole: 'infill',
      lazyFracture: true,
      fractureGrid: [2, 2],
      navBlock: f === 0,
    });
    link(edges, partId, colId(f, 1, 1));
    if (f > 0) link(edges, partId, `slab_f${f}_e`);
  }

  // Rooftop perimeter firing parapets (y = floors * FLOOR_H .. +1.05 m) for epic high-ground sniper cover!
  const roofY = floors * FLOOR_H;
  const parapetH = 1.05;
  const roofSlabs = { e: `slab_f${floors}_e`, wf: `slab_f${floors}_wf`, wl: `slab_f${floors}_wl` };
  const parapets: readonly [string, number, number, number, number, string][] = [
    ['para_s_w', -hw / 2, hd - 0.2, hw / 2 - 0.1, 0.2, roofSlabs.wf],
    ['para_s_e', hw / 2, hd - 0.2, hw / 2 - 0.1, 0.2, roofSlabs.e],
    ['para_n_w', -hw / 2, -hd + 0.2, hw / 2 - 0.1, 0.2, roofSlabs.wl],
    ['para_n_e', hw / 2, -hd + 0.2, hw / 2 - 0.1, 0.2, roofSlabs.e],
    ['para_w', -hw + 0.2, 0, 0.2, hd - 0.4, roofSlabs.wf],
    ['para_e', hw - 0.2, 0, 0.2, hd - 0.4, roofSlabs.e],
  ];
  for (const [pid, px, pz, hx, hz, host] of parapets) {
    nodes.push({
      id: pid,
      pos: pt(px, roofY + parapetH / 2, pz),
      half: [hx, parapetH / 2, hz],
      mat: 'concreteDark',
      color: darkTint,
      hp: 300,
      tier: 2,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'infill',
      lazyFracture: true,
      fractureGrid: [2, 1],
    });
    link(edges, pid, host);
  }

  recordFootprint(opts?.spec, x, z, hw, hd, yaw);

  return {
    id,
    kind: 'war_office',
    label: opts?.label ?? `${floors}-STORY CONCRETE OFFICE`,
    value: floors === 3 ? 650 : 450,
    batched: true,
    collapseThreshold: 0.58,
    nodes,
    links: edges,
  };
}

// ---------------------------------------------------------------------------
// 2. 3-Level Driveable Concrete Parking Garage (Infantry + Vehicles!)
// ---------------------------------------------------------------------------

export function buildParkingGarageCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
  opts?: { spec?: MapSpec; label?: string },
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const nodes: StructuralNodeSpec[] = [];
  const edges: [string, string][] = [];

  const W = 26;
  const D = 18;
  const hw = W / 2; // 13
  const hd = D / 2; // 9
  const colHalf = 0.42;
  const colTint: [number, number, number] = [0.36, 0.38, 0.40];
  const deckTint: [number, number, number] = [0.43, 0.45, 0.46];
  const barrierTint: [number, number, number] = [0.50, 0.51, 0.52];

  // 4x3 concrete column grid spanning x = [-12.2, -4.1, +4.1, +12.2], z = [-8.2, 0, +8.2]
  const colXs = [-12.2, -4.1, 4.1, 12.2] as const;
  const colZs = [-8.2, 0, 8.2] as const;
  const colId = (f: number, ix: number, iz: number) => `pg_col_f${f}_${ix}_${iz}`;

  // Two elevated decks: Level 1 (y = 3.6) and Level 2 Roof Deck (y = 7.2)
  for (let f = 0; f < 2; f++) {
    const y0 = f * FLOOR_H;
    const clearH = FLOOR_H - SLAB_HALF_Y * 2;
    const colCy = y0 + clearH / 2;
    const anchored = f === 0;

    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        // Leave center-lane ramp clearance at interior mid columns where ramps enter/exit
        if (f === 0 && iz === 2 && (ix === 1 || ix === 2)) continue;
        if (f === 1 && iz === 0 && (ix === 1 || ix === 2)) continue;
        const cid = colId(f, ix, iz);
        nodes.push({
          id: cid,
          pos: pt(colXs[ix]!, colCy, colZs[iz]!),
          half: [colHalf, clearH / 2, colHalf],
          mat: 'concreteDark',
          color: colTint,
          hp: f === 0 ? 640 : 500,
          tier: 2,
          anchored,
          kind: 'column',
          yaw,
          materialClass: 'concrete',
          structuralMaterial: 'concrete',
          supportRole: 'load_bearing',
          loadCapacity: f === 0 ? 260_000 : 170_000,
        });
        if (f > 0) {
          // Connect to column directly below if present
          const below = colId(0, ix, iz);
          if (nodes.some(n => n.id === below)) link(edges, below, cid);
        }
      }
    }

    const slabTopY = (f + 1) * FLOOR_H;
    const slabCy = slabTopY - SLAB_HALF_Y;

    // Deck split into 3 structural bays with ramp slot open on South (f=0) or North (f=1):
    //   - West Turnaround Deck (x in [-13, -7.2], full depth z in [-9, +9])
    //   - East Turnaround Deck (x in [+7.2, +13], full depth z in [-9, +9])
    //   - Main Center Deck (x in [-7.2, +7.2], z in [-9, +2.8] for L1; z in [-2.8, +9] for L2)
    const westBayId = `pg_deck_f${f + 1}_w`;
    const eastBayId = `pg_deck_f${f + 1}_e`;
    const midBayId = `pg_deck_f${f + 1}_m`;

    nodes.push({
      id: westBayId,
      pos: pt(-10.1, slabCy, 0),
      half: [2.9, SLAB_HALF_Y, hd - 0.04],
      mat: 'concrete',
      color: deckTint,
      hp: 760,
      tier: 2,
      anchored: false,
      kind: f === 1 ? 'roof' : 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [2, 3],
      navWalkable: true,
      impactRadius: 8.5,
    });
    nodes.push({
      id: eastBayId,
      pos: pt(10.1, slabCy, 0),
      half: [2.9, SLAB_HALF_Y, hd - 0.04],
      mat: 'concrete',
      color: deckTint,
      hp: 760,
      tier: 2,
      anchored: false,
      kind: f === 1 ? 'roof' : 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [2, 3],
      navWalkable: true,
      impactRadius: 8.5,
    });

    const midZ0 = f === 0 ? -hd + 0.04 : -2.8;
    const midZ1 = f === 0 ? 2.8 : hd - 0.04;
    nodes.push({
      id: midBayId,
      pos: pt(0, slabCy, (midZ0 + midZ1) / 2),
      half: [7.18, SLAB_HALF_Y, (midZ1 - midZ0) / 2],
      mat: 'concrete',
      color: deckTint,
      hp: 820,
      tier: 2,
      anchored: false,
      kind: f === 1 ? 'roof' : 'slab',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [3, 2],
      navWalkable: true,
      impactRadius: 9.0,
    });

    // Connect columns to bays
    for (let iz = 0; iz < 3; iz++) {
      const lw = colId(f, 0, iz);
      const le = colId(f, 3, iz);
      if (nodes.some(n => n.id === lw)) link(edges, lw, westBayId);
      if (nodes.some(n => n.id === le)) link(edges, le, eastBayId);
    }
    for (const ix of [1, 2] as const) {
      for (let iz = 0; iz < 3; iz++) {
        const cm = colId(f, ix, iz);
        if (nodes.some(n => n.id === cm)) link(edges, cm, midBayId);
      }
    }
    link(edges, westBayId, midBayId);
    link(edges, eastBayId, midBayId);

    // Wide Driveable Concrete Ramp (5.8 m wide, 14.4 m horizontal run -> 14.0 deg gentle vehicle slope!)
    // f = 0 (South slot z = +5.8): climbs from x = -7.2 (y = 0) up to x = +7.2 (y = 3.6) -> roll = +angle
    // f = 1 (North slot z = -5.8): climbs from x = +7.2 (y = 3.6) up to x = -7.2 (y = 7.2) -> roll = -angle
    const rampRun = 14.4;
    const rampAngle = Math.atan2(FLOOR_H, rampRun);
    const rampLen = Math.hypot(rampRun, FLOOR_H);
    const rampId = `pg_ramp_f${f}`;
    nodes.push({
      id: rampId,
      pos: pt(0, y0 + FLOOR_H / 2 - SLAB_HALF_Y, f === 0 ? 5.85 : -5.85),
      half: [rampLen / 2 + 0.25, 0.16, 2.85],
      mat: 'asphalt',
      color: [0.32, 0.33, 0.35],
      hp: 680,
      tier: 2,
      anchored: f === 0,
      kind: 'catwalk',
      yaw,
      roll: f === 0 ? rampAngle : -rampAngle,
      materialClass: 'concrete',
      structuralMaterial: 'concrete',
      supportRole: 'load_bearing',
      navWalkable: true,
    });
    if (f === 0) {
      link(edges, rampId, eastBayId);
      link(edges, rampId, midBayId);
    } else {
      link(edges, rampId, westBayId);
      link(edges, rampId, `pg_deck_f1_e`);
    }

    // Perimeter knee-wall crash barriers (1.05 m high) around Level 1 & Level 2 — signature parking garage firing slits!
    const barH = 1.05;
    const barCy = slabTopY + barH / 2;
    const barriers: readonly [string, number, number, number, number, string][] = [
      [`pg_bar_f${f + 1}_n_w`, -9.5, -hd + 0.22, 3.3, 0.22, westBayId],
      [`pg_bar_f${f + 1}_n_m`, 0, -hd + 0.22, 6.8, 0.22, midBayId],
      [`pg_bar_f${f + 1}_n_e`, 9.5, -hd + 0.22, 3.3, 0.22, eastBayId],
      [`pg_bar_f${f + 1}_s_w`, -9.5, hd - 0.22, 3.3, 0.22, westBayId],
      [`pg_bar_f${f + 1}_s_m`, 0, hd - 0.22, 6.8, 0.22, f === 0 ? eastBayId : midBayId],
      [`pg_bar_f${f + 1}_s_e`, 9.5, hd - 0.22, 3.3, 0.22, eastBayId],
      [`pg_bar_f${f + 1}_w`, -hw + 0.22, 0, 0.22, hd - 0.5, westBayId],
      [`pg_bar_f${f + 1}_e`, hw - 0.22, 0, 0.22, hd - 0.5, eastBayId],
    ];
    for (const [bid, bx, bz, hx, hz, host] of barriers) {
      nodes.push({
        id: bid,
        pos: pt(bx, barCy, bz),
        half: [hx, barH / 2, hz],
        mat: 'concrete',
        color: barrierTint,
        hp: 340,
        tier: 2,
        anchored: false,
        kind: 'wall',
        yaw,
        materialClass: 'concrete',
        structuralMaterial: 'concrete',
        supportRole: 'infill',
        lazyFracture: true,
        fractureGrid: [2, 1],
      });
      link(edges, bid, host);
    }
  }

  // Volatile fuel barrel tucked by a ground-floor maintenance pillar for tactical chain reactions
  nodes.push({
    id: 'pg_fuel_barrel',
    pos: pt(-10.8, 0.55, -6.4),
    half: [0.42, 0.55, 0.42],
    mat: 'paintRed',
    color: 0xc2281e,
    hp: 35,
    tier: 0,
    anchored: true,
    kind: 'hazard',
    yaw,
    hazardRadius: 9.5,
    hazardDamage: 280,
    materialClass: 'metal',
    structuralMaterial: 'timber',
    supportRole: 'infill',
  });

  recordFootprint(opts?.spec, x, z, hw, hd, yaw);

  return {
    id,
    kind: 'parking_garage',
    label: opts?.label ?? '3-LEVEL PARKING GARAGE',
    value: 950,
    batched: true,
    collapseThreshold: 0.55,
    nodes,
    links: edges,
  };
}

// ---------------------------------------------------------------------------
// 3. 2-Story Enterable War-Zone House (Brick/Masonry or Timber + Drywall — Tank-Smashable!)
// ---------------------------------------------------------------------------

export function buildWarHouseCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
  opts?: { style?: 'brick' | 'wood'; tint?: [number, number, number]; spec?: MapSpec; label?: string },
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const nodes: StructuralNodeSpec[] = [];
  const edges: [string, string][] = [];

  const isWood = opts?.style === 'wood';
  const W = 11.0;
  const D = 9.0;
  const hw = W / 2; // 5.5
  const hd = D / 2; // 4.5
  const wt = isWood ? 0.16 : 0.20;
  const extMat = isWood ? 'plywood' : 'concrete';
  const extStructMat = isWood ? 'timber' : 'masonry';
  const extMatClass = isWood ? 'wood' : 'stone';
  const extTier = isWood ? 0 : 1;
  const extHp = isWood ? 120 : 210;
  const extTint: [number, number, number] = opts?.tint ?? (isWood ? [0.44, 0.34, 0.25] : [0.50, 0.35, 0.28]);
  const trimTint: [number, number, number] = [0.36, 0.30, 0.24];
  const drywallTint: [number, number, number] = [0.70, 0.67, 0.61];

  const clearH = FLOOR_H - SLAB_HALF_Y * 2;
  const postXs = [-hw + 0.22, hw - 0.22] as const;
  const postZs = [-hd + 0.22, hd - 0.22] as const;

  // 4 corner structural posts on ground & 2nd floor
  for (let f = 0; f < 2; f++) {
    const y0 = f * FLOOR_H;
    for (let ix = 0; ix < 2; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        const pid = `h_post_f${f}_${ix}_${iz}`;
        nodes.push({
          id: pid,
          pos: pt(postXs[ix]!, y0 + clearH / 2, postZs[iz]!),
          half: [0.22, clearH / 2, 0.22],
          mat: extMat,
          color: trimTint,
          hp: extHp + 40,
          tier: extTier,
          anchored: f === 0,
          kind: 'column',
          yaw,
          materialClass: extMatClass,
          structuralMaterial: extStructMat,
          supportRole: 'load_bearing',
          loadCapacity: f === 0 ? 48_000 : 28_000,
        });
        if (f === 1) link(edges, `h_post_f0_${ix}_${iz}`, pid);
      }
    }
  }

  // 2nd Floor Timber Deck (y = 3.6 m, navWalkable: true) split into South main room + West landing
  const slabCy = FLOOR_H - SLAB_HALF_Y;
  nodes.push({
    id: 'h_floor_s',
    pos: pt(0, slabCy, 1.15),
    half: [hw - 0.1, SLAB_HALF_Y, 3.25],
    mat: 'plywood',
    color: [0.44, 0.36, 0.27],
    hp: 150,
    tier: 0,
    anchored: false,
    kind: 'slab',
    yaw,
    materialClass: 'wood',
    structuralMaterial: 'timber',
    supportRole: 'load_bearing',
    lazyFracture: true,
    fractureGrid: [2, 2],
    navWalkable: true,
    impactRadius: 5.5,
  });
  nodes.push({
    id: 'h_floor_nw',
    pos: pt(-hw + 1.4, slabCy, -3.25),
    half: [1.3, SLAB_HALF_Y, 1.15],
    mat: 'plywood',
    color: [0.44, 0.36, 0.27],
    hp: 130,
    tier: 0,
    anchored: false,
    kind: 'slab',
    yaw,
    materialClass: 'wood',
    structuralMaterial: 'timber',
    supportRole: 'load_bearing',
    navWalkable: true,
  });
  link(edges, 'h_post_f0_0_1', 'h_floor_s');
  link(edges, 'h_post_f0_1_1', 'h_floor_s');
  link(edges, 'h_post_f0_0_0', 'h_floor_nw');
  link(edges, 'h_post_f0_1_0', 'h_floor_s');
  link(edges, 'h_floor_nw', 'h_floor_s');

  // Interior timber staircase (along north wall z = -3.25, climbs x = +3.9 -> -2.8, run 6.7 m -> 28 deg!)
  const stairRun = 6.7;
  const stairAngle = Math.atan2(FLOOR_H, stairRun);
  const stairLen = Math.hypot(stairRun, FLOOR_H);
  nodes.push({
    id: 'h_stair',
    pos: pt((3.9 - 2.8) / 2, FLOOR_H / 2 - SLAB_HALF_Y, -3.25),
    half: [stairLen / 2 + 0.15, 0.12, 1.05],
    mat: 'plywood',
    color: [0.40, 0.32, 0.24],
    hp: 130,
    tier: 0,
    anchored: true,
    kind: 'catwalk',
    yaw,
    roll: -stairAngle,
    materialClass: 'wood',
    structuralMaterial: 'timber',
    supportRole: 'load_bearing',
    navWalkable: true,
  });
  link(edges, 'h_stair', 'h_floor_nw');
  link(edges, 'h_stair', 'h_floor_s');

  // Ground-floor exterior walls (Front +Z and Rear -Z have open 2.4 m doorways; East/West walls are solid breachable masonry/timber!)
  for (const side of ['s', 'n'] as const) {
    const wz = side === 's' ? hd - wt : -hd + wt;
    const iz = side === 's' ? 1 : 0;
    for (const wing of ['w', 'e'] as const) {
      const x0 = wing === 'w' ? -hw + 0.45 : 1.2;
      const x1 = wing === 'w' ? -1.2 : hw - 0.45;
      const wid = `h_wall_f0_${side}_${wing}`;
      nodes.push({
        id: wid,
        pos: pt((x0 + x1) / 2, clearH / 2, wz),
        half: [(x1 - x0) / 2, clearH / 2, wt],
        mat: extMat,
        color: extTint,
        hp: extHp,
        tier: extTier,
        anchored: true,
        kind: 'wall',
        yaw,
        materialClass: extMatClass,
        structuralMaterial: extStructMat,
        supportRole: 'load_bearing',
        lazyFracture: true,
        fractureGrid: [2, 2],
        navBlock: true,
      });
      link(edges, wid, `h_post_f0_${wing === 'w' ? 0 : 1}_${iz}`);
      link(edges, wid, side === 's' ? 'h_floor_s' : 'h_floor_nw');
    }
  }
  for (const side of ['w', 'e'] as const) {
    const wx = side === 'w' ? -hw + wt : hw - wt;
    const ix = side === 'w' ? 0 : 1;
    const wid = `h_wall_f0_${side}`;
    nodes.push({
      id: wid,
      pos: pt(wx, clearH / 2, 0),
      half: [wt, clearH / 2, hd - 0.45],
      mat: extMat,
      color: extTint,
      hp: extHp,
      tier: extTier,
      anchored: true,
      kind: 'wall',
      yaw,
      materialClass: extMatClass,
      structuralMaterial: extStructMat,
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [3, 2],
      navBlock: true,
    });
    link(edges, wid, `h_post_f0_${ix}_0`);
    link(edges, wid, `h_post_f0_${ix}_1`);
    link(edges, wid, 'h_floor_s');
  }

  // Interior drywall dividing wall (shreds from shotguns, HMGs, explosives, or vehicles!)
  nodes.push({
    id: 'h_drywall_f0',
    pos: pt(0, clearH / 2, 1.8),
    half: [0.10, clearH / 2 - 0.04, 2.2],
    mat: 'plaster',
    color: drywallTint,
    hp: 55,
    tier: 0,
    anchored: true,
    kind: 'wall',
    yaw,
    materialClass: 'wood',
    structuralMaterial: 'drywall',
    supportRole: 'infill',
    lazyFracture: true,
    fractureGrid: [2, 2],
    navBlock: true,
  });
  link(edges, 'h_drywall_f0', 'h_floor_s');

  // 2nd Floor walls with wide firing windows (sill + header + breakable glass)
  const sillH = 1.05;
  const f1Y0 = FLOOR_H;
  const f1HeadY = f1Y0 + 2.65;
  const f1HeadH = Math.max(0.42, f1Y0 + clearH - f1HeadY);
  for (const side of ['s', 'n'] as const) {
    const wz = side === 's' ? hd - wt : -hd + wt;
    const iz = side === 's' ? 1 : 0;
    const sillId = `h_sill_f1_${side}`;
    const headId = `h_head_f1_${side}`;
    const glassId = `h_glass_f1_${side}`;
    nodes.push({
      id: sillId,
      pos: pt(0, f1Y0 + sillH / 2, wz),
      half: [hw - 0.45, sillH / 2, wt],
      mat: extMat,
      color: extTint,
      hp: extHp * 0.85,
      tier: extTier,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: extMatClass,
      structuralMaterial: extStructMat,
      supportRole: 'infill',
      lazyFracture: true,
      fractureGrid: [2, 1],
    });
    nodes.push({
      id: headId,
      pos: pt(0, f1HeadY + f1HeadH / 2, wz),
      half: [hw - 0.45, f1HeadH / 2, wt],
      mat: extMat,
      color: trimTint,
      hp: extHp * 0.75,
      tier: extTier,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: extMatClass,
      structuralMaterial: extStructMat,
      supportRole: 'infill',
    });
    nodes.push({
      id: glassId,
      pos: pt(0, f1Y0 + sillH + (f1HeadY - (f1Y0 + sillH)) / 2, wz),
      half: [hw - 0.7, (f1HeadY - (f1Y0 + sillH)) / 2 - 0.04, 0.05],
      mat: 'glass',
      color: [0.48, 0.56, 0.62],
      hp: 14,
      tier: 0,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: 'concrete',
      structuralMaterial: 'glass',
      supportRole: 'infill',
    });
    link(edges, sillId, `h_post_f1_0_${iz}`);
    link(edges, sillId, `h_post_f1_1_${iz}`);
    link(edges, headId, `h_post_f1_0_${iz}`);
    link(edges, headId, `h_post_f1_1_${iz}`);
    link(edges, glassId, sillId);
  }
  for (const side of ['w', 'e'] as const) {
    const wx = side === 'w' ? -hw + wt : hw - wt;
    const ix = side === 'w' ? 0 : 1;
    const sillId = `h_sill_f1_${side}`;
    const headId = `h_head_f1_${side}`;
    nodes.push({
      id: sillId,
      pos: pt(wx, f1Y0 + sillH / 2, 0),
      half: [wt, sillH / 2, hd - 0.45],
      mat: extMat,
      color: extTint,
      hp: extHp * 0.85,
      tier: extTier,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: extMatClass,
      structuralMaterial: extStructMat,
      supportRole: 'infill',
      lazyFracture: true,
      fractureGrid: [2, 1],
    });
    nodes.push({
      id: headId,
      pos: pt(wx, f1HeadY + f1HeadH / 2, 0),
      half: [wt, f1HeadH / 2, hd - 0.45],
      mat: extMat,
      color: trimTint,
      hp: extHp * 0.75,
      tier: extTier,
      anchored: false,
      kind: 'wall',
      yaw,
      materialClass: extMatClass,
      structuralMaterial: extStructMat,
      supportRole: 'infill',
    });
    link(edges, sillId, `h_post_f1_${ix}_0`);
    link(edges, sillId, `h_post_f1_${ix}_1`);
    link(edges, headId, `h_post_f1_${ix}_0`);
    link(edges, headId, `h_post_f1_${ix}_1`);
  }

  // Pitched Gable Roof (2 sloped roof panels meeting along Z ridge at y = 8.4 m)
  const roofPitch = 0.34; // ~19.5 deg
  const roofBaseY = FLOOR_H * 2; // 7.2
  const roofHalfSpan = hd / Math.cos(roofPitch) + 0.35;
  const roofMidY = roofBaseY + (hd / 2) * Math.tan(roofPitch);
  nodes.push({
    id: 'h_roof_s',
    pos: pt(0, roofMidY, hd / 2),
    half: [hw + 0.35, 0.14, roofHalfSpan / 2],
    mat: 'rust',
    color: [0.36, 0.26, 0.22],
    hp: 150,
    tier: 0,
    anchored: false,
    kind: 'roof',
    yaw,
    pitch: roofPitch,
    materialClass: 'wood',
    structuralMaterial: 'timber',
    supportRole: 'load_bearing',
    lazyFracture: true,
    fractureGrid: [3, 2],
    impactRadius: 6.0,
  });
  nodes.push({
    id: 'h_roof_n',
    pos: pt(0, roofMidY, -hd / 2),
    half: [hw + 0.35, 0.14, roofHalfSpan / 2],
    mat: 'rust',
    color: [0.33, 0.24, 0.20],
    hp: 150,
    tier: 0,
    anchored: false,
    kind: 'roof',
    yaw,
    pitch: -roofPitch,
    materialClass: 'wood',
    structuralMaterial: 'timber',
    supportRole: 'load_bearing',
    lazyFracture: true,
    fractureGrid: [3, 2],
    impactRadius: 6.0,
  });
  link(edges, 'h_post_f1_0_1', 'h_roof_s');
  link(edges, 'h_post_f1_1_1', 'h_roof_s');
  link(edges, 'h_post_f1_0_0', 'h_roof_n');
  link(edges, 'h_post_f1_1_0', 'h_roof_n');
  link(edges, 'h_roof_s', 'h_roof_n');

  recordFootprint(opts?.spec, x, z, hw, hd, yaw);

  return {
    id,
    kind: 'war_house',
    label: opts?.label ?? (isWood ? 'TIMBER FARMHOUSE' : '2-STORY MASONRY HOUSE'),
    value: 320,
    batched: true,
    collapseThreshold: 0.55,
    nodes,
    links: edges,
  };
}

// ---------------------------------------------------------------------------
// 4. Properly Linked Walkable Timber Field Watchtower & Wooden Supply Shack
// ---------------------------------------------------------------------------

/**
 * 4-leg timber field watchtower with a walkable access ramp up to the 3.6 m lookout deck.
 * Properly connected to the 4-pass structural solver: destroying 2 adjacent stilts or 3 stilts
 * immediately tips and collapses the tower (ZERO floating pieces!).
 * Immune to assault rifles/SMGs; shredded by .50 cal, HMGs, autocannons, explosives, and medium+ rams.
 */
export function buildFieldWatchtowerCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const deckTopY = FLOOR_H; // 3.6 m — matches ENDLESS_WAR_LEVELS!
  const legH = deckTopY - SLAB_HALF_Y * 2;
  const W = 1.9;
  const D = 1.8;

  const nodes: StructuralNodeSpec[] = [
    // 4 primary anchored timber stilts
    { id: 'stilt_fl', pos: pt(-W, legH / 2, D), half: [0.20, legH / 2, 0.20], mat: 'plywood', color: 0x524234, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_fr', pos: pt(W, legH / 2, D), half: [0.20, legH / 2, 0.20], mat: 'plywood', color: 0x524234, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_bl', pos: pt(-W, legH / 2, -D), half: [0.20, legH / 2, 0.20], mat: 'plywood', color: 0x48382c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_br', pos: pt(W, legH / 2, -D), half: [0.20, legH / 2, 0.20], mat: 'plywood', color: 0x48382c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },

    // Walkable timber lookout deck (top at exact y = 3.6 m)
    { id: 'deck', pos: pt(0, deckTopY - SLAB_HALF_Y, 0), half: [W + 0.35, SLAB_HALF_Y, D + 0.35], mat: 'plywood', color: 0x62503e, hp: 135, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 6.5, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', navWalkable: true },

    // Walkable rear access ramp climbing from (z = -8.4, y = 0) up to rear deck edge (z = -2.0, y = 3.6) -> 29 deg!
    {
      id: 'ramp',
      pos: pt(0, deckTopY / 2 - 0.12, -5.2),
      half: [0.85, 0.12, Math.hypot(6.4, deckTopY) / 2 + 0.12],
      mat: 'plywood',
      color: 0x554434,
      hp: 115,
      tier: 0,
      anchored: true,
      kind: 'catwalk',
      yaw,
      pitch: -Math.atan2(deckTopY, 6.4),
      materialClass: 'wood',
      structuralMaterial: 'timber',
      supportRole: 'infill',
      navWalkable: true,
    },

    // Firing parapets around front & sides (infill — open rear for ramp entry)
    { id: 'parapet_f', pos: pt(0, deckTopY + 0.52, D + 0.15), half: [W + 0.25, 0.52, 0.18], mat: 'dirt', color: 0x766c58, hp: 110, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'infill' },
    { id: 'parapet_l', pos: pt(-W - 0.15, deckTopY + 0.52, 0), half: [0.18, 0.52, D + 0.1], mat: 'plywood', color: 0x5a4838, hp: 100, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'infill' },
    { id: 'parapet_r', pos: pt(W + 0.15, deckTopY + 0.52, 0), half: [0.18, 0.52, D + 0.1], mat: 'plywood', color: 0x5a4838, hp: 100, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'infill' },

    // Upper corner roof posts & corrugated roof canopy
    { id: 'up_fl', pos: pt(-W, deckTopY + 1.25, D), half: [0.13, 1.25, 0.13], mat: 'plywood', color: 0x4c3c2e, hp: 75, tier: 0, anchored: false, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing' },
    { id: 'up_fr', pos: pt(W, deckTopY + 1.25, D), half: [0.13, 1.25, 0.13], mat: 'plywood', color: 0x4c3c2e, hp: 75, tier: 0, anchored: false, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing' },
    { id: 'up_bl', pos: pt(-W, deckTopY + 1.25, -D), half: [0.13, 1.25, 0.13], mat: 'plywood', color: 0x4c3c2e, hp: 75, tier: 0, anchored: false, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing' },
    { id: 'up_br', pos: pt(W, deckTopY + 1.25, -D), half: [0.13, 1.25, 0.13], mat: 'plywood', color: 0x4c3c2e, hp: 75, tier: 0, anchored: false, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing' },
    { id: 'roof', pos: pt(0, deckTopY + 2.55, 0), half: [W + 0.55, 0.12, D + 0.55], mat: 'rust', color: 0x5d4438, hp: 110, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 6.5, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'load_bearing' },

    // Volatile fuel drum at base (shootable with any firearm to trigger a chain-reaction demolition!)
    { id: 'fuel_drum', pos: pt(W + 0.95, 0.55, D + 0.3), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xb8261e, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 9.0, hazardDamage: 240, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill' },
  ];

  const edges: [string, string][] = [
    ['stilt_fl', 'deck'],
    ['stilt_fr', 'deck'],
    ['stilt_bl', 'deck'],
    ['stilt_br', 'deck'],
    ['deck', 'parapet_f'],
    ['deck', 'parapet_l'],
    ['deck', 'parapet_r'],
    ['deck', 'up_fl'],
    ['deck', 'up_fr'],
    ['deck', 'up_bl'],
    ['deck', 'up_br'],
    ['up_fl', 'roof'],
    ['up_fr', 'roof'],
    ['up_bl', 'roof'],
    ['up_br', 'roof'],
    ['ramp', 'deck'],
  ];

  return {
    id,
    kind: 'watchtower',
    label: 'FIELD WATCHTOWER',
    value: 180,
    nodes,
    links: edges,
  };
}

/**
 * Enterable wooden timber supply shack.
 * Immune to assault rifles / SMGs; shredded by .50 cal, HMGs, autocannons, fire, explosives, or vehicle rams.
 */
export function buildTimberShackCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
  opts?: { spec?: MapSpec },
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const hw = 3.2;
  const hd = 2.6;
  const H = 3.0;
  const wt = 0.14;

  const nodes: StructuralNodeSpec[] = [
    // Back & side timber walls
    { id: 'shack_n', pos: pt(0, H / 2, -hd + wt), half: [hw, H / 2, wt], mat: 'plywood', color: 0x564331, hp: 115, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [3, 2], navBlock: true },
    { id: 'shack_w', pos: pt(-hw + wt, H / 2, 0), half: [wt, H / 2, hd - 0.14], mat: 'plywood', color: 0x4f3d2c, hp: 115, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], navBlock: true },
    { id: 'shack_e', pos: pt(hw - wt, H / 2, 0), half: [wt, H / 2, hd - 0.14], mat: 'plywood', color: 0x4f3d2c, hp: 115, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], navBlock: true },
    // Front walls flanking 2.2 m wide open doorway
    { id: 'shack_sw', pos: pt(-2.15, H / 2, hd - wt), half: [1.05, H / 2, wt], mat: 'plywood', color: 0x5c4836, hp: 95, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', navBlock: true },
    { id: 'shack_se', pos: pt(2.15, H / 2, hd - wt), half: [1.05, H / 2, wt], mat: 'plywood', color: 0x5c4836, hp: 95, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', navBlock: true },
    // Corrugated steel roof
    { id: 'shack_roof', pos: pt(0, H + 0.14, 0), half: [hw + 0.35, 0.12, hd + 0.35], mat: 'rust', color: 0x5a3e30, hp: 120, tier: 0, anchored: false, kind: 'roof', yaw, pitch: 0.06, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], impactRadius: 5.0 },
  ];

  const edges: [string, string][] = [
    ['shack_n', 'shack_roof'],
    ['shack_w', 'shack_roof'],
    ['shack_e', 'shack_roof'],
    ['shack_sw', 'shack_roof'],
    ['shack_se', 'shack_roof'],
  ];

  recordFootprint(opts?.spec, x, z, hw, hd, yaw);

  return {
    id,
    kind: 'timber_shack',
    label: 'TIMBER SUPPLY SHACK',
    value: 140,
    nodes,
    links: edges,
  };
}

// ---------------------------------------------------------------------------
// 5. Enterable Tier-3 Reinforced Concrete Bunker (Tank-Proof, Siege Ordnance Only!)
// ---------------------------------------------------------------------------

/**
 * Heavy fortified Tier-3 reinforced concrete pillbox bunker with rear entrance and wide firing embrasures.
 * Immune to small arms, HMGs, standard rockets, and TANK RAMS (tanks deflect cleanly off it).
 * Requires siege ordnance (105mm Howitzer, AC-130 105mm/bomb, jet bombs, breach charges, nuke).
 */
export function buildReinforcedBunkerCluster(
  id: string,
  x: number,
  z: number,
  yaw: number,
  enemyOwned = false,
  opts?: { spec?: MapSpec },
): StructuralClusterSpec {
  const pt = makeTransform(x, z, yaw);
  const hw = 4.6;
  const hd = 3.6;
  const wallTint: [number, number, number] = enemyOwned ? [0.28, 0.30, 0.32] : [0.42, 0.45, 0.47];
  const roofTint: [number, number, number] = [0.26, 0.28, 0.30];

  const nodes: StructuralNodeSpec[] = [
    // Thick reinforced side & corner bearing walls (0.9 m thick!)
    { id: 'bk_w', pos: pt(-hw + 0.45, 1.35, 0), half: [0.45, 1.35, hd - 0.3], mat: 'concreteDark', color: wallTint, hp: 1400, tier: 3, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], navBlock: true, loadCapacity: 400_000 },
    { id: 'bk_e', pos: pt(hw - 0.45, 1.35, 0), half: [0.45, 1.35, hd - 0.3], mat: 'concreteDark', color: wallTint, hp: 1400, tier: 3, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], navBlock: true, loadCapacity: 400_000 },
    // Front lower embrasure wall (y = 0..1.18 m, leaving wide firing slit y = 1.18..2.25 m!)
    { id: 'bk_front_sill', pos: pt(0, 0.59, hd - 0.45), half: [hw - 0.8, 0.59, 0.45], mat: 'concrete', color: wallTint, hp: 1300, tier: 3, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [3, 1], navBlock: true, loadCapacity: 350_000 },
    // Front upper brow beam above firing slit
    { id: 'bk_front_brow', pos: pt(0, 2.45, hd - 0.45), half: [hw - 0.8, 0.28, 0.45], mat: 'concreteDark', color: roofTint, hp: 1100, tier: 3, anchored: false, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing' },
    // Rear bunker walls leaving a 2.6 m wide open rear doorway (x in [-1.3, +1.3] clear!)
    { id: 'bk_rw', pos: pt(-2.95, 1.35, -hd + 0.42), half: [1.65, 1.35, 0.42], mat: 'concrete', color: wallTint, hp: 1200, tier: 3, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', navBlock: true, loadCapacity: 300_000 },
    { id: 'bk_re', pos: pt(2.95, 1.35, -hd + 0.42), half: [1.65, 1.35, 0.42], mat: 'concrete', color: wallTint, hp: 1200, tier: 3, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', navBlock: true, loadCapacity: 300_000 },
    // Massive 0.85 m thick reinforced blast roof slab
    { id: 'bk_roof', pos: pt(0, 3.12, 0), half: [hw + 0.35, 0.42, hd + 0.35], mat: 'concreteDark', color: roofTint, hp: 1800, tier: 3, anchored: false, kind: 'roof', yaw, materialClass: 'concrete', structuralMaterial: 'reinforced_concrete', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [3, 2], impactRadius: 9.0 },
  ];

  const edges: [string, string][] = [
    ['bk_w', 'bk_roof'],
    ['bk_e', 'bk_roof'],
    ['bk_rw', 'bk_roof'],
    ['bk_re', 'bk_roof'],
    ['bk_w', 'bk_front_brow'],
    ['bk_e', 'bk_front_brow'],
    ['bk_front_brow', 'bk_roof'],
    ['bk_w', 'bk_front_sill'],
    ['bk_e', 'bk_front_sill'],
  ];

  recordFootprint(opts?.spec, x, z, hw + 0.4, hd + 0.4, yaw);

  return {
    id,
    kind: 'reinforced_bunker',
    label: enemyOwned ? 'ENEMY REINFORCED BUNKER' : 'REINFORCED BUNKER',
    value: 500,
    nodes,
    links: edges,
  };
}
