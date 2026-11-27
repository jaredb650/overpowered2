/**
 * Smoke, thrown to take the high ground away. Real in both directions: the player cannot see through it, and neither can a soldier,
 * which `perception.ts` asks here. Sonar sees through it, which is the counterplay and the one thing about this that favours the player.
 */
import * as THREE from 'three';
import { rand, TAU } from '../../core/math';
import type { Commander } from './index';

const MAX_CLOUDS = 3;
const SECONDS = 13;
const RADIUS = 6;
/** Seconds between new puffs. A cloud is a slow leak, not one big ball. */
const EMIT_EVERY = 0.18;
const COLOR = 0xa8b0b6;
const GRAVITY = 22;
/** Metres up from which the player counts as on the high ground. */
const HIGH = 3;
/** Seconds up there before a canister comes over. */
const HIGH_FOR = 2.5;
const THROW_REST = 16;
const THROW_REACH = 32;

const _a = new THREE.Vector3();
const _v = new THREE.Vector3();

interface Cloud {
  until: number;
  emitAt: number;
  readonly at: THREE.Vector3;
}

/**
 * Co-op (net/world/villainProps.ts): a cloud is the host's fact, because the host's soldiers cannot see through it. The host reports each
 * one (`popped`) and a guest draws it (`pop`); the canister is thrown at any player on the high ground (`heads`).
 */
export interface SmokeLink {
  readonly guest: boolean;
  popped(at: THREE.Vector3): void;
  /** Host: the feet of every living player. */
  feet(): readonly THREE.Vector3[];
}

export class Smoke {
  /** Co-op: set by net/world/villainProps.ts. Null alone. */
  link: SmokeLink | null = null;
  /** The player the next canister is for: the one up high. */
  private readonly mark = new THREE.Vector3();
  private readonly clouds: Cloud[] = Array.from({ length: MAX_CLOUDS }, () => ({ until: 0, emitAt: 0, at: new THREE.Vector3() }));
  private next = 0;
  private highFor = 0;
  private restUntil = 0;
  private pendingAt = -1;
  private readonly pending = new THREE.Vector3();

  constructor(private readonly c: Commander) {}

  reset(): void {
    for (const k of this.clouds) k.until = 0;
    this.highFor = this.restUntil = 0;
    this.pendingAt = -1;
  }

  pop(at: THREE.Vector3): void {
    const { now, ctx } = this.c.w;
    const k = this.clouds[this.next]!;
    this.next = (this.next + 1) % MAX_CLOUDS;
    k.at.copy(at);
    k.until = now + SECONDS;
    k.emitAt = 0;
    ctx.audio.play('steam_burst', { position: at, volume: 0.9 });
    this.link?.popped(at);
  }

  /** The clouds still up, with their seconds left, for a player who has just arrived. */
  get standing(): { at: THREE.Vector3; left: number }[] {
    const now = this.c.w.now;
    return this.clouds.filter(k => now < k.until).map(k => ({ at: k.at, left: k.until - now }));
  }

  /** Co-op guest: one of the host's clouds, with `left` seconds to run. */
  show(at: THREE.Vector3, left: number): void {
    const now = this.c.w.now;
    // Told twice of one cloud (a catch-up can arrive by two routes): it is still one cloud.
    if (this.clouds.some(c => now < c.until && c.at.distanceToSquared(at) < 0.25)) return;
    const k = this.clouds[this.next]!;
    this.next = (this.next + 1) % MAX_CLOUDS;
    k.at.copy(at);
    k.until = this.c.w.now + Math.min(SECONDS, left);
    k.emitAt = 0;
    if (left >= SECONDS - 0.5) this.c.w.ctx.audio.play('steam_burst', { position: at, volume: 0.9 });
  }

