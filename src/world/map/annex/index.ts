/**
 * The Retraining Annex, an orbital Bureau training vessel & proving ground, at `/?contract=retraining`.
 * One route north through every station of the tutorial (docs/design/tutorial.md, campaign/missions/retraining.ts).
 * Roofless over the training bays and proving ground behind tall hull bulkheads, so the capture drone, supply pod,
 * and Tactical Nuke have clear sky everywhere. plan.ts has every coordinate.
 */
import * as THREE from 'three';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, cable, container, fence, machine, pipe, tyres, vent } from '../../kit/props';
import { drumCluster, palletStack } from '../holdfast/props';
import type { MapPlan, MapSpec } from '../spec';
import {
  bulkheadWall, clonePod, consoleDesk, dressHullWall, floorGuide, lightGantry, obsBooth, ribArch, sign,
} from './kit';
import {
  BALCONY, BLADE, BOUNDS, CHIMNEY, CHIMNEY_TOP, DASH_LAND, DASH_PIT, DECK, DOORS, DUCT, EXIT, GALLERY, HALL,
  INTAKE, JET_TOWER, LEDGE, MANTLE, PIT, QUIET, ROCKET_LEDGE, SHED, SLAM_PIT, SLOT, STAIRS_X, STAND, TOWN,
  VAULT, WALL, WALL_LAND, WALL_PIT, YARD,
} from './plan';
import { buildAnnexTown } from './town';

const T = 1;
const CONTAINMENT = 48;

function containment(k: Kit): void {
  const { x0, x1, z0, z1 } = BOUNDS;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  k.containment(cx, CONTAINMENT / 2, z0 - 1, hx + 2, CONTAINMENT / 2, 1);
  k.containment(cx, CONTAINMENT / 2, z1 + 1, hx + 2, CONTAINMENT / 2, 1);
  k.containment(x0 - 1, CONTAINMENT / 2, cz, 1, CONTAINMENT / 2, hz + 2);
  k.containment(x1 + 1, CONTAINMENT / 2, cz, 1, CONTAINMENT / 2, hz + 2);
}

// -------------------------------------------------------------------------------------------------
// 1. INTAKE — Pressurised Starship Cloning Bay & Voluntary Exit Airlock
// -------------------------------------------------------------------------------------------------

function intake(k: Kit): void {
  const { x0, x1, z0, z1, h } = INTAKE;
  const g = k.geo;

  // Polished clinical deck plating with recessed steel trim & grate drainage runs.
  k.floor('tile', x0 - T, z0, x1 + T, z1 + T, 0);
  g.use('grate').box(-3.2, 0.008, 7, 0.35, 0.004, 6.2, FACE.py);
  g.use('grate').box(3.2, 0.008, 7, 0.35, 0.004, 6.2, FACE.py);

  // Pressurised enclosed starship hull walls & vaulted ceiling.
  k.mass('panel', x0 - T, 0, z0, x0, h, z1);
  k.mass('panel', x1, 0, z0, x1 + T, h, z1);
  k.mass('steelDark', x0 - T, h, z0, x1 + T, h + 0.6, z1 + T);
  dressHullWall(k, x0, 1, z0 + 1, z1, 0, h, { bay: 3.2, stripY: [0.35, 3.6], pipes: true });
  dressHullWall(k, x1, -1, z0 + 1, z1, 0, h, { bay: 3.2, stripY: [0.35, 3.6], pipes: true });

  // Chamfered overhead starship bulkhead ribs framing the cloning bay.
  for (const z of [2.5, 5.5, 8.5, 11.5]) {
    ribArch(k, x0, x1, z, 0, h, { openTop: false, cant: 1.5, thick: 0.42 });
  }

  // South wall: EXIT · VOLUNTARY airlock portal & stark white-lit departure corridor.
  bulkheadWall(k, x0 - T, x1 + T, z1, z1 + T, 0, h, 0, INTAKE.door * 2, 2.75, 'emissiveWhite');
  k.floor('concreteDark', EXIT.x0 - T, EXIT.z0 + T, EXIT.x1 + T, EXIT.z1 + T, 0);
  k.mass('steelDark', EXIT.x0 - T, 0, EXIT.z0 + T, EXIT.x0, 3.2, EXIT.z1);
  k.mass('steelDark', EXIT.x1, 0, EXIT.z0 + T, EXIT.x1 + T, 3.2, EXIT.z1);
  k.mass('steelDark', EXIT.x0 - T, 0, EXIT.z1, EXIT.x1 + T, 3.2, EXIT.z1 + T);
  k.mass('steelDark', EXIT.x0 - T, 3.2, EXIT.z0 + T, EXIT.x1 + T, 3.6, EXIT.z1 + T);
  // Rhythmic glowing white light ribs receding toward the pure white exit wall.
  for (const ez of [16.4, 18.2, 20.0]) {
    g.use('emissiveWhite').box(EXIT.x0 + 0.04, 1.6, ez, 0.02, 1.45, 0.04);
    g.use('emissiveWhite').box(EXIT.x1 - 0.04, 1.6, ez, 0.02, 1.45, 0.04);
    g.use('emissiveWhite').box(0, 3.12, ez, 1.5, 0.02, 0.04);
  }
  g.use('emissiveWhite').box(0, 1.55, EXIT.z1 - 0.03, 1.52, 1.5, 0.02);
  k.light(0, 2.5, EXIT.z1 - 1.4, 'white', 85, 8);
  sign(k, 0, 3.55, z1 - 0.04, Math.PI, 'EXIT · VOLUNTARY', 2.8);

  // Eight sculpted cylindrical Cryo-Clone Pods lining east & west bulkheads, tethered to ceiling manifolds.
  for (let i = 0; i < 4; i++) {
    const pz = 2.8 + i * 2.95;
    clonePod(k, x0 + 1.35, pz, 0, h, 0, false);
    clonePod(k, x1 - 1.35, pz, 0, h, Math.PI, false);
  }
  // Twin overhead cryo-manifold spines flanking the central axis so the RETRAINING portal stays cleanly framed.
  pipe(k, [-2.6, h - 0.45, 1.5, -2.6, h - 0.45, 12.8], 0.14, 'steel', 4, 10, false);
  pipe(k, [2.6, h - 0.45, 1.5, 2.6, h - 0.45, 12.8], 0.14, 'steel', 4, 10, false);

  // Player's opened central clone pod pedestal at (0, 0, 8.5): stepped low deck + overhead stasis crown (walk-through clear!).
  g.use('steelDark').lathe([1.35, 0, 1.35, 0.1, 1.15, 0.22, 0.9, 0.22], 0, 0, 8.5, 20, false);
  k.collide(0, 0.11, 8.5, 1.15, 0.11, 1.15, 'metal');
  g.use('emissiveCyan').lathe([1.16, 0.2, 1.16, 0.24], 0, 0, 8.5, 20, false);
  // Retracted upper stasis hood hanging directly above the player's pod (head clearance > 2.8m!).
  g.use('steelDark').lathe([0.92, 2.95, 1.02, 3.1, 0.85, 3.32, 0.45, 3.5, 0.22, h], 0, 0, 8.5, 18, false);
  g.use('emissiveCyan').lathe([0.92, 2.92, 0.92, 2.97], 0, 0, 8.5, 18, false);
  cable(k, 0.4, 3.4, 8.5, 1.6, h - 0.2, 8.5, 0.35, 0.05);
  cable(k, -0.4, 3.4, 8.5, -1.6, h - 0.2, 8.5, 0.35, 0.05);

  // Two Bureau compliance terminals flanking the north airlock.
  consoleDesk(k, -4.4, 0, 1.7, 0.28, 1.7);
  consoleDesk(k, 4.4, 0, 1.7, -0.28, 1.7);
  sign(k, -4.4, 2.4, 1.06, 0, 'SOCIETAL COMPLIANCE', 2.2);
  sign(k, 4.4, 2.4, 1.06, 0, 'MORALE IS MONITORED', 2.2);

  // Floor wayfinding chevrons leading north from the player's pod straight through the airlock.
  floorGuide(k, 0, 0, 6.8, 0.4, { width: 1.5, step: 2.0 });

  // North bulkhead airlock into the Mobility Hall.
  bulkheadWall(k, x0 - T, x1 + T, z0, z0 + 1, 0, h, DOORS.hall.x, DOORS.hall.w, 3.5, 'emissiveCyan');
  sign(k, 0, 4.25, z0 + 1.08, 0, 'RETRAINING', 2.8);

  // Cool clinical sci-fi bay lighting.
  k.lampBar(0, h - 0.14, 4.0, 0, 4.2, 'white', 75, 14);
  k.lampBar(0, h - 0.14, 8.5, 0, 4.2, 'cyan', 85, 15);
  k.lampBar(0, h - 0.14, 12.2, 0, 3.6, 'white', 55, 12);
}

