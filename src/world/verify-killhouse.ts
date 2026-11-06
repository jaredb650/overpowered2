/**
 * Proof sheet for The Kill House, run against the real physics world and the real Player. The static half measures what
 * the brief asks for. The sweep half runs a capsule through every door and along every wall at speed, because the
 * complaint this map answers was getting snagged on geometry.
 */
import * as THREE from 'three';
import { CG, type InputSystem, type PhysicsSystem, type PlayerSystem } from '../core/contracts';
import { KH, RAMP, rot, YARD_OUT } from './map/killhouse/plan';
import type { World } from './World';

const RAPIER_CUBOID = 1;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

const clearRun = (physics: PhysicsSystem, x: number, y: number, z: number, dx: number, dz: number, max: number): number => {
  _o.set(x, y, z);
  _d.set(dx, 0, dz);
  return physics.raycast(_o, _d, max, CG.World)?.distance ?? max;
};

const trueLength = (points: readonly number[]): number => {
  let l = 0;
  for (let i = 3; i < points.length; i += 3) l += Math.hypot(points[i]! - points[i - 3]!, points[i + 1]! - points[i - 2]!, points[i + 2]! - points[i - 1]!);
  return l;
};

/** What a body actually walks: the grid path pulled straight wherever a capsule fits, because the 8-way grid stair-steps. */
function walkedLength(physics: PhysicsSystem, points: readonly number[]): number {
  const n = points.length / 3;
  const at = (i: number, axis: number) => points[i * 3 + axis]!;
  let len = 0;
  for (let i = 0; i < n - 1;) {
    let j = n - 1;
    for (; j > i + 1; j--) {
      if (Math.abs(at(i, 1) - at(j, 1)) > 0.05) continue;
      _o.set(at(i, 0), at(i, 1) + 0.9, at(i, 2));
      _d.set(at(j, 0) - at(i, 0), 0, at(j, 2) - at(i, 2));
      if (!physics.sweepCapsule(_o, 0.4, 0.35, _d, CG.World)) break;
    }
    len += Math.hypot(at(j, 0) - at(i, 0), at(j, 1) - at(i, 1), at(j, 2) - at(i, 2));
    i = j;
  }
  return len;
}

export interface KillHouseReport {
  colliders: Record<string, number>;
  nav: { nodes: number; levels: Record<string, number>; slopeNodes: number };
  /** `meters` follows the grid. `walked` is the same route pulled straight. */
  longestPath: { cost: number; meters: number; walked: number; from: number[]; to: number[] };
  spawns: { total: number; byKind: Record<string, number>; flowFailures: string[]; worstMeters: number; jumpsNeeded: number; offGraphAir: string[] };
  doors: { count: number; narrowest: number; widths: Record<string, number>; blocked: string[] };
  narrowGaps: string[];
  corridorWidth: number;
  /** Pairs of standing eyes at least 18 m apart with a clear line. `worst` groups the longest by 6 m cells. */
  sightlines: { samples: number; longest: number; p95: number; over30: number; worst: string[] };
  containment: { holes: number; escapes: number };
  pickups: { total: number; deck: number; stranded: string[] };
  ms: number;
}

