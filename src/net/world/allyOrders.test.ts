/**
 * A guest and the squad allies (world/allies.ts): the same E key and prompts the host's player has, asked of the host, which
 * checks and carries it out. A man told to follow a guest follows that guest.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSystem } from '../../core/contracts';
import { ALLY } from '../../allies/data';
import { party } from './sharedkit';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Man { body: { position: THREE.Vector3; center: THREE.Vector3; yaw: number; char: { anim: object } }; type: string; state: string; order: string; detached: boolean; leader: PlayerSystem | null }

function game(guests = 1) {
  const g = party(guests);
  const man = (x: number, z: number, state = 'up'): Man => ({ body: { position: V(x, 0, z), center: V(x, 1.2, z), yaw: 0, char: { anim: {} } }, type: 'rifleman', state, order: 'post', detached: false, leader: null });
  const squad: Man[] = [man(10, -2), man(30, -2, 'down')];
  const system = {
    allies: squad,
    toggle: vi.fn((a: Man, by: PlayerSystem | null) => { a.order = a.order === 'follow' ? 'post' : 'follow'; a.leader = a.order === 'follow' ? by : null; }),
    toggleSquad: vi.fn((by: PlayerSystem | null) => { for (const a of squad) if (a.state === 'up') { a.order = 'follow'; a.leader = by; } }),
    reviveBy: vi.fn((a: Man) => (a.state === 'down' ? (a.state = 'up', true) : false)),
  };
  (g.host.ctx as unknown as { allies: unknown }).allies = system;
  const sides = g.guests.map(seat => {
    const keys = { pressed: false, down: false };
    const stims = { count: 2, spend() { if (this.count <= 0) return false; this.count--; return true; }, give(n: number) { this.count += n; return n; } };
    const prompts: string[] = [];
    Object.assign(seat.ctx, {
      characters: { spawn: () => ({ root: new THREE.Group(), anim: { setLocomotion: vi.fn(), update: vi.fn(), setPosture: vi.fn() }, release: vi.fn() }) },
      render: { scene: new THREE.Scene() },
      input: { pressed: (a: string) => a === 'interact' && keys.pressed, isDown: (a: string) => a === 'interact' && keys.down, labelFor: () => 'E' },
      progression: { ...seat.ctx.progression, stims },
    });
    Object.assign(seat.ctx.hud, { follow: (_at: unknown, text: string) => { prompts.push(text); return () => {}; }, floatText: vi.fn(), banner: vi.fn() });
    Object.assign(seat.ctx.weapons, { ammo: () => ({ mag: 0, reserve: 0 }), setLoadout: vi.fn() });
    return { seat, keys, stims, prompts };
  });
  Object.assign(g.host.ctx.hud, { banner: vi.fn() });
  Object.assign(g.host.ctx.weapons, { ammo: () => ({ mag: 0, reserve: 0 }), setLoadout: vi.fn() });
  g.build();
  /** A frame, a sixtieth on; the garrison's news goes out five times a second. */
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { vi.advanceTimersByTime(1000 / 60); g.step(); } };
  /** Stands a guest a couple of metres from a man, facing him. */
  const face = (i: number, a: Man) => {
    const p = sides[i]!.seat.ctx.player as unknown as { position: THREE.Vector3; eye: THREE.Vector3; forward: THREE.Vector3 };
    p.position.set(a.body.position.x, 0, a.body.position.z + 2);
    p.eye.set(a.body.position.x, 1.6, a.body.position.z + 2);
    p.forward.set(0, 0, -1);
  };
  /** Holds E for `seconds`, then lets go. */
  const press = (i: number, seconds: number) => {
    const { keys } = sides[i]!;
    keys.pressed = keys.down = true;
    frame();
    keys.pressed = false;
    frame(Math.max(0, Math.round(seconds * 60) - 1));
    keys.down = false;
    frame(2);
  };
  frame(30);
  return { ...g, squad, system, sides, frame, face, press };
}

describe('a guest gives the squad allies their orders through the host', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('sees the host\'s prompt on a man in front of them, and a tap sends him after the guest', () => {
    const g = game();
    g.face(0, g.squad[0]!);
    g.frame(2);
    expect(g.sides[0]!.prompts.at(-1)).toContain('E FOLLOW ME');
    g.press(0, 0.05);
    expect(g.system.toggle).toHaveBeenCalledTimes(1);
    const [who, by] = g.system.toggle.mock.calls[0]!;
    expect(who).toBe(g.squad[0]);
    // He follows the guest who asked: the stand-in the host keeps for that guest, standing where the guest stands.
    expect(by).not.toBeNull();
    expect(by).not.toBe(g.host.ctx.player);
    expect(by!.position.x).toBe(10);
    // The host's next word says he is following, so the guest's prompt offers the way back.
    g.frame(20);
    expect(g.sides[0]!.prompts.at(-1)).toContain('E BACK TO POST');
    expect(g.guests[0]!.world.allyOrders).toMatchObject({ asked: 1 });
    expect(g.host.world.allyOrders.done).toBe(1);
  });

  it('a hold is the whole squad', () => {
    const g = game();
    g.face(0, g.squad[0]!);
    g.frame(2);
    g.press(0, ALLY.hold + 0.1);
    expect(g.system.toggleSquad).toHaveBeenCalledTimes(1);
    expect(g.system.toggle).not.toHaveBeenCalled();
    expect(g.squad[0]!.leader).not.toBeNull();
  });

  it('a long hold on a man who is down spends the guest\'s own stim and gets him up', () => {
    const g = game();
    g.face(0, g.squad[1]!);
    g.frame(2);
    expect(g.sides[0]!.prompts.at(-1)).toContain('REVIVE');
    g.press(0, ALLY.revive + 0.1);
    expect(g.system.reviveBy).toHaveBeenCalledWith(g.squad[1]);
    expect(g.squad[1]!.state).toBe('up');
    expect(g.sides[0]!.stims.count).toBe(1);
  });

  it('a stim the host cannot use comes back: the man was already up there', () => {
    const g = game();
    g.face(0, g.squad[1]!);
    g.frame(2);
    // Up on the host a moment before the guest's word arrives; the guest's picture still has him down.
    g.squad[1]!.state = 'up';
    g.sides[0]!.keys.pressed = g.sides[0]!.keys.down = true;
    g.sides[0]!.seat.world.update();
    g.sides[0]!.keys.pressed = false;
    for (let i = 0; i < Math.round((ALLY.revive + 0.1) * 60); i++) { vi.advanceTimersByTime(1000 / 60); g.sides[0]!.seat.world.update(); }
    expect(g.sides[0]!.stims.count).toBe(1);
    g.relay.flush();
    expect(g.sides[0]!.stims.count).toBe(2);
    expect(g.guests[0]!.world.allyOrders.refunds).toBe(1);
  });

  it('the host refuses an order for a man the guest is nowhere near', () => {
    const g = game();
    g.face(0, g.squad[0]!);
    g.frame(2);
    const world = g.guests[0]!.world as unknown as { w: { send(event: unknown): void } };
    (g.guests[0]!.ctx.player as unknown as { position: THREE.Vector3 }).position.set(200, 0, 200);
    world.w.send({ t: 'aorder', k: 'toggle', id: 1 });
    g.relay.flush();
    expect(g.system.toggle).not.toHaveBeenCalled();
  });

  it('a man following a guest who has left the match follows the host again', () => {
    const g = game();
    g.squad[0]!.order = 'follow';
    g.squad[0]!.leader = { alive: true } as PlayerSystem;
    g.frame(20);
    expect(g.squad[0]!.leader).toBeNull();
  });
});