// -------------------------------------------------------------------------------------------------
// 2. MOBILITY HALL — Starship Kinetics & Propulsion Bay
// -------------------------------------------------------------------------------------------------

function hall(k: Kit): void {
  const { x0, x1 } = HALL;
  const north = ROCKET_LEDGE.z0;
  const g = k.geo;

  // Towering starship hull side walls.
  k.mass('panel', x0 - T, PIT, north - T, x0, WALL, 0);
  k.mass('panel', x1, PIT, north - T, x1 + T, WALL, 0);

  // Hull paneling along walls: keep wall-run section flush so boots never snag!
  dressHullWall(k, x0, 1, MANTLE.z0, 0, 0, WALL, { bay: 6.5, stripY: [2.6, 8.5], pipes: true });
  dressHullWall(k, x1, -1, MANTLE.z0, 0, 0, WALL, { bay: 6.5, stripY: [2.6, 8.5], pipes: true });
  // Wall-run & dash pit walls: flush armor paneling up to y=10, rich upper structure above.
  dressHullWall(k, x0, 1, WALL_LAND.z0, MANTLE.z0, PIT, WALL, { bay: 6.5, flush: true, stripY: [DECK + 4.5] });
  dressHullWall(k, x1, -1, WALL_LAND.z0, MANTLE.z0, PIT, WALL, { bay: 6.5, flush: true, stripY: [DECK + 4.5] });
  // Slam & Rocket bay walls.
  dressHullWall(k, x0, 1, north, WALL_LAND.z0, 0, WALL, { bay: 6.5, stripY: [2.2, 9.5], pipes: true });
  dressHullWall(k, x1, -1, north, WALL_LAND.z0, 0, WALL, { bay: 6.5, stripY: [2.2, 9.5], pipes: true });

  // Overhead open-truss starship hull ribs arching across the bay every ~12m (skipping wall-run lower wall clearances).
  for (const rz of [-4, -16, -24, -38, -44, -65, -97, -110, -122]) {
    ribArch(k, x0, x1, rz, rz < -40 && rz > -100 ? DECK : 0, WALL, { openTop: true, cant: 2.2 });
  }
  // Upper-only overhead ribs spanning the wall-run pit at y=10..20 (leaving y=0..10 completely flush for wall-running!).
  for (const rz of [-74, -81, -88]) {
    ribArch(k, x0, x1, rz, 10, WALL, { openTop: true, cant: 2.2 });
  }

  // Cantilevered Evaluator Observation Booths peering down into the kinetics bay.
  obsBooth(k, x0, 1, 9.5, -20, 11, 3.2);
  obsBooth(k, x1, -1, 10.5, -56, 12, 3.2);
  obsBooth(k, x0, 1, 11.5, -116, 12, 3.2);

  // Deck floors & cushioned shock-absorber pits.
  k.floor('tile', x0, MANTLE.z0, x1, 0, 0);
  k.floor('tile', x0, ROCKET_LEDGE.z1, x1, WALL_LAND.z0, 0);
  for (const pit of [DASH_PIT, WALL_PIT]) {
    k.floor('rubber', x0, pit.z0, x1, pit.z1, PIT, 0.6, 3, 'concrete');
    // Padded shock-mat rib strips & amber pit safety borders.
    const pz = (pit.z0 + pit.z1) / 2, len = pit.z1 - pit.z0;
    g.use('hazard').box(0, PIT + 0.015, pit.z1 - 0.35, (x1 - x0) / 2 - 0.3, 0.008, 0.25, FACE.py);
    g.use('hazard').box(0, PIT + 0.015, pit.z0 + 0.35, (x1 - x0) / 2 - 0.3, 0.008, 0.25, FACE.py);
    for (let px = x0 + 2; px <= x1 - 2; px += 4) {
      g.use('steelDark').bevel(px, PIT + 0.08, pz, 0.12, 0.08, len / 2 - 0.8, 0.02);
    }
    k.light(0, PIT + 2.4, pz, 'orange', 35, 16);
  }
  k.mass('steelDark', x0, PIT, MANTLE.z0, x1, 0, MANTLE.z0 + 0.6);

  // --- Station A: Crouch Duct (z: -12..-6, gap: 1.2m) ---
  k.mass('panel', x0, DUCT.gap, DUCT.z0, x1, WALL, DUCT.z1);
  // Hydraulic blast-gate pistons & chamfered lower beam framing the duct slot.
  g.use('steelDark').bevel(0, DUCT.gap + 0.16, DUCT.z1 + 0.08, (x1 - x0) / 2, 0.16, 0.12, 0.04);
  g.use('hazard').box(0, DUCT.gap + 0.06, DUCT.z1 + 0.21, (x1 - x0) / 2 - 0.1, 0.07, 0.01, FACE.pz);
  for (const px of [-5.5, 5.5]) {
    g.use('steel').cyl(px, DUCT.gap + 0.2, DUCT.z1 + 0.24, px, DUCT.gap + 4.8, DUCT.z1 + 0.24, 0.18, 0.18, 10);
    g.use('steelDark').cyl(px, DUCT.gap + 4.8, DUCT.z1 + 0.24, px, DUCT.gap + 7.2, DUCT.z1 + 0.24, 0.26, 0.26, 10);
  }
  // Illuminated ceiling strip INSIDE the duct so crouching through feels sleek & crisp!
  g.use('emissiveWhite').box(0, DUCT.gap - 0.015, (DUCT.z0 + DUCT.z1) / 2, 2.2, 0.01, 2.6, FACE.ny);
  floorGuide(k, 0, 0, -1.2, -16.8, { width: 2.0, step: 2.4 });
  sign(k, 0, DUCT.gap + 1.45, DUCT.z1 + 0.22, 0, 'CROUCH', 2.8);

  // --- Waist-High Kinetic Vault Barrier (z: -18.8..-18, h: 1m) ---
  k.block('panel', x0, 0, VAULT.z0, x1, VAULT.h, VAULT.z1, 0.05, 'metal');
  g.use('steelDark').bevel(0, VAULT.h - 0.06, (VAULT.z0 + VAULT.z1) / 2, (x1 - x0) / 2, 0.06, 0.44, 0.02);
  g.use('emissiveCyan').box(0, VAULT.h + 0.01, VAULT.z1 - 0.04, (x1 - x0) / 2 - 0.4, 0.015, 0.025, FACE.py | FACE.pz);

  // --- Station B: Slide Slot (z: -34..-26, gap: 1.15m) ---
  k.mass('panel', x0, SLOT.gap, SLOT.z0, x1, WALL, SLOT.z1);
  g.use('steelDark').bevel(0, SLOT.gap + 0.18, SLOT.z1 + 0.08, (x1 - x0) / 2, 0.18, 0.12, 0.04);
  g.use('hazard').box(0, SLOT.gap + 0.06, SLOT.z1 + 0.21, (x1 - x0) / 2 - 0.1, 0.07, 0.01, FACE.pz);
  for (const px of [-5.5, 5.5]) {
    g.use('steel').cyl(px, SLOT.gap + 0.2, SLOT.z1 + 0.24, px, SLOT.gap + 5.2, SLOT.z1 + 0.24, 0.18, 0.18, 10);
  }
  // Glowing slide chute lights inside the 8m tunnel + speed runway floor chevrons.
  g.use('emissiveCyan').box(0, SLOT.gap - 0.015, (SLOT.z0 + SLOT.z1) / 2, 1.8, 0.01, 3.6, FACE.ny);
  floorGuide(k, 0, 0, -19.5, -39.2, { width: 2.2, step: 2.5 });
  sign(k, 0, SLOT.gap + 1.45, SLOT.z1 + 0.22, 0, 'SLIDE', 2.8);

  // --- Station C: Mantle Wall & Dash Pit (z: -40..-68) ---
  k.block('steelDark', x0, 0, MANTLE.z0, x1, DECK, MANTLE.z1, 0.06, 'metal');
  // Bright cyan hand-grip climb bars on the south face of the mantle wall.
  for (const gy of [0.95, 1.75, 2.45]) {
    g.use('emissiveCyan').box(0, gy, MANTLE.z1 + 0.02, 2.6, 0.03, 0.015, FACE.pz);
  }
  // Launch edge trim & directional chevrons atop the take-off deck.
  g.use('hazard').box(0, DECK + 0.01, MANTLE.z0 + 0.45, (x1 - x0) / 2 - 0.2, 0.008, 0.28, FACE.py);
  g.use('emissiveCyan').box(0, DECK + 0.012, MANTLE.z0 + 0.12, (x1 - x0) / 2 - 0.1, 0.01, 0.05);
  floorGuide(k, 0, DECK, MANTLE.z1 - 0.6, MANTLE.z0 + 0.8, { width: 2.4, step: 2.2 });
  sign(k, 0, DECK + 3.2, MANTLE.z1 + 0.08, 0, 'DASH', 2.8);

  // --- Station D: Dash Landing & Wall-Run Pit (z: -62..-100) ---
  k.block('steelDark', x0, PIT, DASH_LAND.z0, x1, DECK, DASH_LAND.z1, 0.06, 'metal');
  g.use('hazard').box(0, DECK + 0.01, DASH_LAND.z0 + 0.45, (x1 - x0) / 2 - 0.2, 0.008, 0.28, FACE.py);
  g.use('emissiveCyan').box(0, DECK + 0.012, DASH_LAND.z0 + 0.12, (x1 - x0) / 2 - 0.1, 0.01, 0.05);
  // Angled glowing launch lines guiding players from center deck toward BOTH wall-run tracks!
  k.stripLine([0, DECK, -63.0, -5.2, DECK, -65.4, -7.2, DECK, -67.6], 0.12, 'emissiveCyan');
  k.stripLine([0, DECK, -63.0, 5.2, DECK, -65.4, 7.2, DECK, -67.6], 0.12, 'emissiveCyan');
  sign(k, 0, DECK + 3.4, DASH_PIT.z0 + 0.08, 0, 'WALL RUN', 3.0);

  // Flush sci-fi kinetic wall-run tracks along BOTH walls (x = ±8) with dual glowing cyan stripes & forward chevrons!
  const wMidZ = (WALL_PIT.z0 + WALL_PIT.z1) / 2;
  const wHalfZ = (WALL_PIT.z1 - WALL_PIT.z0) / 2;
  for (const side of [-1, 1]) {
    const wx = side < 0 ? x0 + 0.015 : x1 - 0.015;
    const face = side < 0 ? FACE.px : FACE.nx;
    // Dark magnetic grip track backing band (1.4m tall, completely flush).
    g.use('steelDark').box(wx, DECK + 1.65, wMidZ, 0.01, 0.72, wHalfZ, face);
    // Dual glowing cyan speed rails.
    g.use('emissiveCyan').box(wx + (side < 0 ? 0.01 : -0.01), DECK + 1.15, wMidZ, 0.01, 0.045, wHalfZ, face);
    g.use('emissiveCyan').box(wx + (side < 0 ? 0.01 : -0.01), DECK + 2.15, wMidZ, 0.01, 0.045, wHalfZ, face);
    // Forward speed chevrons along the track every 3.5m.
    for (let wz = WALL_PIT.z1 - 2.2; wz > WALL_PIT.z0 + 1.8; wz -= 3.5) {
      g.use('emissiveCyan').box(wx + (side < 0 ? 0.012 : -0.012), DECK + 1.65, wz, 0.008, 0.34, 0.06, face);
    }
  }

  // Wall-run landing deck leading into the Chimney.
  k.block('steelDark', x0, PIT, WALL_LAND.z0, x1, DECK, WALL_LAND.z1, 0.06, 'metal');
  floorGuide(k, 0, DECK, WALL_LAND.z1 - 0.6, WALL_LAND.z0 + 0.5, { width: 1.8, step: 2.2 });

  // --- Station E: The Chimney Shaft (z: -103..-100, DECK 2.8m -> CHIMNEY_TOP 14.8m) ---
  const { x0: cx0, x1: cx1, z0: cz0, z1: cz1, side, back } = CHIMNEY;
  k.mass('panel', cx0 - side, DECK, cz0, cx0, CHIMNEY_TOP, cz1);
  k.mass('panel', cx1, DECK, cz0, cx1 + side, CHIMNEY_TOP, cz1);
  k.mass('panel', cx0 - side, 0, cz0 - back, cx1 + side, CHIMNEY_TOP, cz0);
  k.mass('steelDark', cx0 - side, 0, cz0, cx1 + side, DECK, WALL_LAND.z0);
  // Sealed flanking bulkhead towers so the chimney is the only route up.
  k.mass('steelDark', x0, 0, cz0 - back, cx0 - side, WALL, WALL_LAND.z0);
  k.mass('steelDark', cx1 + side, 0, cz0 - back, x1, WALL, WALL_LAND.z0);
  sign(k, 0, DECK + 2.6, cz0 + 0.08, 0, 'CHIMNEY', 2.2);
  // Flush vertical cyan track spines + alternating left-right glowing step chevrons teaching the kick rhythm!
  g.use('emissiveCyan').box(cx0 + 0.01, (DECK + CHIMNEY_TOP) / 2, (cz0 + cz1) / 2, 0.01, (CHIMNEY_TOP - DECK) / 2, 0.04, FACE.px);
  g.use('emissiveCyan').box(cx1 - 0.01, (DECK + CHIMNEY_TOP) / 2, (cz0 + cz1) / 2, 0.01, (CHIMNEY_TOP - DECK) / 2, 0.04, FACE.nx);
  for (let i = 0; i < 6; i++) {
    const ry = DECK + 1.4 + i * 1.9;
    const onLeft = i % 2 === 0;
    const rx = onLeft ? cx0 + 0.015 : cx1 - 0.015;
    g.use('emissiveCyan').box(rx, ry, (cz0 + cz1) / 2, 0.01, 0.05, 0.95, onLeft ? FACE.px : FACE.nx);
  }
  // Top deck side safety rails & illuminated launch edge overlooking the Slam Pit.
  k.rail([cx0 - side + 0.2, CHIMNEY_TOP, cz0, cx0 - side + 0.2, CHIMNEY_TOP, cz0 - back + 0.2]);
  k.rail([cx1 + side - 0.2, CHIMNEY_TOP, cz0, cx1 + side - 0.2, CHIMNEY_TOP, cz0 - back + 0.2]);
  g.use('emissiveCyan').box(0, CHIMNEY_TOP + 0.015, cz0 - back + 0.14, cx1 + side - 0.3, 0.01, 0.06, FACE.py);
  sign(k, 0, CHIMNEY_TOP - 2.6, cz0 - back - 0.08, Math.PI, 'SLAM', 2.6);

  // --- Station F: The Slam Target Arena (z: -124..-106) ---
  // Concentric sci-fi shock-test target bullseye inlaid on the deck.
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.use('paintYellow').box(SLAM_PIT.cx + Math.cos(a) * 4.2, 0.008, SLAM_PIT.cz + Math.sin(a) * 4.2, 0.34, 0.003, 0.12, FACE.py);
    g.use('emissiveOrange').box(SLAM_PIT.cx + Math.cos(a) * 3.85, 0.01, SLAM_PIT.cz + Math.sin(a) * 3.85, 0.22, 0.004, 0.04, FACE.py);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.use('emissiveCyan').box(SLAM_PIT.cx + Math.cos(a) * 1.4, 0.01, SLAM_PIT.cz + Math.sin(a) * 1.4, 0.18, 0.004, 0.035, FACE.py);
  }
  // Blast-deflector pad right in front of the Rocket Ledge showing the exact rocket-jump sweet spot!
  g.use('steelDark').bevel(0, 0.03, -124.0, 2.2, 0.03, 1.3, 0.02);
  g.use('emissiveOrange').box(0, 0.065, -124.0, 1.6, 0.005, 0.06, FACE.py);
  g.use('emissiveOrange').box(0, 0.065, -124.0, 0.06, 0.005, 0.9, FACE.py);
  g.use('hazard').box(0, 0.065, -125.15, 2.1, 0.005, 0.16, FACE.py);

  // --- Station G & H: Rocket Ledge (no-climb, y=7m) & Jump Jet Thruster Pylon (no-climb, y=7..14m) ---
  k.noClimb(() => k.block('steelDark', x0, 0, ROCKET_LEDGE.z0, x1, LEDGE, ROCKET_LEDGE.z1, 0.06, 'metal'));
  // Vertical amber no-climb chevrons & hazard edge along the Rocket Ledge face.
  g.use('hazard').box(0, LEDGE - 0.18, ROCKET_LEDGE.z1 + 0.02, (x1 - x0) / 2 - 0.2, 0.14, 0.015, FACE.pz);
  for (const sx of [-4, 0, 4]) {
    g.use('emissiveOrange').box(sx, LEDGE * 0.5, ROCKET_LEDGE.z1 + 0.02, 0.05, LEDGE * 0.36, 0.015, FACE.pz);
  }
  sign(k, 0, LEDGE + 1.85, ROCKET_LEDGE.z1 + 0.08, 0, 'ROCKET JUMP', 3.0);

  // Jump Jet Thruster Pylon with angled structural fins & altitude tick marks!
  const jt = JET_TOWER;
  const jcx = (jt.x0 + jt.x1) / 2, jcz = (jt.z0 + jt.z1) / 2;
  k.noClimb(() => k.block('steelDark', jt.x0, LEDGE, jt.z0, jt.x1, LEDGE + jt.h, jt.z1, 0.06, 'metal'));
  for (let tick = 1; tick <= 6; tick++) {
    const ty = LEDGE + tick * 1.05;
    g.use('emissiveCyan').box(jt.x1 + 0.02, ty, jcz, 0.015, 0.03, 1.35, FACE.px);
    g.use('emissiveCyan').box(jcx, ty, jt.z1 + 0.02, 1.45, 0.03, 0.015, FACE.pz);
  }
  // Glowing beacon landing pad atop the Jump Jet tower.
  g.use('emissiveCyan').box(jcx, LEDGE + jt.h + 0.015, jcz, (jt.x1 - jt.x0) / 2 - 0.25, 0.01, (jt.z1 - jt.z0) / 2 - 0.25, FACE.py);
  sign(k, jt.x1 + 0.08, LEDGE + 2.35, jcz, Math.PI / 2, 'JUMP JET', 2.4);

  // North bulkhead airlock at y = LEDGE into The Gallery.
  k.mass('steelDark', x0 - T, 0, ROCKET_LEDGE.z0 - T, x1 + T, LEDGE, ROCKET_LEDGE.z0);
  bulkheadWall(k, x0 - T, x1 + T, ROCKET_LEDGE.z0 - T, ROCKET_LEDGE.z0, LEDGE, WALL - LEDGE, DOORS.gallery.x, DOORS.gallery.w, 3.5, 'emissiveCyan');

  // Crisp overhead bay lighting (always between obstacles, never inside one).
  for (const z of [-3, -15.5, -22, -37.5, -54, -65, -81, -96, -113, -122]) {
    lightGantry(k, x0, x1, 10.5, z, 'white', 120, 24);
  }
  k.light(0, CHIMNEY_TOP + 3, SLAM_PIT.cz, 'cyan', 100, 24);
  k.light(jcx, LEDGE + jt.h + 3, jcz, 'cyan', 70, 16);
}

