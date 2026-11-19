/**
 * Everything that warns of an enemy's attack, on every screen: the ground ring under a strike, a mortar, a grenade or a slam
 * (`zone`), the shell that comes down in it (`strike`), a boss's ground shock (`shock`), a flashbang (`bang`), and the muzzle
 * stars and sight lasers of things that are not an enemy's own attack (a tank laying its gun, a mortar spotter: `glint`, `laser`).
 *
 * A ring is always the host's word: it is sent from wherever the host draws one (`Telegraphs.zone`), with the host's time, and a
 * guest draws it with the seconds it has left. Stars and lasers of an attack a guest plays itself (attacks.ts) come from that
 * attack's own code on the guest; only the ones outside such an attack are sent, a laser's two ends at 10 Hz.
 *
 * None of this hurts. What a slam or a shell does to each player is the host's (`hurt`, `shove`: targeting.ts).
 */
import * as THREE from 'three';
import { CATALOG } from '../../audio/catalog';
import { shockFx } from '../../enemies/bosses';
import type { Telegraphs } from '../../enemies/telegraph';
import type { WorldContext, WorldModule } from './context';
import type { EnemyFire } from './enemyFire';
import { HostTime, hostStamp } from './hostTime';
import { validVec, type Vec } from './wire';

export type WarningEvent =
  /** A ground ring at `at`, radius `r`, landing in `s` seconds from host time `ht`; `c` its colour if not the usual red. */
  | { t: 'zone'; at: Vec; r: number; s: number; c?: number; ht: number }
  /** A star at a muzzle: colour, size, seconds. */
  | { t: 'glint'; at: Vec; c: number; sz: number; s: number }
  /** A sight laser `id` from `a` to `b` (sent at 10 Hz while it is on), or `off`. */
  | { t: 'laser'; id: number; a?: Vec; b?: Vec; c?: number; st?: number; off?: 1 }
  /** A ground shock at `at`: the ring, dust, crack and sound. */
  | { t: 'shock'; at: Vec; r: number; snd: string }
  /** A shell lands at `at`, `d` seconds from host time `ht`. */
  | { t: 'strike'; at: Vec; d: number; ht: number }
  /** A flashbang goes off at `at`, `d` seconds from host time `ht`. */
  | { t: 'bang'; at: Vec; d: number; ht: number };

const LASER_MS = 100;
/** A laser the host stopped telling us about is let go after this long. */
const LASER_STALE_MS = 1200;
const PER_SECOND = 40;

const round = (n: number): number => Math.round(n * 100) / 100;
const pack = (v: THREE.Vector3): Vec => [round(v.x), round(v.y), round(v.z)];
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

interface GuestLaser { handle: number; from: THREE.Vector3; to: THREE.Vector3; fromGoal: THREE.Vector3; toGoal: THREE.Vector3; at: number }
interface Timed { at: number; kind: 'strike' | 'bang'; position: THREE.Vector3 }

export class Warnings implements WorldModule {
  /** Guest: what has been drawn, for the browser proofs. */
  readonly seen = { zones: 0, glints: 0, lasers: 0, shocks: 0, strikes: 0, bangs: 0 };
  private readonly clock = new HostTime();
  private readonly color = new THREE.Color();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  /** Host: lasers that belong to an attack a guest plays itself, and when each other one was last sent. */
  private readonly own = new Set<number>();
  private readonly sentAt = new Map<number, number>();
  /** Guest: the host's lasers drawn here, by the host's handle. */
  private readonly lasers = new Map<number, GuestLaser>();
  private readonly timed: Timed[] = [];
  private second = 0;
  private spent = 0;

