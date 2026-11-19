/**
 * The villain's props over the mocked transport, with his real devices, shutters and smoke on every side: what the host lays,
 * every guest has; any player trips one, decided by the host; a guest's round disarms one for all; a late arrival gets the lot.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { noop } from '../../core/stubs';
import { Barricades } from '../../enemies/commander/barricades';
import { Devices } from '../../enemies/commander/devices';
import type { Commander } from '../../enemies/commander';
import { Smoke } from '../../enemies/commander/smoke';
import type { VillainPropsEvent } from './villainProps';
import { party } from './testkit';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A Commander with his real props and nothing else: blasts and hurts are recorded. */
function villain(ctx: Ctx) {
  const booms: { at: THREE.Vector3; cause: string }[] = [];
  const hurts: { amount: number; cause: string }[] = [];
  const colliders = new Set<object>();
  Object.assign(ctx, {
    render: { scene: new THREE.Scene(), materials: { patch: (m: THREE.Material) => m, world: () => new THREE.MeshBasicMaterial() }, highlight: vi.fn() },
    physics: { ...ctx.physics, raycast: vi.fn(() => null), raycastInto: vi.fn(() => false), radialListeners: new Set(),
      addStaticBox: vi.fn(() => { const c = { handle: colliders.size + 1 }; colliders.add(c); return c; }), world: { removeCollider: vi.fn((c: object) => colliders.delete(c)) } },
    fx: noop('fx'), audio: noop('audio'),
  });
  const sense = { position: ctx.player.position, alive: true, speed: 0 };
  const doors = [{ x: 10, z: 0, dx: 0, dz: 1, w: 3 }, { x: -10, z: 0, dx: 0, dz: 1, w: 3 }];
  const c = {
    w: { ctx, player: sense, get now() { return ctx.time.elapsed; } },
    o: { noise: vi.fn(), routes: { setClosed: vi.fn() }, doors, soldiers: [] },
    boom: (at: THREE.Vector3, _r: number, _d: number, cause: string) => { booms.push({ at: at.clone(), cause }); },
    hurt: (amount: number, _from: THREE.Vector3, cause: string) => { hurts.push({ amount, cause }); },
    mortars: { tubeLost: vi.fn() }, tracker: { hotDoors: () => [0, 1] }, books: { hotDoors: () => [0, 1] }, posts: { doorFloor: (_d: unknown, out: THREE.Vector3) => (out.set(0, 0, 0), true) },
    doorList: doors, has: () => false, radio: vi.fn(),
  } as unknown as Commander;
  const parts = { devices: new Devices(c), barricades: new Barricades(c), smoke: new Smoke(c) };
  Object.assign(c, parts);
  (ctx.enemies as unknown as { outpost: unknown }).outpost = { commander: parts };
  return { ...parts, booms, hurts, colliders, sense };
}

function game(guests = 2) {
  const g = party(guests);
  const sides = [g.host, ...g.guests].map(side => ({ ...side, ...villain(side.ctx) }));
  for (const s of sides) s.player.position.set(40, 0, 40);
  for (const body of g.bodies) body.position.set(40, 0, 40);
  /** A frame: the host's Commander runs his devices, every side its co-op world, and every message lands. */
  const step = (dt = 0.05) => {
    for (const s of sides) (s.ctx.time as { dt: number; elapsed: number }).elapsed += dt, (s.ctx.time as { dt: number }).dt = dt;
    sides[0]!.devices.update();
    g.step();
  };
  step();
  return { ...g, sides, host: sides[0]!, guests: sides.slice(1), step };
}

const ids = (d: Devices) => d.live.map(x => `${x.id}:${x.kind}`).sort();