// -------------------------------------------------------------------------------------------------
// 3. THE GALLERY — Starship Ballistics & Armament Deck
// -------------------------------------------------------------------------------------------------

function gallery(k: Kit): void {
  const { x0, x1, z0, z1, landing, foot } = GALLERY;
  const g = k.geo;
  const h = 9.5;

  k.floor('tile', x0, z0, x1, z1, 0);
  k.mass('panel', x0 - T, 0, z0, x0, h, z1);
  k.mass('panel', x1, 0, z0, x1 + T, h, z1);
  dressHullWall(k, x0, 1, z0, z1, 0, h, { bay: 6.5, stripY: [1.3, 6.2], pipes: true });
  dressHullWall(k, x1, -1, z0, z1, 0, h, { bay: 6.5, stripY: [1.3, 6.2], pipes: true });

  // Open starship hull ribs framing the range — deliberately leaving (8, -162) wide open above for the Supply Pod!
  for (const rz of [-138, -150, -172, -184, -196]) {
    ribArch(k, x0, x1, rz, 0, h, { openTop: true, cant: 2.0 });
  }
  // Elevated evaluator observation gallery along the west wall overlooking the firing lanes.
  obsBooth(k, x0, 1, 5.2, -168, 16, 3.2);

  // Arrival mezzanine (y = LEDGE) with glass overlook balustrade & sleek stairs down.
  k.block('steelDark', x0, 0, landing, x1, LEDGE, z1, 0.06, 'metal');
  for (const [rx0, rx1] of [[x0 + 0.2, -2.3], [2.3, x1 - 0.2]] as const) {
    g.use('steelDark').bevel((rx0 + rx1) / 2, LEDGE + 0.08, landing + 0.14, (rx1 - rx0) / 2, 0.08, 0.14, 0.02);
    g.use('glass').box((rx0 + rx1) / 2, LEDGE + 0.62, landing + 0.14, (rx1 - rx0) / 2 - 0.05, 0.46, 0.03);
    g.use('steel').bevel((rx0 + rx1) / 2, LEDGE + 1.1, landing + 0.14, (rx1 - rx0) / 2, 0.04, 0.08, 0.01);
  }
  k.stairs(0, landing, LEDGE, 0, foot, 0, 4, 'steel', true);
  // Overhead entry header gantry spanning the first bay, greeting arrivals from the mezzanine.
  g.use('steelDark').bevel(0, h - 0.15, -150, (x1 - x0) / 2, 0.22, 0.24, 0.03);
  g.use('emissiveCyan').box(0, h - 0.38, -149.76, (x1 - x0) / 2 - 2.4, 0.025, 0.02, FACE.pz);
  sign(k, 0, h - 0.65, -149.72, 0, 'THE GALLERY', 3.6);

  // --- Ballistic Firing Line (z = -153) & Dual Target Lanes ---
  // Glowing cyan firing line & range lane rails extending straight to laneA (-4, -170) and laneB (+4, -178).
  g.use('emissiveCyan').box(0, 0.01, foot - 2, 10.5, 0.005, 0.06, FACE.py);
  g.use('hazard').box(0, 0.008, foot - 2.4, 10.5, 0.004, 0.24, FACE.py);
  // Two firing stall dividers (short, flanking the edges so center sightlines stay wide open).
  for (const sx of [-8.5, 0, 8.5]) {
    if (sx === 0) continue; // Keep center aisle completely clear!
    g.use('steelDark').bevel(sx, 0.65, foot - 2.0, 0.08, 0.65, 1.0, 0.02);
    g.use('glass').box(sx, 1.55, foot - 2.0, 0.02, 0.35, 0.9);
  }
  // Range lane tracks & glowing circular subject pedestals at laneA and laneB.
  for (const [lx, lz, accent] of [[-4, -170, 'emissiveCyan'], [4, -178, 'emissiveOrange']] as const) {
    g.use(accent).box(lx - 1.1, 0.008, (foot - 2 + lz) / 2, 0.025, 0.004, (foot - 2 - lz) / 2, FACE.py);
    g.use(accent).box(lx + 1.1, 0.008, (foot - 2 + lz) / 2, 0.025, 0.004, (foot - 2 - lz) / 2, FACE.py);
    g.use('steelDark').lathe([1.05, 0, 1.05, 0.05, 0.85, 0.06], lx, 0, lz, 16, false);
    g.use(accent).lathe([1.06, 0.04, 1.06, 0.065], lx, 0, lz, 16, false);
  }
  // Distance telemetry console on west wall near firing line.
  consoleDesk(k, x0 + 1.1, 0, -155, Math.PI / 2, 2.2);

  // --- Supply Pod Drop Pad (x = 8, z = -162) ---
  const px = 8, pz = -162;
  g.use('steelDark').bevel(px, 0.04, pz, 2.5, 0.04, 2.5, 0.03);
  g.use('hazard').box(px, 0.085, pz + 2.35, 2.4, 0.006, 0.18, FACE.py);
  g.use('hazard').box(px, 0.085, pz - 2.35, 2.4, 0.006, 0.18, FACE.py);
  g.use('hazard').box(px - 2.35, 0.085, pz, 0.18, 0.006, 2.2, FACE.py);
  g.use('emissiveOrange').box(px, 0.09, pz, 1.65, 0.006, 0.06, FACE.py);
  g.use('emissiveOrange').box(px, 0.09, pz, 0.06, 0.006, 1.65, FACE.py);
  // Four glowing corner beacon bollards around the drop pad.
  for (const sx of [-2.2, 2.2]) for (const sz of [-2.2, 2.2]) {
    g.use('steelDark').bevel(px + sx, 0.32, pz + sz, 0.14, 0.32, 0.14, 0.03);
    g.use('emissiveOrange').box(px + sx, 0.66, pz + sz, 0.1, 0.06, 0.1);
  }
  sign(k, x1 - 0.12, 3.6, pz, -Math.PI / 2, 'SUPPLY', 2.4);
  k.light(px, 4.2, pz, 'orange', 55, 14);

  // --- Grenade Blast Wall & Trench (z: -191..-198) ---
  k.block('steelDark', -7, 0, -191.2, 7, 1.2, -190.4, 0.05, 'metal');
  g.use('hazard').box(0, 1.06, -190.38, 6.8, 0.1, 0.015, FACE.pz);
  // Angled blast-shield steel backing behind the trench.
  g.use('steelDark').bevel(0, 0.6, -197.2, 6.4, 0.6, 0.25, 0.04);
  // Floor throw-line cue in front of the blast wall.
  floorGuide(k, 0, 0, -182, -189.2, { mat: 'emissiveOrange', width: 2.0, step: 2.4 });

  // --- Corrective Shock Floor Grid (in front of Cutting Room door) ---
  g.use('grate').box(0, 0.012, -198.4, 4.5, 0.006, 1.1, FACE.py);
  g.use('emissiveCyan').box(0, 0.008, -198.4, 4.2, 0.004, 0.04, FACE.py);
  sign(k, -5.2, 2.6, z0 + 0.12, 0, 'HIGH VOLTAGE', 2.2);

  // North bulkhead airlock into the Cutting Room.
  bulkheadWall(k, x0 - T, x1 + T, z0 - T, z0, 0, h, DOORS.blade.x, DOORS.blade.w, 3.5, 'emissiveCyan');

  for (let z = -144; z > z0; z -= 14) {
    lightGantry(k, x0, x1, h - 0.6, z, 'white', 110, 24);
  }
}

