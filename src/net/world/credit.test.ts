/**
 * Whose kill: the credit table against the game's real damage sources. The burn and bleed deaths here are made by the real
 * EnemyManager and DamageModel (their own ticks, their own source names), not by a made-up event; and every source name the
 * game's code can put on damage must have a rule, so a new one cannot slip through to "the host's" by default.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../../characters/archetypes';
import type { CharacterInstance, Ctx, DamageInfo, GameEvents } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import type { Enemy } from '../../enemies/Enemy';
import { EnemyManager } from '../../enemies/EnemyManager';
import { makeCtx } from '../../sandbox/harness';
import { WEAPONS } from '../../weapons/data';
import type { Claims } from './claims';
import type { WorldContext } from './context';
import { Credit, LINGER_MS, creditRule } from './credit';
import { Router } from './router';
import { ENEMY_IDS } from './wire';

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
  return { archetype: id, rig, root, bones, severed: new Set(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), setBurn: vi.fn(), setFrost: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod: vi.fn() } as unknown as CharacterInstance;
}

/** A host's game: the real enemy manager and damage model, and the real `Credit` listening to them. Guest `g` is in slot 1. */
function hostGame() {
  const player = { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const gore = { wound: vi.fn(() => false), headPellets: vi.fn(() => 1), sever: vi.fn(() => null), knockdown: vi.fn(() => false), downed: vi.fn(() => null),
    handedBack: vi.fn(() => null), rouse: vi.fn(), ragdoll: vi.fn(), collapse: vi.fn(), headshot: vi.fn(), gib: vi.fn(), slice: vi.fn(), blowOut: vi.fn(),
    vaporize: vi.fn(), owns: () => false };
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'], player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: () => {}, playOneOf: () => {}, startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const claims = { applying: null as string | null, onStatus: (_uid: number, _from: string) => {} };
  const offs: (() => void)[] = [];
  const sent: { event: { t: string }; to?: string }[] = [];
  const w = {
    ctx, hosting: true, router: new Router(), snapshotSent: [] as ((alive: Set<number>) => void)[],
    session: { lobby: { you: 'h', players: [{ id: 'h', slot: 0, host: true }, { id: 'g', slot: 1, host: false }] } },
    listen: <K extends keyof GameEvents>(type: K, handler: (payload: GameEvents[K]) => void) => { offs.push(ctx.events.on(type, handler)); },
    send: (event: { t: string }, to?: string) => { sent.push({ event, to }); },
  } as unknown as WorldContext;
  const credit = new Credit(w, claims as unknown as Claims);
  // What the game calls on the co-op world, handed on as world.ts hands it.
  (ctx as { coop?: unknown }).coop = { hosting: true, world: {
    notMine: (enemy?: { uid: number }) => credit.notMine(enemy), targetPlayer: null,
    status: (enemy: Enemy) => credit.lit(enemy.uid), burnSpread: (from: Enemy, to: Enemy) => credit.spread(from.uid, to.uid),
  } };
  const manager = new EnemyManager(ctx);
  const kills: { uid: number; by: number; source: string }[] = [];
  ctx.events.on('enemy:killed', e => kills.push({ uid: e.enemy.uid, by: credit.slot(e.enemy.uid), source: e.damage.source }));
  const spawn = (id: EnemyId = 'husk', x = 0): Enemy => {
    const e = manager.spawn(id, new THREE.Vector3(x, 0, -6))!;
    e.dist = 6;
    e.inView = true;
    return e;
  };
  /** The host's status tick for one enemy: burn, bleed and hazards, exactly as `EnemyManager.update` runs it. */
  const status = (e: Enemy, seconds: number) => {
    const tick = (manager as unknown as { updateStatus(e: Enemy, dt: number): void }).updateStatus.bind(manager);
    for (let t = 0; t < seconds && e.alive; t += 0.05) tick(e, 0.05);
  };
  /** A guest's claim being applied: what claims.ts does around `applyDamage` and `afflict`. */
  const asGuest = (run: () => void) => { claims.applying = 'g'; try { run(); } finally { claims.applying = null; } };
  const round = (source: string, amount: number, e: Enemy): DamageInfo =>
    ({ amount, type: 'bullet', point: e.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1, source, region: 'chest' });
  const killOf = (e: Enemy) => kills.find(k => k.uid === e.uid);
  return { ctx, manager, credit, claims, spawn, status, asGuest, round, kills, killOf, dispose: () => { for (const off of offs) off(); } };
}

describe('a death by fire or by bleeding, made by the real status tick', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('the burn tick names its damage `burn`, and the table calls that nobody\'s hand', () => {
    const game = hostGame();
    const e = game.spawn();
    const sources: string[] = [];
    game.ctx.events.on('enemy:hit', hit => sources.push(hit.damage.source));
    game.manager.afflict(e, 'burn', 5);
    game.status(e, 0.6);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['burn']));
    expect(creditRule('burn')).toBe('linger');
    game.dispose();
  });

  it('an enemy a guest set alight and that dies burning is the guest\'s kill', () => {
    const game = hostGame();
    const e = game.spawn();
    e.health = 4;
    // The guest's `status` claim, applied (claims.ts `statusIn`).
    game.claims.onStatus(e.uid, 'g');
    game.asGuest(() => game.manager.afflict(e, 'burn', 5));
    game.status(e, 3);
    expect(e.alive).toBe(false);
    expect(game.killOf(e)).toMatchObject({ source: 'burn', by: 1 });
    game.dispose();
  });

  it('many burn ticks do not hand the guest\'s fire, or a later bleed, to the host', () => {
    const game = hostGame();
    const e = game.spawn();
    game.asGuest(() => game.manager.afflict(e, 'burn', 2));
    // Two seconds of ticks, each an `enemy:hit` from `burn`, and it lives.
    game.status(e, 2.5);
    expect(e.alive).toBe(true);
    expect(e.health).toBeLessThan(e.maxHealth);
    // Then it bleeds out: the real bleed tick, source `bleed`.
    e.bleed = e.health * 4;
    game.status(e, 1);
    expect(game.killOf(e)).toMatchObject({ source: 'bleed', by: 1 });
    game.dispose();
  });

  it('the host\'s own fire is the host\'s, on an enemy a guest shot a moment before', () => {
    const game = hostGame();
    const e = game.spawn();
    game.asGuest(() => game.manager.applyDamage(e, game.round('smg', 5, e)));
    e.health = 4;
    game.manager.afflict(e, 'burn', 5);
    game.status(e, 3);
    expect(game.killOf(e)).toMatchObject({ source: 'burn', by: 0 });
    game.dispose();
  });

  it('fire that spreads from a guest\'s burning enemy to the next is still the guest\'s', () => {
    const game = hostGame();
    const first = game.spawn('husk', 0), second = game.spawn('husk', 1);
    game.asGuest(() => game.manager.afflict(first, 'burn', 5));
    // The grid the spread looks through is filled by the manager's update; here by hand.
    (game.manager as unknown as { query: (at: THREE.Vector3, radius: number, out: Enemy[]) => number }).query = (_at, _radius, out) => { out[0] = first; out[1] = second; return 2; };
    game.status(first, 0.4);
    expect(second.burning).toBeGreaterThan(0);
    second.health = 2;
    game.status(second, 2);
    expect(game.killOf(second)).toMatchObject({ source: 'burn', by: 1 });
    game.dispose();
  });

  it('a hit long ago no longer claims a burn: it is the host\'s, as a solo run counts it', () => {
    const game = hostGame();
    const e = game.spawn();
    game.asGuest(() => game.manager.applyDamage(e, game.round('smg', 5, e)));
    vi.advanceTimersByTime(LINGER_MS + 1000);
    e.health = 2;
    e.burning = 5;
    game.status(e, 2);
    expect(game.killOf(e)).toMatchObject({ source: 'burn', by: 0 });
    game.dispose();
  });

  it('the map and other enemies kill for whoever hurt the enemy last: a fall, a hazard, a charge', () => {
    const game = hostGame();
    for (const source of ['fell', 'lava', 'crusher', 'electric', 'trample', 'crash', 'titan_death', 'bomber']) {
      const e = game.spawn();
      game.asGuest(() => game.manager.applyDamage(e, game.round('smg', 5, e)));
      // A hazard's own tick must not take the last hit for the host.
      game.manager.applyDamage(e, { ...game.round(source, 1, e), type: 'shock' });
      game.manager.applyDamage(e, { ...game.round(source, e.health + 1, e), type: 'true' });
      expect(game.killOf(e), source).toMatchObject({ source, by: 1 });
    }
    game.dispose();
  });

  it('a guest\'s claim is the guest\'s whatever its source, an ally\'s kill is nobody\'s, the host\'s own gun is the host\'s', () => {
    const game = hostGame();
    const a = game.spawn(), b = game.spawn(), c = game.spawn();
    game.asGuest(() => game.manager.applyDamage(a, { ...game.round('warthog', 9999, a), type: 'true' }));
    game.asGuest(() => game.manager.applyDamage(b, game.round('smg', 5, b)));
    game.manager.applyDamage(b, { ...game.round('ally_rifle', 9999, b), type: 'true' });
    game.asGuest(() => game.manager.applyDamage(c, game.round('smg', 5, c)));
    game.manager.applyDamage(c, { ...game.round('rifle', 9999, c), type: 'true' });
    expect(game.killOf(a)!.by).toBe(1);
    expect(game.killOf(b)!.by).toBe(-1);
    expect(game.killOf(c)!.by).toBe(0);
    game.dispose();
  });

  it('a source the table has never heard of is counted as the host\'s and written down', () => {
    const game = hostGame();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = game.spawn();
    game.manager.applyDamage(e, { ...game.round('a_new_thing', 9999, e), type: 'true' });
    expect(game.killOf(e)!.by).toBe(0);
    expect([...game.credit.unknown]).toEqual(['a_new_thing']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    game.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// Every source the game's code can name
// ---------------------------------------------------------------------------------------------

/** Every `.ts` file of the game itself: no tests, no sandboxes, no test kits. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!['sandbox', 'testkit'].includes(entry.name)) sources(path, out); }
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/**
 * Damage source names written in the code: `source: 'x'` (also either side of a `?:`), a status tick's
 * (`statusDamage(e, 'x'`), a field wipe's (`killAll('x')`, `killAllExcept(e, 'x')`), a named constant (`X_SOURCE = 'x'`), a
 * villain device's `cause`, and a strike's or a shell's (`source = 'x'`).
 */
function named(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [
    /\bsource: ?'([a-zA-Z0-9_]*)'/g,
    /\bsource: ?[^,;{}\n]{1,60}\? ?'([a-zA-Z0-9_]*)' ?: ?'[a-zA-Z0-9_]*'/g,
    /\bsource: ?[^,;{}\n]{1,60}\? ?'[a-zA-Z0-9_]*' ?: ?'([a-zA-Z0-9_]*)'/g,
    /\bstatusDamage\([a-zA-Z]+, '([a-zA-Z0-9_]*)'/g,
    /\bkillAll\('([a-zA-Z0-9_]*)'\)/g,
    /\bkillAllExcept\([a-zA-Z]+, '([a-zA-Z0-9_]*)'\)/g,
    /_SOURCE = '([a-zA-Z0-9_]*)'/g,
    /\bsource = '([a-zA-Z0-9_]*)'/g,
    /\bcause = '([a-zA-Z0-9_]*)'/g,
  ];
  for (const file of sources(join(process.cwd(), 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) if (!found.has(match[1]!)) found.set(match[1]!, file);
  }
  return found;
}

describe('every damage source has a credit rule', () => {
  /** Names the scan finds that are never the source of damage on an enemy: a pickup's origin, music. */
  const NOT_DAMAGE = new Set(['drop', 'all']);
  /** What the call-ins lane lists as its claim sources (docs/notes/coop-overhaul.md), and the map's hazards (`HazardKind`). */
  const LISTED = ['airstrike', 'warthog', 'orbital', 'black_sun', 'nuke', 'sentry', 'drop_pod', 'ac130_25mm', 'ac130_40mm', 'ac130_40mm_ap', 'ac130_flak',
    'ac130_105mm', 'ac130_wp', 'ac130_bomb', 'ac130_crash', 'chopper_cannon', 'chopper_rocket', 'chopper_crash', 'door_gun', 'door_gun_crash',
    'frame_rotary', 'frame_40mm', 'frame_40mm_ap', 'frame_flak', 'frame_pod', 'frame_stomp', 'frame_foot', 'frame_charge', 'frame_backhand',
    'lava', 'crusher', 'electric', 'grenade', 'barrel', 'sword_flurry', 'sword_wave', 'sword_deflect', 'chain_storm', 'chain_reaction', 'skyfall',
    'bleed', 'burn', 'fell', 'crash', 'trample', 'hazard', 'coop', ''];

  it('the scan finds the sources the game is known to use (so it is really reading the code)', () => {
    const found = named();
    for (const source of ['bleed', 'burn', 'fell', 'crash', 'trample', 'titan_death', 'lab', 'warthog', 'ally_mortar', 'vehicle_blast', 'frag', 'slam', 'gib']) {
      expect(found.has(source), source).toBe(true);
    }
    expect(found.size).toBeGreaterThan(50);
  });

  it('no source written in the code is without a rule', () => {
    const missing: string[] = [];
    for (const [source, file] of named()) if (!NOT_DAMAGE.has(source) && creditRule(source) === null) missing.push(`${source} (${file.replace(process.cwd(), '')})`);
    expect(missing, 'add each to creditRule in src/net/world/credit.ts').toEqual([]);
  });

  it('every gun, every enemy and every listed call-in, perk and hazard has one', () => {
    for (const source of [...Object.keys(WEAPONS), ...ENEMY_IDS, ...LISTED]) expect(creditRule(source), source).not.toBeNull();
    for (const id of Object.keys(WEAPONS)) expect(creditRule(id), id).toBe('player');
    for (const id of ENEMY_IDS) expect(creditRule(id), id).toBe('linger');
    for (const source of ['bleed', 'burn', 'fell', 'crash', 'lava', 'crusher', 'electric', 'trample']) expect(creditRule(source), source).toBe('linger');
    expect(creditRule('ally_rifle')).toBe('ally');
  });
});
