/**
 * Ground and air spawns are picked from the nav graph instead of hand-placed, so they are always valid. Per zone,
 * farthest-point sampling spreads them out and a line-of-sight test rejects any two that can see each other,
 * which keeps enemies from materialising in plain view of a spot the player might be standing on.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { CG, type MapZone, type PhysicsSystem, type SpawnPoint } from '../core/contracts';
import type { NavGraph } from './nav';
import type { MapSpec } from './map/spec';

const PER_ZONE = 14;
const CANDIDATES = 900;
const MIN_SPACING = 9;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

function canSee(physics: PhysicsSystem, a: THREE.Vector3, b: THREE.Vector3): boolean {
  _a.set(a.x, a.y + 1.5, a.z);
  _b.set(b.x, b.y + 1.5, b.z);
  _d.subVectors(_b, _a);
  const len = _d.length();
  _d.divideScalar(len);
  return physics.raycast(_a, _d, len, CG.World) === null;
}

export function buildSpawns(
  physics: PhysicsSystem, nav: NavGraph, spec: MapSpec, zoneAt: (p: THREE.Vector3) => MapZone | null,
): SpawnPoint[] {
  if (spec.spawns) return [...spec.gates, ...spec.spawns];
  const rng = mulberry32(0x5eed);
  const byZone = new Map<string, number[]>();
  const p = new THREE.Vector3();
  for (let i = 0; i < nav.nodeCount; i++) {
    // Clearance keeps spawns off ledges and out of narrow gaps.
    if (nav.clearance[i]! < 2) continue;
    p.set(nav.px[i]!, nav.py[i]!, nav.pz[i]!);
    const z = zoneAt(p);
    if (!z) continue;
    let list = byZone.get(z.id);
    if (!list) byZone.set(z.id, (list = []));
    list.push(i);
  }

  const out: SpawnPoint[] = [...spec.gates];
  for (const zone of spec.zones) {
    const nodes = byZone.get(zone.id);
    if (!nodes || nodes.length === 0) continue;
    const pool: THREE.Vector3[] = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const n = nodes[Math.floor(rng() * nodes.length)]!;
      pool.push(new THREE.Vector3(nav.px[n]!, nav.py[n]!, nav.pz[n]!));
    }
    const chosen: THREE.Vector3[] = spec.gates.filter(g => g.zone === zone.id).map(g => g.position);
    const start = chosen.length;
    for (let round = 0; round < PER_ZONE; round++) {
      let best: THREE.Vector3 | null = null;
      let bestScore = -1;
      for (const c of pool) {
        let near = 1e9;
        let seen = false;
        for (const s of chosen) {
          const d = s.distanceTo(c);
          if (d < near) near = d;
          if (d < MIN_SPACING) { seen = true; break; }
        }
        if (seen || near <= bestScore) continue;
        for (const s of chosen) if (canSee(physics, s, c)) { seen = true; break; }
        if (seen) continue;
        best = c;
        bestScore = near;
      }
      if (!best) break;
      chosen.push(best);
    }
    for (let i = start; i < chosen.length; i++) out.push({ position: chosen[i]!, zone: zone.id, kind: 'ground' });

    // Flyers enter high over open floor.
    const b = zone.bounds;
    const ceiling = zone.id === 'foundry' ? 24 : zone.id === 'transit' ? 18 : 30;
    for (let i = 0; i < 4 && pool.length; i++) {
      const c = pool[Math.floor(rng() * pool.length)]!;
      out.push({ position: new THREE.Vector3(c.x, Math.min(c.y + 12, Math.max(ceiling, b.min.y + 8)), c.z), zone: zone.id, kind: 'air' });
    }
  }
  return out;
}