// -------------------------------------------------------------------------------------------------
// 4. THE CUTTING ROOM — Sterile Surgical-Combat Melee Bay
// -------------------------------------------------------------------------------------------------

function blade(k: Kit): void {
  const { x0, x1, z0, z1 } = BLADE;
  const g = k.geo;
  const h = 7.2;

  // Gleaming sterile surgical tile floor with recessed central blood-drainage grates.
  k.floor('tile', x0, z0, x1, z1, 0);
  g.use('grate').box(0, 0.008, -214, 0.75, 0.004, 9.5, FACE.py);
  g.use('grate').box(0, 0.008, -214, 7.5, 0.004, 0.75, FACE.py);
  g.use('steelDark').box(0, 0.006, -214, 0.9, 0.003, 9.7, FACE.py);
  // Crisp surgical combat perimeter circle around the melee subjects.
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.use('emissiveWhite').box(Math.cos(a) * 5.2, 0.01, -214.5 + Math.sin(a) * 5.2, 0.28, 0.004, 0.045, FACE.py);
  }

  // Sterile cool-white hull walls, stainless washdown piping, and overhead surgical light rigs.
  k.mass('panel', x0 - T, 0, z0, x0, h, z1);
  k.mass('panel', x1, 0, z0, x1 + T, h, z1);
  dressHullWall(k, x0, 1, z0, z1, 0, h, { bay: 5, stripY: [0.4, 3.8], accent: 'emissiveWhite', pipes: true });
  dressHullWall(k, x1, -1, z0, z1, 0, h, { bay: 5, stripY: [0.4, 3.8], accent: 'emissiveWhite', pipes: true });
  for (const rz of [-207, -214.5, -222]) {
    ribArch(k, x0, x1, rz, 0, h, { openTop: true, accent: 'emissiveWhite', cant: 1.8 });
  }
  obsBooth(k, x1, -1, 3.6, -214.5, 11, 2.8);

  // North bulkhead airlock into the Quiet Room.
  bulkheadWall(k, x0 - T, x1 + T, z0 - T, z0, 0, h, DOORS.quiet.x, DOORS.quiet.w, 3.5, 'emissiveWhite');
  sign(k, 0, 4.45, z0 + 0.12, 0, 'STANDARD ISSUE', 2.8);

  lightGantry(k, x0, x1, h - 0.5, -209, 'white', 100, 18);
  lightGantry(k, x0, x1, h - 0.5, -214.5, 'white', 120, 20);
  lightGantry(k, x0, x1, h - 0.5, -220, 'white', 100, 18);
}

