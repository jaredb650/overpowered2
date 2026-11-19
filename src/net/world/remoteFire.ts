/**
 * A player's weapons on the other screens. Everything a gun does goes out as one of four small events, and is drawn there by
 * the shooter's own FX code from the friend's body (weapons/watch.ts, the remote FX table):
 *
 * - `fire`: one pull. The weapon, the eye and the way the round went, and (when it is not one plain round) its kind, which
 *   hand and barrel, how many rounds and the seed their spread was drawn from. It is for the eye and the ear only: what a
 *   shot hit is a claim with its own shot id (claims.ts). The host lets a guest's through when it left their body and is
 *   not a flood (authority.ts `acceptFire`).
 * - `round`: a projectile left the gun (a rocket, a shell, a grenade, a stake, a plasma ball): every screen flies its own copy.
 * - `loop`: something that lasts ended: the Lance's beam, its giant ball (where it went off), the Kiln's stream. Each begins
 *   with a `fire` of that kind, and its aim between is the friend's pose, which already crosses 20 times a second.
 * - `held`: the gun in hand and the mods fitted to it, sent when either changes, so a suppressed shot sounds suppressed there.
 * - `mfx`: something a melee swing drew in the air (a slash, a ring, dash streaks, a slam), drawn there in the same place.
 *
 * What a player is doing with the gun between shots (a reload, a stim, the rocket's laser up, a Lance charge) rides in their
 * pose as bits (`doing`, pose.ts DOING), not as events.
 *
 * A guest's go to the host, who checks them, draws them and passes them to the other guests with the sender's slot stamped.
 * Nothing drawn from these hurts anything. Gun Kata's notice is here too: it opens the host's fire-rate check for the burst.
 */
import * as THREE from 'three';
import type { FireKind, FireNote, MeleeFx, ProjectileSpec, ProjectileTrail, WeaponId } from '../../core/gameplay';
import type { TracerKind } from '../../core/contracts';
import { SeededRandom, randomInCone } from '../../core/math';
import { WEAPONS } from '../../weapons/data';
import { LANCE_LOOK } from '../../weapons/lance';
import { ROCKET_LASER } from '../../weapons/laser';
import { MODS } from '../../weapons/mods';
import { STIM } from '../../progression/data';
import { DOING } from '../pose';
import type { RemotePlayer } from '../remote';
import type { WorldContext, WorldModule } from './context';
import type { Late } from './late';
import { validVec, type Vec } from './wire';

/**
 * `slot` is stamped by the host. `k`: what the shot is when not the gun's ordinary round (FireKind). `f`: bit 1 the left
 * hand's gun, bit 2 the gun's second kind of round, the rest the barrel. `n`: hitscan rounds (unset: one; 0: none, the round
 * flies as a `proj`). `c` and `s`: the half-angle of their cone and the seed their spread was drawn from, for more than one.
 */
export type FireEvent = {
  t: 'fire'; weapon: string; origin: Vec; dir: Vec; slot?: number;
  k?: FireKind; f?: number; n?: number; c?: number; s?: number;
  /** The tracer a perk of the shooter's gives the round: 1 + its index in `PERK_TRACERS`. Unset: the gun's own. */
  tc?: number;
  /** A melee swing: its sound and pitch. Its `f`: bit 1 a heavy swing, bit 2 the energy blade. */
  snd?: string; p?: number;
};
/** Something a swing drew in the air (core/gameplay.ts MeleeFx), as its vectors and numbers. */
export type MeleeFxEvent = { t: 'mfx'; k: MeleeFx['kind']; a: Vec; b?: Vec; c?: Vec; x?: number; y?: number; l?: string; slot?: number };
/**
 * Something that lasts ended (`weapon:loop`). `at` and `n`: where a giant ball went off, and the wall's normal there. `proj`:
 * the sender's own projectile `i` went off at `at` (or, a stake, stopped in a body there), so its copies end there. `whine`:
 * the rotary cannon's barrels began to turn (`on`) or ran down.
 */
