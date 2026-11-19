/**
 * Prisoners for guests over the mocked transport: the E key on a guest is the designed key (tap questions, tap again lets go, a
 * 0.4 s hold captures, the exact prompt, the ring), the host does it and settles two players on one man, the reveal is the
 * team's, the bounty the captor's, and the shield (off in the game) is carried when it is switched on.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Enemy } from '../../enemies/Enemy';
import { CUFF_HOLD } from '../../enemies/outpost/capture';
import { HOSTAGES, type Holder } from '../../enemies/outpost/prisoners';
import { enlist, type Soldier } from '../../enemies/outpost/soldier';
import type { CaptureEvent } from './capture';
import { CAPTURABLE } from './snapshot';
import { party } from './testkit';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The host's prisoners, as much as the wire needs: the same entry points the real `Prisoners` has, recording what was done. */
function captives(events: { emit(type: string, payload: unknown): void }) {
  const done: string[] = [];
  const holds = new Map<Holder, Soldier>();
  const kneeling = (s: Soldier) => s.surrendered && !s.released && !s.cuffed && s.e.alive;
  return {
    done, holds,
    questionFor(s: Soldier) {
      if (!kneeling(s) || s.collared || s.questioned) return false;
      s.questioned = true; done.push(`question:${s.e.uid}`);
      events.emit('prisoner:questioned', { enemy: s.e, truthful: true, marks: [{ at: V(5, 1, 5), label: 'Alpha 3' }], seconds: 9 });
      return true;
    },
    releaseFor(s: Soldier) {
      if (!kneeling(s) || s.collared || !s.questioned) return false;
      s.released = true; done.push(`release:${s.e.uid}`); events.emit('prisoner:freed', { enemy: s.e });
      return true;
    },
    cuffFor(s: Soldier, holder: Holder | null) {
      if (!kneeling(s) || (s.collared && (!holder || holds.get(holder) !== s))) return false;
      for (const [h, held] of holds) if (held === s) holds.delete(h);
      s.collared = false; s.cuffed = true; done.push(`cuff:${s.e.uid}`); events.emit('prisoner:cuffed', { enemy: s.e });
      return true;
    },
    grabFor(s: Soldier, holder: Holder) {
      if (!HOSTAGES.on || !kneeling(s) || s.collared || holds.has(holder)) return false;
      holds.set(holder, s); s.collared = true; done.push(`grab:${s.e.uid}`); events.emit('prisoner:grabbed', { enemy: s.e });
      return true;
    },
    dropFor(holder: Holder) {
      const s = holds.get(holder);
      if (!s) return false;
      holds.delete(holder); s.collared = false; s.released = true; done.push(`drop:${s.e.uid}`); events.emit('prisoner:freed', { enemy: s.e });
      return true;
    },
    heldBy: (holder: Holder) => holds.get(holder) ?? null,
    shieldHit(holder: Holder, amount: number) { if (holds.get(holder)) done.push(`shield:${Math.round(amount)}`); },
  };
}