describe('the villain\'s props on every screen', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('lays every device on every guest, where the host put it', () => {
    const g = game();
    const d = g.host.devices;
    d.mine(V(1, 0, 1));
    d.tripwire(V(2, 0, 0), V(2, 0, 3));
    d.claymore(V(3, 0, 0), V(0, 0, 1));
    d.snare(V(4, 0, 0), V(4, 0, 3));
    d.beacon(V(5, 0, 0));
    d.charge(V(6, 0, 0), 'satchel', 0);
    d.tube(V(7, 0, 0), 1.2);
    g.step();
    for (const guest of g.guests) {
      expect(ids(guest.devices)).toEqual(ids(d));
      const wire = guest.devices.live.find(x => x.kind === 'tripwire')!;
      expect(wire.end.toArray()).toEqual([2, 0, 3]);
      expect(wire.wire).not.toBeNull();
      expect(wire.model!.visible).toBe(true);
      expect(guest.devices.live.find(x => x.kind === 'claymore')!.facing.z).toBe(1);
      expect(guest.devices.live.find(x => x.kind === 'tube')!.model!.rotation.y).toBeCloseTo(1.2);
    }
    g.dispose();
  });

  it('trips a mine under a guest, decided by the host, and it is gone for all', () => {
    const g = game();
    const mine = g.host.devices.mine(V(0, 0, 0));
    g.step();
    // Guest 2 walks onto it: on its own screen nothing trips (its Commander never runs), the host lights the fuse.
    g.bodies[1]!.position.set(0.5, 0, 0);
    g.step();
    expect(mine.lit).toBe(true);
    for (const guest of g.guests) expect(guest.devices.live[0]!.lit).toBe(true);
    for (let i = 0; i < 14; i++) g.step();
    expect(g.host.booms.map(b => b.cause)).toEqual(['mine']);
    for (const s of g.sides) expect(s.devices.live).toHaveLength(0);
    // The blast was the host's alone to make.
    for (const guest of g.guests) expect(guest.booms).toHaveLength(0);
    g.dispose();
  });

  it('lets a guest shoot a mine: it goes off on the host and is gone for all', () => {
    const g = game();
    g.host.devices.mine(V(0, 0, 0));
    g.host.devices.beacon(V(0, 0, 6));
    g.step();
    const guest = g.guests[0]!;
    g.bodies[0]!.position.set(0, 0, -8);
    // The guest's own shot, down the line to its copy of the mine.
    guest.devices.onShot(V(0, 1.6, -8), V(0, 0.15 - 1.6, 8).normalize());
    expect(guest.devices.live).toHaveLength(2);
    g.step();
    expect(g.host.booms.map(b => b.cause)).toEqual(['mine']);
    for (const s of g.sides) expect(ids(s.devices)).toEqual([expect.stringContaining('beacon')]);
    // A beacon dies quietly, with sparks on every screen.
    guest.devices.onShot(V(0, 1.6, -8), V(0, 0.15 - 1.6, 14).normalize());
    g.step();
    for (const s of g.sides) expect(s.devices.live).toHaveLength(0);
    expect(g.host.booms).toHaveLength(1);
    g.dispose();
  });

  it('refuses a shot through a wall, at a device that is gone, and a flood', () => {
    const g = game(1);
    const mine = g.host.devices.mine(V(0, 0, 0));
    g.step();
    (g.host.ctx.physics.raycast as ReturnType<typeof vi.fn>).mockReturnValue({ distance: 1 });
    g.sendFrom(0, { t: 'devshot', id: mine.id });
    g.sendFrom(0, { t: 'devshot', id: 999 });
    g.sendFrom(0, { t: 'devshot', id: 'x' });
    g.step();
    expect(mine.live).toBe(true);
    (g.host.ctx.physics.raycast as ReturnType<typeof vi.fn>).mockReturnValue(null);
    g.sendFrom(0, { t: 'devshot', id: mine.id });
    g.step();
    expect(mine.live).toBe(false);
    g.dispose();
  });

  it('springs a snare on a running guest: the stop is felt on their screen, the hurt is the host\'s', () => {
    const g = game();
    g.host.devices.snare(V(0, 0, -2), V(0, 0, 2));
    g.step();
    const [a, b] = g.guests as [typeof g.host, typeof g.host];
    a.player.velocity.set(12, 0, 0);
    // The host reads each guest's speed from their pose.
    const remote = [...(g.hw as unknown as { w: { session: { remotes: Map<string, { buffer: { sample(): unknown } }> } } }).w.session.remotes.values()][0]!;
    remote.buffer.sample = () => ({ velocity: [12, 0, 0], yaw: 0 });
    g.bodies[0]!.position.set(0.1, 0, 0);
    g.step(); g.step();
    expect(a.player.push).toHaveBeenCalledOnce();
    expect(a.player.takeDamage).toHaveBeenCalledWith(expect.objectContaining({ source: 'snare' }));
    expect(b.player.push).not.toHaveBeenCalled();
    expect(g.host.hurts).toHaveLength(0);
    for (const s of g.sides) expect(s.devices.live).toHaveLength(0);
    g.dispose();
  });

  it('a guest\'s blast sets the host\'s devices off', () => {
    const g = game(1);
    const charge = g.host.devices.charge(V(0, 0, 0), 'charge', 0);
    g.step();
    g.guests[0]!.devices.onBlast(V(0, 0, 0), 5);
    expect(g.guests[0]!.devices.live[0]!.lit).toBe(false);
    g.host.ctx.events.emit('coop:blast', { center: V(0, 0, 0), radius: 5 });
    expect(charge.lit).toBe(true);
    g.step();
    expect(g.guests[0]!.devices.live[0]!.lit).toBe(true);
    g.dispose();
  });

  it('drops a shutter on every screen as a real collider, and a blast takes it down for all', () => {
    const g = game();
    expect(g.host.barricades.drop(1)).toBe(1);
    g.step();
    for (const guest of g.guests) {
      expect(guest.barricades.count).toBe(1);
      expect(guest.colliders.size).toBe(1);
    }
    // Never on a player standing in the doorway: guest 1 is in the other one.
    g.bodies[0]!.position.set(-10, 0, 1);
    g.step();
    expect(g.host.barricades.drop(1)).toBe(0);
    // Two blasts on the host (one of them a guest's) bring it down, on every screen.
    g.guests[0]!.barricades.onBlast(V(10, 1, 0), 4);
    expect(g.guests[0]!.barricades.count).toBe(1);
    g.host.ctx.events.emit('coop:blast', { center: V(10, 1, 0), radius: 4 });
    g.host.barricades.onBlast(V(10, 1, 0), 4);
    g.step();
    for (const s of g.sides) {
      expect(s.barricades.count).toBe(0);
      expect(s.colliders.size).toBe(0);
    }
    g.dispose();
  });

  it('puts the host\'s smoke on every screen', () => {
    const g = game();
    g.host.smoke.pop(V(3, 0, 3));
    g.step();
    for (const guest of g.guests) {
      expect(guest.smoke.standing).toHaveLength(1);
      expect(guest.smoke.blocks(V(0, 0, 0), V(6, 0, 6))).toBe(true);
    }
    g.dispose();
  });

  it('hands a late arrival every device, shutter and cloud standing', () => {
    const g = game(1);
    const d = g.host.devices;
    const mine = d.mine(V(1, 0, 1));
    d.tripwire(V(2, 0, 0), V(2, 0, 3));
    d.trigger(mine, 99);
    g.host.barricades.drop(1);
    g.host.smoke.pop(V(3, 0, 3));
    g.step();
    // The guest's page reloads: nothing of his stands there, and one stale device does.
    const guest = g.guests[0]!;
    guest.devices.clear(); guest.barricades.reset(); guest.smoke.reset();
    guest.devices.put(777, 'mine', V(9, 0, 9), V(9, 0, 9), V(0, 0, 1), 0, -1);
    g.hw.team.onArrived(g.guestLobbies[0]!.you);
    g.relay.flush();
    expect(ids(guest.devices)).toEqual(ids(d));
    expect(guest.devices.live.find(x => x.kind === 'mine')!.lit).toBe(true);
    expect(guest.barricades.count).toBe(1);
    expect(guest.smoke.standing).toHaveLength(1);
    expect(g.relay.sent<Extract<VillainPropsEvent, { t: 'shutter' }>>('shutter').at(-1)!.settled).toBe(true);
    g.dispose();
  });
});