  constructor(private readonly w: WorldContext, private readonly fire: EnemyFire) {
    w.router.guest('zone', (value, _from, now) => {
      if (!validVec(value.at) || !finite(value.r, 0.1, 80) || !finite(value.s, 0, 30)) return;
      const left = value.s - this.clock.late(value.ht, now);
      if (left <= 0.02) return;
      this.seen.zones++;
      this.telegraphs?.zone(this.a.fromArray(value.at), value.r, left, finite(value.c, 0, 0xffffff) ? value.c : 0xff3010);
    });
    w.router.guest('glint', value => {
      if (!validVec(value.at) || !finite(value.c, 0, 0xffffff) || !finite(value.sz, 0.01, 20) || !finite(value.s, 0, 20)) return;
      this.seen.glints++;
      this.telegraphs?.glint(this.a.fromArray(value.at), value.c, value.sz, value.s);
    });
    w.router.guest('laser', (value, _from, now) => this.laserIn(value, now));
    w.router.guest('shock', value => {
      if (!validVec(value.at) || !finite(value.r, 0.1, 80) || typeof value.snd !== 'string' || !CATALOG.has(value.snd)) return;
      this.seen.shocks++;
      const at = this.a.fromArray(value.at);
      const p = w.ctx.player.position;
      shockFx(w.ctx, at, value.r, value.snd, Math.hypot(p.x - at.x, p.z - at.z));
    });
    w.router.guest('strike', (value, _from, now) => this.later('strike', value.at, value.d, value.ht, now));
    w.router.guest('bang', (value, _from, now) => this.later('bang', value.at, value.d, value.ht, now));
  }

  private get telegraphs(): Telegraphs | undefined { return this.w.manager.aiWorld?.telegraphs; }

  // ---------------------------------------------------------------------------------------------
  // Host
  // ---------------------------------------------------------------------------------------------

  private get sending(): boolean { return this.w.hosting && this.w.ready; }

  /** Host: a ground ring was drawn. Always sent: a ring is never a guest's own guess. */
  zone(position: THREE.Vector3, radius: number, seconds: number, color: THREE.ColorRepresentation): void {
    if (!this.sending || !this.spend()) return;
    const c = this.color.set(color).getHex();
    this.w.send({ t: 'zone', at: pack(position), r: round(radius), s: round(seconds), ...(c !== 0xff3010 ? { c } : {}), ht: hostStamp() });
  }

  /** Host: a muzzle star was drawn, outside any attack a guest plays itself. */
  glint(position: THREE.Vector3, color: THREE.ColorRepresentation, size: number, seconds: number): void {
    if (!this.sending || this.fire.scoped || !this.spend()) return;
    this.w.send({ t: 'glint', at: pack(position), c: this.color.set(color).getHex(), sz: round(size), s: round(seconds) });
  }

  /** Host: a laser was taken from the pool. One taken by an attack's own code is that attack's, on every screen. */
  laserOn(handle: number): void {
    if (!this.w.hosting || handle < 0) return;
    if (this.fire.scoped) this.own.add(handle);
    else { this.own.delete(handle); this.sentAt.set(handle, 0); }
  }

  /** Host: a laser was aimed (every frame it is on). Sent at 10 Hz if it is not an attack's own. */
  laserAim(handle: number, from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, strength: number): void {
    if (!this.sending || this.own.has(handle)) return;
    const now = performance.now();
    if (now - (this.sentAt.get(handle) ?? 0) < LASER_MS) return;
    this.sentAt.set(handle, now);
    this.w.send({ t: 'laser', id: handle, a: pack(from), b: pack(to), c: color.getHex(), st: round(strength) });
  }

  laserOff(handle: number): void {
    if (!this.w.hosting || handle < 0) return;
    if (this.own.delete(handle)) return;
    if (this.sentAt.delete(handle) && this.sending) this.w.send({ t: 'laser', id: handle, off: 1 });
  }

  /** Host: a ground shock (bosses.ts `shockwave`). */
  shock(at: THREE.Vector3, radius: number, sound: string): void {
    if (this.sending) this.w.send({ t: 'shock', at: pack(at), r: round(radius), snd: sound });
  }

  /** Host: a shell is on its way down (EnemyManager.strike). The ring is sent by `zone`; this is the shell itself. */
  strike(at: THREE.Vector3, delay: number): void {
    if (this.sending && this.spend()) this.w.send({ t: 'strike', at: pack(at), d: round(delay), ht: hostStamp() });
  }

