import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Enemy } from '../../enemies/Enemy';
import type { WorldContext } from './context';
import { RecentSet, Replicas, farEveryFor } from './replicas';
import { BURNING, CEILING_BYTES, CHUNK_BYTES, FALL_BACK_TICKS, FAR_EVERY, FAR_EVERY_TIGHT, NEAR_HOLD_TICKS, FROZEN, FULL_BYTES, HEADER_BYTES, MOTION_BYTES, decodeChunk, encodeChunk, encodeRoster,
  type EnemyFrame } from './snapshot';
import type { Targeting } from './targeting';

/** One side of a match, with just what replicas.ts touches. `sent` is every chunk the host put on the lane, per guest. */
function side(hosting: boolean) {
  let uid = 0;
  const alive: Enemy[] = [];
  const spawn = vi.fn((id: Enemy['id'], at: THREE.Vector3) => {
    const enemy = new Enemy(); enemy.uid = ++uid; enemy.id = id; enemy.health = enemy.maxHealth = 100; enemy.alive = true;
    enemy.position.copy(at);
    enemy.char = { root: new THREE.Group(), severed: new Set(), anim: { play: vi.fn() } } as unknown as Enemy['char'];
    alive.push(enemy); return enemy;
  });
  const manager = { alive, spawn, withdraw: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }), placeReplica: vi.fn(), fitPlates: vi.fn() };
  const root = new THREE.Group();
  const players = [{ id: 'host', host: true, slot: 0, away: false }, { id: 'guest', host: false, slot: 1, away: false }];
  const sent: { to: string; data: ArrayBuffer }[] = [];
  const behind = { on: false };
  const lobby = { players, you: hosting ? 'host' : 'guest', behind: () => behind.on };
  const w = { hosting, ready: true, onSnapshot: (_: ArrayBuffer) => {}, snapshotSent: [] as ((alive: Set<number>) => void)[], manager,
    stats: { snapshotBytes: 0, snapshotPackets: 0 }, session: { lobby, remotes: new Map([[hosting ? 'guest' : 'host', { char: { root } }]]) },
    ctx: { waves: { wave: 3, phase: 'clearing', nextWaveIn: 0 }, time: { dt: 1 / 60 },
      gore: { sever: vi.fn((char: { severed: Set<string> }, region: string) => { char.severed.add(region); }) },
      player: { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0) } },
    sendSnapshot: (data: ArrayBuffer, to?: string) => { sent.push({ to: to ?? '*', data }); return 1; } };
  const targets = new Map<number, string>();
  const replicas = new Replicas(w as unknown as WorldContext, { targetOf: (id: number) => targets.get(id) } as unknown as Targeting);
  return { w, replicas, manager, alive, spawn, sent, root, behind, targets, take: (data: ArrayBuffer) => w.onSnapshot(data) };
}

/** Moves this page's clock (`performance.now()`) to `t`. */
const at = (t: number): void => { if (t > performance.now()) vi.advanceTimersByTime(t - performance.now()); };

const frame = (uid: number, x: number, more: Partial<EnemyFrame> = {}): EnemyFrame => ({ uid, id: 'husk', position: [x, 0, 0], velocity: [2, 0, 0], yaw: 0,
  health: 80, maxHealth: 100, armor: 0, flags: 0, animation: 0, severed: 0, plates: 0, posture: 'stand', ...more });

