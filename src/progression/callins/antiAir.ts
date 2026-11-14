/**
 * The enemy fights the aircraft (section 3 of `docs/proposals/air-support.md`).
 *
 * Hunters. Anything that fires explosives can turn on an aircraft: Rocketeers (the swarm's and the Outpost's), the
 * Juggernaut and the Titan. It is never a flood: one hunter at a time is picked across the whole map, and the next only
 * after a rest. A boss being pounded from the air turns on the aircraft doing it, outside the rest, which can make two.
 *
 * The lock. A few seconds in which the seat hears a lock tone that beeps faster as it closes, then a launch warning. No
 * marker: the missile itself is the warning, a hot point with a thick smoke trail climbing and turning onto the aircraft.
 *
 * Flares. Each pop throws decoys; a missile still far enough out turns onto one and bursts on it in mid-air. The player
 * throws them in the chopper and gunship seats; the door gunner's pilot throws his own, and so does any crew. Those are
 * thrown when the missile is close, and sometimes too late to pull it off.
 *
 * Bullets. Only the door gunner feels them: gunmen close under it and snipers further out roll a round that lands now and
 * then. It is not their own fire: they go on fighting the ground, and the aircraft simply takes the odd round.
 *
 * Enemy choppers. The vehicles system sees one friendly at a time, so this hands it a stand-in that is always the
 * helicopter worth fighting: the one the player is in, or any other.
 *
 * Nothing here can touch the player: a missile meets an aircraft or a flare, or bursts in open air, and its burst is a
 * look and a sound only.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, EnemyInstance, FriendlyAircraft } from '../../core/gameplay';
import { chance, lerp, pick, rand, randomUnit } from '../../core/math';
import type { Ac130Rounds } from './ac130Rounds';
import type { Aircraft } from './shared';

export const ANTI_AIR = {
  /** Who can turn on an aircraft. */
  hunters: ['rocketeer', 'juggernaut', 'titan'] as readonly EnemyId[],
  maxHunters: 2,
  /** Seconds after the first aircraft is up before anyone looks at it, and between one hunt and the next. */
  firstRest: 8,
  rest: [14, 22] as const,
  /** A boss turns on the aircraft pounding it at most this often. */
  bossRest: 10,
  /** Metres from a hunter to an aircraft it can lock. The gunship's slant range is about 250. */
  range: 330,
  /** Seconds of lock. The tone's beat closes from the first gap to the second. */
  lock: 3.2,
  bossLock: 2.4,
  beep: [0.42, 0.1] as const,
  missile: {
    /** m/s off the rail, gained a second after, and the most. Radians a second it can turn. */
    boost: 16, accel: 26, speed: 60, turn: 2.6,
    /** Seconds before it bursts on its own, and metres from its target that count as a hit. */
    life: 11, reach: 5,
  },
  decoy: {
    count: 6, life: 3.2, speed: 14, gravity: 9, drag: 0.55,
    /** Metres under the aircraft they start: the door gunner's eye is in the airframe, and a flare at the eye is the whole screen. */
    under: 6,
    /** A missile closer than `least` to the aircraft is past being fooled. `catch` is how close it bursts on one. */
    least: 14, catch: 3,
  },
  /**
   * Metres out the pilot or crew throw flares, and not before `spot` seconds after the launch, which is how long it takes
   * them to see it. How often they are late, and how close a late pop is.
   */
  react: [55, 95] as const,
  spot: 0.6,
  late: 0.3,
  lateAt: [6, 12] as const,
  bullets: {
    every: 0.4,
    /** A gunman's reach and his chance a tick at the foot of it, falling to nothing at `reach`. */
    reach: 75, chance: 0.12,
    sniperReach: 260, sniperChance: 0.06,
    /** Chance a tick that a gunman in reach puts a tracer up at all, landing or not. */
    shown: 0.45,
  },
} as const;

const SHOOTERS: ReadonlySet<EnemyId> = new Set<EnemyId>(['trooper', 'gunner', 'brute', 'sniper', 'warden', 'riot']);
const HUNTERS: ReadonlySet<EnemyId> = new Set(ANTI_AIR.hunters);
const M = ANTI_AIR.missile;
const D = ANTI_AIR.decoy;

/** What anti-air draws with: the gunship's spark renderer, its own instance. Narrowed so a test can hand in a stand-in. */
export type Sky = Pick<Ac130Rounds, 'flash' | 'flare' | 'update' | 'clear'>;

interface Decoy {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  life: number;
}