// -------------------------------------------------------------------------------------------------
// 5. THE QUIET ROOM — Stealth Kill-House Pods & The Gun Kata Ring
// -------------------------------------------------------------------------------------------------

function quiet(k: Kit): void {
  const { x0, x1, z0, z1 } = QUIET;
  const g = k.geo;
  const h = 7.4;

  k.floor('concreteDark', x0, z0, x1, z1, 0);
  k.mass('panel', x0 - T, 0, z0, x0, h, z1);
  k.mass('panel', x1, 0, z0, x1 + T, h, z1);
  dressHullWall(k, x0, 1, z0, z1, 0, h, { bay: 6.5, stripY: [0.35, 4.4], accent: 'emissiveRed', pipes: true });
  dressHullWall(k, x1, -1, z0, z1, 0, h, { bay: 6.5, stripY: [0.35, 4.4], accent: 'emissiveRed', pipes: true });
  for (const rz of [-234, -246, -258, -267]) {
    ribArch(k, x0, x1, rz, 0, h, { openTop: true, accent: 'emissiveRed', cant: 2.0 });
  }

  // --- South Half: Modular Sci-Fi Tactical Kill-House Partitions (hiding the 3 Sonar subjects) ---
  const pods: readonly (readonly [number, number, number, number])[] = [
    [-14, -236, -6, -236.6],
    [-6, -236.6, -6.6, -244],
    [6, -236.6, 14, -236],
    [6.6, -244, 6, -236.6],
    [-3, -246, 3, -246.6],
  ];
  for (const [ax, az, bx, bz] of pods) {
    const px0 = Math.min(ax, bx), px1 = Math.max(ax, bx);
    const pz0 = Math.min(az, bz), pz1 = Math.max(az, bz);
    k.mass('steelDark', px0, 0, pz0, px1, 4.0, pz1);
    // Bevelled sci-fi armor cap & thin vertical red emergency edge markers so partitions read crisply in low light!
    g.use('panel').tint(0.65, 0.72, 0.82).bevel((px0 + px1) / 2, 4.1, (pz0 + pz1) / 2, (px1 - px0) / 2 + 0.08, 0.12, (pz1 - pz0) / 2 + 0.08, 0.04);
    g.tint(1);
    g.use('emissiveRed').box((px0 + px1) / 2, 0.25, (pz0 + pz1) / 2, (px1 - px0) / 2 + 0.03, 0.03, (pz1 - pz0) / 2 + 0.03);
  }
  floorGuide(k, 0, 0, -228.5, -244.5, { mat: 'emissiveRed', width: 1.6, step: 2.6 });

  // --- North Half: THE RING (Gun Kata Arena, centered at 0, -258) ---
  const rcz = -258;
  // Slightly raised circular central dais (0.06m step — smooth to walk on) with glowing crimson halo!
  g.use('steelDark').lathe([1.85, 0, 1.85, 0.06, 1.55, 0.06], 0, 0, rcz, 32, false);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    g.use('emissiveRed').box(Math.cos(a) * 1.68, 0.065, rcz + Math.sin(a) * 1.68, 0.14, 0.005, 0.045, FACE.py);
    g.use('emissiveRed').box(Math.cos(a) * 9.0, 0.01, rcz + Math.sin(a) * 9.0, 0.42, 0.004, 0.05, FACE.py);
  }
  // 8 radial glowing crimson spokes connecting center dais to the 8 kata subject spots!
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const tx = Math.cos(a) * 9, tz = rcz + Math.sin(a) * 9;
    k.stripLine([Math.cos(a) * 1.9, 0.01, rcz + Math.sin(a) * 1.9, tx, 0.01, tz], 0.04, 'emissiveRed');
    g.use('steelDark').lathe([0.65, 0, 0.65, 0.04, 0.5, 0.04], tx, 0, tz, 12, false);
    g.use('emissiveRed').lathe([0.66, 0.03, 0.66, 0.045], tx, 0, tz, 12, false);
  }
  // Dramatic overhead octagonal red spotlight rig suspended above The Ring.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = ((i + 1) / 8) * Math.PI * 2;
    k.beam(Math.cos(a) * 4.5, h - 0.6, rcz + Math.sin(a) * 4.5, Math.cos(b) * 4.5, h - 0.6, rcz + Math.sin(b) * 4.5, 0.12, 0.14, 'steelDark');
    g.use('emissiveRed').box(Math.cos(a) * 4.5, h - 0.78, rcz + Math.sin(a) * 4.5, 0.22, 0.04, 0.22);
  }

  // Heavy blast bulkhead opening outdoors to The Yard.
  bulkheadWall(k, x0 - T, x1 + T, z0 - T, z0, 0, h, DOORS.yard.x, DOORS.yard.w, 3.8, 'emissiveCyan');
  sign(k, 0, 4.9, z0 + 0.12, 0, 'BLAST DOOR', 2.8);

  k.light(-9, 5.4, -240, 'white', 65, 15);
  k.light(9, 5.4, -240, 'white', 65, 15);
  k.light(0, 5.4, -234, 'white', 55, 14);
  k.light(0, 6.2, rcz, 'red', 105, 20);
}

