/**
 * The gunship over a small map's invisible containment, on real Rapier: a perimeter wall with the invisible extension
 * the Kill House stands on it, and a lid like the Crucible's. Every round from orbit height reaches the floor, and the
 * seat's sight holds its spot on the ground while the ship circles. Before the fix the sight landed on the lid 35 m
 * under the ship, the lock dragged the view round after that point, and every round burst on it in mid-air.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG, type Ctx } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { GunnerSeat, type SeatPlan, type SeatRig } from '../../vehicles/seat';
import { Kit } from '../../world/kit/kit';
import type { ModelMaterials } from '../modelkit';
import { AC130 } from './ac130Data';
import { Battery } from './ac130Guns';
import type { Ac130Mount } from './ac130Model';
import { AIR, Ac130Rounds, type ImpactKind } from './ac130Rounds';
import type { Airframe } from './airframe';
import { OrbitPath } from './airframe';
import { GroundProbe } from './ground';

/** Half-width of the map inside its perimeter wall. */
const HALF = 36;
const WALL = 7.5;
const CONTAIN = 26;
const LID = 150;
const DT = 1 / 60;
const SPOT = new THREE.Vector3(10, 0, -5);
const POST = new THREE.Vector3(25.5, 20, -21.2);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sink: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink), apply: () => sink });
function stub<T>(o: Record<string, unknown>): T {
  return new Proxy(o, { get: (t, k) => (k in t ? t[k as string] : sink) }) as T;
}

let physics: Physics;
let ctx: Ctx;
const look = { x: 0, y: 0 };

beforeAll(async () => {
  physics = await Physics.create();
  const k = new Kit(physics);
  k.collide(0, -1, 0, 200, 1, 200);
  for (const s of [-1, 1]) {
    // The real wall, and the invisible one stood on it.
    k.collide(s * HALF, WALL / 2, 0, 0.5, WALL / 2, HALF + 0.5);
    k.collide(0, WALL / 2, s * HALF, HALF + 0.5, WALL / 2, 0.5);
    k.containment(s * HALF, (WALL + CONTAIN) / 2, 0, 0.5, (CONTAIN - WALL) / 2, HALF + 0.5);
    k.containment(0, (WALL + CONTAIN) / 2, s * HALF, HALF + 0.5, (CONTAIN - WALL) / 2, 0.5);
  }
  k.containment(0, LID, 0, 200, 2, 200);
  // A post that passes in front of the seat's spot halfway through its quarter of the circle.
  k.collide(POST.x, POST.y, POST.z, 1, POST.y, 1);
  physics.flushQueries();
  ctx = stub<Ctx>({
    physics,
    render: stub({ scene: new THREE.Scene(), camera: { position: V(0, 0, 0), fov: 40 }, renderer: { domElement: { clientHeight: 900, style: {} } } }),
    input: stub({ frameLook: look, isDown: () => false, pressed: () => false }),
    player: stub({ eye: V(0, 1.6, 0), sensitivity: 0.002, lookScale: 1, invertY: false }),
    enemies: stub({ alive: [], query: () => 0 }),
  });
});

/** A ship at `ship`, nose along `heading`, every mount at its centre. */
function airframe(ship: THREE.Vector3, heading: THREE.Vector3): Airframe<Ac130Mount> {
  const root = new THREE.Object3D();
  root.position.copy(ship);
  root.quaternion.setFromUnitVectors(V(0, 0, 1), heading);
  return { root, mount: (_m: string, out: THREE.Vector3) => out.copy(ship) } as unknown as Airframe<Ac130Mount>;
}

/** Fires one round with `fire`, and runs it until it lands. */
function land(ship: THREE.Vector3, fire: (b: Battery) => void): { kind: ImpactKind; point: THREE.Vector3 } {
  const rounds = new Ac130Rounds(ctx, { group: () => new THREE.Group() } as unknown as ModelMaterials);
  const heading = V(0, 0, 0).sub(ship).setY(0).normalize().cross(V(0, 1, 0));
  const battery = new Battery(ctx, new GroundProbe(ctx, AIR), airframe(ship, heading), rounds);
  let landed: { kind: ImpactKind; point: THREE.Vector3 } | null = null;
  rounds.onImpact = (kind, point) => (landed ??= { kind, point: point.clone() });
  fire(battery);
  for (let i = 0; i < 30 / DT && !landed; i++) {
    battery.update(DT);
    rounds.update(DT);
  }
  expect(landed, 'never landed').not.toBeNull();
  return landed!;
}