export interface Missile {
  readonly body: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  /** What it is after: the aircraft, until a flare pulls it off. */
  target: Aircraft | null;
  decoy: Decoy | null;
  age: number;
  smokeIn: number;
  /** Metres out from the aircraft its pilot or crew throw flares. */
  readonly reactAt: number;
  reacted: boolean;
}

export interface Hunt {
  readonly enemy: EnemyInstance;
  readonly target: Aircraft;
  readonly boss: boolean;
  /** Seconds of lock left. */
  lock: number;
  readonly lockFor: number;
  beepIn: number;
  missile: Missile | null;
}

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _at = new THREE.Vector3();

export class AntiAir {
  readonly hunts: Hunt[] = [];
  readonly decoys: Decoy[] = [];
  /** Seconds until a new hunter may be picked. */
  rest: number = ANTI_AIR.firstRest;
  private now = 0;
  private aircraft: readonly Aircraft[] = [];
  private readonly seen = new Map<Aircraft, number>();
  private readonly bossFree = new Map<number, number>();
  private bulletsIn = 0;
  private friend: Aircraft | null = null;
  private readonly friendly: FriendlyAircraft = { position: new THREE.Vector3(), hit: seconds => this.friend?.struck?.(seconds) };

  constructor(private readonly ctx: Ctx, private readonly sky: Sky, private readonly prisoners: ReadonlySet<number>) {
    ctx.events.on('enemy:hit', e => this.pounded(e.enemy, e.damage.source));
  }

  /** Every missile in the air. */
  get missiles(): Missile[] {
    const out: Missile[] = [];
    for (const h of this.hunts) if (h.missile) out.push(h.missile);
    return out;
  }

  /** `aircraft` is every one up, on the strike clock. */
  update(dt: number, aircraft: readonly Aircraft[]): void {
    this.aircraft = aircraft;
    this.now += dt;
    this.watchFlares();
    this.pickFriend();
    if (aircraft.some(a => a.huntable)) this.rest -= dt;
    else this.rest = Math.max(this.rest, ANTI_AIR.firstRest);
    for (let i = this.hunts.length - 1; i >= 0; i--) this.hunt(this.hunts[i]!, dt);
    if (this.hunts.length === 0 && this.rest <= 0) this.pick();
    this.moveDecoys(dt);
    this.bullets(dt);
    this.sky.update(this.ctx.time.dt);
  }

  // --- Hunters ------------------------------------------------------------------------------------------------------

  /** Still in the air and still a target: not going down, and not gone home. */
  private up(a: Aircraft): boolean {
    return a.huntable && this.aircraft.includes(a);
  }

  private hunting(e: EnemyInstance): boolean {
    return this.hunts.some(h => h.enemy === e);
  }

