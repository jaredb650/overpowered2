/**
 * The enemies' fire on every screen.
 *
 * Host: every enemy ray is checked against every remote player (a hit becomes `hurt`, targeting.ts). Every enemy projectile
 * (bullet, rocket, grenade, shell) is described once, as it leaves (`WireProjectile`: kind, origin, velocity, fuse, look), and each
 * guest flies its own harmless copy; the blast still comes from the host (`boom`). One that explodes carries a number, so its end
 * (`projx`) removes the copy, and a guest who shoots the copy out of the air asks the host to blow up the real one (`projhit`).
 *
 * While an enemy's attack runs its own code on the host (attacks.ts opens a `scope`), nothing here is sent piece by piece: the
 * shots of one `fire` are gathered (`record`, `take`) and ride in that attack's event, and its flashes and sounds are made by the
 * same code on each guest. Outside a scope (a vehicle's gun, a dropped grenade, the Commander's mortar team) flashes, sounds,
 * rays and projectiles go out one by one (`efx`, `ray`, `proj`), each capped per second.
 */
import * as THREE from 'three';
import type { MuzzleKind, TracerKind } from '../../core/contracts';
import type { ProjectileSpec, ProjectileTrail } from '../../core/gameplay';
import { CATALOG } from '../../audio/catalog';
import { closestSegmentPoints } from '../../weapons/geometry';
import type { WorldContext } from './context';
import type { PlayerTarget, Targeting } from './targeting';
import { validVec, type Vec } from './wire';

const PROJECTILE_KINDS = ['bullet', 'rocket', 'grenade', 'shell', 'plasma', 'stake'] as const;
type WireKind = typeof PROJECTILE_KINDS[number];
const TRAILS: readonly ProjectileTrail[] = ['none', 'smoke', 'big', 'hellfire', 'rings', 'sparks', 'swarm', 'plasma'];
const TRACERS: readonly TracerKind[] = ['scout', 'bullet', 'heavy', 'hellfire', 'bloodthirst', 'berserk', 'plasma', 'rail', 'enemy', 'carbine', 'pistol',
  'sabot', 'snipe', 'ap', 'hp', 'plusP', 'flechette', 'api', 'raufoss', 'scoutLong'];
const MUZZLES: readonly MuzzleKind[] = ['smg', 'rifle', 'shotgun', 'rocket', 'autocannon', 'plasma', 'railgun', 'minigun', 'revolver', 'flame', 'enemy',
  'carbine', 'pistol', 'sabot', 'snipe', 'quiver', 'rotary', 'hmg', 'suppressed'];

/**
 * An enemy projectile as it left the barrel: origin, velocity, kind; `id` if it explodes (its end is told), tracer, gravity
 * (m/s², down), lifetime and fuse (s), trail, size, and `x` if it carries a blast.
 */
export interface WireProjectile { o: Vec; v: Vec; k: WireKind; id?: number; tr?: string; g?: number; l?: number; fu?: number; tl?: string; sz?: number; x?: 1 }
/** An enemy's instant shot: where it left and where it stopped, its tracer and the sound of a near miss. */
export interface WireRay { o: Vec; e: Vec; tr?: string; wz?: string }
export type WireShot = WireProjectile | WireRay;

export type EnemyFireEvent =
  /** Host: an enemy's instant shot, for the guests' tracers. */
  | { t: 'ray'; from: Vec; to: Vec; tr?: string; wz?: string }
  /** Host: an enemy projectile that no attack event carries (a vehicle's shell, a dropped grenade). */
  | { t: 'proj'; p: WireProjectile }
  /** Host: enemy projectile `id` is gone (it blew up, or was shot down). */
  | { t: 'projx'; id: number }
  /** Guest to host: I shot the copy of enemy projectile `id` out of the air. */
  | { t: 'projhit'; id: number }
  /** Host: a flash (`mz`, along `dir`) and/or a sound (`snd`) at `at`, from something that is not an enemy's attack. */
  | { t: 'efx'; at: Vec; dir?: Vec; mz?: string; snd?: string; vol?: number; pitch?: number };

/** Loose events a second, each kind: enough for a truck's gun and a tank, never a flood. */
const PER_SECOND = 60;
/** Shots one `fire` of an attack may carry (a shotgun's pellets). */
export const MAX_SHOTS = 16;
const PLAYER_RADIUS = 0.45;
const WHIZZ_RADIUS = 3;