// -------------------------------------------------------------------------------------------------
// 6. THE YARD — Exterior Proving Ground & Council Observation Balcony
// -------------------------------------------------------------------------------------------------

function yard(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1 } = YARD;
  const g = k.geo;

  // Compacted earth proving ground with weathered asphalt service apron & tactical lane markings.
  k.floor('dirt', x0, z0, x1, z1, 0);
  g.use('asphalt').tint(0.62, 0.66, 0.72).slab(0, 0.015, -280, 14, 0.015, 9, 4, FACE.py);
  g.use('asphalt').tint(0.58, 0.62, 0.68).slab(-6, 0.015, -306, 4.2, 0.015, 22, 4, FACE.py);
  g.tint(1);

  // Exterior starship facility facade on the south boundary (back of the Quiet Room).
  for (const fx of [-22, -16, 16, 22]) {
    k.mass('steelDark', fx - 0.7, 0, z1, fx + 0.7, 7.6, z1 + 1.4);
  }
  k.mass('panel', x0 - T, 0, z1, QUIET.x0, 7.4, z1 + T);
  k.mass('panel', QUIET.x1, 0, z1, x1 + T, 7.4, z1 + T);
  vent(k, -20, 4.2, z1 - 0.06, Math.PI, 3.4, 1.8);
  vent(k, 20, 4.2, z1 - 0.06, Math.PI, 3.4, 1.8);
  sign(k, 0, 5.0, z1 - 0.14, Math.PI, 'THE YARD', 3.2);

  // Fortified proving-ground perimeter walls with buttresses & upper security chain-link fencing.
  k.mass('concreteDark', x0 - T, 0, z0, x0, 6.0, z1);
  k.mass('concreteDark', x1, 0, z0, x1 + T, 6.0, z1);
  for (let wz = z0 + 6; wz < z1 - 4; wz += 10) {
    for (const side of [-1, 1]) {
      const wx = side < 0 ? x0 : x1;
      g.use('steelDark').bevel(wx - side * 0.25, 3.0, wz, 0.3, 3.0, 0.35, 0.05);
      g.use('emissiveCyan').box(wx - side * 0.56, 5.6, wz, 0.02, 0.06, 0.35);
    }
  }
  fence(k, [x0 + 0.15, z0, x0 + 0.15, z1], 6.0, 2.2, false);
  fence(k, [x1 - 0.15, z0, x1 - 0.15, z1], 6.0, 2.2, false);

  // --- The Roofless Tactical Ambush Shed (SHED: x 14..24, z -324..-314) ---
  // Open to the sky so the capture drone skyhook lifts cuffed men cleanly out of it!
  const { x0: sx0, x1: sx1, z0: sz0, z1: sz1, h } = SHED;
  k.floor('concreteDark', sx0, sz0, sx1, sz1, 0.02, 0.08, 3);
  k.mass('plywood', sx0, 0, sz0, sx1, h, sz0 + 0.3);
  k.mass('plywood', sx0, 0, sz1 - 0.3, sx1, h, sz1);
  k.mass('plywood', sx1 - 0.3, 0, sz0, sx1, h, sz1);
  k.mass('plywood', sx0, 0, sz0, sx0 + 0.3, h, sz0 + 3);
  k.mass('plywood', sx0, 0, sz1 - 3, sx0 + 0.3, h, sz1);
  // Structural steel corner posts, perimeter rim beams, entrance frame, and warm interior work light.
  for (const [cx, cz] of [[sx0 + 0.15, sz0 + 0.15], [sx1 - 0.15, sz0 + 0.15], [sx0 + 0.15, sz1 - 0.15], [sx1 - 0.15, sz1 - 0.15]] as const) {
    g.use('steelDark').bevel(cx, h / 2, cz, 0.2, h / 2 + 0.15, 0.2, 0.03);
  }
  k.beam(sx0, h + 0.08, sz0 + 0.15, sx1, h + 0.08, sz0 + 0.15, 0.16, 0.12, 'steelDark');
  k.beam(sx0, h + 0.08, sz1 - 0.15, sx1, h + 0.08, sz1 - 0.15, 0.16, 0.12, 'steelDark');
  k.beam(sx1 - 0.15, h + 0.08, sz0, sx1 - 0.15, h + 0.08, sz1, 0.16, 0.12, 'steelDark');
  // Entrance lintel & amber work-beacon over the west doorway so the shed is unmistakably readable!
  k.beam(sx0 + 0.15, h - 0.1, sz0 + 3, sx0 + 0.15, h - 0.1, sz1 - 3, 0.18, 0.14, 'steelDark');
  g.use('emissiveOrange').box(sx0 - 0.04, h - 0.1, (sz0 + sz1) / 2, 0.02, 0.05, 1.4, FACE.nx);
  palletStack(k, sx1 - 1.4, sz0 + 1.5, 0.2, 2);
  drumCluster(k, sx1 - 1.4, sz1 - 1.5, 3);
  k.light((sx0 + sx1) / 2, 3.2, (sz0 + sz1) / 2, 'orange', 55, 14);

  // --- Realistic Tactical Proving-Ground Cover (keeping yardA (-10, -299) and stairs (-6, -320) clear!) ---
  // Tiered sandbag fighting positions for squad A.
  for (const [bx0, bz0, bx1, bz1] of [[-18, -296.2, -5, -295.0], [4, -290.2, 12, -289.0]] as const) {
    k.block('dirt', bx0, 0, bz0, bx1, 1.05, bz1, 0.16);
    g.use('paintWhite').tint(0.55, 0.50, 0.40).bevel((bx0 + bx1) / 2, 1.12, (bz0 + bz1) / 2, (bx1 - bx0) / 2 - 0.1, 0.08, (bz1 - bz0) / 2 - 0.08, 0.04);
    g.tint(1);
  }
  // Concrete jersey barriers & industrial machinery / shipping containers framing the flanks.
  barrier(k, -21, 0, -311, 0.15, 5.2);
  barrier(k, 1, 0, -305, -0.1, 5.0);
  barrier(k, -14, 0, -284, 0.25, 4.4);
  barrier(k, 14, 0, -284, -0.2, 4.4);
  container(k, -23.5, 0, -290, Math.PI / 2, [0.34, 0.44, 0.56]);
  container(k, 23.5, 0, -296, Math.PI / 2, [0.46, 0.52, 0.58]);
  machine(k, -25, 0, -324, Math.PI / 2, 3.6, 2.6, 2.2);
  tyres(k, -19.5, 0, -295, 3);
  palletStack(k, 10, -310, 0.4, 2);
  spec.shack(-22, -280, 0.2, 'sheet', 0, [0.52, 0.58, 0.64]);

  // --- Monumental Council Observation Balcony (STAND: x -10..10, z -342..-334, y = BALCONY = 6m) ---
  const { x0: bx0, x1: bx1, z0: bz0, z1: bz1 } = STAND;
  k.mass('steelDark', bx0, 0, bz0, bx1, BALCONY, bz1);
  k.mass('panel', x0 - T, 0, z0 - T, bx0, 6.2, z0);
  k.mass('panel', bx1, 0, z0 - T, x1 + T, 6.2, z0);
  // Heavy canted sci-fi support ribs on the south facade of the observation bunker.
  for (const rx of [-8.8, -1.5, 2.5, 8.8]) {
    k.beam(rx, 0, bz1 + 1.4, rx, BALCONY, bz1 + 0.05, 0.28, 0.26, 'steelDark');
    g.use('emissiveCyan').box(rx, BALCONY - 0.3, bz1 + 0.18, 0.06, 0.5, 0.02, FACE.pz);
  }
  // Grand staircase ascending to the observation balcony with glowing cyan tread guide!
  k.stairs(STAIRS_X, bz1 + 12, 0, STAIRS_X, bz1, BALCONY, 4, 'steel', true);
  floorGuide(k, STAIRS_X, 0.02, bz1 + 16.5, bz1 + 12.2, { width: 2.2, step: 2.0 });
  sign(k, STAIRS_X, 3.6, bz1 + 0.14, 0, 'STAIRS', 2.2);

  // Panoramic armored glass observation parapet overlooking the shantytown (open sky above for nuke aiming!).
  k.block('steelDark', bx0, BALCONY, bz0, bx1, BALCONY + 0.14, bz0 + 0.34, 0.03, 'metal');
  k.deco('glass', bx0 + 0.3, BALCONY + 0.14, bz0 + 0.12, bx1 - 0.3, BALCONY + 1.15, bz0 + 0.22, 0.01);
  k.deco('steel', bx0, BALCONY + 1.15, bz0, bx1, BALCONY + 1.24, bz0 + 0.34, 0.02);
  for (const mx of [-6.5, -2.5, 2.5, 6.5]) {
    g.use('steelDark').bevel(mx, BALCONY + 0.65, bz0 + 0.17, 0.07, 0.52, 0.12, 0.015);
  }
  g.use('emissiveCyan').box(0, BALCONY + 0.17, bz0 + 0.35, 9.4, 0.02, 0.02, FACE.pz);
  k.collide(0, BALCONY + 0.62, bz0 + 0.17, (bx1 - bx0) / 2, 0.62, 0.17, 'glass');

  // Blast-catch rear & side walls of the observation deck (catches the contractor when the nuke shockwave hits!).
  k.mass('panel', bx0, BALCONY, bz1 - 0.55, STAIRS_X - 2.2, BALCONY + 4.4, bz1);
  k.mass('panel', STAIRS_X + 2.2, BALCONY, bz1 - 0.55, bx1, BALCONY + 4.4, bz1);
  for (const wx of [bx0, bx1 - 0.55]) {
    k.mass('panel', wx, BALCONY, bz0, wx + 0.55, BALCONY + 4.4, bz1);
  }
  // Cantilevered rear blast-hood ribs along the back half of the balcony (leaving the north rail open to the sky!).
  for (const rx of [-8.8, -2.8, 2.8, 8.8]) {
    k.beam(rx, BALCONY + 4.2, bz1 - 0.2, rx, BALCONY + 4.8, bz1 - 2.6, 0.16, 0.16, 'steelDark');
  }
  // Tactical Nuke command telemetry consoles tucked against the east/west balcony sides.
  consoleDesk(k, bx1 - 1.5, BALCONY, bz0 + 3.4, -Math.PI / 2, 2.2);
  sign(k, 3.2, BALCONY + 3.1, bz1 - 0.62, Math.PI, 'COMPLIANCE IS MANDATORY', 3.4);
  k.light(0, BALCONY + 3.6, bz1 - 2.2, 'cyan', 55, 16);

  // Yard perimeter floodlight masts.
  k.mast(-26, -276, 0, 12.5, 0.6, 'white', 140, 44);
  k.mast(26, -276, 0, 12.5, -0.6, 'white', 140, 44);
  k.mast(-26, -330, 0, 12.5, 2.4, 'white', 140, 44);
  k.mast(26, -330, 0, 12.5, -2.4, 'white', 140, 44);
}