export type LoopEvent = { t: 'loop'; k: 'beam' | 'giant' | 'hose' | 'spin' | 'whine' | 'proj'; slot?: number; at?: Vec; n?: Vec; i?: number; on?: 1 };
/**
 * A projectile left a player's gun: every other screen flies its own copy, which hurts nothing. `k` its kind, `src` the
 * weapon (or `grenade`), `o` and `v` where it starts and how fast, `i` its number if it explodes (a `loop` of kind `proj` ends
 * its copies). The rest only when set: `g` gravity, `l` seconds to live,
 * `fu` fuse, `tr` trail, `sz` size, `tc` tracer tint, `x` it explodes, `w` it steers for the laser, `fk` a flak shell, `tg` the
 * enemy a missile is after, `q` its turn rate, steer delay, weave, acceleration and top speed, `hx` a helix salvo's six numbers.
 */
export type ProjEvent = {
  t: 'round'; slot?: number; k: string; src: string; o: Vec; v: Vec; i?: number;
  g?: number; l?: number; fu?: number; tr?: string; sz?: number; tc?: string; x?: 1; w?: 1; fk?: 1;
  tg?: number; q?: number[]; hx?: number[];
};
/** The gun a player holds and the mods fitted to it, in MOD_ORDER. `on`: bit 1 the rocket's laser sight is up. */
export type KitEvent = { t: 'held'; weapon: string; mods: string[]; slot?: number };
/** Guest to host: my Gun Kata brain chip went. Its burst outruns the gun's rate for `KATA.window` s (authority.ts `kata`). */
export type KataEvent = { t: 'kata' };

const PROJECTILES: readonly ProjectileSpec['kind'][] = ['rocket', 'shell', 'grenade', 'bullet', 'plasma', 'stake'];
const TRAILS: readonly ProjectileTrail[] = ['none', 'smoke', 'big', 'hellfire', 'rings', 'sparks', 'swarm', 'plasma'];
/**
 * What a guest may send in a second, by kind, each with its own count (they shared one of 40 once: a fast explosive gun's
 * launches and landings together ran it out, and copies went untold where they ended). `end` is a round's landing: one for
 * each launch and more, so the word that ends a copy is the last thing ever dropped.
 */
const PER_SECOND = { round: 80, end: 240, loop: 30, mfx: 60 } as const;
/** The tracers a perk gives a gun's rounds (progression/data.ts TRACER_ORDER), by number on the wire. Add at the end only. */
export const PERK_TRACERS: readonly TracerKind[] = ['hellfire', 'bloodthirst', 'berserk'];
/**
 * How far a shot's origin may be from where the host has that guest's body: the body is drawn a tenth of a second back and
 * its pose is a moment old, and a dash covers 26 m a second. The same allowance the host gives a hit claim (authority.ts).
 */
export const originSlack = (pingMs: number | undefined): number => 7 + 26 * (0.35 + Math.min(1500, pingMs ?? 250) / 1000);
/** Milliseconds between the `fire` events of a held Kiln. */
const HOSE_MS = 120;
/** Seconds between looks at what the local player holds, for `held`. */
const KIT_EVERY = 0.4;
/** Millimetres for a position, a ten-thousandth for a direction: what a tracer needs, in a third of the bytes. */
const mm = (n: number): number => Math.round(n * 1000) / 1000;
const unit = (n: number): number => Math.round(n * 10000) / 10000;
const point = (v: THREE.Vector3): Vec => [mm(v.x), mm(v.y), mm(v.z)];
const finite = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

export class RemoteFire implements WorldModule {
  /** Events sent and drawn, by kind, since the world began: for the proofs and the bandwidth numbers. */
  readonly sent = { fire: 0, round: 0, loop: 0, held: 0, mfx: 0, bytes: 0 };
  readonly drawn = { fire: 0, round: 0, loop: 0, held: 0, mfx: 0 };