export function verifyKillHouse(world: World, physics: PhysicsSystem): KillHouseReport {
  const t0 = performance.now();
  const nav = world.navGraph;
  const plan = world.spec.plan!;

  const shapes = new Map<number, number>();
  physics.world.forEachCollider(c => shapes.set(c.shapeType(), (shapes.get(c.shapeType()) ?? 0) + 1));
  const colliders: Record<string, number> = {};
  for (const [type, n] of shapes) colliders[type === RAPIER_CUBOID ? 'box' : `other:${type}`] = n;

  const levels: Record<string, number> = {};
  let slopeNodes = 0;
  for (let i = 0; i < nav.nodeCount; i++) {
    if (Math.abs(nav.slopeX[i]!) + Math.abs(nav.slopeZ[i]!) > 0.05) { slopeNodes++; continue; }
    const key = nav.py[i]!.toFixed(2);
    levels[key] = (levels[key] ?? 0) + 1;
  }

  // Longest walk between any two places: every third node as a target, every node as a start.
  const p = new THREE.Vector3();
  let worst = { cost: 0, meters: 0, walked: 0, from: [0, 0, 0], to: [0, 0, 0] };
  for (let n = 0; n < nav.nodeCount; n += 3) {
    p.set(nav.px[n]!, nav.py[n]! + 0.1, nav.pz[n]!);
    nav.setTarget(p);
    nav.settle();
    const far = nav.farthest();
    if (far.cost > worst.cost) {
      const from = new THREE.Vector3(far.x, far.y + 0.1, far.z);
      const route = nav.trace(from).points;
      worst = { cost: far.cost, meters: Math.round(trueLength(route)), walked: Math.round(walkedLength(physics, route)), from: [far.x, far.y, far.z], to: [p.x, p.y, p.z] };
    }
  }

  // Flow from every spawn to a spread of places a player can stand.
  const spots: THREE.Vector3[] = [
    ...world.zones.map(z => z.bounds.getCenter(new THREE.Vector3()).setY(0.1)),
    new THREE.Vector3(-14.5, 4.6, -14.5), new THREE.Vector3(0, 4.6, 14.5), new THREE.Vector3(14.5, 4.6, 0), new THREE.Vector3(-3, 4.6, -19),
    new THREE.Vector3(30, 0.1, 30), new THREE.Vector3(-30, 0.1, -30), new THREE.Vector3(-30, 0.1, 30), new THREE.Vector3(30, 0.1, -30),
  ].map(s => { nav.nearest(s, 8, s); s.y += 0.1; return s; });
  const flowFailures: string[] = [];
  const offGraphAir: string[] = [];
  let worstMeters = 0, jumpsNeeded = 0;
  const out = new THREE.Vector3();
  const byKind: Record<string, number> = {};
  for (const s of world.spawnPoints) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  for (const target of spots) {
    nav.setTarget(target);
    nav.settle();
    for (const s of world.spawnPoints) {
      const name = `${s.kind} ${s.position.toArray().map(v => v.toFixed(0))}`;
      if (s.kind === 'air') {
        if (!nav.nearest(new THREE.Vector3(s.position.x, 0.1, s.position.z), 6, out) && !offGraphAir.includes(name)) offGraphAir.push(name);
        continue;
      }
      const flows = nav.flowDirection(s.position, out);
      const tr = nav.trace(s.position);
      if (!flows || !tr.ok) { flowFailures.push(`${name} -> ${target.toArray().map(v => v.toFixed(0))}`); continue; }
      jumpsNeeded += tr.kinds.jump + tr.kinds.pad;
      worstMeters = Math.max(worstMeters, walkedLength(physics, tr.points));
    }
  }

  const widths: Record<string, number> = {};
  const blockedDoors: string[] = [];
  let narrowest = Infinity;
  for (const d of plan.doors) {
    const a = clearRun(physics, d.x, 1, d.z, -d.dz, d.dx, 30), b = clearRun(physics, d.x, 1, d.z, d.dz, -d.dx, 30);
    const w = Math.round((a + b) * 100) / 100;
    narrowest = Math.min(narrowest, w);
    if (w < 3) blockedDoors.push(`${d.x.toFixed(1)},${d.z.toFixed(1)}`);
    widths[w.toFixed(2)] = (widths[w.toFixed(2)] ?? 0) + 1;
  }

  // Any floor node squeezed from two opposite sides. Anything under 3 m is a nook by this map's rules. Barrels are
  // left out: they are few, flush in corners, and they blow up.
  const barrels = world.spec.explosives.map(e => e.pos);
  const seen = new Set<string>();
  let corridorWidth = Infinity;
  // Axis pairs only: on a diagonal every room corner would read as a gap.
  const axes = [[1, 0], [0, 1]] as const;
  for (let i = 0; i < nav.nodeCount; i++) {
    if (nav.py[i]! > 0.3 || barrels.some(b => Math.hypot(b.x - nav.px[i]!, b.z - nav.pz[i]!) < 3.2)) continue;
    // Inside a gate bay axis rays cut across 45 degree corners and read short. Nobody runs through there at speed.
    const absX = Math.abs(nav.px[i]!), absZ = Math.abs(nav.pz[i]!);
    if (absX + absZ > KH.chamfer || Math.max(absX, absZ) > YARD_OUT) continue;
    for (const y of [0.5, 1.4]) {
      for (const [ax, az] of axes) {
        const w = clearRun(physics, nav.px[i]!, y, nav.pz[i]!, ax, az, 12) + clearRun(physics, nav.px[i]!, y, nav.pz[i]!, -ax, -az, 12);
        corridorWidth = Math.min(corridorWidth, w);
        if (w < 3) seen.add(`${Math.round(nav.px[i]! / 2) * 2},${Math.round(nav.pz[i]! / 2) * 2}`);
      }
    }
  }

  // Sightlines between standing eyes, floor to floor.
  const eyes: number[] = [];
  for (let i = 0; i < nav.nodeCount; i += 5) if (nav.py[i]! < 0.3) eyes.push(i);
  const lengths: number[] = [];
  const cellsOver30 = new Map<string, number>();
  const cell = (v: number) => Math.round(v / 6) * 6;
  for (let a = 0; a < eyes.length; a++) {
    for (let b = a + 1; b < eyes.length; b++) {
      const i = eyes[a]!, j = eyes[b]!;
      const dx = nav.px[j]! - nav.px[i]!, dz = nav.pz[j]! - nav.pz[i]!;
      const len = Math.hypot(dx, dz);
      if (len < 18) continue;
      if (clearRun(physics, nav.px[i]!, 1.6, nav.pz[i]!, dx / len, dz / len, len) >= len) {
        lengths.push(len);
        if (len > 30) {
          const key = `${cell(nav.px[i]!)},${cell(nav.pz[i]!)} to ${cell(nav.px[j]!)},${cell(nav.pz[j]!)}`;
          cellsOver30.set(key, Math.max(cellsOver30.get(key) ?? 0, Math.round(len)));
        }
      }
    }
  }
  lengths.sort((a, b) => a - b);

  let holes = 0, escapes = 0;
  const down = new THREE.Vector3(0, -1, 0);
  for (let x = -38; x <= 38; x += 1.5) for (let z = -38; z <= 38; z += 1.5) {
    _o.set(x, 39, z);
    if (!physics.raycast(_o, down, 45, CG.World)) holes++;
  }
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    for (const y of [1, 6, 10, 16, 24]) {
      _o.set(Math.cos(a) * 3, y, Math.sin(a) * 3);
      _d.set(Math.cos(a), 0, Math.sin(a));
      if (!physics.raycast(_o, _d, 120, CG.World)) escapes++;
    }
  }

  const stranded: string[] = [];
  let deck = 0;
  for (const s of world.pickupSpots) {
    if (s.y > 3) deck++;
    if (!nav.nearest(s, 2.5, out)) stranded.push(s.toArray().map(v => v.toFixed(1)).join(','));
  }

  return {
    colliders,
    nav: { nodes: nav.nodeCount, levels, slopeNodes },
    longestPath: worst,
    spawns: { total: world.spawnPoints.length, byKind, flowFailures: flowFailures.slice(0, 12), worstMeters: Math.round(worstMeters), jumpsNeeded, offGraphAir },
    doors: { count: plan.doors.length, narrowest, widths, blocked: blockedDoors },
    narrowGaps: [...seen].slice(0, 40),
    corridorWidth: Math.round(corridorWidth * 100) / 100,
    sightlines: { samples: lengths.length, longest: Math.round(lengths.at(-1) ?? 0), p95: Math.round(lengths[Math.floor(lengths.length * 0.95)] ?? 0), over30: lengths.filter(l => l > 30).length, worst: [...cellsOver30].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => `${k}: ${v} m`) },
    containment: { holes, escapes },
    pickups: { total: world.pickupSpots.length, deck, stranded },
    ms: Math.round(performance.now() - t0),
  };
}