// -------------------------------------------------------------------------------------------------
// Minimap vector plan
// -------------------------------------------------------------------------------------------------

function buildPlan(): MapPlan {
  return {
    fills: [
      { x0: INTAKE.x0, z0: INTAKE.z0, x1: INTAKE.x1, z1: INTAKE.z1, rgb: [38, 62, 82], label: 'INTAKE' },
      { x0: HALL.x0, z0: ROCKET_LEDGE.z0, x1: HALL.x1, z1: 0, rgb: [32, 50, 68], label: 'MOBILITY' },
      { x0: GALLERY.x0, z0: GALLERY.z0, x1: GALLERY.x1, z1: GALLERY.z1, rgb: [36, 56, 74], label: 'GALLERY' },
      { x0: BLADE.x0, z0: BLADE.z0, x1: BLADE.x1, z1: BLADE.z1, rgb: [44, 62, 76], label: 'CUTTING' },
      { x0: QUIET.x0, z0: QUIET.z0, x1: QUIET.x1, z1: QUIET.z1, rgb: [46, 36, 48], label: 'QUIET' },
      { x0: YARD.x0, z0: YARD.z0, x1: YARD.x1, z1: YARD.z1, rgb: [52, 56, 48], label: 'YARD' },
      { x0: TOWN.x0, z0: TOWN.z0, x1: TOWN.x1, z1: STAND.z0, rgb: [68, 52, 42], label: 'TOWN' },
    ],
    walls: [
      { ax: INTAKE.x0, az: INTAKE.z1, bx: INTAKE.x0, bz: INTAKE.z0, half: 0.5 },
      { ax: INTAKE.x1, az: INTAKE.z1, bx: INTAKE.x1, bz: INTAKE.z0, half: 0.5 },
      { ax: HALL.x0, az: 0, bx: HALL.x0, bz: ROCKET_LEDGE.z0, half: 0.5 },
      { ax: HALL.x1, az: 0, bx: HALL.x1, bz: ROCKET_LEDGE.z0, half: 0.5 },
      { ax: GALLERY.x0, az: GALLERY.z1, bx: GALLERY.x0, bz: GALLERY.z0, half: 0.5 },
      { ax: GALLERY.x1, az: GALLERY.z1, bx: GALLERY.x1, bz: GALLERY.z0, half: 0.5 },
      { ax: YARD.x0, az: YARD.z1, bx: YARD.x0, bz: YARD.z0, half: 0.5 },
      { ax: YARD.x1, az: YARD.z1, bx: YARD.x1, bz: YARD.z0, half: 0.5 },
      { ax: TOWN.x0, az: TOWN.z0, bx: TOWN.x1, bz: TOWN.z0, half: 0.6 },
    ],
    blocks: [
      { x0: SHED.x0, z0: SHED.z0, x1: SHED.x1, z1: SHED.z1 },
    ],
    decks: [
      { x0: HALL.x0, z0: ROCKET_LEDGE.z0, x1: HALL.x1, z1: ROCKET_LEDGE.z1 },
      { x0: STAND.x0, z0: STAND.z0, x1: STAND.x1, z1: STAND.z1 },
    ],
    gates: [],
    doors: [
      { x: DOORS.hall.x, z: DOORS.hall.z, dx: 0, dz: -1, w: DOORS.hall.w },
      { x: DOORS.gallery.x, z: DOORS.gallery.z, dx: 0, dz: -1, w: DOORS.gallery.w },
      { x: DOORS.blade.x, z: DOORS.blade.z, dx: 0, dz: -1, w: DOORS.blade.w },
      { x: DOORS.quiet.x, z: DOORS.quiet.z, dx: 0, dz: -1, w: DOORS.quiet.w },
      { x: DOORS.yard.x, z: DOORS.yard.z, dx: 0, dz: -1, w: DOORS.yard.w },
    ],
  };
}

