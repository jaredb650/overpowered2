/**
 * Outpost Defense's fort over the mocked transport, with real walls (Rapier) on every side: what the host's walls do, every
 * guest's do; a guest's blast, boarding up and Barracks purchases go through the host; a late arrival gets the fort as it stands.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { noop } from '../../core/stubs';
import type { CallInId, WeaponId } from '../../core/gameplay';
import { ALLY_PRICES, ECONOMY, SHOPS } from '../../contracts/defense/data';
import { Defense } from '../../contracts/defense';
import { Physics } from '../../physics/Physics';
import { MapSpec } from '../../world/map/spec';
import { HEALTH, Structures } from '../../world/structures';
import type { FortEvent } from './fort';
import { party } from './testkit';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** A hired man, as much of him as the garrison's roll and the wire read. */
const ally = (uid: number) => ({ state: 'up', type: 'rifleman', body: { position: V(50, 0, 50), yaw: 0, uid, char: { anim: {} } }, post: V(50, 0, 50), postYaw: 0, postRadius: 1 });

/** One side's fort: real walls (a wall, a lift gate, a wall, and a shack) and the real contract over a fake run. */
async function fort() {
  const physics = await Physics.create();
  physics.addStaticBox(V(0, -0.5, 0), V(30, 0.5, 30), null, 'concrete');
  const spec = new MapSpec();
  spec.wall(-6, 0, -2, 0);
  spec.wall(-2, 0, 2, 0);
  spec.wallGate(2, 0, 6, 0, 0, true);
  spec.shack(-8, -8, 0.3, 'planks');
  const hired: string[] = [];
  const allies = { allies: [] as ReturnType<typeof ally>[], preload: async () => {}, keyTaken: null as unknown,
    spawn: vi.fn((type: string) => { hired.push(type); const a = ally(hired.length); allies.allies.push(a); return a; }),
    markBreach: vi.fn(), clearBreach: vi.fn(), focusDistance: Infinity };
  /** A mounted gun, as much of it as the seats read: who is on it, where it points, and what it was told to do. */
  const mount = () => {
    const gun = { occupant: null as unknown, remote: false, aimYaw: 0.4, aimPitch: 0.1, shooting: false, levelNumber: 1, pivot: V(0, 1, 0), standAt: V(0, 0, 1),
      aimed: null as THREE.Vector3 | null, held: false,
      occupy(who: unknown) { if (gun.occupant) return false; gun.occupant = who; return true; },
      vacate(who: unknown) { if (gun.occupant !== who) return; gun.occupant = null; gun.remote = false; gun.held = false; },
      aimAt(p: THREE.Vector3) { gun.aimed = p.clone(); }, trigger(held: boolean) { gun.held = held; },
      clear() { gun.occupant = null; gun.remote = false; }, upgrade: vi.fn() };
    return gun;
  };
  const guns = [mount(), mount()];
  const extra = {
    physics, fx: noop('fx'), audio: noop('audio'), allies,
    weapons: { current: 'smg', owned: new Set<WeaponId>(['harrow']), grenades: 0, ammo: () => ({ reserve: 0, maxReserve: 100 }), give: vi.fn(), setLoadout: vi.fn(), addGrenades: vi.fn() },
    progression: { stims: { count: 1, max: 5, give: () => 1 }, callIns: new Set<CallInId>(), callInCooldown: () => 0, grantCallIn: vi.fn(), kills: 0, score: 0, headshots: 0, resume: vi.fn(),
      callInsManager: { emplacements: { all: guns } } },
    waves: { wave: 2, phase: 'intermission', nextWaveIn: 20 },
  };
  return { physics, spec, extra, hired, allies, guns };
}

/** Finishes a side's fake `Ctx`: the walls and the contract need the `Ctx` they live in. */
function build(ctx: Ctx, f: Awaited<ReturnType<typeof fort>>) {
  const walls = new Structures(ctx, f.spec.structures, () => new THREE.MeshBasicMaterial());
  walls.attach(null);
  (ctx as unknown as { world: unknown }).world = { ...ctx.world, objects: { walls, structures: walls.all }, nav: { nearest: () => true } };
  const defense = new Defense(ctx);
  (ctx as unknown as { contracts: unknown }).contracts = { defense, wallet: null };
  return { walls, defense };
}

