/**
 * The supply pod in co-op. The race that deleted a guest's pod (audit A5): a guest replayed `wave:clear` while its copy of the
 * waves still said `spawning`, so the pod it had just called was retired on the next frame.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { WavePhase } from '../../core/gameplay';
import { noop } from '../../core/stubs';
import { DROP_POD } from '../../progression/data';
import { ModelMaterials } from '../../progression/modelkit';
import { DropPods } from '../../progression/pickups/pods';
import { makeRange } from '../../weapons/testkit';
import { party } from './sharedkit';
import { batchOf } from '../batch';

const SPOT = new THREE.Vector3(0, 0, -60);
const LANDS = DROP_POD.warnSeconds + DROP_POD.height / DROP_POD.speed;

/** A game with real physics and weapons (the weapons' test range), dressed with what the pods touch. */
async function game(phase: WavePhase = 'intermission') {
  const r = await makeRange();
  r.reset();
  const ctx = r.ctx as Ctx & Record<string, unknown>;
  const scene = new THREE.Scene();
  const base = noop<Ctx['render']>('render');
  ctx.render = new Proxy(base, { get: (t, k) => (k === 'scene' ? scene : k === 'materials' ? { patch: (m: THREE.Material) => m } : Reflect.get(t, k)) });
  const feed: string[] = [];
  ctx.hud = { feed: (line: string) => feed.push(line), marker: () => () => {}, follow: () => () => {}, callout() {} } as unknown as Ctx['hud'];
  ctx.waves = { wave: 3, phase, nextWaveIn: 25 } as unknown as Ctx['waves'];
  const blasts: THREE.Vector3[] = [];
  ctx.combat = { explode: (at: THREE.Vector3) => blasts.push(at.clone()) } as unknown as Ctx['combat'];
  ctx.world = { pickupSpots: [SPOT], playerSpawns: [{ position: new THREE.Vector3(), yaw: 0 }] } as unknown as Ctx['world'];
  (ctx.player as unknown as { alive: boolean }).alive = true;
  let opened = 0;
  ctx.events.on('shop:open', () => opened++);
  return { r, ctx: ctx as Ctx, scene, feed, blasts, opened: () => opened };
}

/** The pods of one game, as progression holds them. */
function podsOf(ctx: Ctx, supply: boolean): DropPods {
  const pods = new DropPods(ctx, new ModelMaterials(ctx), supply);
  (ctx as unknown as { progression: { pods: DropPods } }).progression = { pods } as never;
  return pods;
}

/** One frame of a set of pods: the wall clock moves a sixtieth, as in the game. */
const tick = (pods: DropPods | DropPods[]): void => {
  vi.advanceTimersByTime(1000 / 60);
  for (const p of [pods].flat()) p.update(1 / 60);
};

type PodView = { phase: string; id: number; entry: { position: THREE.Vector3; active: boolean }; group: THREE.Group; taken: boolean; weapon: string | null };
const view = (pods: DropPods): PodView[] => (pods as unknown as { pods: PodView[] }).pods.filter(p => p.phase !== 'spent');

describe('the break reaches a guest with the wave event, not a snapshot later', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it("a guest hears `wave:clear` already in the break, with the host's clock", () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    const heard: { phase: WavePhase; next: number; wave: number }[] = [];
    guest.ctx.events.on('wave:clear', () => heard.push({ phase: guest.ctx.waves.phase, next: guest.ctx.waves.nextWaveIn, wave: guest.ctx.waves.wave }));
    // The host's director is in the break by the time it announces the clear (enemies/waves.ts).
    Object.assign(game.host.ctx.waves, { wave: 3, phase: 'intermission', nextWaveIn: 8 });
    game.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 950 });
    game.relay.flush();
    // The clock is the team's break (net/teamBreak.ts: 45 s, set before the wave's news goes out), not the director's own 8 s.
    expect(heard).toEqual([{ phase: 'intermission', next: 45, wave: 3 }]);
    game.dispose();
  });

  it('a clear is the break even from a director that announces first (Outpost Defense), and a start ends it', () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    Object.assign(game.host.ctx.waves, { wave: 2, phase: 'clearing', nextWaveIn: 0 });
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('intermission');
    Object.assign(game.host.ctx.waves, { wave: 3, phase: 'boss' });
    game.host.ctx.events.emit('wave:start', { wave: 3, total: 9, boss: true });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('boss');
    expect(guest.ctx.waves.wave).toBe(3);
    game.dispose();
  });

  it('junk in the phase or the clock changes nothing it should not', () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    Object.assign(guest.ctx.waves, { nextWaveIn: 5 });
    game.host.room.channel('action').send(batchOf('shared-test', [{ t: 'wave', kind: 'start', wave: 4, total: 1, boss: false, bonus: 0, phase: 'intermission', next: -1 }]));
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('spawning');
    expect(guest.ctx.waves.nextWaveIn).toBe(5);
    game.host.room.channel('action').send(batchOf('shared-test', [{ t: 'wave', kind: 'clear', wave: 4, total: 0, boss: false, bonus: 0, phase: 7, next: 'soon' }]));
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('intermission');
    expect(guest.ctx.waves.nextWaveIn).toBe(5);
    game.dispose();
  });
});