const round = (n: number): number => Math.round(n * 100) / 100;
const pack = (v: THREE.Vector3): Vec => [round(v.x), round(v.y), round(v.z)];
const isRay = (shot: WireShot): shot is WireRay => (shot as WireRay).e !== undefined;
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

/** What a guest's copy of an attack needs of the game's combat, and gets from here instead. */
export interface CopyCombat {
  spawnProjectile(spec: ProjectileSpec): void;
  fireRay(origin: THREE.Vector3, dir: THREE.Vector3): void;
  enemyMuzzle(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void;
}

export class EnemyFire {
  /** Guest: what has been drawn, for the browser proofs. */
  readonly seen = { projectiles: 0, rays: 0, flashes: 0, sounds: 0, gone: 0 };
  private depth = 0;
  private shots: WireShot[] | null = null;
  private readonly gathered: WireShot[] = [];
  private nextId = 1;
  private second = 0;
  private readonly spent = { ray: 0, proj: 0, efx: 0 };
  /** Guest: the shots of the `fire` being replayed, and how far into them the attack's own code has got. */
  private queue: readonly WireShot[] | null = null;
  private queued = 0;
  private readonly lastDir = new THREE.Vector3();
  private hasDir = false;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly spec: ProjectileSpec = { origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'bullet', team: 'enemy', damage: 0, source: 'coop', cosmetic: true };
  private readonly blast = { radius: 1, damage: 0, kind: 'enemy' as const };

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    w.router.guest('ray', value => {
      if (validVec(value.from) && validVec(value.to)) this.drawRay(this.a.fromArray(value.from), this.b.fromArray(value.to), value.tr, value.wz);
    });
    w.router.guest('proj', value => { if (value.p) this.copy(value.p, null); });
    w.router.guest('projx', value => {
      if (!finite(value.id, 1, 0xffffffff)) return;
      this.seen.gone++;
      (w.ctx.combat as unknown as { dropProjectileCopy?(id: number): void }).dropProjectileCopy?.(value.id);
    });
    w.router.host('projhit', (value, from) => {
      if (!finite(value.id, 1, 0xffffffff) || w.life(from).down) return;
      (w.ctx.combat as unknown as { detonateProjectile?(id: number): void }).detonateProjectile?.(value.id);
    });
    w.router.guest('efx', value => this.fxIn(value));
  }

  // ---------------------------------------------------------------------------------------------
  // Host: an attack's own code is running
  // ---------------------------------------------------------------------------------------------