  /** The aircraft this man could lock: the one the player is in if it is in reach, or the nearest. */
  private targetFor(e: EnemyInstance): Aircraft | null {
    let best: Aircraft | null = null;
    let bestD: number = ANTI_AIR.range;
    for (const a of this.aircraft) {
      if (!a.huntable) continue;
      const d = a.position.distanceTo(e.center);
      if (d > ANTI_AIR.range) continue;
      if (a.flown) return a;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** One man, picked at random from everyone who can reach an aircraft. */
  private pick(): void {
    let chosen: EnemyInstance | null = null;
    let target: Aircraft | null = null;
    let seen = 0;
    for (const e of this.ctx.enemies.alive) {
      if (!e.alive || !HUNTERS.has(e.id) || this.prisoners.has(e.uid) || this.hunting(e)) continue;
      const a = this.targetFor(e);
      if (!a) continue;
      // Reservoir: each candidate ends up the pick with the same chance, without a list.
      if (Math.random() * ++seen < 1) {
        chosen = e;
        target = a;
      }
    }
    if (chosen && target) this.start(chosen, target, false);
  }

  /** A boss hit by an aircraft turns on that aircraft, if it is not resting from its last missile. */
  private pounded(e: EnemyInstance, source: string): void {
    if (!e.isBoss || !e.alive || !HUNTERS.has(e.id) || this.hunts.length >= ANTI_AIR.maxHunters || this.hunting(e)) return;
    if (this.now < (this.bossFree.get(e.uid) ?? 0)) return;
    const a = this.aircraft.find(x => x.huntable && source.startsWith(x.sources));
    if (a) this.start(e, a, true);
  }

  private start(enemy: EnemyInstance, target: Aircraft, boss: boolean): void {
    const lock = boss ? ANTI_AIR.bossLock : ANTI_AIR.lock;
    this.hunts.push({ enemy, target, boss, lock, lockFor: lock, beepIn: 0, missile: null });
  }

  private end(h: Hunt): void {
    this.hunts.splice(this.hunts.indexOf(h), 1);
    if (h.boss) this.bossFree.set(h.enemy.uid, this.now + ANTI_AIR.bossRest);
    else this.rest = rand(ANTI_AIR.rest[0], ANTI_AIR.rest[1]);
  }

  private hunt(h: Hunt, dt: number): void {
    if (h.missile) {
      this.fly(h, h.missile, dt);
      return;
    }
    const { enemy, target } = h;
    if (!enemy.alive || !this.up(target) || target.position.distanceTo(enemy.center) > ANTI_AIR.range * 1.2) {
      this.end(h);
      return;
    }
    h.lock -= dt;
    if (target.flown) {
      h.beepIn -= dt;
      if (h.beepIn <= 0) {
        h.beepIn = lerp(ANTI_AIR.beep[0], ANTI_AIR.beep[1], 1 - h.lock / h.lockFor);
        this.ctx.audio.play('aa_lock');
      }
    }
    if (h.lock <= 0) this.launch(h);
  }

  private launch(h: Hunt): void {
    const { audio, fx, render } = this.ctx;
    const { enemy, target } = h;
    const body = new THREE.Object3D();
    body.position.copy(enemy.center).setY(enemy.center.y + (enemy.isBoss ? 2 : 0.9));
    render.scene.add(body);
    // Off the rail steeply up and leaning toward the aircraft, so the climb reads before the turn.
    _dir.subVectors(target.position, body.position).setY(0).normalize().add(_to.set(0, 1.6, 0)).normalize();
    const auto = target.autoFlares;
    const late = chance(ANTI_AIR.late);
    const range = late ? ANTI_AIR.lateAt : ANTI_AIR.react;
    h.missile = {
      body, velocity: _dir.clone().multiplyScalar(M.boost), target, decoy: null, age: 0, smokeIn: 0,
      reactAt: auto ? rand(range[0], range[1]) : -1, reacted: false,
    };
    fx.attachEmitter(body, 'airstrikeTrail');
    fx.muzzleFlash(body.position, _dir, 'rocket');
    fx.smoke(body.position, 0xb8bcc0, 2.2, 2.5);
    audio.play('enemy_rocket_fire', { position: body.position, volume: 1 });
    if (target.flown) audio.play('aa_launch');
  }

  // --- Missiles -----------------------------------------------------------------------------------------------------

  private fly(h: Hunt, m: Missile, dt: number): void {
    const { body, velocity } = m;
    const p = body.position;
    m.age += dt;
    if (m.target && !this.up(m.target)) {
      this.burst(h, m);
      return;
    }
    const aim = m.decoy?.position ?? m.target?.position;
    if (!aim || m.age >= M.life || (m.decoy && m.decoy.life <= 0)) {
      this.burst(h, m);
      return;
    }
    // Turn the nose toward the aim, no faster than `turn`, then fly at the speed it has built up.
    const speed = Math.min(M.speed, M.boost + M.accel * m.age);
    _dir.copy(velocity).normalize();
    _to.subVectors(aim, p).normalize();
    const angle = _dir.angleTo(_to);
    if (angle > 1e-4) _dir.lerp(_to, Math.min(1, (M.turn * dt) / angle)).normalize();
    velocity.copy(_dir).multiplyScalar(speed);
    p.addScaledVector(velocity, dt);
    this.sky.flash(p, 0.8, 0.14, 9, 18, 11, 5);
    // A thick trail of its own over the emitter's: from the gunship's sensor 200 m up, the emitter's alone is a thread.
    m.smokeIn -= dt;
    if (m.smokeIn <= 0) {
      m.smokeIn = 0.05;
      this.ctx.fx.smoke(p, 0xdfe2e4, 1.6, 3.2);
    }

    const left = p.distanceTo(aim);
    if (m.decoy) {
      if (left <= D.catch) this.burst(h, m);
      return;
    }
    const target = m.target!;
    if (left <= M.reach) {
      this.burst(h, m);
      if (target.flown) this.ctx.camera.addTrauma(0.5);
      target.hit();
      return;
    }
    if (!m.reacted && left <= m.reactAt && m.age >= ANTI_AIR.spot && target.autoFlares) {
      m.reacted = true;
      target.popFlares();
    }
  }

  private burst(h: Hunt, m: Missile): void {
    const { audio, fx, render } = this.ctx;
    const p = m.body.position;
    fx.explosion(p, { radius: 3, kind: 'rocket', scale: 0.9 });
    fx.smoke(p, 0x3a3c40, 3, 3);
    audio.play('rocket_explosion', { position: p, volume: 0.9 });
    // The trail's emitter stops itself once its body has left the scene.
    render.scene.remove(m.body);
    h.missile = null;
    this.end(h);
  }

  // --- Flares -------------------------------------------------------------------------------------------------------

  /** Flares are noticed by the count going down, so the seat, the pilot and the crew all throw them the same way. */
  private watchFlares(): void {
    for (const a of this.aircraft) {
      const was = this.seen.get(a);
      if (was !== undefined && a.flares < was) this.flared(a);
      this.seen.set(a, a.flares);
    }
    for (const a of this.seen.keys()) if (!this.aircraft.includes(a)) this.seen.delete(a);
  }

  /** Decoys out of `a`, drawn unless it draws its own, and every missile on it still far enough out turns onto one. */
  flared(a: Aircraft): void {
    const fresh: Decoy[] = [];
    for (let i = 0; i < D.count; i++) {
      const velocity = randomUnit(new THREE.Vector3()).setY(0).normalize().multiplyScalar(D.speed * rand(0.6, 1.1));
      velocity.y = -rand(3, 9);
      const decoy = { position: a.position.clone().setY(a.position.y - D.under), velocity, life: D.life * rand(0.85, 1.1) };
      fresh.push(decoy);
      this.decoys.push(decoy);
      if (!a.drawsFlares) this.sky.flare(decoy.position, velocity, decoy.life);
    }
    for (const h of this.hunts) {
      const m = h.missile;
      if (!m || m.target !== a || m.decoy || m.body.position.distanceTo(a.position) <= D.least) continue;
      m.decoy = pick(fresh);
      m.target = null;
    }
  }

  private moveDecoys(dt: number): void {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i]!;
      d.life -= dt;
      d.velocity.multiplyScalar(Math.exp(-D.drag * dt));
      d.velocity.y -= D.gravity * dt;
      d.position.addScaledVector(d.velocity, dt);
      if (d.life <= 0) this.decoys.splice(i, 1);
    }
  }