describe('the host\'s tick', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
  afterEach(() => vi.useRealTimers());

  it('sends 48 new enemies as chunks that each fit one packet, full the first time and 27 bytes each after', () => {
    const host = side(true);
    for (let index = 0; index < 48; index++) host.spawn('husk', new THREE.Vector3(index % 8, 0, 3 + Math.floor(index / 8)));
    host.replicas.update(1000);
    const first = host.sent.filter(packet => decodeChunk(packet.data)!.roster === undefined);
    expect(first).toHaveLength(2);
    for (const packet of host.sent) expect(packet.data.byteLength).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(first.flatMap(packet => decodeChunk(packet.data)!.enemies).map(enemy => enemy.uid).sort((a, b) => a - b)).toEqual(Array.from({ length: 48 }, (_, index) => index + 1));
    expect(first.every(packet => decodeChunk(packet.data)!.enemies.every(enemy => enemy.full))).toBe(true);
    expect(first.reduce((sum, packet) => sum + packet.data.byteLength, 0)).toBe(2 * HEADER_BYTES + 48 * FULL_BYTES);
    // Not due yet: the tick is 50 ms, whatever the frame rate.
    host.sent.length = 0;
    host.replicas.update(1016); host.replicas.update(1033);
    expect(host.sent).toHaveLength(0);
    // Once nothing in the full record has changed for a while, a tick is motion records plus the few whose key tick it is.
    for (let now = 1050; now < 1600; now += 50) host.replicas.update(now);
    host.sent.length = 0;
    host.replicas.update(1600);
    const steady = host.sent.map(packet => decodeChunk(packet.data)!).filter(chunk => !chunk.roster);
    const records = steady.flatMap(chunk => chunk.enemies);
    expect(records).toHaveLength(48);
    expect(records.filter(enemy => enemy.full).length).toBeLessThanOrEqual(3);
    expect(steady.every(chunk => chunk.time === 1600 && chunk.wave === 3 && chunk.phase === 'clearing' && chunk.alive === 48)).toBe(true);
  });

  it('a change in the full record is carried on the next ticks, and every enemy gets a full record once a second', () => {
    const host = side(true);
    const enemy = host.spawn('husk', new THREE.Vector3(0, 0, 5));
    for (let now = 0; now < 1000; now += 50) host.replicas.update(now);
    host.sent.length = 0;
    enemy.health = 40;
    host.replicas.update(1000);
    const after = decodeChunk(host.sent[0]!.data)!.enemies[0]!;
    expect(after).toMatchObject({ full: true, health: 40 });
    host.sent.length = 0;
    for (let now = 1050; now < 3050; now += 50) host.replicas.update(now);
    const records = host.sent.map(packet => decodeChunk(packet.data)!).filter(chunk => !chunk.roster).flatMap(chunk => chunk.enemies);
    expect(records).toHaveLength(40);
    // Eight more ticks after the change, then one a second.
    expect(records.filter(record => record.full).length).toBe(8 + 2);
  });

  it('sends far enemies a quarter as often, near ones and bosses every tick, and stays inside the byte budget at the cap', () => {
    const host = side(true);
    // The guest stands at the origin looking down +z.
    host.root.position.set(0, 0, 0); host.root.rotation.y = 0;
    for (let index = 0; index < 20; index++) host.spawn('husk', new THREE.Vector3(index % 5 - 2, 0, 6 + Math.floor(index / 5)));
    for (let index = 0; index < 27; index++) host.spawn('husk', new THREE.Vector3(index % 9 - 4, 0, -40 - Math.floor(index / 9)));
    const boss = host.spawn('titan', new THREE.Vector3(0, 0, -60));
    boss.isBoss = true;
    for (let now = 0; now < 2000; now += 50) host.replicas.update(now);
    host.sent.length = 0;
    for (let now = 2000; now < 4000; now += 50) host.replicas.update(now);
    const counts = new Map<number, number>();
    for (const packet of host.sent) for (const enemy of decodeChunk(packet.data)!.enemies) counts.set(enemy.uid, (counts.get(enemy.uid) ?? 0) + 1);
    for (let uid = 1; uid <= 20; uid++) expect(counts.get(uid)).toBe(40);
    for (let uid = 21; uid <= 47; uid++) expect(counts.get(uid)).toBe(10);
    expect(counts.get(boss.uid)).toBe(40);
    // 20 near and 28 far, as research 5.3 budgets it: 25 KB a second for snapshots. Motion records make it about 15.
    const bytesPerSecond = host.sent.reduce((sum, packet) => sum + packet.data.byteLength, 0) / 2;
    expect(bytesPerSecond).toBeLessThan(17_000);
    // Every one of the 48 next to the guest is the worst there is, and still under the 64 KB ceiling.
    const crowd = side(true);
    for (let index = 0; index < 48; index++) crowd.spawn('husk', new THREE.Vector3(index % 8, 0, 3 + Math.floor(index / 8)));
    for (let now = 0; now < 1000; now += 50) crowd.replicas.update(now);
    crowd.sent.length = 0;
    for (let now = 1000; now < 2000; now += 50) crowd.replicas.update(now);
    const worst = crowd.sent.reduce((sum, packet) => sum + packet.data.byteLength, 0);
    expect(worst).toBeLessThan(30_000);
    expect(worst).toBeGreaterThan(48 * MOTION_BYTES * 20);
  });

  it('an enemy that stops being near is still sent every tick for a second, and one at the edge does not flip between the tiers', () => {
    const host = side(true);
    host.root.position.set(0, 0, 0); host.root.rotation.y = 0;
    // Five more behind the guest, so nobody is one of "the last few".
    for (let index = 0; index < 5; index++) host.spawn('husk', new THREE.Vector3(index, 0, -50));
    const leaver = host.spawn('husk', new THREE.Vector3(0, 0, -20));
    const edge = host.spawn('husk', new THREE.Vector3(10, 0, -20));
    const sentOn = (uid: number): number[] => host.sent.flatMap(packet => { const chunk = decodeChunk(packet.data)!; return chunk.enemies.some(enemy => enemy.uid === uid) ? [chunk.tick] : []; });
    const tiers = (uid: number): number[] => host.sent.flatMap(packet => decodeChunk(packet.data)!.enemies.filter(enemy => enemy.uid === uid).map(enemy => enemy.tier ?? 0));
    for (let now = 0; now < 500; now += 50) host.replicas.update(now);
    host.sent.length = 0;
    // One walks out of the ring behind the guest and stays out; the other steps over its edge and back every tick.
    leaver.position.set(0, 0, -30);
    for (let now = 500, step = 0; now < 3500; now += 50, step++) {
      edge.position.set(10, 0, step % 2 ? -20 : -30);
      host.replicas.update(now);
    }
    const out = sentOn(leaver.uid);
    // It left on tick 11. Every tick for a second (11 to 30), then one in four (31 to 70).
    expect(out.filter(tick => tick <= 30)).toHaveLength(NEAR_HOLD_TICKS);
    expect(out.filter(tick => tick > 30)).toHaveLength(40 / FAR_EVERY);
    // Its records say "near" for the first 8 of those ticks and "far" for the last 12, while they still come every tick.
    const said = tiers(leaver.uid);
    expect(said.slice(0, NEAR_HOLD_TICKS - FALL_BACK_TICKS).every(tier => tier === 0)).toBe(true);
    expect(said.slice(NEAR_HOLD_TICKS - FALL_BACK_TICKS).every(tier => tier === 1)).toBe(true);
    // The one at the edge never changes tier and never misses a tick.
    expect(sentOn(edge.uid)).toHaveLength(60);
    expect(tiers(edge.uid).every(tier => tier === 0)).toBe(true);
    // A minute later a new one walks out: its hold is as long (nothing is left over from the first), and the map of who
    // was near holds only the living.
    host.sent.length = 0;
    host.manager.withdraw(leaver);
    const second = host.spawn('husk', new THREE.Vector3(0, 0, -20));
    for (let now = 3500; now < 4000; now += 50) host.replicas.update(now);
    second.position.set(0, 0, -30);
    host.sent.length = 0;
    for (let now = 4000; now < 6000; now += 50) host.replicas.update(now);
    expect(sentOn(second.uid)).toHaveLength(NEAR_HOLD_TICKS + 20 / FAR_EVERY);
  });

  it('a far enemy that is new still goes out at once, and the roster goes twice a second', () => {
    const host = side(true);
    host.root.position.set(0, 0, 0);
    for (let index = 0; index < 6; index++) host.spawn('husk', new THREE.Vector3(0, 0, 5 + index));
    for (let now = 0; now < 500; now += 50) host.replicas.update(now);
    host.sent.length = 0;
    const late = host.spawn('husk', new THREE.Vector3(0, 0, -60));
    host.replicas.update(500);
    expect(host.sent.flatMap(packet => decodeChunk(packet.data)!.enemies).some(enemy => enemy.uid === late.uid && enemy.full)).toBe(true);
    host.sent.length = 0;
    for (let now = 550; now < 2550; now += 50) host.replicas.update(now);
    const rosters = host.sent.map(packet => decodeChunk(packet.data)!).filter(chunk => chunk.roster);
    expect(rosters).toHaveLength(4);
    expect(rosters[0]!.roster).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('skips a guest whose connection is behind, and tells the other modules who is alive', () => {
    const host = side(true);
    host.spawn('husk', new THREE.Vector3(0, 0, 5));
    const heard: number[][] = [];
    host.w.snapshotSent.push(alive => heard.push([...alive]));
    host.behind.on = true;
    for (let now = 0; now < 500; now += 50) host.replicas.update(now);
    expect(host.sent).toHaveLength(0);
    expect(host.replicas.counts.skipped).toBe(10);
    expect(heard).toEqual([[1]]);
    host.behind.on = false;
    host.replicas.update(500);
    expect(host.sent.length).toBeGreaterThan(0);
  });

  it('says who each enemy is after, by slot, and whether it is aiming', () => {
    const host = side(true);
    const enemy = host.spawn('husk', new THREE.Vector3(0, 0, 5));
    host.targets.set(enemy.uid, 'guest');
    enemy.face = 'player';
    enemy.frozen = 2; enemy.burning = 1; enemy.maim.legs = 1; enemy.rising = 0.4;
    host.replicas.update(0);
    expect(decodeChunk(host.sent[0]!.data)!.enemies[0]).toMatchObject({ target: 1, aiming: true, flags: FROZEN | BURNING, legs: 1, rising: true });
  });

  it('thins the far tier only over the ceiling, and goes back well under it', () => {
    expect(farEveryFor(20_000, FAR_EVERY)).toBe(FAR_EVERY);
    expect(farEveryFor(CEILING_BYTES + 1, FAR_EVERY)).toBe(FAR_EVERY_TIGHT);
    expect(farEveryFor(CEILING_BYTES * 0.8, FAR_EVERY_TIGHT)).toBe(FAR_EVERY_TIGHT);
    expect(farEveryFor(CEILING_BYTES * 0.5, FAR_EVERY_TIGHT)).toBe(FAR_EVERY);
  });
});

describe('a guest\'s replicas', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
  afterEach(() => vi.useRealTimers());
  const chunk = (time: number, enemies: EnemyFrame[]) => encodeChunk({ time, tick: Math.round(time / 50), wave: 3, phase: 'clearing', enemies });

  it('makes an enemy only from a full record, and moves it between its states a little in the past', () => {
    const guest = side(false);
    at(1000);
    guest.take(chunk(1000, [frame(7, 1, { full: false })]));
    expect(guest.spawn).not.toHaveBeenCalled();
    expect(guest.replicas.counts.waiting).toBe(1);
    for (let now = 1050; now <= 2000; now += 10) {
      at(now);
      if (now % 50 === 0) guest.take(chunk(now, [frame(7, now / 500, { full: now === 1050 })]));
      guest.replicas.animate(now);
    }
    expect(guest.spawn).toHaveBeenCalledOnce();
    const enemy = guest.replicas.enemy(7)!;
    expect(enemy.health).toBe(80);
    // 50 ms interval, no jitter, 20 ms pad: drawn 70 ms back, to within a frame.
    expect(enemy.position.x).toBeGreaterThan((2000 - 70 - 12) / 500);
    expect(enemy.position.x).toBeLessThan((2000 - 70 + 12) / 500);
    expect(enemy.velocity.x).toBe(2);
    expect(guest.manager.placeReplica).toHaveBeenCalled();
    expect(guest.w.ctx.waves.wave).toBe(3);
  });

  it('is unmoved by chunks that come out of order, twice, or not at all', () => {
    const steady = side(false), rough = side(false);
    const times: number[] = [];
    for (let t = 1000; t <= 3000; t += 50) times.push(t);
    for (const t of times) { at(t); steady.take(chunk(t, [frame(7, t / 500)])); }
    // The same states, but pairs swapped, some doubled, and one in six lost.
    const order = times.filter((_, index) => index % 6 !== 4);
    for (let index = 0; index + 1 < order.length; index += 3) [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
    for (const t of order) { at(Math.max(t, 1000) + 50); rough.take(chunk(t, [frame(7, t / 500)])); rough.take(chunk(t, [frame(7, t / 500)])); }
    for (let now = 2000; now <= 2900; now += 16) {
      steady.replicas.animate(now); rough.replicas.animate(now);
    }
    expect(rough.spawn).toHaveBeenCalledOnce();
    // Both draw the same walk; the rough one a little further back (its packets came 50 ms later).
    const a = steady.replicas.enemy(7)!.position.x, b = rough.replicas.enemy(7)!.position.x;
    expect(a - b).toBeGreaterThan(0);
    expect(a - b).toBeLessThan(0.45);
    expect(b).toBeGreaterThan(2600 / 500);
  });

  it('applies the body\'s state when the playhead reaches it, health at once', () => {
    const guest = side(false);
    for (let t = 1000; t <= 1400; t += 50) { at(t); guest.take(chunk(t, [frame(7, 0)])); }
    for (let now = 1300; now <= 1400; now += 16) guest.replicas.animate(now);
    const enemy = guest.replicas.enemy(7)!;
    at(1450);
    guest.take(chunk(1450, [frame(7, 0, { flags: FROZEN | BURNING, health: 12, posture: 'handsUp', severed: 8 })]));
    expect(enemy.health).toBe(12);
    expect(guest.replicas.flags(7)).toBe(FROZEN | BURNING);
    guest.manager.placeReplica.mockClear();
    guest.replicas.animate(1460);
    expect(guest.manager.placeReplica.mock.calls.at(-1)![3]).toMatchObject({ frozen: false, burning: false });
    expect(guest.w.ctx.gore.sever).not.toHaveBeenCalled();
    for (let now = 1476; now <= 1700; now += 16) { at(now); if (now % 50 < 16) guest.take(chunk(now, [frame(7, 0, { flags: FROZEN | BURNING, health: 12, posture: 'handsUp', severed: 8 })])); guest.replicas.animate(now); }
    const [, , posture, view] = guest.manager.placeReplica.mock.calls.at(-1)!;
    expect(posture).toBe('handsUp');
    expect(view).toMatchObject({ frozen: true, burning: true });
    expect(view.frost).toBeGreaterThan(0.5);
    // The limb the host has off and this copy still has waits for its `sever` event (the real cut, on the reliable lane)...
    expect(guest.w.ctx.gore.sever).not.toHaveBeenCalled();
    const more = (from: number, to: number, severed: number) => {
      for (let now = from; now <= to; now += 16) { at(now); if (now % 50 < 16) guest.take(chunk(now, [frame(7, 0, { flags: FROZEN | BURNING, health: 12, posture: 'handsUp', severed })])); guest.replicas.animate(now); }
    };
    // ... and only drops, once, if that never comes.
    more(1716, 2600, 8);
    expect(guest.w.ctx.gore.sever).toHaveBeenCalledOnce();
    // A second limb whose event does come in time is cut by the event, not by the state.
    more(2616, 2900, 8 | 2);
    (enemy.char.severed as Set<string>).add('chest');
    more(2916, 4200, 8 | 2);
    expect(guest.w.ctx.gore.sever).toHaveBeenCalledOnce();
  });

  it('a copy handed back by its own ragdoll is drawn where it lay on that very frame, then walks to the host\'s place: no pop', () => {
    const guest = side(false);
    // Gore has the body from 2 s to 3 s, lying 1.5 m from where the host's stands.
    const body = { center: new THREE.Vector3(1.5, 0.9, 0) };
    let down = false;
    (guest.w.ctx.gore as unknown as { downed: (char: unknown) => typeof body | null }).downed = () => (down ? body : null);
    const xs: number[] = [];
    for (let now = 1000; now <= 4500; now += 10) {
      at(now);
      if (now % 50 === 0) guest.take(chunk(now, [frame(7, 0, { full: now === 1000, velocity: [0, 0, 0] })]));
      const enemy = guest.replicas.enemy(7);
      if (enemy && !enemy.def) (enemy as unknown as { def: { chest: number } }).def = { chest: 0.9 };
      down = now >= 2000 && now < 3000;
      // The enemy system draws the copy where the replica put it (EnemyManager.placeReplica); gore draws it while it is down.
      if (enemy && down) enemy.char.root.position.set(1.5, 0, 0);
      guest.replicas.animate(now);
      if (enemy && !down) enemy.char.root.position.copy(enemy.position);
      if (enemy && now >= 2900) xs.push(enemy.position.x);
    }
    // Never a step of more than a run's worth between two frames, on the frame it gets up or after.
    for (let index = 1; index < xs.length; index++) expect(Math.abs(xs[index]! - xs[index - 1]!)).toBeLessThan(0.05);
    expect(xs[10]).toBeCloseTo(1.5, 1);
    expect(xs.at(-1)).toBeCloseTo(0, 2);
  });

  it('withdraws an enemy the roster no longer names, after a moment for its death to arrive, and never one that is newer than the roster', () => {
    const guest = side(false);
    at(1000);
    guest.take(chunk(1000, [frame(7, 0), frame(8, 1)]));
    guest.replicas.animate(1000);
    guest.take(encodeRoster({ time: 1100, tick: 22, wave: 3, phase: 'clearing' }, [8]));
    guest.take(chunk(1150, [frame(9, 2)]));
    guest.take(encodeRoster({ time: 1120, tick: 22, wave: 3, phase: 'clearing' }, [8]));
    guest.replicas.animate(1400);
    expect(guest.manager.withdraw).not.toHaveBeenCalled();
    guest.replicas.animate(1700);
    expect(guest.manager.withdraw).toHaveBeenCalledOnce();
    expect(guest.replicas.enemy(7)).toBeUndefined();
    expect(guest.replicas.enemy(8)).toBeDefined();
    expect(guest.replicas.enemy(9)).toBeDefined();
    // A state from before that roster, arriving late, does not bring it back.
    guest.take(chunk(1050, [frame(7, 0)]));
    expect(guest.replicas.enemy(7)).toBeUndefined();
    // One the roster missed for a moment and then names again stays.
    guest.take(encodeRoster({ time: 1800, tick: 36, wave: 3, phase: 'clearing' }, [9]));
    guest.take(encodeRoster({ time: 1900, tick: 38, wave: 3, phase: 'clearing' }, [8, 9]));
    guest.replicas.animate(2600);
    expect(guest.replicas.enemy(8)).toBeDefined();
  });

  it('never brings back a killed uid, and forgets the oldest kills past its cap', () => {
    const guest = side(false);
    guest.replicas.dead.add(7);
    guest.take(chunk(1000, [frame(7, 0), frame(8, 0)]));
    expect(guest.spawn).toHaveBeenCalledOnce();
    expect(guest.replicas.enemy(7)).toBeUndefined();
    const recent = new RecentSet(3);
    for (const uid of [1, 2, 3, 2, 4]) recent.add(uid);
    expect([1, 2, 3, 4].map(uid => recent.has(uid))).toEqual([false, true, true, true]);
    expect(recent.size).toBe(3);
  });

  it('keeps something meant for an enemy it has not seen yet, runs it when the enemy appears, and lets it go after a while', () => {
    const guest = side(false);
    const ran: number[] = [];
    at(1000);
    guest.replicas.whenSeen(7, enemy => ran.push(enemy.uid));
    guest.replicas.whenSeen(8, enemy => ran.push(enemy.uid));
    expect(ran).toEqual([]);
    guest.take(chunk(1000, [frame(7, 0)]));
    expect(ran).toEqual([7]);
    guest.replicas.whenSeen(7, enemy => ran.push(enemy.uid * 10));
    expect(ran).toEqual([7, 70]);
    guest.replicas.animate(1000);
    guest.replicas.animate(2600);
    at(2700);
    guest.take(chunk(2700, [frame(8, 0)]));
    expect(ran).toEqual([7, 70]);
    guest.replicas.dead.add(9);
    guest.replicas.whenSeen(9, () => ran.push(9));
    guest.take(chunk(2750, [frame(9, 0)]));
    expect(ran).toEqual([7, 70]);
  });

  it('drops junk, the old format and chunks from long ago; a reloaded host starts a new timeline', () => {
    const guest = side(false);
    at(10_000);
    guest.take(chunk(10_000, [frame(7, 0)]));
    guest.take(new ArrayBuffer(3));
    guest.take(new Uint8Array(64).buffer);
    expect(guest.replicas.counts.bad).toBe(2);
    guest.take(chunk(4000, [frame(8, 0)]));
    expect(guest.replicas.counts.stale).toBe(1);
    expect(guest.replicas.enemy(8)).toBeUndefined();
    // The host's page reloaded: its clock starts over, far from the last. Its chunks are taken, not dropped as old.
    guest.take(encodeChunk({ time: 10_000 + 3_600_000, tick: 2, wave: 5, phase: 'spawning', enemies: [frame(8, 0)] }));
    expect(guest.replicas.enemy(8)).toBeDefined();
    expect(guest.w.ctx.waves.wave).toBe(5);
  });

  it('keeps the chunks that come while the map loads and takes them when it is up', () => {
    const guest = side(false);
    guest.w.ready = false;
    at(1000);
    guest.take(chunk(1000, [frame(7, 0)]));
    guest.take(chunk(1050, [frame(7, 0.1, { full: false })]));
    expect(guest.spawn).not.toHaveBeenCalled();
    guest.w.ready = true;
    guest.replicas.begin();
    expect(guest.spawn).toHaveBeenCalledOnce();
    expect(guest.replicas.map.get(7)!.motion.count).toBe(2);
  });

  it('the host\'s chunks, fed straight to a guest with one in ten lost, draw every enemy close to where the host has it', () => {
    const host = side(true), guest = side(false);
    host.root.position.set(0, 0, 0);
    const bodies = Array.from({ length: 30 }, (_, index) => host.spawn('husk', new THREE.Vector3(index, 0, index % 2 ? 8 : -45)));
    let worst = 0, n = 0;
    for (let now = 0; now <= 6000; now += 1000 / 60) {
      at(now);
      for (const body of bodies) { body.velocity.set(1.5, 0, 0); body.position.x += 1.5 / 60; }
      host.sent.length = 0;
      host.replicas.update(now);
      for (const packet of host.sent) if (++n % 10 !== 0) guest.take(packet.data);
      guest.replicas.animate(now);
      if (now < 2000) continue;
      for (const body of bodies) {
        const copy = guest.replicas.map.get(body.uid)!;
        // Where the host had it at the moment being drawn.
        const then = body.position.x - 1.5 * (now - copy.motion.playhead) / 1000;
        worst = Math.max(worst, Math.abs(copy.enemy.position.x - then));
      }
    }
    expect(guest.alive).toHaveLength(30);
    expect(worst).toBeLessThan(0.05);
  });
});