export interface SweepRig {
  player: PlayerSystem;
  input: InputSystem;
  /** One fixed 60 Hz frame of the real game. */
  step(): void;
}

export interface SweepReport {
  doorRuns: number;
  doorPassed: number;
  /** Per approach angle in degrees: runs, how many got through, and the worst seconds lost against a free run. */
  doorByAngle: Record<string, { runs: number; passed: number; worstLoss: number; meanLoss: number }>;
  doorStops: string[];
  wallRuns: number;
  /** Mean ground covered along the wall as a fraction of top speed. */
  wallProgress: number;
  /** Runs where forward progress fell below 1 m/s for a sixth of a second: the capsule caught on something. */
  wallCatches: string[];
  /** Out of every gate bay into the yard, from the middle of the bay and near each jamb. */
  gateRuns: number;
  gateStops: string[];
  /** Each ramp from the floor to the far side of its pier, and each side of the deck ring including its seams. */
  climbRuns: number;
  climbCatches: string[];
  /** Slowest climb or deck run, as ground covered over top speed. */
  climbProgress: number;
  topSpeed: number;
  ms: number;
}

const OFFSETS = [-1.2, 0, 1.2];
const ANGLES = [0, 0.35, -0.35, 0.7, -0.7];
const LEAD = 6.5;

