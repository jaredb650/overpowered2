import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TANK, TRUCK } from '../../enemies/vehicles/data';
import { Physics } from '../../physics/Physics';
import type { Claims } from './claims';
import type { WorldContext } from './context';
import { VehicleHits } from './vehicleHits';
import type { Vehicles } from './vehicles';

/** A guest with the host's vehicles drawn at `puppets`, in a real physics world. */
async function guest(puppets: Map<number, { kind: string; root: THREE.Object3D; turret: number }>) {
  const physics = await Physics.create();
  const vehicleHit = vi.fn(), vehicleBlast = vi.fn(), hitMarker = vi.fn();
  const w = { hosting: false, ctx: { physics, hud: { hitMarker }, audio: { play: vi.fn() } } } as unknown as WorldContext;
  const vehicles = { each: (visit: (id: number, kind: string, root: THREE.Object3D, turret: number) => void) => { for (const [id, p] of puppets) visit(id, p.kind, p.root, p.turret); },
    get none() { return puppets.size === 0; } } as unknown as Vehicles;
  const hits = new VehicleHits(w, vehicles, { vehicleHit, vehicleBlast } as unknown as Claims);
  const step = () => { hits.update(); physics.flushQueries(); };
  return { physics, hits, vehicleHit, vehicleBlast, hitMarker, step };
}

describe('a guest\'s rounds on the host\'s vehicles', () => {
  it('stops a round on the drawn truck\'s own boxes, wherever it stands and faces, and names the part and the point in its frame', async () => {
    const root = new THREE.Object3D();
    root.position.set(20, 0, -30);
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const g = await guest(new Map([[7, { kind: 'truck', root, turret: 0 }]]));
    g.step();
    // Its engine box, from the side it now shows: the truck's own +z is the world's +x after the quarter turn.
    const engine = TRUCK.parts.find(part => part.id === 'engine')!;
    const at = new THREE.Vector3(...engine.at).applyQuaternion(root.quaternion).add(root.position);
    const from = at.clone().add(new THREE.Vector3(0, 0, 12));
    const hit = g.physics.raycast(from, new THREE.Vector3(0, 0, -1), 40)!;
    expect(hit).not.toBeNull();
    expect(hit.distance).toBeCloseTo(12 - engine.half[0], 1);
    expect(g.hits.shot(hit.collider, hit.point, 60, 'harrow')).toBe(true);
    const [id, part, local, amount, source, kind] = g.vehicleHit.mock.calls[0]!;
    expect([id, part, amount, source, kind]).toEqual([7, 'engine', 60, 'harrow', undefined]);
    // In the truck's own frame: on the engine's side face, at its height and length along the hull.
    expect(Math.abs((local as THREE.Vector3).x)).toBeCloseTo(engine.half[0], 1);
    expect((local as THREE.Vector3).y).toBeCloseTo(engine.at[1], 1);
    expect((local as THREE.Vector3).z).toBeCloseTo(engine.at[2], 1);
    // A soft-skinned truck takes bullets: the marker says so.
    expect(g.hitMarker).toHaveBeenLastCalledWith('body');
    // A collider that is not a vehicle's is nobody's claim.
    expect(g.hits.shot(null, hit.point, 60, 'harrow')).toBe(false);
    expect(g.vehicleHit).toHaveBeenCalledOnce();
  });
  it('follows the drawing as it moves, turns a tank\'s turret box with its turret, and takes the boxes away with the vehicle', async () => {
    const root = new THREE.Object3D();
    const puppets = new Map([[3, { kind: 'tank', root, turret: 0 }]]);
    const g = await guest(puppets);
    g.step();
    const down = new THREE.Vector3(0, -1, 0);
    expect(g.physics.raycast(new THREE.Vector3(0, 20, 0), down, 40)).not.toBeNull();
    root.position.set(50, 0, 0);
    g.step();
    expect(g.physics.raycast(new THREE.Vector3(0, 20, 0), down, 40)).toBeNull();
    const top = g.physics.raycast(new THREE.Vector3(50, 20, 0), down, 40)!;
    expect(g.hits.shot(top.collider, top.point, 600, 'sabot')).toBe(true);
    expect(TANK.parts.some(part => part.id === g.vehicleHit.mock.calls[0]![1])).toBe(true);
    // Armour stops a plain bullet and lets a Sabot dart through: the guess the marker shows.
    expect(g.hitMarker).toHaveBeenLastCalledWith('armorThrough');
    g.hits.shot(top.collider, top.point, 60, 'smg');
    expect(g.hitMarker).toHaveBeenLastCalledWith('armor');
    // A rocket landing on it is a direct hit of its kind.
    g.hits.shot(top.collider, top.point, 300, 'rocket', 'rocket');
    expect(g.vehicleHit.mock.calls.at(-1)![5]).toBe('rocket');
    puppets.clear();
    g.step();
    expect(g.physics.raycast(new THREE.Vector3(50, 20, 0), down, 40)).toBeNull();
    expect(g.hits.shot(top.collider, top.point, 600, 'sabot')).toBe(false);
  });
  it('sends a blast only when the host has sent a vehicle', async () => {
    const puppets = new Map<number, { kind: string; root: THREE.Object3D; turret: number }>();
    const g = await guest(puppets);
    const spec = { radius: 6, damage: 400, kind: 'rocket' as const, source: 'rocket', team: 'player' as const };
    g.hits.blast(new THREE.Vector3(), spec);
    expect(g.vehicleBlast).not.toHaveBeenCalled();
    puppets.set(1, { kind: 'truck', root: new THREE.Object3D(), turret: 0 });
    g.hits.blast(new THREE.Vector3(), spec);
    expect(g.vehicleBlast).toHaveBeenCalledOnce();
  });
});