async function game(guests = 1) {
  const forts = await Promise.all(Array.from({ length: guests + 1 }, () => fort()));
  const g = party(guests, forts.map(f => f.extra), 'defense');
  const sides = [g.host, ...g.guests].map((side, i) => ({ ...side, ...build(side.ctx, forts[i]!), ...forts[i]! }));
  // A frame for every side to find its walls and contract, and for the host's first word to arrive.
  const step = () => { for (const s of sides) s.walls.update(0.016); g.step(); };
  // Nobody starts in the wall's line.
  for (const s of sides) s.player.position.set(30, 0, 30);
  step();
  return { ...g, sides, host: sides[0]!, guests: sides.slice(1), step };
}

const same = (a: Structures, b: Structures) => expect(b.all.map(p => [p.stage, Math.round(p.health), a.isOpen(p) ? 1 : 0]))
  .toEqual(a.all.map(p => [p.stage, Math.round(p.health), a.isOpen(p) ? 1 : 0]));

describe('one fort for the whole team', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());
  const tick = (g: { step(): void }, ms = 200) => { vi.advanceTimersByTime(ms); g.step(); };

  it('wears and breaches a wall on every screen as it does on the host', async () => {
    const g = await game(2);
    const wall = g.host.walls.all[1]!;
    g.host.walls.blast(V(0, 1, 0.5), 3, 100, 'grenade');
    tick(g);
    expect(wall.stage).toBe('intact');
    expect(wall.health).toBeLessThan(HEALTH.wall[0]);
    for (const guest of g.guests) same(g.host.walls, guest.walls);
    g.host.walls.blast(V(0, 1, 0.5), 3, 2000, 'rocket');
    tick(g);
    expect(wall.stage).toBe('breached');
    for (const guest of g.guests) {
      expect(guest.walls.all[1]!.stage).toBe('breached');
      same(g.host.walls, guest.walls);
      // The breach is a way through here too: the colliders are the breached stage's.
      guest.physics.flushQueries();
      expect(guest.physics.raycast(V(0, 1.5, -3), V(0, 0, 1), 6)).toBeNull();
    }
    const loud = g.relay.sent<Extract<FortEvent, { t: 'fort' }>>('fort').filter(e => e.loud?.length);
    expect(loud.length).toBeGreaterThan(0);
    expect(loud[0]!.at).toBeDefined();
    g.dispose();
  });

  it('a guest\'s blast wears the host\'s wall, never just its own copy', async () => {
    const g = await game(2);
    const [a, b] = g.guests as [typeof g.host, typeof g.host];
    a.walls.blast(V(0, 1, 0.5), 3, 150, 'rocket');
    expect(a.walls.all[1]!.health).toBe(HEALTH.wall[0]);
    tick(g); tick(g);
    expect(g.host.walls.all[1]!.health).toBeLessThan(HEALTH.wall[0]);
    same(g.host.walls, a.walls);
    same(g.host.walls, b.walls);
    // A tank shell's multiplier is not a guest's to claim, and junk is dropped.
    const before = g.host.walls.all[1]!.health;
    g.sendFrom(0, { t: 'wallblast', at: [0, 1, 0.5], radius: 3, amount: 10, source: 'tank_cannon' });
    g.sendFrom(0, { t: 'wallblast', at: [0, 'x', 0.5], radius: 3, amount: 1e9, source: 'rocket' });
    g.sendFrom(0, { t: 'wallblast', at: [0, 1, 0.5], radius: 900, amount: 1e9, source: 'rocket' });
    tick(g);
    expect(before - g.host.walls.all[1]!.health).toBeLessThanOrEqual(10);
    g.dispose();
  });

  it('a round on a shack goes through the host', async () => {
    const g = await game(1);
    const guest = g.guests[0]!;
    const shack = guest.walls.all.find(p => p.kind === 'shack')!;
    guest.walls.hit(shack.colliders[0]!, 4000);
    expect(shack.stage).toBe('intact');
    tick(g); tick(g);
    expect(g.host.walls.all[shack.id]!.stage).toBe('breached');
    expect(shack.stage).toBe('breached');
    g.dispose();
  });

  it('hands a late arrival the fort as it stands', async () => {
    const g = await game(1);
    g.host.walls.blast(V(0, 1, 0.5), 3, 2000, 'rocket');
    g.host.walls.blast(V(-4, 1, 0.5), 2, 80, 'grenade');
    tick(g);
    const guest = g.guests[0]!;
    // The guest's page reloads: its walls are whole again, and the host is told it arrived.
    guest.walls.reset();
    expect(guest.walls.all[1]!.stage).toBe('intact');
    g.hw.team.onArrived(g.guestLobbies[0]!.you);
    g.relay.flush();
    same(g.host.walls, guest.walls);
    expect(guest.walls.all[1]!.stage).toBe('breached');
    g.dispose();
  });

  it('lets a guest board up a wall: the host puts the stage up and the guest is paid', async () => {
    const g = await game(2);
    const [a, b] = g.guests as [typeof g.host, typeof g.host];
    g.host.walls.blast(V(0, 1, 0.5), 3, 2000, 'rocket');
    tick(g);
    // Guest 1 stands at the breach and holds E through a whole stage.
    g.bodies[0]!.position.set(0, 0, 1.5);
    a.player.position.set(0, 0, 1.5);
    (a.ctx.input.isDown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    a.defense.needLoadout = false;
    a.defense.link = a.defense.link!;
    for (let i = 0; i < 6 && a.walls.all[1]!.stage === 'breached'; i++) {
      a.defense.repair.update(ECONOMY.handSeconds / 2 + 0.01, false);
      tick(g, 400);
    }
    expect(g.host.walls.all[1]!.stage).toBe('damaged');
    expect(a.walls.all[1]!.stage).toBe('damaged');
    expect(b.walls.all[1]!.stage).toBe('damaged');
    expect(a.defense.credits).toBe(ECONOMY.handPay);
    expect(g.host.defense.credits).toBe(0);
    expect(b.defense.credits).toBe(0);
    g.dispose();
  });

  it('pays a guest whose answer lands after the wall\'s own news has ended the work', async () => {
    const g = await game(1);
    const a = g.guests[0]!;
    // The host's word on the wall arrived first, so the guest is no longer working on anything.
    expect(a.defense.repair.working).toBe(false);
    a.defense.repair.answered(1, ECONOMY.handPay, false);
    expect(a.defense.credits).toBe(ECONOMY.handPay);
    // A refusal for work it is not doing changes nothing.
    a.defense.repair.answered(1, 0, true);
    expect(a.defense.repair.blocked).toBe(false);
    g.dispose();
  });

  it('settles two guests boarding up the same stage: one is paid', async () => {
    const g = await game(2);
    g.host.walls.blast(V(0, 1, 0.5), 3, 2000, 'rocket');
    tick(g);
    for (const body of g.bodies) body.position.set(0, 0, 1.5);
    const send = (i: number) => g.sendFrom(i, { t: 'repair', i: 1, from: 2 });
    send(0); send(1);
    g.relay.flush(); tick(g);
    const answers = g.relay.sent<Extract<FortEvent, { t: 'repaired' }>>('repaired');
    expect(answers.map(a => a.pay).sort()).toEqual([0, ECONOMY.handPay]);
    expect(g.host.walls.all[1]!.stage).toBe('damaged');
    g.dispose();
  });

  it('refuses a guest who is not at the wall, and a gap someone stands in', async () => {
    const g = await game(1);
    g.host.walls.blast(V(0, 1, 0.5), 3, 2000, 'rocket');
    tick(g);
    const send = () => { g.sendFrom(0, { t: 'repair', i: 1, from: 2 }); g.relay.flush(); };
    g.bodies[0]!.position.set(20, 0, 20);
    send();
    expect(g.host.walls.all[1]!.stage).toBe('breached');
    // At the wall, but the host's own player is standing in the gap.
    g.bodies[0]!.position.set(0, 0, 1.5);
    g.host.player.position.set(0, 0, 0);
    vi.advanceTimersByTime(1000);
    send();
    expect(g.host.walls.all[1]!.stage).toBe('breached');
    expect(g.relay.sent<Extract<FortEvent, { t: 'repaired' }>>('repaired').at(-1)).toMatchObject({ pay: 0, blocked: true });
    g.dispose();
  });

  it('raises a lift gate for any player, on every screen', async () => {
    const g = await game(2);
    const gate = g.host.walls.all.find(p => p.kind === 'gate')!;
    for (const s of g.sides) s.player.position.set(40, 0, 40);
    for (const body of g.bodies) body.position.set(40, 0, 40);
    tick(g);
    expect(g.host.walls.isOpen(gate)).toBe(false);
    g.bodies[1]!.position.set(4, 0, 2);
    tick(g); tick(g);
    expect(g.host.walls.isOpen(gate)).toBe(true);
    for (const guest of g.guests) expect(guest.walls.isOpen(guest.walls.all[gate.id]!)).toBe(true);
    // It will not drop on a player standing under it.
    g.bodies[1]!.position.set(4, 0, 0);
    g.host.walls.setOpen(gate, false);
    expect(g.host.walls.isOpen(gate)).toBe(true);
    g.bodies[1]!.position.set(40, 0, 40);
    tick(g); tick(g);
    for (const s of g.sides) expect(s.walls.isOpen(s.walls.all[gate.id]!)).toBe(false);
    // A guest's own gate rises as they reach it, before the host has said so.
    g.guests[0]!.player.position.set(4, 0, 2);
    g.guests[0]!.walls.update(0.016);
    expect(g.guests[0]!.walls.isOpen(g.guests[0]!.walls.all[gate.id]!)).toBe(true);
    g.dispose();
  });

  it('a guest hires at the Barracks with its own credits; the host posts the man', async () => {
    const g = await game(2);
    const [a] = g.guests as [typeof g.host];
    a.defense.credits = ALLY_PRICES.rifleman + 5;
    expect(a.defense.buy('barracks', { kind: 'ally', type: 'rifleman' })).toBeNull();
    expect(a.defense.credits).toBe(5);
    expect(a.hired).toEqual([]);
    tick(g, 300); tick(g, 300);
    expect(g.host.hired).toEqual(['rifleman']);
    expect(g.host.defense.credits).toBe(0);
    expect(a.defense.credits).toBe(5);
    // Every guest's shop now counts him.
    for (const guest of g.guests) expect(guest.defense.view().squad).toBe(1);
    expect(g.host.ctx.hud.feed).toHaveBeenCalledWith(expect.stringContaining('GUEST1'), expect.anything());
    g.dispose();
  });

  it('refunds a purchase the host refuses', async () => {
    const g = await game(1);
    const a = g.guests[0]!;
    // The host's squad is full; the guest's last word on it is stale.
    for (let i = 0; i < ECONOMY.squadMax; i++) g.host.allies.allies.push(ally(100 + i));
    a.defense.credits = ALLY_PRICES.rifleman;
    expect(a.defense.buy('barracks', { kind: 'ally', type: 'rifleman' })).toBeNull();
    expect(a.defense.credits).toBe(0);
    tick(g, 300);
    expect(a.defense.credits).toBe(ALLY_PRICES.rifleman);
    expect(g.host.hired).toEqual([]);
    // Only the fort's own purchases are the host's to carry out.
    g.sendFrom(0, { t: 'fortbuy', n: 99, shop: 'armoury', act: { kind: 'weapon', id: 'sabot' } });
    tick(g, 300);
    expect(g.host.ctx.weapons.give).not.toHaveBeenCalled();
    g.dispose();
  });

  it('one mounted gun, one gunner: a guest\'s seat is kept on the host and shown on every screen, and a second taker steps off', async () => {
    const g = await game(2);
    const [a, b] = g.guests as [typeof g.host, typeof g.host];
    const seats = (s: typeof g.host) => (s.defense as unknown as { seats(): void }).seats();
    const frame = (ms = 300) => { for (const s of g.sides) { (s.ctx.time as { elapsed: number }).elapsed += ms / 1000; seats(s); } tick(g, ms); for (const s of g.sides) seats(s); };
    // Guest 1 steps onto gun 0 on its own screen, pointing it and firing.
    a.guns[0]!.occupant = 'player';
    a.guns[0]!.aimYaw = 1.1; a.guns[0]!.shooting = true;
    frame(); frame();
    expect(g.host.guns[0]!.occupant).not.toBeNull();
    expect(g.host.guns[0]!.remote).toBe(true);
    expect(g.host.guns[0]!.held).toBe(true);
    // The other guest sees it manned, swung the same way and firing, as somebody else's gun.
    expect(b.guns[0]!.occupant).not.toBeNull();
    expect(b.guns[0]!.remote).toBe(true);
    expect(b.guns[0]!.held).toBe(true);
    expect(Math.atan2(-b.guns[0]!.aimed!.x, -(b.guns[0]!.aimed!.z))).toBeCloseTo(1.1, 1);
    expect(a.guns[0]!.occupant).toBe('player');
    // A garrison gunner cannot take it on the host; nor can the second guest, whose own screen let it try.
    expect(g.host.guns[0]!.occupy({})).toBe(false);
    b.guns[0]!.occupant = 'player'; b.guns[0]!.remote = false;
    frame(); frame();
    expect(b.guns[0]!.occupant).not.toBe('player');
    expect(b.ctx.hud.feed).toHaveBeenCalledWith('THAT GUN IS TAKEN', expect.any(String));
    // Guest 1 steps off: the gun is free everywhere.
    a.guns[0]!.occupant = null;
    frame(); frame(); frame();
    for (const s of g.sides) expect(s.guns[0]!.occupant).toBeNull();
    // One of the host's garrison on gun 1 shows as manned on the guests.
    const soldier = {};
    g.host.guns[1]!.occupy(soldier);
    frame(); frame();
    for (const guest of g.guests) expect(guest.guns[1]!.remote).toBe(true);
    g.host.guns[1]!.vacate(soldier);
    frame(); frame();
    for (const guest of g.guests) expect(guest.guns[1]!.occupant).toBeNull();
    g.dispose();
  });

  it('shows a lost shop, a work crew and the next wave on a guest', async () => {
    const g = await game(1);
    const a = g.guests[0]!;
    g.host.defense.damageShop('armoury', SHOPS.armoury.health);
    g.host.walls.blast(V(0, 1, 0.5), 3, 100, 'grenade');
    tick(g, 300); tick(g, 300);
    expect(a.defense.shops.armoury.lost).toBe(true);
    expect(a.ctx.hud.banner).toHaveBeenCalledWith('ARMOURY LOST', expect.any(String), expect.any(String));
    expect(a.defense.preview).toBe(g.host.defense.preview);
    // The guest pays for a work crew; the host's crew mends the host's wall, and the guest sees it under repair, then whole.
    a.defense.credits = 1000;
    const repair = a.defense.offers('barracks').find(o => o.act.kind === 'repair' && o.act.index === 1 && o.why === null)!;
    expect(a.defense.buy('barracks', repair.act)).toBeNull();
    tick(g, 300);
    expect(g.host.walls.all[1]!.repairing).toBeGreaterThanOrEqual(0);
    tick(g, 300);
    expect(a.walls.all[1]!.repairing).toBeGreaterThanOrEqual(0);
    g.host.walls.update(ECONOMY.repairSeconds + 1);
    tick(g, 300);
    expect(a.walls.all[1]!.health).toBe(HEALTH.wall[0]);
    expect(a.walls.all[1]!.repairing).toBe(-1);
    g.dispose();
  });
});