/**
 * Every door from both sides, near each jamb and through the middle, square on and at up to 40 degrees, at a run and with a
 * dash. Then every wall from end to end, leaning 6 degrees into it. A run counts as a snag if the capsule loses more than
 * the angle alone can explain.
 */
export function sweepPlayer(world: World, physics: PhysicsSystem, rig: SweepRig): SweepReport {
  const t0 = performance.now();
  const { player, input, step } = rig;
  const plan = world.spec.plan!;
  const dt = 1 / 60;
  const start = new THREE.Vector3();
  const release = () => {
    input.simulate('forward', false);
    input.simulate('dash', false);
    input.simulate('jump', false);
  };
  const place = (x: number, z: number, dirX: number, dirZ: number, y = 0.05) => {
    release();
    player.reset?.();
    start.set(x, y, z);
    player.teleport(start, Math.atan2(-dirX, -dirZ));
    step();
  };

  // Reach top speed once, on the open court, so ratios mean something whatever the movement tuning is.
  place(0, 8.5, 1, 0);
  input.simulate('forward', true);
  let top = 0;
  for (let i = 0; i < 40; i++) { step(); top = Math.max(top, player.speed); }
  release();

  let doorRuns = 0, doorPassed = 0;
  const doorStops: string[] = [];
  const byAngle: SweepReport['doorByAngle'] = {};
  for (const door of plan.doors) {
    const tx = -door.dz, tz = door.dx;
    for (const side of [1, -1]) {
      for (const offset of OFFSETS) {
        for (const angle of ANGLES) {
          for (const dash of [false, true]) {
            const c = Math.cos(angle), s = Math.sin(angle);
            const fx = door.dx * side, fz = door.dz * side;
            const vx = fx * c - fz * s, vz = fx * s + fz * c;
            const px = door.x + tx * offset, pz = door.z + tz * offset;
            const sx = px - vx * LEAD, sz = pz - vz * LEAD;
            // A legitimate run needs a straight line to the door from a place a body fits.
            _o.set(sx, 1, sz);
            if (physics.overlapCapsule(_o, 0.5, 0.45, CG.World)) continue;
            const span = Math.hypot(px - sx, pz - sz);
            if (clearRun(physics, sx, 0.5, sz, vx, vz, span + 1.5) < span + 1.5 || clearRun(physics, sx, 1.5, sz, vx, vz, span + 1.5) < span + 1.5) continue;
            doorRuns++;
            place(sx, sz, vx, vz);
            input.simulate('forward', true);
            let t = 0, passed = false;
            while (t < 2) {
              input.simulate('dash', dash && Math.abs(t - 0.25) < dt / 2);
              step();
              t += dt;
              const along = (player.position.x - door.x) * fx + (player.position.z - door.z) * fz;
              if (along > 2.5) { passed = true; break; }
            }
            if (passed) doorPassed++;
            // Dash runs are faster than this baseline, so only a plain run can show a real loss of time.
            const free = (LEAD + 2.5 / Math.max(Math.cos(angle), 0.5)) / top + 0.12;
            const loss = dash ? 0 : Math.max(0, t - free);
            const key = String(Math.round(Math.abs(angle) * 57.3 / 5) * 5);
            const row = (byAngle[key] ??= { runs: 0, passed: 0, worstLoss: 0, meanLoss: 0 });
            row.runs++;
            if (passed) row.passed++;
            row.worstLoss = Math.max(row.worstLoss, loss);
            row.meanLoss += loss;
            if (!passed) doorStops.push(`door ${door.x.toFixed(0)},${door.z.toFixed(0)} side ${side} off ${offset} ang ${angle} dash ${dash}: stopped at ${player.position.x.toFixed(1)},${player.position.y.toFixed(1)},${player.position.z.toFixed(1)} ${player.state}`);
          }
        }
      }
    }
  }

  for (const row of Object.values(byAngle)) {
    row.meanLoss = Math.round((row.meanLoss / row.runs) * 1000) / 1000;
    row.worstLoss = Math.round(row.worstLoss * 100) / 100;
  }

  let wallRuns = 0, progressSum = 0;
  const wallCatches: string[] = [];
  // Cover and T-walls count too: each side of a block is one more surface to catch on.
  const faces = [
    ...plan.walls,
    ...plan.blocks.flatMap(b => [
      { ax: b.x0, az: b.z0, bx: b.x1, bz: b.z0, half: 0 }, { ax: b.x1, az: b.z0, bx: b.x1, bz: b.z1, half: 0 },
      { ax: b.x1, az: b.z1, bx: b.x0, bz: b.z1, half: 0 }, { ax: b.x0, az: b.z1, bx: b.x0, bz: b.z0, half: 0 },
    ]),
  ];
  for (const w of faces) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (len < 4) continue;
    const ux = (w.bx - w.ax) / len, uz = (w.bz - w.az) / len;
    for (const side of [1, -1]) {
      for (const dir of [1, -1]) {
        const nx = -uz * side, nz = ux * side;
        const fromX = dir > 0 ? w.ax : w.bx, fromZ = dir > 0 ? w.az : w.bz;
        const off = w.half + 0.7;
        const sx = fromX + ux * dir * 0.8 + nx * off, sz = fromZ + uz * dir * 0.8 + nz * off;
        _o.set(sx, 1, sz);
        if (physics.overlapCapsule(_o, 0.5, 0.45, CG.World)) continue;
        // Stop short of whatever closes the far end. Only the wall itself is on trial.
        const reach = Math.min(len - 1.6, clearRun(physics, sx, 0.5, sz, ux * dir, uz * dir, len), clearRun(physics, sx, 1.5, sz, ux * dir, uz * dir, len)) - 1.4;
        if (reach < 3) continue;
        wallRuns++;
        const lean = 0.105;
        const vx = ux * dir * Math.cos(lean) - nx * Math.sin(lean), vz = uz * dir * Math.cos(lean) - nz * Math.sin(lean);
        place(sx, sz, vx, vz);
        input.simulate('forward', true);
        let t = 0, gone = 0, last = 0, slow = 0, worstSlow = 0;
        while (t < reach / (top * 0.15) + 0.6) {
          step();
          t += dt;
          gone = (player.position.x - sx) * ux * dir + (player.position.z - sz) * uz * dir;
          slow = t > 0.3 && (gone - last) / dt < 1 ? slow + dt : 0;
          worstSlow = Math.max(worstSlow, slow);
          last = gone;
          if (gone >= reach) break;
        }
        progressSum += gone / t / top;
        if (gone < reach || worstSlow >= 1 / 6) wallCatches.push(`wall ${w.ax.toFixed(0)},${w.az.toFixed(0)}>${w.bx.toFixed(0)},${w.bz.toFixed(0)} side ${side} dir ${dir}: ran ${gone.toFixed(1)}/${reach.toFixed(1)} stalled ${worstSlow.toFixed(2)} s at ${player.position.x.toFixed(1)},${player.position.z.toFixed(1)}`);
      }
    }
  }
  const gateStops: string[] = [];
  let gateRuns = 0;
  for (const gate of plan.gates) {
    if (!gate.bay) continue;
    const ox = Math.cos(gate.yaw), oz = -Math.sin(gate.yaw);
    for (const offset of [-gate.w / 2 + 0.7, 0, gate.w / 2 - 0.7]) {
      const sx = gate.x + ox * 1.8 - oz * offset, sz = gate.z + oz * 1.8 + ox * offset;
      gateRuns++;
      place(sx, sz, -ox, -oz);
      input.simulate('forward', true);
      let t = 0, out = -1.8;
      while (t < 1 && out < 2.4) {
        step();
        t += dt;
        out = -((player.position.x - gate.x) * ox + (player.position.z - gate.z) * oz);
      }
      if (out < 2.4) gateStops.push(`gate ${gate.x.toFixed(0)},${gate.z.toFixed(0)} offset ${offset.toFixed(1)}: stopped at ${player.position.x.toFixed(1)},${player.position.z.toFixed(1)}`);
    }
  }

  const climbCatches: string[] = [];
  let climbRuns = 0, climbProgress = Infinity;
  const R = KH.ring, H = KH.deckW / 2;
  const lines: [string, number, number, number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const [fx, fz] = rot(i, RAMP.footX + 2.5, RAMP.z), [tx, tz] = rot(i, RAMP.pierX + 0.7, RAMP.z);
    const [ax, az] = rot(i, -R - H + 0.7, -R), [bx, bz] = rot(i, R + H - 0.7, -R);
    lines.push([`ramp ${i}`, 0.05, fx, fz, tx, tz], [`deck ${i}`, KH.deck + 0.05, ax, az, bx, bz]);
  }
  for (const [name, y, ax, az, bx, bz] of lines) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    climbRuns++;
    place(ax, az, ux, uz, y);
    input.simulate('forward', true);
    let t = 0, gone = 0;
    while (t < len / (top * 0.4) + 0.6 && gone < len) {
      step();
      t += dt;
      gone = (player.position.x - ax) * ux + (player.position.z - az) * uz;
    }
    climbProgress = Math.min(climbProgress, gone / t / top);
    if (gone < len) climbCatches.push(`${name}: ran ${gone.toFixed(1)}/${len.toFixed(1)} ended ${player.position.toArray().map(v => v.toFixed(1))}`);
  }

  release();
  return {
    gateRuns, gateStops, climbRuns, climbCatches, climbProgress: Math.round(climbProgress * 100) / 100,
    doorRuns, doorPassed, doorByAngle: byAngle, doorStops: doorStops.slice(0, 24),
    wallRuns, wallProgress: Math.round((progressSum / Math.max(1, wallRuns)) * 100) / 100, wallCatches: wallCatches.slice(0, 24),
    topSpeed: Math.round(top * 10) / 10, ms: Math.round(performance.now() - t0),
  };
}