  /** Host: true while an attack that guests play themselves is running its own code. */
  get scoped(): boolean { return this.depth > 0; }
  enter(): void { this.depth++; }
  leave(): void { if (this.depth > 0) this.depth--; }
  /** Host: from here until `take`, enemy shots are gathered instead of sent. */
  record(): void {
    this.gathered.length = 0;
    this.shots = this.gathered;
  }
  /** Host: the shots gathered since `record`, or undefined if there were none. */
  take(): WireShot[] | undefined {
    const shots = this.shots;
    this.shots = null;
    return shots && shots.length ? shots.slice() : undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // Host: what enemies fire
  // ---------------------------------------------------------------------------------------------

  /** Host: an enemy's ray from `from` to `to`. Returns where it stopped on a remote player, or null if it hit none. */
  enemyRay(from: THREE.Vector3, to: THREE.Vector3, damage: number, source: string, trace = true, tracer?: TracerKind, whizz?: string): THREE.Vector3 | null {
    if (!this.w.hosting) return null;
    let nearest = 2;
    let target: PlayerTarget | undefined;
    for (const candidate of this.targeting.players()) {
      if (!candidate.player.alive) continue;
      const hit = closestSegmentPoints(from, to, candidate.player.position, candidate.player.eye);
      if (hit.dist2 < 0.4 * 0.4 && hit.s < nearest) { nearest = hit.s; target = candidate; }
    }
    const end = target ? from.clone().lerp(to, nearest) : to;
    if (trace) {
      const tr = tracer && tracer !== 'enemy' ? tracer : undefined;
      if (this.shots) {
        if (this.shots.length < MAX_SHOTS) this.shots.push({ o: pack(from), e: pack(end), ...(tr ? { tr } : {}), ...(whizz ? { wz: whizz } : {}) });
      } else if (this.spend('ray')) this.w.send({ t: 'ray', from: pack(from), to: pack(end), ...(tr ? { tr } : {}), ...(whizz ? { wz: whizz } : {}) });
    }
    if (!target || target.id === this.w.session.lobby.you) return null;
    this.targeting.hurt(target.id, { amount: damage, from, type: 'bullet', source });
    return end;
  }

  /**
   * Host: an enemy launched a projectile. Returns its number if its end must be told (it explodes), else 0. A flame is never
   * sent: its stream is drawn by each screen's own copy of the attack.
   */
  projectile(spec: ProjectileSpec): number {
    if (!this.w.hosting || !this.w.ready || spec.kind === 'flame') return 0;
    const id = spec.explosion || spec.fuse ? this.nextId++ : 0;
    if (this.nextId > 0xfffffff) this.nextId = 1;
    const wire: WireProjectile = { o: pack(spec.origin), v: pack(spec.velocity), k: spec.kind as WireKind };
    if (id) wire.id = id;
    if (spec.tracer && spec.tracer !== 'enemy') wire.tr = spec.tracer;
    if (spec.gravity) wire.g = round(Math.abs(spec.gravity));
    if (spec.lifetime !== undefined) wire.l = round(spec.lifetime);
    if (spec.fuse) wire.fu = round(spec.fuse);
    if (spec.trail) wire.tl = spec.trail;
    if (spec.size !== undefined && spec.size !== 1) wire.sz = round(spec.size);
    if (spec.explosion) wire.x = 1;
    if (this.shots) {
      if (this.shots.length < MAX_SHOTS) this.shots.push(wire);
    } else if (this.spend('proj')) this.w.send({ t: 'proj', p: wire });
    return id;
  }

  /** Host: enemy projectile `id` is gone. */
  gone(id: number): void {
    if (this.w.hosting && this.w.ready && id > 0) this.w.send({ t: 'projx', id });
  }

  /** Guest: the local player shot the copy of enemy projectile `id` out of the air. */
  shot(id: number): void {
    if (!this.w.hosting && this.w.ready && id > 0) this.w.send({ t: 'projhit', id });
  }

  /** Host: a muzzle flash that is not part of an attack the guests play themselves. */
  flash(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void {
    if (!this.w.hosting || !this.w.ready || this.depth > 0 || !this.spend('efx')) return;
    this.w.send({ t: 'efx', at: pack(position), dir: [round(dir.x), round(dir.y), round(dir.z)], mz: kind });
  }

  /** Host: a sound at a place, likewise. */
  sound(id: string, position: THREE.Vector3, volume = 1, pitch = 1): void {
    if (!this.w.hosting || !this.w.ready || this.depth > 0 || !this.spend('efx')) return;
    this.w.send({ t: 'efx', at: pack(position), snd: id, ...(volume !== 1 ? { vol: round(volume) } : {}), ...(pitch !== 1 ? { pitch: round(pitch) } : {}) });
  }

  private spend(kind: 'ray' | 'proj' | 'efx'): boolean {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.second) { this.second = second; this.spent.ray = this.spent.proj = this.spent.efx = 0; }
    return ++this.spent[kind] <= PER_SECOND;
  }

  // ---------------------------------------------------------------------------------------------
  // Guest: drawing it
  // ---------------------------------------------------------------------------------------------

  /** Guest: the shots of the `fire` about to be replayed. The attack's own code then draws them through `combat`. */
  load(shots: readonly WireShot[] | null): void {
    this.queue = shots;
    this.queued = 0;
    this.hasDir = false;
  }

  /** Guest: what a copy of an attack calls where the host's called the game's combat. Nothing here can hurt. */
  readonly combat: CopyCombat = {
    spawnProjectile: spec => {
      // A flame is this screen's own: no damage, and gone at the first thing it touches.
      if (spec.kind === 'flame') {
        spec.damage = 0;
        spec.cosmetic = true;
        this.w.ctx.combat.spawnProjectile(spec);
        return;
      }
      const shot = this.queue?.[this.queued];
      if (!shot || isRay(shot)) return;
      this.queued++;
      this.copy(shot, spec.origin);
    },
    fireRay: origin => {
      const shot = this.queue?.[this.queued];
      if (!shot || !isRay(shot) || !validVec(shot.e)) return;
      this.queued++;
      this.b.fromArray(shot.e);
      this.lastDir.subVectors(this.b, origin).normalize();
      this.hasDir = true;
      this.drawRay(origin, this.b, shot.tr, shot.wz);
    },
    enemyMuzzle: (position, dir, kind) => {
      this.seen.flashes++;
      this.w.ctx.fx.muzzleFlash(position, this.hasDir ? this.lastDir : dir, kind);
    },
  };

  /** Guest: flies a harmless copy of the host's projectile. `muzzle` is where this screen's copy of the gun is, to leave from. */
  private copy(wire: WireProjectile, muzzle: THREE.Vector3 | null): void {
    if (!validVec(wire.o) || !validVec(wire.v) || !PROJECTILE_KINDS.includes(wire.k)) return;
    const spec = this.spec;
    spec.origin.fromArray(wire.o);
    spec.velocity.fromArray(wire.v);
    if (spec.velocity.lengthSq() > 400 * 400) return;
    spec.kind = wire.k;
    spec.tracer = TRACERS.includes(wire.tr as TracerKind) ? wire.tr as TracerKind : 'enemy';
    spec.gravity = finite(wire.g, 0, 100) ? -wire.g : undefined;
    spec.lifetime = finite(wire.l, 0, 20) ? wire.l : undefined;
    spec.fuse = finite(wire.fu, 0, 20) ? wire.fu : undefined;
    spec.trail = TRAILS.includes(wire.tl as ProjectileTrail) ? wire.tl as ProjectileTrail : undefined;
    spec.size = finite(wire.sz, 0.1, 10) ? wire.sz : undefined;
    spec.explosion = wire.x ? this.blast : undefined;
    // It leaves this screen's copy of the gun and slides onto the host's line, unless the two are too far apart to be one shot.
    spec.visualFrom = muzzle && muzzle.distanceToSquared(spec.origin) < 6 * 6 ? muzzle : undefined;
    this.lastDir.copy(spec.velocity).normalize();
    this.hasDir = true;
    this.seen.projectiles++;
    (this.w.ctx.combat as unknown as { spawnCopy?(spec: ProjectileSpec, id: number): void }).spawnCopy?.(spec, finite(wire.id, 1, 0xffffffff) ? wire.id : 0);
  }

  private drawRay(from: THREE.Vector3, to: THREE.Vector3, tracer: string | undefined, whizz: string | undefined): void {
    const { ctx } = this.w;
    this.seen.rays++;
    ctx.fx.tracer(from, to, TRACERS.includes(tracer as TracerKind) ? tracer as TracerKind : 'enemy');
    // The crack of a round that passed close, as the host's own player hears it.
    const player = ctx.player;
    if (!player.alive) return;
    const hit = closestSegmentPoints(from, to, player.position, player.eye);
    if (hit.dist2 < PLAYER_RADIUS * PLAYER_RADIUS || hit.dist2 > WHIZZ_RADIUS * WHIZZ_RADIUS || hit.s < 0.02 || hit.s > 0.98) return;
    const id = whizz && CATALOG.has(whizz) ? whizz : 'bullet_whizz';
    ctx.audio.play(id, { position: this.c.copy(from).lerp(to, hit.s), volume: 0.7, pitchJitter: 0.1 });
  }

  private fxIn(value: Extract<EnemyFireEvent, { t: 'efx' }>): void {
    const { ctx } = this.w;
    if (!validVec(value.at)) return;
    const at = this.a.fromArray(value.at);
    if (value.mz !== undefined && MUZZLES.includes(value.mz as MuzzleKind) && validVec(value.dir)) {
      this.seen.flashes++;
      ctx.fx.muzzleFlash(at, this.b.fromArray(value.dir).normalize(), value.mz as MuzzleKind);
    }
    if (typeof value.snd === 'string' && CATALOG.has(value.snd)) {
      this.seen.sounds++;
      ctx.audio.play(value.snd, { position: at, volume: finite(value.vol, 0, 2) ? value.vol : 1, pitch: finite(value.pitch, 0.2, 4) ? value.pitch : 1, pitchJitter: 0.08 });
    }
  }
}