  private readonly rng = new SeededRandom();
  private readonly dir = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly note: FireNote = {
    kind: 'gun', left: false, barrel: 0, rays: 0, cone: 0, seed: 0, alt: false, aimed: false, to: new THREE.Vector3(),
    swing: { sound: '', pitch: 1, heavy: false, energy: false },
  };
  private readonly mfx: MeleeFx = { kind: 'slash', a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), x: 0, y: 0, look: '' };
  /** When the local player's stim injection is over on the others' screens. */
  private stimUntil = -Infinity;
  private readonly spec: ProjectileSpec = { origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'rocket', team: 'player', damage: 0, source: '', cosmetic: true };
  private hoseAt = -Infinity;
  private nextTag = 0;
  /** The kit last sent, as one string, and when it is next looked at. */
  private kitSent = '';
  private kitIn = 0;
  /** Host: each player's latest kit, by lobby id, for a guest who arrives later. */
  private readonly kits = new Map<string, KitEvent>();
  /** Each friend's latest kit by slot, kept for a body that is built after the word came. */
  private readonly held = new Map<number, KitEvent>();
  /** Host: side events each guest has sent this second, by kind (`PER_SECOND`). */
  private readonly side = new Map<string, { second: number; round: number; end: number; loop: number; mfx: number }>();
  /** Host: side events left out because a guest sent more of a kind than `PER_SECOND` allows. */
  dropped = 0;

  /** `late` (host): keeps a guest's event for a moment when it arrives before that guest's body does. */
  constructor(private readonly w: WorldContext, private readonly late?: Late) {
    w.listen('weapon:fired', event => this.shoot(event.weapon, event.origin, event.dir, event.note ?? null));
    w.listen('weapon:loop', event => {
      if (event.kind === 'whine') this.send(event.on ? { t: 'loop', k: 'whine', on: 1 } : { t: 'loop', k: 'whine' });
      else if (!event.on) this.send({ t: 'loop', k: event.kind, ...(event.kind === 'giant' ? { at: point(event.at), ...(event.normal ? { n: point(event.normal) } : {}) } : {}) });
    });
    w.listen('melee:fx', e => this.send({
      t: 'mfx', k: e.kind, a: point(e.a), ...(e.kind === 'slam' || e.kind === 'sound' ? {} : { b: [unit(e.b.x), unit(e.b.y), unit(e.b.z)] as Vec }),
      ...(e.kind === 'slash' ? { c: [unit(e.c.x), unit(e.c.y), unit(e.c.z)] as Vec } : e.kind === 'slam' ? { b: [unit(e.b.x), unit(e.b.y), unit(e.b.z)] as Vec } : {}),
      ...(e.x ? { x: mm(e.x) } : {}), ...(e.y ? { y: mm(e.y) } : {}), ...(e.kind === 'slash' || e.kind === 'sound' ? { l: e.look } : {}),
    }));
    w.listen('stim:inject', () => { this.stimUntil = performance.now() + STIM.seconds * 1000; });
    // A guest's Gun Kata: the host lets its burst through the fire-rate check (authority.ts `kata`).
    if (!w.hosting) w.listen('chip:kata', () => w.send({ t: 'kata' }));
    w.router.host('fire', (value, from, now) => this.fireIn(value, from, now));
    w.router.guest('fire', value => this.draw(value));
    w.router.host('loop', (value, from, now) => this.sideIn(value, from, now));
    w.router.guest('loop', value => this.drawLoop(value));
    w.router.host('round', (value, from, now) => this.sideIn(value, from, now));
    w.router.guest('round', value => this.drawProjectile(value));
    w.router.host('mfx', (value, from, now) => this.sideIn(value, from, now));
    w.router.guest('mfx', value => this.drawMelee(value));
    w.router.host('held', (value, from) => this.kitIn_(value, from));
    w.router.guest('held', value => this.drawKit(value));
    w.router.host('kata', (_value, from, now) => { w.validator.kata(from, now); });
  }

  private send(event: FireEvent | LoopEvent | ProjEvent | KitEvent | MeleeFxEvent): void {
    if (!this.w.ready) return;
    const slot = this.w.session.lobby.me?.slot;
    const out = this.w.hosting ? { ...event, slot } : event;
    this.sent[event.t]++;
    this.sent.bytes += JSON.stringify(out).length;
    this.w.send(out);
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------

  /** The local player fired: tell the others what, and how it looks. `note` unset: one plain round down the aim. */
  private shoot(weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, note: FireNote | null): void {
    const { ctx } = this.w;
    if (!ctx.player.alive) return;
    // The Kiln fires thirty globs a second: the others are told a few times a second that it is still on (their copy of the
    // stream follows the friend's pose between).
    if (note?.kind === 'hose') {
      const now = performance.now();
      if (now - this.hoseAt < HOSE_MS) return;
      this.hoseAt = now;
    }
    const event: FireEvent = { t: 'fire', weapon, origin: point(origin), dir: [0, 0, 0] };
    let way = dir;
    if (note?.kind === 'swing') {
      event.k = 'swing';
      const told = note.swing;
      if (told) {
        const flags = (told.heavy ? 1 : 0) | (told.energy ? 2 : 0);
        if (flags) event.f = flags;
        event.snd = told.sound;
        if (told.pitch !== 1) event.p = mm(told.pitch);
      }
    } else if (note) {
      if (note.kind !== 'gun') event.k = note.kind;
      const flags = (note.left ? 1 : 0) | (note.alt ? 2 : 0) | (note.barrel << 2);
      if (flags) event.f = flags;
      if (note.aimed) way = this.dir.subVectors(note.to, origin).normalize();
      else if (note.rays === 1 && note.cone > 0 && note.seed !== 0) {
        // One round off the aim (a rotary cannon's wobble): its own direction says it all, in no more bytes.
        way = randomInCone(dir, note.cone, this.dir, this.rng.seed(note.seed));
      } else if (note.rays > 1 && note.cone > 0) {
        event.c = unit(note.cone);
        event.s = note.seed;
      }
      if (note.rays !== 1 && note.kind === 'gun') event.n = note.rays;
    }
    event.dir = [unit(way.x), unit(way.y), unit(way.z)];
    // A perk's tracer (Hellfire, Bloodthirst, Berserk) is this player's to say: the others do not know their perks.
    if (note?.kind !== 'swing') {
      const perk = (ctx.weapons as { modifiers?: { tracer?: TracerKind | null } }).modifiers?.tracer;
      const tracer = perk ? PERK_TRACERS.indexOf(perk) + 1 : 0;
      if (tracer > 0) event.tc = tracer;
    }
    this.send(event);
  }

  /**
   * The local player's gun launched `spec` (Combat.spawnProjectile): every other screen flies a copy. Returns the number an
   * explosive round goes by between screens (0: none), which `landed` quotes when it goes off.
   */
  projectile(spec: ProjectileSpec): number {
    if (spec.team !== 'player' || spec.cosmetic || spec.kind === 'flame' || !this.w.ready || !this.w.ctx.player.alive) return 0;
    // A gun's round or a thrown grenade. A call-in's rounds are the call-in's to show (callins.ts).
    if (spec.source !== 'grenade' && !Object.hasOwn(WEAPONS, spec.source)) return 0;
    const event: ProjEvent = { t: 'round', k: spec.kind, src: spec.source, o: point(spec.origin), v: point(spec.velocity) };
    let tag = 0;
    // A round whose end the others must be told: one that goes off, and a stake, which stops in a body or flies on through
    // it by what it did to that body on this screen.
    if (spec.explosion || spec.flak || spec.kind === 'stake') {
      tag = this.nextTag = this.nextTag % 0xffff + 1;
      event.i = tag;
    }
    if (spec.gravity) event.g = mm(Math.abs(spec.gravity));
    if (spec.lifetime !== undefined) event.l = mm(spec.lifetime);
    if (spec.fuse) event.fu = mm(spec.fuse);
    if (spec.trail) event.tr = spec.trail;
    if (spec.size !== undefined && spec.size !== 1) event.sz = mm(spec.size);
    if (spec.tracer) event.tc = spec.tracer;
    if (spec.explosion) event.x = 1;
    if (spec.wired) event.w = 1;
    if (spec.flak) event.fk = 1;
    if (spec.turnRate) {
      event.q = [mm(spec.turnRate), mm(spec.steerDelay ?? 0), mm(spec.weave ?? 0), mm(spec.accel ?? 0), mm(spec.topSpeed ?? 0)];
      const uid = (spec.target as { uid?: number } | null | undefined)?.uid;
      if (typeof uid === 'number') event.tg = uid;
    }
    const h = spec.helix;
    if (h) event.hx = [unit(h.phase), mm(h.reach), mm(h.radius), mm(h.pitch), mm(h.startRadius), mm(h.convergence)];
    this.send(event);
    return tag;
  }

  /** The local player's own round `tag` went off at `at` (Projectiles.explode): the others' copies of it end there. */
  landed(tag: number, at: THREE.Vector3): void {
    this.send({ t: 'loop', k: 'proj', i: tag, at: point(at) });
  }

  /** Every frame: what the local player holds is told to the others when it changes. */
  /** Guest: the gun in hand is told again (the host shows the others whatever it last heard). */
  resay(): void { this.kitSent = ''; this.kitIn = 0; }

  /** Host: a connection that is gone takes the gun it was last told to hold, and its budget, with it. */
  forgetPeer(id: string): void { this.kits.delete(id); this.side.delete(id); }

  update(): void {
    const { ctx } = this.w;
    this.kitIn -= ctx.time.realDt;
    if (this.kitIn > 0) return;
    this.kitIn = KIT_EVERY;
    for (const remote of this.w.session.remotes.values()) {
      // `watcher?.`: other modules' tests stand a bare body in for a friend.
      const watcher = remote.watcher as RemotePlayer['watcher'] | undefined;
      const kit = !watcher || watcher.held ? undefined : this.held.get(remote.player.slot);
      if (kit) watcher!.hold(kit.weapon, kit.mods);
    }
    const weapon = ctx.weapons.current;
    const fitted = ctx.weapons.fitted;
    const mods: string[] = [];
    if (fitted) for (const id of fitted) if (MODS[id].weapon === weapon) mods.push(id);
    mods.sort();
    const key = `${weapon}|${mods.join(',')}`;
    if (key === this.kitSent) return;
    this.kitSent = key;
    const event: KitEvent = { t: 'held', weapon, mods };
    if (this.w.hosting) this.kits.set(this.w.session.lobby.you ?? 'host', { ...event, slot: this.w.session.lobby.me?.slot });
    this.send(event);
  }

  /** Host: a guest has arrived in the world (team.ts): they are told what everyone already holds. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    for (const [owner, kit] of this.kits) if (owner !== id) this.w.send(kit, id);
  }

  // -------------------------------------------------------------------------------------------
  // The host's checks
  // -------------------------------------------------------------------------------------------

  /** Host: a guest's shot, checked, drawn here and passed on to the other guests. */
  private fireIn(value: FireEvent, from: string, now: number): void {
    if (this.late) this.late.with(from, now, 'fire', (remote, at) => this.fireNow(value, from, at, remote));
    else { const remote = this.w.sender(from, now); if (remote) this.fireNow(value, from, now, remote); }
  }

  private fireNow(value: FireEvent, from: string, now: number, remote: RemotePlayer): void {
    if (!validVec(value.origin) || !validVec(value.dir) || this.far(remote, value.origin, from)
      || this.w.life(from).down || !this.w.validator.acceptFire(from, 0, value.weapon, now)) return;
    const event = { ...value, slot: remote.player.slot };
    this.draw(event);
    this.w.relay(event, from);
  }

  /** Host: a guest's projectile, loop end or swing effect, checked (their body is here, it is near it, not a flood), drawn and passed on. */
  private sideIn(value: LoopEvent | ProjEvent | MeleeFxEvent, from: string, now: number): void {
    if (this.late) this.late.with(from, now, value?.t ?? 'side', (remote, at) => this.sideNow(value, from, at, remote));
    else { const remote = this.w.sender(from, now); if (remote) this.sideNow(value, from, now, remote); }
  }

  private sideNow(value: LoopEvent | ProjEvent | MeleeFxEvent, from: string, now: number, remote: RemotePlayer): void {
    if (this.w.life(from).down) return;
    const second = Math.floor(now / 1000);
    let side = this.side.get(from);
    if (!side) this.side.set(from, side = { second, round: 0, end: 0, loop: 0, mfx: 0 });
    if (side.second !== second) { side.second = second; side.round = side.end = side.loop = side.mfx = 0; }
    const kind = value.t === 'round' ? 'round' : value.t === 'mfx' ? 'mfx' : value.k === 'proj' ? 'end' : 'loop';
    if (++side[kind] > PER_SECOND[kind]) { this.dropped++; return; }
    if (value.t === 'round' && (!validVec(value.o) || this.far(remote, value.o, from))) return;
    // A swing's effects are round the swinger: a flying slash's rings may be a long way off, never across the map.
    if (value.t === 'mfx' && (!validVec(value.a) || Math.hypot(value.a[0] - remote.char.root.position.x, value.a[2] - remote.char.root.position.z) > 80)) return;
    const event = { ...value, slot: remote.player.slot };
    if (event.t === 'round') this.drawProjectile(event);
    else if (event.t === 'mfx') this.drawMelee(event);
    else this.drawLoop(event);
    this.w.relay(event, from);
  }

  private kitIn_(value: KitEvent, from: string): void {
    const player = this.w.session.lobby.players.find(p => p.id === from);
    if (!player || !this.validKit(value)) return;
    const event: KitEvent = { t: 'held', weapon: value.weapon, mods: value.mods.slice(0, 16), slot: player.slot };
    this.kits.set(from, event);
    this.drawKit(event);
    this.w.relay(event, from);
  }

  private validKit(value: KitEvent): boolean {
    return typeof value.weapon === 'string' && Object.hasOwn(WEAPONS, value.weapon) && Array.isArray(value.mods)
      && value.mods.length <= 32 && value.mods.every(id => typeof id === 'string' && id.length <= 32);
  }

  /** True when `origin` is not where the host has that guest's body, by more than lag and a dash explain (`originSlack`). */
  private far(remote: RemotePlayer, origin: Vec, from: string): boolean {
    const p = remote.char.root.position;
    return Math.hypot(origin[0] - p.x, origin[1] - (p.y + 1.6), origin[2] - p.z) >= originSlack(this.w.session.lobby.pingOf?.(from));
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  /** The friend in `slot`, if their body is here and has its weapons watcher. */
  private remote(slot: number | undefined): RemotePlayer | undefined {
    for (const remote of this.w.session.remotes.values()) if (remote.player.slot === slot && remote.watcher) return remote;
    return undefined;
  }

  private draw(event: FireEvent): void {
    if (!validVec(event.origin) || !validVec(event.dir) || !Object.hasOwn(WEAPONS, event.weapon)) return;
    const remote = this.remote(event.slot);
    if (!remote) return;
    this.drawn.fire++;
    const dir = this.dir.set(event.dir[0], event.dir[1], event.dir[2]);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const note = this.note;
    const flags = finite(event.f, 0, 255) ? event.f : 0;
    note.kind = event.k === 'rail' || event.k === 'beam' || event.k === 'ball' || event.k === 'giant' || event.k === 'hose' || event.k === 'swing' ? event.k : 'gun';
    note.left = (flags & 1) !== 0;
    note.alt = (flags & 2) !== 0;
    note.barrel = flags >> 2;
    // No more rounds than the biggest scatter in the game fires at once (a quad of flechettes, with a pellet perk).
    note.rays = event.n === undefined ? 1 : finite(event.n, 0, 256) ? Math.floor(event.n) : 0;
    note.cone = finite(event.c, 0, 1.2) ? event.c : 0;
    note.seed = finite(event.s, 0, 0xffffffff) ? event.s >>> 0 : 0;
    note.aimed = false;
    note.tracer = finite(event.tc, 1, PERK_TRACERS.length) ? PERK_TRACERS[Math.floor(event.tc) - 1]! : null;
    if (note.kind === 'swing') {
      const told = note.swing!;
      told.heavy = (flags & 1) !== 0;
      told.energy = (flags & 2) !== 0;
      told.sound = typeof event.snd === 'string' && /^[a-z0-9_]{1,40}$/.test(event.snd) ? event.snd : '';
      told.pitch = finite(event.p, 0.25, 4) ? event.p : 1;
      note.left = note.alt = false;
      note.barrel = 0;
    }
    remote.watcher.fire(event.weapon as WeaponId, this.origin.set(event.origin[0], event.origin[1], event.origin[2]), dir, note);
  }

  private drawLoop(event: LoopEvent): void {
    if (event.k !== 'beam' && event.k !== 'giant' && event.k !== 'hose' && event.k !== 'spin' && event.k !== 'whine' && event.k !== 'proj') return;
    const remote = this.remote(event.slot);
    if (!remote) return;
    this.drawn.loop++;
    const at = validVec(event.at) ? this.at.set(event.at[0], event.at[1], event.at[2]) : null;
    if (event.k === 'proj') {
      if (at && finite(event.i, 1, 0xffff)) remote.watcher.landed(event.i, at);
      return;
    }
    const normal = validVec(event.n) ? this.normal.set(event.n[0], event.n[1], event.n[2]).normalize() : null;
    remote.watcher.loop(event.k, at, normal, event.on === 1);
  }

  private drawProjectile(event: ProjEvent): void {
    const kind = event.k as ProjectileSpec['kind'];
    if (!PROJECTILES.includes(kind) || !validVec(event.o) || !validVec(event.v) || typeof event.src !== 'string') return;
    if (event.src !== 'grenade' && !Object.hasOwn(WEAPONS, event.src)) return;
    const remote = this.remote(event.slot);
    if (!remote) return;
    const spec = this.spec;
    spec.origin.set(event.o[0], event.o[1], event.o[2]);
    spec.velocity.set(event.v[0], event.v[1], event.v[2]);
    if (spec.velocity.length() > 400) return;
    spec.kind = kind;
    spec.source = event.src;
    spec.damage = 1;
    spec.gravity = finite(event.g, 0, 100) ? event.g : undefined;
    spec.lifetime = finite(event.l, 0, 30) ? event.l : undefined;
    spec.fuse = finite(event.fu, 0, 30) ? event.fu : undefined;
    spec.trail = TRAILS.includes(event.tr as ProjectileTrail) ? event.tr as ProjectileTrail : undefined;
    spec.size = finite(event.sz, 0.05, 20) ? event.sz : undefined;
    spec.tracer = typeof event.tc === 'string' && event.tc.length <= 16 ? event.tc as TracerKind : undefined;
    // Its blast is the shooter's game's to send (`boom`): this copy only has to know that it ends in one.
    spec.explosion = event.x === 1 ? { radius: 1, damage: 0, kind: 'rocket' } : undefined;
    spec.wired = event.w === 1;
    spec.flak = event.fk === 1;
    const q = Array.isArray(event.q) && event.q.length === 5 && event.q.every(n => finite(n, 0, 1000)) ? event.q : null;
    spec.turnRate = q ? q[0] : undefined;
    spec.steerDelay = q ? q[1] : undefined;
    spec.weave = q ? q[2] : undefined;
    spec.accel = q ? q[3] : undefined;
    spec.topSpeed = q ? q[4] : undefined;
    spec.target = q && finite(event.tg, 1, 0xffffffff) ? this.w.ctx.enemies.alive.find(enemy => enemy.uid === event.tg) ?? null : null;
    const h = Array.isArray(event.hx) && event.hx.length === 6 && event.hx.every(n => finite(n, -1000, 1000)) ? event.hx : null;
    spec.helix = h ? { phase: h[0]!, reach: h[1]!, radius: h[2]!, pitch: h[3]!, startRadius: h[4]!, convergence: h[5]! } : undefined;
    spec.tag = finite(event.i, 1, 0xffff) ? event.i : 0;
    this.drawn.round++;
    remote.watcher.launch(spec);
  }

  private drawMelee(event: MeleeFxEvent): void {
    if (!validVec(event.a) || !['slash', 'ring', 'streaks', 'slam', 'sound'].includes(event.k)) return;
    const remote = this.remote(event.slot);
    if (!remote) return;
    const e = this.mfx;
    e.kind = event.k;
    e.a.set(event.a[0], event.a[1], event.a[2]);
    if (validVec(event.b)) e.b.set(event.b[0], event.b[1], event.b[2]);
    else e.b.set(0, 1, 0);
    if (validVec(event.c)) e.c.set(event.c[0], event.c[1], event.c[2]);
    else e.c.set(1, 0, 0);
    e.x = finite(event.x, 0, 0xffffff) ? event.x : 0;
    e.y = finite(event.y, 0, 100) ? event.y : 0;
    e.look = typeof event.l === 'string' && /^[a-z0-9_]{1,40}$/.test(event.l) ? event.l : '';
    this.drawn.mfx++;
    remote.watcher.meleeFx(e);
  }

  /** What the local player is doing with their gun now, as the bits their pose carries (pose.ts DOING). */
  doing(): number {
    const { ctx } = this.w;
    const w = ctx.weapons;
    let flags = 0;
    if (w.reloading) flags |= DOING.reload;
    if (performance.now() < this.stimUntil) flags |= DOING.stim;
    if (ROCKET_LASER.sight && WEAPONS[w.current].laser === true) flags |= DOING.laser;
    if (w.current === 'lance' && w.charge > 0) flags |= DOING.charge | (LANCE_LOOK.ball ? DOING.ball : 0);
    return flags;
  }

  private drawKit(event: KitEvent): void {
    if (!this.validKit(event) || !finite(event.slot, 0, 3)) return;
    this.held.set(event.slot, event);
    this.drawn.held++;
    this.remote(event.slot)?.watcher.hold(event.weapon, event.mods);
  }
}