  update(dt: number): void {
    const { c } = this;
    const { w } = c;
    const now = w.now;
    if (this.pendingAt >= 0 && now >= this.pendingAt) {
      this.pendingAt = -1;
      this.pop(this.pending);
    }
    for (const k of this.clouds) {
      if (now >= k.until || now < k.emitAt) continue;
      k.emitAt = now + EMIT_EVERY;
      const a = rand(0, TAU);
      const r = rand(0, RADIUS * 0.8);
      _a.set(k.at.x + Math.sin(a) * r, k.at.y + rand(0.3, 2.6), k.at.z + Math.cos(a) * r);
      w.ctx.fx.smoke(_a, COLOR, rand(3, 4.5), 3.4);
    }
    // Co-op guest: the clouds are drawn; who throws the next canister is the host's business.
    if (this.link?.guest || !c.has('smoke')) return;
    // Co-op host: any player up high draws the canister.
    this.mark.copy(w.player.position);
    if (this.link) for (const p of this.link.feet()) if (p.y > this.mark.y) this.mark.copy(p);
    this.highFor = this.mark.y > HIGH ? this.highFor + dt : 0;
    if (this.highFor >= HIGH_FOR && now >= this.restUntil) this.throwAtPlayer(now);
  }

  /** The nearest man who can throw that far lobs it at the foot of the deck. */
  private throwAtPlayer(now: number): void {
    const { o, w } = this.c;
    let best = null as (typeof o.soldiers)[number] | null;
    let bestD2 = THROW_REACH * THROW_REACH;
    for (const s of o.soldiers) {
      if (!s.fighting || s.e.maim.arms === 0) continue;
      const d2 = s.e.position.distanceToSquared(this.mark);
      if (d2 >= bestD2) continue;
      best = s;
      bestD2 = d2;
    }
    if (!best) return;
    this.restUntil = now + THROW_REST;
    const e = best.e;
    _a.copy(this.mark);
    if (!w.ctx.world.nav.nearest(_a, 8, _a)) return;
    const flight = Math.min(1.5, Math.max(0.6, e.position.distanceTo(_a) / 14));
    _v.set((_a.x - e.center.x) / flight, (_a.y - e.center.y) / flight + 0.5 * GRAVITY * flight, (_a.z - e.center.z) / flight);
    w.ctx.combat.spawnProjectile({
      origin: e.center, velocity: _v, kind: 'grenade', team: 'enemy', damage: 0, source: 'smoke', gravity: -GRAVITY, fuse: flight + 0.4, lifetime: flight + 1.4, trail: 'none',
      explosion: { radius: 0.4, damage: 0, kind: 'grenade', scale: 0.2 },
    });
    w.ctx.audio.play('grenade_throw', { position: e.center, volume: 0.7 });
    e.char.anim.play('throw', 0.9);
    this.pendingAt = now + flight + 0.4;
    this.pending.copy(_a);
    this.c.radio('radio.smoke.out', best);
  }

  /** True when a cloud lies across this line. Three cylinders at most, so this is cheap enough to ask for every man. */
  blocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const now = this.c.w.now;
    const r2 = RADIUS * RADIUS;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    for (const k of this.clouds) {
      if (now >= k.until) continue;
      const yMin = k.at.y - 1;
      const yMax = k.at.y + 6.5;
      const fx = a.x - k.at.x, fz = a.z - k.at.z;
      if (len2 <= 1e-8) {
        if (fx * fx + fz * fz < r2 && Math.max(a.y, b.y) >= yMin && Math.min(a.y, b.y) <= yMax) return true;
        continue;
      }
      const B = fx * dx + fz * dz;
      const C = fx * fx + fz * fz - r2;
      const disc = B * B - len2 * C;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-B - sq) / len2);
      const t1 = Math.min(1, (-B + sq) / len2);
      if (t0 >= t1) continue;
      const y0 = a.y + dy * t0;
      const y1 = a.y + dy * t1;
      if (Math.max(y0, y1) >= yMin && Math.min(y0, y1) <= yMax) return true;
    }
    return false;
  }
}