describe('the gunship over invisible containment', () => {
  const { radius, altitude } = AC130.orbit;

  it('puts every round of every gun on the floor, through the invisible wall and the lid', () => {
    for (const angle of [0, 1.3, 2.9, 4.4]) {
      const ship = V(Math.cos(angle) * radius, altitude, Math.sin(angle) * radius);
      // 8 m in from the near wall: the line down to it crosses the invisible wall, and the lid.
      const aim = V(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(HALF - 8);
      const dir = aim.clone().sub(ship);
      const reach = dir.length();
      dir.normalize();
      const world = physics.raycast(ship, dir, reach, CG.World);
      expect(world && world.point.y, 'a world ray stops on the containment').toBeGreaterThan(WALL);
      expect(physics.raycast(ship, dir, reach - 0.5, CG.World | CG.Air), 'nothing real in the way').toBeNull();

      const shots: [string, (b: Battery) => void][] = [
        ['25', b => b.fire25(aim, 0)],
        ['40 HE', b => ((b.round40 = 'g40'), b.fire40(aim, 0))],
        ['40 AP', b => ((b.round40 = 'ap'), b.fire40(aim, 0))],
        ['40 flak', b => ((b.round40 = 'flak'), b.fire40(aim, 0))],
        ['105 HE', b => ((b.round105 = 'g105'), b.fire105(aim))],
        ['105 WP', b => ((b.round105 = 'wp'), b.fire105(aim))],
        ['bomb', b => b.dropBomb(aim)],
      ];
      for (const [name, fire] of shots) {
        const { point } = land(ship, fire);
        expect(point.y, `${name} at ${angle}`).toBeLessThan(3);
        expect(Math.hypot(point.x - aim.x, point.z - aim.z), `${name} at ${angle}`).toBeLessThan(4);
      }
    }
  });

  /** A quarter of the circle, no input: where the sight sits on each frame, and how far its line passes from the first. */
  function quarter(plan: SeatPlan): { seen: THREE.Vector3[]; miss: number[] } {
    const path = new OrbitPath(AC130.orbit);
    path.begin(V(0, 0, 0), 0);
    const seat = new GunnerSeat(ctx, stub<SeatRig>({ prisoners: new Set() }), plan);
    const pivot = V(0, 0, 0);
    const heading = V(0, 0, 0);
    const frame = new THREE.Quaternion();
    const fly = (t: number) => {
      path.at(t, pivot);
      frame.setFromUnitVectors(V(0, 0, 1), path.heading(t, heading));
    };
    let t = path.holdsFrom;
    fly(t);
    seat.sit(SPOT, pivot);
    const seen: THREE.Vector3[] = [];
    const miss: number[] = [];
    const line = new THREE.Ray();
    for (let i = 0; i < Math.PI / 2 / Math.abs(AC130.orbit.rate) / DT; i++) {
      fly((t += DT));
      seat.update(DT, frame, pivot);
      seen.push(seat.point.clone());
      miss.push(Math.sqrt(line.set(seat.view.position, seat.aim).distanceSqToPoint(seen[0]!)));
    }
    return { seen, miss };
  }

  it('holds the sight on its spot on the ground for a quarter of the circle with no input, and the mouse still moves it', () => {
    const { seen, miss } = quarter(AC130.seat);
    expect(seen[0]!.distanceTo(SPOT)).toBeLessThan(1);
    expect(Math.max(...miss)).toBeLessThan(0.25);
    // The post did pass in front, and the sight came back off it onto the spot.
    expect(seen.some(p => p.y > 5)).toBe(true);
    expect(seen[seen.length - 1]!.distanceTo(seen[0]!)).toBeLessThan(0.25);

    // The sight the gunship had before: on the lid under the ship, and carried round with it.
    const old = quarter({ ...AC130.seat, outside: false }).seen;
    expect(old[0]!.y).toBeGreaterThan(LID);
    expect(old[old.length - 1]!.distanceTo(old[0]!)).toBeGreaterThan(20);
  });

  it('turns where the mouse turns it', () => {
    const path = new OrbitPath(AC130.orbit);
    path.begin(V(0, 0, 0), 0);
    const seat = new GunnerSeat(ctx, stub<SeatRig>({ prisoners: new Set() }), AC130.seat);
    const pivot = path.at(path.holdsFrom, V(0, 0, 0));
    const frame = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), path.heading(path.holdsFrom, V(0, 0, 0)));
    seat.sit(V(0, 0, 0), pivot);
    seat.update(DT, frame, pivot);
    const before = seat.point.clone();
    look.x = 40;
    seat.update(DT, frame, pivot);
    look.x = 0;
    seat.update(DT, frame, pivot);
    expect(seat.point.distanceTo(before)).toBeGreaterThan(10);
    const held = seat.point.clone();
    seat.update(DT, frame, pivot);
    expect(seat.point.distanceTo(held)).toBeLessThan(0.05);
  });
});
