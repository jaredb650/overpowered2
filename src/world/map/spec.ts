/** Everything the authored map declares besides static geometry. Filled in by the zone files, read by World. */
import * as THREE from 'three';
import type { MapZone, SpawnPoint } from '../../core/contracts';
import type { EmplacementSpec } from '../../vehicles/emplacement';
import type { DesignatedLink } from '../nav';
import { SHACK, WALL, type StructureSpec, type WallStyle } from '../structures';
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
  /** Mounted guns, built by the call-in manager on the first run: see src/vehicles/emplacement.ts. */
  readonly emplacements: EmplacementSpec[] = [];
  /** Walls, gates and shacks that blasts wear down: see src/world/structures.ts. */
  readonly structures: StructureSpec[] = [];

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

  /** A mounted gun with its tripod's foot here, facing `yaw` (a camera's: 0 looks down -Z), swinging `arc` either way. */
  emplacement(x: number, y: number, z: number, yaw: number, arc = 1, level = 1): void {
    this.emplacements.push({ pos: new THREE.Vector3(x, y, z), yaw, arc, level });
  }

  /**
   * A straight wall standing on `y` from pillar centre (ax, az) to pillar centre (bx, bz), cut into segments about
   * WALL.segment long with a pillar at every joint. Runs that share an end share its pillar, so a `wallGate` drops in between two.
   * `style` builds it taller and thicker, with a battlement (structures.ts, WallStyle); without one it is the plain 3 m wall.
   */
  wall(ax: number, az: number, bx: number, bz: number, y = 0, style?: WallStyle): void {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / WALL.segment));
    for (let i = 0; i < n; i++) {
      this.segment('wall', ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, ax + ((bx - ax) * (i + 1)) / n, az + ((bz - az) * (i + 1)) / n, y, style);
    }
  }

  /**
   * A steel gate between two pillar centres, in a wall. Shut or blown, nothing between. (`gate` is an enemy entrance.) With `opens`
   * it is a lift gate that rises for the player or an ally near it and drops behind them.
   */
  wallGate(ax: number, az: number, bx: number, bz: number, y = 0, opens = false, style?: WallStyle): void {
    this.segment('gate', ax, az, bx, bz, y, style);
    if (opens) this.structures[this.structures.length - 1]!.opens = true;
  }

  /** A plank or sheet-metal hut, SHACK.width along `yaw` (the kit's: 0 runs along +X) and SHACK.depth across, door on its +Z side. */
  shack(x: number, z: number, yaw = 0, look: 'planks' | 'sheet' = 'planks', y = 0): void {
    this.structures.push({ kind: 'shack', x, y, z, yaw, length: SHACK.width, look });
  }

  private segment(kind: 'wall' | 'gate', ax: number, az: number, bx: number, bz: number, y: number, style?: WallStyle): void {
    const length = Math.hypot(bx - ax, bz - az);
    this.structures.push({ kind, x: (ax + bx) / 2, y, z: (az + bz) / 2, yaw: Math.atan2(-(bz - az), bx - ax), length, ...(style ? { style } : {}) });
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