describe('one pod for everyone', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('under the team\'s slow-mo a pod falls as it does alone in slow-mo: at full speed, on every screen alike', async () => {
    // Alone the pods are stepped on the real clock (progression/index.ts: `pods.update(realDt)`), so a slowed world does not
    // slow a pod. In co-op they read the wall clock, which is that same real time and the same on every page: the world's
    // scale never enters it. A pod on a clock that slowed would be the one thing in co-op that differs from single player.
    const games = [await game(), await game()];
    const table = party(1, true, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, true));
    table.build();
    pods[0]!.call(SPOT.clone());
    table.relay.flush();
    // The world at a quarter speed on both screens for the whole fall: the game's own clocks say so, the wall clock does not.
    for (const g of games) Object.assign(g.ctx.time, { slowmo: 0.25 });
    const frames = Math.ceil((LANDS + 0.2) * 60);
    for (let i = 0; i < frames; i++) {
      vi.advanceTimersByTime(1000 / 60);
      // What each screen's progression hands the pods: its real step. (A world step would be a quarter of it.)
      for (const p of pods) p.update(1 / 60);
    }
    for (const p of pods) expect(view(p)[0]!.phase).not.toBe('falling');
    for (const p of pods) expect(['landed', 'open']).toContain(view(p)[0]!.phase);
    // And a solo pod given the same real time is at the same place in its life.
    const alone = await game();
    const solo = podsOf(alone.ctx, true);
    solo.call(SPOT.clone());
    for (let i = 0; i < frames; i++) solo.update(1 / 60);
    expect(view(solo)[0]!.phase).toBe(view(pods[0]!)[0]!.phase);
    table.dispose();
  });

  it('the host calls it; every guest flies the same pod at the same spot and none calls its own', async () => {
    const games = [await game(), await game('spawning'), await game('spawning')];
    const table = party(2, true, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, true));
    table.build();
    // The guests are still in `spawning` by their own copy of the waves: the race of audit A5.
    table.host.ctx.events.on('wave:clear', e => pods[0]!.onWaveClear(e.wave));
    for (const [i, seat] of table.guests.entries()) seat.ctx.events.on('wave:clear', e => pods[i + 1]!.onWaveClear(e.wave));
    table.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 0 });
    table.relay.flush();
    tick(pods);
    const host = view(pods[0]!)[0]!;
    expect(host.id).toBe(1);
    for (const guest of [pods[1]!, pods[2]!]) {
      const seen = view(guest);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.id).toBe(1);
      expect(seen[0]!.entry.position.toArray()).toEqual(host.entry.position.toArray());
    }
    // One call, to each guest.
    expect(table.relay.sent('pod').filter(e => e.op === 'call').map(e => e.id)).toEqual([1, 1]);
    // It lands and opens on every screen in the same frame, turned the same way; only the host's landing is a blast.
    for (let i = 0; i < Math.round((LANDS + 1.5) * 60); i++) tick(pods);
    expect(pods.map(p => view(p)[0]!.phase)).toEqual(['open', 'open', 'open']);
    expect(pods.map(p => view(p)[0]!.group.rotation.y)).toEqual(Array(3).fill(host.group.rotation.y));
    expect(games.map(g => g.blasts.length)).toEqual([1, 0, 0]);
    // Each player opens their own shop at it.
    for (const [i, g] of games.entries()) {
      g.r.player.position.copy(host.entry.position);
      g.r.input.simulate('interact', true);
      tick(pods[i]!);
      g.r.input.endFrame();
      expect(g.opened()).toBe(1);
    }
    // The break ends on the host: the pod goes for everyone, on the host's word.
    (games[0]!.ctx.waves as { phase: WavePhase }).phase = 'spawning';
    tick(pods[0]!);
    table.relay.flush();
    expect(pods.map(p => view(p).length)).toEqual([0, 0, 0]);
    table.dispose();
  });

  it('a guest that was loading, or joins in the break, gets the pod where it is: already down and open, with no second blast', async () => {
    const games = [await game(), await game()];
    const table = party(1, false, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, true));
    table.build();
    pods[0]!.call(SPOT.clone());
    table.relay.flush();
    // The guest's world is not up: the call was dropped on its floor.
    expect(view(pods[1]!)).toHaveLength(0);
    for (let i = 0; i < Math.round((LANDS + 4) * 60); i++) tick(pods[0]!);
    table.guests[0]!.world.begin();
    table.relay.flush();
    const seen = view(pods[1]!);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.phase).toBe('open');
    expect(seen[0]!.group.visible).toBe(true);
    expect(seen[0]!.group.position.toArray()).toEqual(view(pods[0]!)[0]!.group.position.toArray());
    expect(games[1]!.blasts).toHaveLength(0);
    // Asked twice (the host also sends it on the guest's first card): still one pod.
    table.guests[0]!.world.begin();
    table.relay.flush();
    expect(view(pods[1]!)).toHaveLength(1);
    table.dispose();
  });

  it('a guest caught mid-fall sees it at the same height as the host', async () => {
    const games = [await game(), await game()];
    const table = party(1, false, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, true));
    table.build();
    pods[0]!.call(SPOT.clone());
    table.relay.flush();
    for (let i = 0; i < Math.round((DROP_POD.warnSeconds + 0.8) * 60); i++) tick(pods[0]!);
    table.guests[0]!.world.begin();
    table.relay.flush();
    tick(pods);
    const [h, g] = pods.map(p => view(p)[0]!);
    expect(g!.phase).toBe('falling');
    // Within a frame of the fall (the host's own clock restarts on the frame it begins to fall).
    expect(Math.abs(g!.group.position.y - h!.group.position.y)).toBeLessThan(DROP_POD.speed / 60 + 0.01);
    table.dispose();
  });

  it("a guest's own copy of the waves cannot end the host's pod, unless the host's word never comes", async () => {
    const games = [await game(), await game()];
    const table = party(1, true, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, true));
    table.build();
    pods[0]!.call(SPOT.clone());
    table.relay.flush();
    (games[1]!.ctx.waves as { phase: WavePhase }).phase = 'spawning';
    for (let i = 0; i < 60 * 5; i++) tick(pods[1]!);
    expect(view(pods[1]!)).toHaveLength(1);
    for (let i = 0; i < 60 * 6; i++) tick(pods[1]!);
    expect(view(pods[1]!)).toHaveLength(0);
    table.dispose();
  });
});