  /** Host: a flashbang was thrown at `at` and goes off in `fuse` seconds. Each player's own eyes decide how blind they go. */
  bang(at: THREE.Vector3, fuse: number): void {
    if (this.sending) this.w.send({ t: 'bang', at: pack(at), d: round(fuse), ht: hostStamp() });
  }

  private spend(): boolean {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.second) { this.second = second; this.spent = 0; }
    return ++this.spent <= PER_SECOND;
  }

  // ---------------------------------------------------------------------------------------------
  // Guest
  // ---------------------------------------------------------------------------------------------

  private laserIn(value: Extract<WarningEvent, { t: 'laser' }>, now: number): void {
    const telegraphs = this.telegraphs;
    if (!telegraphs || !finite(value.id, 0, 64)) return;
    let laser = this.lasers.get(value.id);
    if (value.off) {
      if (laser) { telegraphs.releaseLaser(laser.handle); this.lasers.delete(value.id); }
      return;
    }
    if (!validVec(value.a) || !validVec(value.b)) return;
    const strength = finite(value.st, 0, 10) ? value.st : 0.5;
    if (!laser) {
      const handle = telegraphs.acquireLaser(finite(value.c, 0, 0xffffff) ? value.c : 0xff3020, strength);
      if (handle < 0) return;
      laser = { handle, from: new THREE.Vector3(...value.a), to: new THREE.Vector3(...value.b), fromGoal: new THREE.Vector3(), toGoal: new THREE.Vector3(), at: now };
      this.lasers.set(value.id, laser);
      this.seen.lasers++;
    } else telegraphs.setLaserStrength(laser.handle, strength);
    laser.fromGoal.fromArray(value.a);
    laser.toGoal.fromArray(value.b);
    laser.at = now;
  }

  private later(kind: Timed['kind'], at: Vec, delay: number, stamp: number, now: number): void {
    if (!validVec(at) || !finite(delay, 0, 30) || this.timed.length >= 32) return;
    const left = delay - this.clock.late(stamp, now);
    this.timed.push({ at: this.w.ctx.time.elapsed + Math.max(0, left), kind, position: new THREE.Vector3(...at) });
  }

  update(now: number): void {
    if (this.w.hosting) return;
    const { ctx } = this.w;
    const telegraphs = this.telegraphs;
    // The host's lasers glide between its 10 Hz words, and one it went quiet about is let go.
    const blend = 1 - Math.exp(-18 * ctx.time.realDt);
    for (const [id, laser] of this.lasers) {
      if (!telegraphs || now - laser.at > LASER_STALE_MS) {
        telegraphs?.releaseLaser(laser.handle);
        this.lasers.delete(id);
        continue;
      }
      laser.from.lerp(laser.fromGoal, blend);
      laser.to.lerp(laser.toGoal, blend);
      telegraphs.aimLaser(laser.handle, laser.from, laser.to);
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const timed = this.timed[i]!;
      if (ctx.time.elapsed < timed.at) continue;
      this.timed.splice(i, 1);
      if (timed.kind === 'strike') {
        this.seen.strikes++;
        ctx.fx.tracer(this.a.copy(timed.position).setY(timed.position.y + 34), timed.position, 'heavy');
      } else {
        this.seen.bangs++;
        ctx.audio.play('grenade_explode', { position: timed.position, pitch: 1.6, volume: 0.8 });
        ctx.render.lights.flash(timed.position, 0xffffff, 18, 12, 0.25);
        this.b.copy(timed.position).y += 0.6;
        this.w.manager.outpost?.suppression.flash(this.b);
      }
    }
  }

  dispose(): void {
    const telegraphs = this.telegraphs;
    for (const laser of this.lasers.values()) telegraphs?.releaseLaser(laser.handle);
    this.lasers.clear();
    this.timed.length = 0;
  }
}