export const ANNEX_STAGES = [
  { label: 'Pressurising the clone bay', run: (k: Kit, spec: MapSpec) => { spec.reactor = null; containment(k); intake(k); hall(k); } },
  { label: 'Calibrating the lanes', run: (k: Kit) => { gallery(k); blade(k); quiet(k); } },
  { label: 'Preparing the proving ground', run: (k: Kit, spec: MapSpec) => { yard(k, spec); buildAnnexTown(k, spec); } },
] as const;

export function authorAnnex(_k: Kit, spec: MapSpec): void {
  spec.plan = buildPlan();
  spec.zone('annex-intake', 'INTAKE', INTAKE.x0, -1, INTAKE.z0, INTAKE.x1, 6, EXIT.z1);
  spec.zone('annex-hall', 'MOBILITY HALL', HALL.x0, PIT - 1, ROCKET_LEDGE.z0, HALL.x1, WALL, 0);
  spec.zone('annex-gallery', 'GALLERY', GALLERY.x0, -1, GALLERY.z0, GALLERY.x1, 10, GALLERY.z1);
  spec.zone('annex-blade', 'CUTTING ROOM', BLADE.x0, -1, BLADE.z0, BLADE.x1, 8, BLADE.z1);
  spec.zone('annex-quiet', 'QUIET ROOM', QUIET.x0, -1, QUIET.z0, QUIET.x1, 8, QUIET.z1);
  spec.zone('annex-shed', 'SHED', SHED.x0, -1, SHED.z0, SHED.x1, 6, SHED.z1);
  spec.zone('annex-yard', 'YARD', YARD.x0, -1, YARD.z0, YARD.x1, 20, YARD.z1);
  spec.zone('annex-balcony', 'BALCONY', STAND.x0, BALCONY - 1, STAND.z0, STAND.x1, 30, STAND.z1);
  spec.zone('annex-town', 'TOWN', TOWN.x0, -1, TOWN.z0, TOWN.x1, 30, TOWN.z1);
  spec.playerSpawns.push({ position: new THREE.Vector3(0, 0.32, 8.5), yaw: 0 });
  // The yard's gates, where a man let go walks out, and where a lost body comes back.
  spec.spawns = [[-27, -276], [27, -276], [-27, -326], [27, -326]].map(([x, z]) => ({
    position: new THREE.Vector3(x!, 0.1, z!), zone: 'annex-yard', kind: 'ground' as const,
  }));
  spec.view('overview', 40, 60, 10, 0, 0, -160);
  spec.view('intake', 0, 1.7, 12, 0, 1.6, 0);
  spec.view('hall', 0, 14, 4, 0, 2, -80);
  spec.view('yard', -26, 10, -276, 10, 0, -310);
  spec.view('town', 0, BALCONY + 1.7, -336, 0, 2, -392);
}

export const ANNEX_BOUNDS = BOUNDS;
export const ANNEX_HUB = new THREE.Vector3(0, 0, -300);