describe('a weapon cache is shared: each player takes their own share', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('stands until every player has had theirs, gives each the gun their own arsenal is due, and nobody takes twice', async () => {
    const games = [await game(), await game(), await game()];
    const table = party(2, true, games.map(g => g.ctx));
    const pods = games.map(g => podsOf(g.ctx, false));
    table.build();
    pods[0]!.call(SPOT.clone());
    table.relay.flush();
    for (const g of games) g.r.player.position.set(0, 0, 200);
    for (let i = 0; i < Math.round((LANDS + 1.5) * 60); i++) tick(pods);
    expect(pods.map(p => view(p)[0]!.phase)).toEqual(['open', 'open', 'open']);
    const guns = games.map(g => g.r.weapons.owned.size);
    // The first guest walks in: their share, on their screen only. The pod stays on every screen.
    games[1]!.r.player.position.copy(SPOT);
    tick(pods[1]!);
    table.relay.flush();
    expect(games.map(g => g.r.weapons.owned.size)).toEqual([guns[0], guns[1]! + 1, guns[2]]);
    expect(pods.map(p => view(p).length)).toEqual([1, 1, 1]);
    expect(view(pods[1]!)[0]!.taken).toBe(true);
    // Standing in it gives nothing more.
    for (let i = 0; i < 30; i++) tick(pods[1]!);
    expect(games[1]!.r.weapons.owned.size).toBe(guns[1]! + 1);
    // The host, then the last guest: the host retires it for everyone.
    games[0]!.r.player.position.copy(SPOT);
    tick(pods[0]!);
    table.relay.flush();
    expect(pods.map(p => view(p).length)).toEqual([1, 1, 1]);
    games[2]!.r.player.position.copy(SPOT);
    tick(pods[2]!);
    table.relay.flush();
    expect(games.map(g => g.r.weapons.owned.size)).toEqual(guns.map(n => n + 1));
    expect(pods.map(p => view(p).length)).toEqual([0, 0, 0]);
    table.dispose();
  });

  it('single player is as it was: the cache is taken once and goes', async () => {
    const g = await game();
    const pods = podsOf(g.ctx, false);
    pods.call(SPOT.clone());
    g.r.player.position.set(0, 0, 200);
    for (let i = 0; i < Math.round((LANDS + 1.5) * 60); i++) tick(pods);
    expect(view(pods)[0]!.id).toBe(0);
    expect(g.blasts).toHaveLength(1);
    g.r.player.position.copy(SPOT);
    tick(pods);
    expect(view(pods)).toHaveLength(0);
  });
});