function game(guests = 2) {
  const g = party(guests, [], 'outpost');
  const host = g.host;
  const prisoners = captives(host.ctx.events as never);
  (host.manager as unknown as { outpost: unknown }).outpost = { captives: prisoners };
  /** A man on his knees at `at`, on the host and (after a snapshot) on every guest. */
  const kneel = (at: THREE.Vector3): Soldier => {
    const e = host.manager.spawn('trooper', at) as Enemy;
    const s = { e, surrendered: true, released: false, collared: false, cuffed: false, questioned: false, fate: 'surrender' } as unknown as Soldier;
    enlist(e, s);
    return s;
  };
  /** Frames on every side, 150 ms apart on the clock, so snapshots go out and everything lands. */
  const step = (n = 2) => { for (let i = 0; i < n; i++) { vi.advanceTimersByTime(150); g.step(); } };
  /** Guest `i` stands at `at` on its own screen and on the host's. */
  const stand = (i: number, at: THREE.Vector3) => { g.guests[i]!.player.position.copy(at); g.guests[i]!.player.eye.copy(at).y += 1.6; g.bodies[i]!.position.copy(at); };
  /** Guest `i`'s E key for one frame: `pressed` on its first frame, `down` while held, `dt` seconds of it. */
  const key = (i: number, pressed: boolean, down: boolean, dt: number) => {
    const { ctx } = g.guests[i]!;
    (ctx.input.pressed as ReturnType<typeof vi.fn>).mockReturnValue(pressed);
    (ctx.input.isDown as ReturnType<typeof vi.fn>).mockReturnValue(down);
    (ctx.time as { dt: number }).dt = dt;
    g.gws[i]!.update();
    (ctx.input.pressed as ReturnType<typeof vi.fn>).mockReturnValue(false);
  };
  const tap = (i: number) => { key(i, true, true, 0.05); key(i, false, false, 0.05); g.relay.flush(); step(); };
  const hold = (i: number, seconds: number) => { key(i, true, true, 0); for (let t = 0; t < seconds; t += 0.05) key(i, false, true, 0.05); g.relay.flush(); step(); key(i, false, false, 0.05); };
  const prompt = (i: number) => (g.guests[i]!.ctx.hud.follow as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string | undefined;
  return { ...g, prisoners, kneel, step, stand, key, tap, hold, prompt };
}

describe('prisoners for every player', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => { vi.useRealTimers(); HOSTAGES.on = false; });

  it('marks a kneeling man for the guests and gives them the designed prompt', () => {
    const g = game();
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(0, V(0, 0, 0));
    g.key(0, false, false, 0.05);
    expect(g.gws[0]!.replicas.get(s.e.uid)!.to.flags & CAPTURABLE).toBeTruthy();
    expect(g.prompt(0)).toBe('Tap [E] to question · Hold [E] to capture');
    g.dispose();
  });

  it('a tap questions him, the whole team sees what he gave up, and a second tap lets him go', () => {
    const g = game();
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(0, V(0, 0, 0));
    g.tap(0);
    expect(g.prisoners.done).toEqual([`question:${s.e.uid}`]);
    // The marks are on both guests' maps (the host's own screen is the host's `Prisoners`).
    for (const guest of g.guests) expect(guest.ctx.hud.marker).toHaveBeenCalledWith(expect.objectContaining({ x: 5, z: 5 }), 'Alpha 3', expect.any(String));
    expect(g.guests[1]!.ctx.hud.feed).toHaveBeenCalledWith('GUEST1 questioned a prisoner', expect.any(String));
    // The truth lights every fighting man, on every guest.
    const fighter = g.host.manager.spawn('trooper', V(9, 0, 9));
    g.step();
    for (const gw of g.gws) gw.update();
    for (const guest of g.guests) expect(guest.ctx.render.highlight).toHaveBeenCalled();
    expect(fighter.alive).toBe(true);
    g.key(0, false, false, 0.05);
    expect(g.prompt(0)).toBe('Tap [E] to release · Hold [E] to capture');
    g.tap(0);
    expect(g.prisoners.done).toEqual([`question:${s.e.uid}`, `release:${s.e.uid}`]);
    g.dispose();
  });

  it('a 0.4 s hold captures him, with the ring filling, and the bounty is the captor\'s', () => {
    const g = game();
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(1, V(0, 0, 0));
    // Short of 0.4 s and let go: a question, not a capture.
    g.key(1, true, true, 0); g.key(1, false, true, 0.2);
    expect(g.guests[1]!.ctx.hud.hold).toHaveBeenLastCalledWith(0.2 / CUFF_HOLD);
    g.key(1, false, false, 0.05); g.relay.flush();
    expect(g.prisoners.done).toEqual([`question:${s.e.uid}`]);
    g.step();
    g.hold(1, CUFF_HOLD);
    expect(g.prisoners.done).toEqual([`question:${s.e.uid}`, `cuff:${s.e.uid}`]);
    expect(g.guests[1]!.ctx.hud.feed).toHaveBeenCalledWith('PRISONER CUFFED', expect.any(String));
    expect(g.guests[0]!.ctx.hud.feed).toHaveBeenCalledWith('GUEST2 cuffed a prisoner', expect.any(String));
    // The drone lifts him: the host's purse was paid, and passes it on to the guest who cuffed him.
    const wallet = { credits: 300, earned: 300, earn: vi.fn() };
    (g.host.ctx.contracts as { wallet: unknown }).wallet = wallet;
    const purse = { earn: vi.fn() };
    (g.guests[1]!.ctx.contracts as { wallet: unknown }).wallet = purse;
    g.host.ctx.events.emit('prisoner:secured', { enemy: s.e, bounty: 300 });
    g.relay.flush();
    expect(wallet.credits).toBe(0);
    expect(purse.earn).toHaveBeenCalledWith(300);
    g.dispose();
  });

  it('settles two guests on one man: the first key wins, the second does nothing', () => {
    const g = game();
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(0, V(0.5, 0, 0)); g.stand(1, V(-0.5, 0, 0));
    // Both hold E through the same frames; both messages reach the host together.
    g.key(0, true, true, 0); g.key(1, true, true, 0);
    for (let t = 0; t < CUFF_HOLD; t += 0.05) { g.key(0, false, true, 0.05); g.key(1, false, true, 0.05); }
    g.relay.flush();
    expect(g.prisoners.done).toEqual([`cuff:${s.e.uid}`]);
    // And a question racing a question: asked once.
    const t = g.kneel(V(0, 0, -2.5));
    g.step();
    g.key(0, false, false, 0.05); g.key(1, false, false, 0.05);
    g.key(0, true, true, 0.05); g.key(1, true, true, 0.05); g.key(0, false, false, 0.05); g.key(1, false, false, 0.05);
    g.relay.flush();
    expect(g.prisoners.done.filter(d => d === `question:${t.e.uid}`)).toHaveLength(1);
    expect(g.prisoners.done.some(d => d.startsWith('release'))).toBe(false);
    g.dispose();
  });

  it('refuses a key from across the room, from a downed player, and on a man who is not kneeling', () => {
    const g = game(1);
    const s = g.kneel(V(0, 0, -2));
    const fighter = g.host.manager.spawn('trooper', V(1, 0, -2));
    g.step();
    g.bodies[0]!.position.set(30, 0, 30);
    for (const act of ['question', 'cuff', 'release', 'grab', 'junk']) g.sendFrom(0, { t: 'capture', uid: s.e.uid, act });
    g.relay.flush();
    g.bodies[0]!.position.set(0, 0, 0);
    g.sendFrom(0, { t: 'capture', uid: fighter.uid, act: 'cuff' });
    g.sendFrom(0, { t: 'capture', uid: 'x', act: 'cuff' });
    g.sendFrom(0, { t: 'capture', uid: s.e.uid, act: 'grab' });
    g.relay.flush();
    expect(g.prisoners.done).toEqual([]);
    // The older message, with no `act`, is still a capture.
    g.sendFrom(0, { t: 'capture', uid: s.e.uid });
    g.relay.flush();
    expect(g.prisoners.done).toEqual([`cuff:${s.e.uid}`]);
    g.dispose();
  });

  it('tells a late arrival who has been questioned', () => {
    const g = game(1);
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(0, V(0, 0, 0));
    g.tap(0);
    // The page reloads: its list is empty until the host's catch-up.
    const fresh = g.gws[0]!['capture' as never] as { questioned: Set<number> };
    fresh.questioned.clear();
    g.hw.team.onArrived(g.guestLobbies[0]!.you);
    g.relay.flush();
    expect(fresh.questioned.has(s.e.uid)).toBe(true);
    expect(g.relay.sent<Extract<CaptureEvent, { t: 'prisoner' }>>('prisoner').at(-1)!.op).toBe('state');
    g.dispose();
  });

  it('with the shield switched on: hold grabs, rounds from the front stop on him, a tap lets go', () => {
    HOSTAGES.on = true;
    const g = game(1);
    const s = g.kneel(V(0, 0, -2));
    g.step();
    g.stand(0, V(0, 0, 0));
    g.key(0, false, false, 0.05);
    expect(g.prompt(0)).toBe('Tap [E] to question · Hold [E] to grab');
    g.hold(0, CUFF_HOLD);
    expect(g.prisoners.done).toEqual([`grab:${s.e.uid}`]);
    const guest = g.guests[0]!;
    const interceptor = (guest.player as unknown as { interceptor: (d: unknown) => boolean }).interceptor;
    // From the front (the player looks down -z) he takes it; from behind the player does.
    expect(interceptor({ amount: 20, type: 'bullet', source: 'trooper', from: V(0, 1, -10) })).toBe(true);
    expect(interceptor({ amount: 20, type: 'bullet', source: 'trooper', from: V(0, 1, 10) })).toBe(false);
    g.relay.flush();
    expect(g.prisoners.done).toEqual([`grab:${s.e.uid}`, 'shield:20']);
    g.key(0, false, false, 0.05);
    expect(g.prompt(0)).toBe('[E] let go · Hold [E] to capture');
    // With him in front, the player goes at his pace.
    guest.player.velocity.set(12, 0, 0);
    g.key(0, false, false, 0.2);
    expect(guest.player.velocity.x).toBeLessThan(12);
    g.tap(0);
    expect(g.prisoners.done.at(-1)).toBe(`drop:${s.e.uid}`);
    expect((guest.player as unknown as { interceptor: unknown }).interceptor).toBeFalsy();
    g.dispose();
  });
});
