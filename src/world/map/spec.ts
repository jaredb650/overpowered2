/** Everything the authored map declares besides static geometry. Filled in by the zone files, read by World. */
import * as THREE from 'three';
import type { MapZone, SpawnPoint } from '../../core/contracts';
import type { DesignatedLink } from '../nav';
import { LEVEL } from './layout';

export interface PadSpec {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Peak height of the arc above the higher end. */
  arc: number;
  radius: number;
}

export interface LaunchRampSpec {
  /** Centre of the trigger strip at the lip. */
  pos: THREE.Vector3;
  /** Direction of travel, horizontal. */
  dir: THREE.Vector3;
  halfWidth: number;
  length: number;
  /** Added along `dir`. */
  boost: number;
  /** Added upward. */
  lift: number;
}

export interface ExplosiveSpec {
  pos: THREE.Vector3;
  kind: 'barrel' | 'tank';
}

export interface CrusherSpec {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  floorY: number;
  topY: number;
  period: number;
  phase: number;
}

export interface ElectricSpec {
  box: THREE.Box3;
  period: number;
  onTime: number;
  phase: number;
}

export interface GantrySpec {
  /** Rail ends. The gantry moves along X. */
  x0: number;
  x1: number;
  y: number;
  z0: number;
  z1: number;
  period: number;
}

export interface ReactorSpec {
  floorY: number;
  topY: number;
}

export interface ViewSpec {
  pos: [number, number, number];
  look: [number, number, number];
}

/** Where vehicles may drive: a centre line and how wide the road is. Marks and routes run on these. */
export interface RoadSpec {
  id: string;
  points: readonly (readonly [number, number])[];
  width: number;
}

/** A vector plan of the map for the minimap, and the list of what to test. Maps without one are charted from the nav graph. */
export interface MapPlan {
  fills: { x0: number; z0: number; x1: number; z1: number; rgb: readonly [number, number, number]; label: string }[];
  /** Solid wall spans as centre lines, so cut corners stay diagonal. */
  walls: { ax: number; az: number; bx: number; bz: number; half: number }[];
  /** Cover and other solid blocks. */
  blocks: { x0: number; z0: number; x1: number; z1: number }[];
  decks: { x0: number; z0: number; x1: number; z1: number }[];
  /** `bay` gates are real openings. The others are shutters on the wall face. */
  gates: { x: number; z: number; yaw: number; w: number; bay: boolean }[];
  /** Every doorway: centre, travel direction through it and width. */
  doors: { x: number; z: number; dx: number; dz: number; w: number }[];
}

export class MapSpec {
  readonly zones: MapZone[] = [];
  readonly playerSpawns: { position: THREE.Vector3; yaw: number }[] = [];
  readonly pickupSpots: THREE.Vector3[] = [];
  /** Authored entrances. Ground and air spawns are derived from the nav graph unless `spawns` is set. */
  readonly gates: SpawnPoint[] = [];
  readonly pads: PadSpec[] = [];
  readonly ramps: LaunchRampSpec[] = [];
  readonly explosives: ExplosiveSpec[] = [];
  readonly lava: THREE.Box3[] = [];
  readonly crushers: CrusherSpec[] = [];
  readonly electric: ElectricSpec[] = [];
  readonly gantries: GantrySpec[] = [];
  readonly jumpLinks: DesignatedLink[] = [];
  readonly views: Record<string, ViewSpec> = {};
  /** Empty on maps with no vehicles. */
  roads: readonly RoadSpec[] = [];
  /** Null on maps without one. */
  reactor: ReactorSpec | null = { floorY: 0, topY: 90 };
  plan: MapPlan | null = null;
  /** When set, ground and air spawns are these and nothing is derived from the nav graph. */
  spawns: SpawnPoint[] | null = null;

  zone(id: string, name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.zones.push({ id, name, bounds: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) });
  }

  pad(x: number, y: number, z: number, tx: number, ty: number, tz: number, arc = 5, radius = 2.2): void {
    const pos = new THREE.Vector3(x, y, z), target = new THREE.Vector3(tx, ty, tz);
    this.pads.push({ pos, target, arc, radius });
    this.jumpLinks.push({ a: pos.clone(), b: target.clone(), kind: 'pad' });
  }

  /** Pad under a corner of the Ring Road: aimed at a point on the deck at angle `a` around the corner centre. */
  ringPad(cx: number, cz: number, a: number): void {
    const c = Math.cos(a), s = Math.sin(a);
    this.pad(cx + c * 50, 0, cz + s * 50, cx + c * 72, LEVEL.ring + 0.6, cz + s * 72, 5);
  }

  jump(ax: number, ay: number, az: number, bx: number, by: number, bz: number, twoWay = true): void {
    this.jumpLinks.push({ a: new THREE.Vector3(ax, ay, az), b: new THREE.Vector3(bx, by, bz), kind: 'jump', twoWay });
  }

  gate(zone: string, x: number, y: number, z: number): void {
    this.gates.push({ position: new THREE.Vector3(x, y, z), zone, kind: 'gate' });
  }

  pickup(x: number, y: number, z: number): void {
    this.pickupSpots.push(new THREE.Vector3(x, y, z));
  }

  barrels(x: number, y: number, z: number, n = 3, spread = 1.1): void {
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963;
      const r = i === 0 ? 0 : spread * Math.sqrt(i) * 0.9;
      this.explosives.push({ pos: new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r), kind: 'barrel' });
    }
  }

  tank(x: number, y: number, z: number): void {
    this.explosives.push({ pos: new THREE.Vector3(x, y, z), kind: 'tank' });
  }

  view(name: string, px: number, py: number, pz: number, lx: number, ly: number, lz: number): void {
    this.views[name] = { pos: [px, py, pz], look: [lx, ly, lz] };
  }
}

/** Launch speed for an arc from `from` to `to` peaking `arc` meters above the higher end, under `gravity`. */
export function ballistic(from: THREE.Vector3, to: THREE.Vector3, arc: number, gravity: number, out: THREE.Vector3): THREE.Vector3 {
  const apex = Math.max(from.y, to.y) + arc;
  const up = Math.sqrt(2 * gravity * (apex - from.y));
  const t = up / gravity + Math.sqrt((2 * (apex - to.y)) / gravity);
  return out.set((to.x - from.x) / t, up, (to.z - from.z) / t);
}
