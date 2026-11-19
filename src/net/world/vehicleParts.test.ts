/**
 * The host's vehicles as working machines on a guest, over the mocked transport with the real models: wheels turn and steer,
 * tracks run and come off, the gun lifts, the roof gun is fitted and swung, fires burn; and a vehicle that dies becomes the
 * same wreck on the guest, on colliders of its own, with a tank's turret thrown clear, for a late arrival too.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { noop } from '../../core/stubs';
import { VEHICLES, type GroundDef } from '../../enemies/vehicles/data';
import { GunRack, WIRE } from '../../enemies/vehicles/ground';
import { Fleet } from '../../enemies/vehicles/models';
import { Wreck } from '../../enemies/vehicles/wreck';
import { ModelMaterials } from '../../progression/modelkit';
import { Gun } from '../../vehicles/guns';
import type { VehiclesEvent } from './vehicles';
import { party } from './testkit';

type Kind = 'humvee' | 'truck' | 'tank';

/** One side's vehicle system, as much as the co-op module reads: the real fleet and gun rack, and a list of live vehicles and wrecks. */
function system(ctx: Ctx) {
  const colliders = new Set<object>();
  const scene = new THREE.Scene();
  Object.assign(ctx, {
    render: { scene, materials: { patch: (m: THREE.Material) => m }, lights: { flash: vi.fn() }, decals: { add: vi.fn() }, highlight: vi.fn() },
    physics: { ...ctx.physics, addStaticBox: vi.fn(() => { const c = { handle: colliders.size + 1, setTranslation: vi.fn(), setRotation: vi.fn() }; colliders.add(c); return c; }),
      world: { removeCollider: vi.fn((c: object) => colliders.delete(c)) } },
    fx: { ...['chips', 'embers', 'heatShimmer', 'ring', 'smoke', 'dust', 'sparks'].reduce((o, k) => ({ ...o, [k]: vi.fn() }), {}), attachEmitter: () => ({ stop: vi.fn() }) },
    audio: { play: vi.fn(), startLoop: () => noop('loop') },
  });
  const materials = new ModelMaterials(ctx);
  const sys = { ctx, fleet: new Fleet(materials, scene), guns: new GunRack(spec => new Gun(materials, scene, spec)), live: [] as unknown[], wrecks: [] as Wreck[],
    closeGround: vi.fn(), detonate: vi.fn() };
  (ctx.enemies as unknown as { vehicles: unknown }).vehicles = sys;
  return { sys, colliders, scene };
}