  // --- Bullets ------------------------------------------------------------------------------------------------------

  private bullets(dt: number): void {
    this.bulletsIn -= dt;
    if (this.bulletsIn > 0) return;
    const B = ANTI_AIR.bullets;
    this.bulletsIn = B.every;
    for (const a of this.aircraft) {
      if (a.rounds <= 0 || !a.huntable) continue;
      for (const e of this.ctx.enemies.alive) {
        if (!e.alive || !SHOOTERS.has(e.id) || this.prisoners.has(e.uid)) continue;
        const d = e.center.distanceTo(a.position);
        const sniper = e.id === 'sniper';
        const reach = sniper ? B.sniperReach : B.reach;
        if (d > reach) continue;
        const odds = sniper ? B.sniperChance : B.chance * (1 - d / reach);
        const roll = Math.random();
        if (roll >= B.shown) continue;
        const lands = roll < odds;
        _at.copy(a.position);
        if (!lands) _at.addScaledVector(randomUnit(_to), rand(3, 9));
        this.ctx.fx.tracer(e.center, _at, 'enemy');
        if (lands && a.shot()) break;
      }
    }
  }

  // --- Enemy choppers -----------------------------------------------------------------------------------------------

  private pickFriend(): void {
    let best: Aircraft | null = null;
    for (const a of this.aircraft) {
      if (!a.struck || a.hits <= 0) continue;
      if (!best || a.flown) best = a;
    }
    if (best) this.friendly.position.copy(best.position);
    if (best === this.friend) return;
    // The stand-in is handed over once: the chopper reads its position every frame, and that is copied above.
    if (!best || !this.friend) this.ctx.enemies.vehicles?.setFriendly(best ? this.friendly : null);
    this.friend = best;
  }

  clear(): void {
    for (const h of this.hunts) if (h.missile) this.ctx.render.scene.remove(h.missile.body);
    this.hunts.length = 0;
    this.decoys.length = 0;
    this.seen.clear();
    this.bossFree.clear();
    this.rest = ANTI_AIR.firstRest;
    this.sky.clear();
    if (this.friend) this.ctx.enemies.vehicles?.setFriendly(null);
    this.friend = null;
  }
}