export interface FuzzReport {
  seconds: number;
  insideFrames: number;
  belowFloor: number;
  outOfBounds: number;
  /** Times the random keys stood still for 3 s. Mostly just a bad run of keys. */
  pauses: number;
  /** Places where no direction got the capsule a meter away. */
  wedged: string[];
  maxHeight: number;
  rooms: number;
}

/** Random hands: every move in the kit, for a long time. Reports frames inside geometry, falls and spots it could not leave. */
export function fuzzPlayer(world: World, physics: PhysicsSystem, rig: SweepRig, seconds: number, seed = 7): FuzzReport {
  const { player, input, step } = rig;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dt = 1 / 60;
  player.reset?.();
  const actions = ['forward', 'left', 'right', 'jump', 'dash', 'slide'] as const;
  let insideFrames = 0, belowFloor = 0, outOfBounds = 0, maxHeight = 0;
  const wedged: string[] = [];
  let pauses = 0;
  let next = 0, t = 0, sampleT = 0;
  const last = player.position.clone();
  const visited = new Set<string>();
  const c = new THREE.Vector3();
  while (t < seconds) {
    if (t >= next) {
      next = t + 0.15 + rnd() * 0.9;
      input.simulate('forward', rnd() < 0.85);
      input.simulate('left', rnd() < 0.25);
      input.simulate('right', rnd() < 0.25);
      input.simulate('jump', rnd() < 0.3);
      input.simulate('dash', rnd() < 0.15);
      input.simulate('slide', rnd() < 0.15);
      player.yaw += (rnd() - 0.5) * 2.2;
    }
    step();
    t += dt;
    const p = player.position;
    c.set(p.x, p.y + 0.9, p.z);
    if (physics.overlapCapsule(c, 0.3, 0.3, CG.World)) insideFrames++;
    if (p.y < -0.5) belowFloor++;
    if (Math.abs(p.x) > 40 || Math.abs(p.z) > 40) outOfBounds++;
    maxHeight = Math.max(maxHeight, p.y);
    const z = world.zoneAt(p);
    if (z) visited.add(z.id);
    if (t >= sampleT) {
      if (sampleT > 0 && p.distanceTo(last) < 0.25) {
        pauses++;
        const from = p.clone();
        for (const a of actions) input.simulate(a, false);
        let free = false;
        for (let turn = 0; turn < 8 && !free; turn++) {
          player.yaw = (turn * Math.PI) / 4;
          input.simulate('forward', true);
          for (let i = 0; i < 30; i++) step();
          free = player.position.distanceTo(from) > 1;
        }
        if (!free) wedged.push(`${from.x.toFixed(1)},${from.y.toFixed(1)},${from.z.toFixed(1)} ${player.state}`);
      }
      last.copy(p);
      sampleT = t + 3;
    }
  }
  for (const a of actions) input.simulate(a, false);
  return { seconds, insideFrames, belowFloor, outOfBounds, pauses, wedged, maxHeight: Math.round(maxHeight * 10) / 10, rooms: visited.size };
}