function game(guests = 1) {
  const g = party(guests, [], 'outpost');
  const sides = [g.host, ...g.guests].map(side => ({ ...side, ...system(side.ctx) }));
  const host = sides[0]!;
  /** A live vehicle on the host: the real model, and the parts' state the test sets. */
  const drive = (kind: Kind, at: THREE.Vector3) => {
    const model = host.sys.fleet.ground(kind);
    model.root.position.copy(at);
    const v = { alive: true, def: VEHICLES[kind], position: model.root.position, quaternion: model.root.quaternion, turretYaw: 0, modelRoot: model.root,
      x: [0, 0, 0, 0, 0, 0, 0, 0], wire(out: number[]) { out.length = 0; out.push(...v.x); return out; }, model };
    host.sys.live.push(v);
    return v;
  };
  /** Frames: the host sends every 200 ms; each guest draws 16 ms at a time. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      vi.advanceTimersByTime(16);
      g.hw.update(); g.relay.flush();
      for (const gw of g.gws) { gw.update(); gw.updateGuests(); }
    }
  };
  const copy = (i: number) => (g.gws[i]! as unknown as { vehicles: { puppets: Map<number, { model: ReturnType<Fleet['ground']>; gun: Gun | null; fires: { engine: unknown[]; fuel: unknown[] } }>; wreckCount: number; wrecks: Map<number, { wreck: Wreck; flung: THREE.Object3D | null }> } }).vehicles;
  return { ...g, sides, host, guests: sides.slice(1), drive, run, copy };
}

describe('enemy vehicles on a guest are working machines', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('turns the wheels with the road, steers the front pair, and fits and swings the roof gun', () => {
    const g = game();
    const car = g.drive('humvee', new THREE.Vector3(5, 0, 5));
    car.x = [8, 0.3, 0.04, -0.03, 0, 1.2, 0.2, WIRE.roofGun | WIRE.firing];
    g.run(1500);
    const puppet = [...g.copy(0).puppets.values()][0]!;
    expect(puppet.model.root.visible).toBe(true);
    // Eight metres a second for over a second: several turns of a half-metre wheel.
    expect(Math.abs(puppet.model.wheels[0]!.part.rotation.x)).toBeGreaterThan(6);
    expect(puppet.model.steered[0]!.rotation.y).toBeCloseTo(0.3, 1);
    expect(puppet.model.body.rotation.x).toBeCloseTo(0.04, 2);
    expect(puppet.gun).not.toBeNull();
    expect(puppet.gun!.root.visible).toBe(true);
    // Parked, with nobody on it: the gun goes back on the rack and the wheels stop.
    car.x = [0, 0, 0, 0, 0, 0, 0, 0];
    g.run(1500);
    const turned = puppet.model.wheels[0]!.part.rotation.x;
    g.run(500);
    expect(puppet.model.wheels[0]!.part.rotation.x).toBeCloseTo(turned, 1);
    expect(puppet.gun).toBeNull();
    g.dispose();
  });

  it('runs a tank\'s tracks, lifts its gun, throws a track and lights an engine fire as the host\'s does', () => {
    const g = game();
    const tank = g.drive('tank', new THREE.Vector3(0, 0, 10));
    tank.x = [3, 0, 0, 0, 0.12, 0, 0, WIRE.roofGun];
    g.run(1200);
    const puppet = [...g.copy(0).puppets.values()][0]!;
    expect(puppet.model.tracks.every(t => t.belt.visible)).toBe(true);
    expect(puppet.model.barrel!.rotation.x).toBeCloseTo(-0.12, 2);
    expect(puppet.fires.engine).toHaveLength(0);
    tank.x = [0, 0, 0, 0, 0.12, 0, 0, WIRE.roofGun | WIRE.trackLeft | WIRE.engineFire];
    g.run(600);
    expect(puppet.model.tracks.map(t => t.belt.visible)).toEqual([false, true]);
    expect(puppet.fires.engine).toHaveLength(2);
    g.dispose();
  });

  it('turns a dead tank into the same wreck on the guest: cover, a thrown turret, cleared when the host clears it', () => {
    const g = game(2);
    const tank = g.drive('tank', new THREE.Vector3(0, 0, 10));
    tank.x = [0, 0, 0, 0, 0, 0, 0, WIRE.roofGun];
    g.run(600);
    expect(g.copy(0).puppets.size).toBe(1);
    // It dies on the host as GroundVehicle.destroy does it: off the live list, a wreck of its model, the turret flung.
    const def = VEHICLES.tank as GroundDef;
    g.host.sys.live.length = 0;
    tank.alive = false;
    const wreck = new Wreck(g.host.sys as never, tank.model.root, [], def.wreck, def.halfWidth, def.halfLength, null);
    const turret = tank.model.turret!;
    g.host.scene.add(turret);
    wreck.fling({ mesh: turret, velocity: new THREE.Vector3(2, 11, 3), spin: new THREE.Vector3(1, 0.5, -1), floor: 0.75, collider: null, flying: true });
    g.host.sys.wrecks.push(wreck);
    g.run(300);
    for (const i of [0, 1]) {
      const guest = g.copy(i);
      expect(guest.puppets.size).toBe(0);
      expect(guest.wreckCount).toBe(1);
      const w = [...guest.wrecks.values()][0]!;
      expect(w.wreck.burnLeft).toBeGreaterThan(0);
      // Every part a box of its own, the turret's with the turret.
      expect(g.guests[i]!.colliders.size).toBe(def.parts.length);
      expect(w.flung).not.toBeNull();
      expect(w.flung!.parent).toBe(g.guests[i]!.scene);
    }
    // The guest's copy hurts nobody and sets nothing off.
    const rose = [...g.copy(0).wrecks.values()][0]!;
    // The turret is in the air, thrown as the host's was, and comes down on its floor.
    expect(rose.flung!.position.y).toBeGreaterThan(2);
    (g.guests[0]!.ctx.time as { dt: number }).dt = 0.1;
    g.run(600);
    expect(rose.flung!.position.y).toBeCloseTo(0.75);
    for (let i = 0; i < 40; i++) rose.wreck.update(1);
    expect(g.guests[0]!.sys.detonate).not.toHaveBeenCalled();
    expect(g.guests[0]!.player.takeDamage).not.toHaveBeenCalled();
    // The host clears it.
    g.host.sys.wrecks.length = 0;
    g.run(100);
    for (const i of [0, 1]) {
      expect(g.copy(i).wreckCount).toBe(0);
      expect(g.guests[i]!.colliders.size).toBe(0);
    }
    g.dispose();
  });

  it('hands a late arrival every wreck, lying where it lies', () => {
    const g = game();
    const truck = g.drive('truck', new THREE.Vector3(4, 0, -6));
    g.run(600);
    const def = VEHICLES.truck as GroundDef;
    g.host.sys.live.length = 0;
    const wreck = new Wreck(g.host.sys as never, truck.model.root, [], def.wreck, def.halfWidth, def.halfLength, null);
    g.host.sys.wrecks.push(wreck);
    g.run(300);
    // The guest's page reloads: no wreck there until the host's catch-up.
    const guest = g.copy(0);
    for (const w of guest.wrecks.values()) w.wreck.dispose();
    guest.wrecks.clear();
    g.hw.team.onArrived(g.guestLobbies[0]!.you);
    g.relay.flush();
    expect(guest.wreckCount).toBe(1);
    const sent = g.relay.sent<Extract<VehiclesEvent, { t: 'wreck'; op: 'add' }>>('wreck').at(-1)!;
    expect(sent.hop).toBeUndefined();
    const placed = [...guest.wrecks.values()][0]!.wreck.root.position;
    expect(placed.x).toBeCloseTo(4);
    expect(placed.z).toBeCloseTo(-6);
    g.dispose();
  });
});
