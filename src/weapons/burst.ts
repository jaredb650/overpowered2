/**
 * A small cannon round going off where it lands: the 20 mm of the rotary gun on key 8 and of the helicopter's door gun.
 *
 * It is not `Combat.explode`, and must not become it. A blast queries and rolls every body in reach on the blast table,
 * throws every ragdoll and chunk near it, checks the player, the map's explosives and the projectiles in the air, and
 * punches the camera. Twenty-five of those a second would be the autocannon held down. A burst is the look and the sound
 * (`fx.burst`, `cannon_burst`), a nudge of shake for one that lands close, and fragments: a small bullet hit, with no
 * sound or marker of its own, on any body inside `radius` of it other than the one the round struck. Fragments are
 * bullets to everything that reads a hit, so a body answers them as it answers any light round and nothing here reaches
 * into how bodies fall.
 *
 * Nothing is built per burst: the particles are the fx rings, the sound is a pooled voice and the scratch below is reused.
 */
import * as THREE from 'three';
import { CG, type Ctx, type PlayOptions } from '../core/contracts';
import type { BurstSpec, EnemyInstance } from '../core/gameplay';
import { clamp } from '../core/math';
import type { Combat } from './Combat';
import { TUNING } from './data';
import { closestOnSegment } from './geometry';

/** `?burst=0`: no round bursts, on foot or from the door gun. They land as plain heavy bullets. */
export const BURST_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('burst') !== '0';

/** How far a body's skin stands off the line from its feet to its head, so a burst is measured to the man and not his spine. */
const SKIN = 0.25;
/** A fragment at the edge of the burst does this share of one at its centre. */
const EDGE = 0.5;
/** How far off the surface the burst is taken to be, so its line of sight does not start inside the wall. */
const STANDOFF = 0.05;

export class Bursts {
  /** Counted since the last `reset`, for tests and the cost check. */
  readonly stats = { bursts: 0, fragments: 0 };

  private busy = false;
  private readonly list: EnemyInstance[] = [];
  private readonly center = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly near = new THREE.Vector3();
  private readonly way = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly sound: PlayOptions = { position: undefined, volume: 1, pitch: 1, pitchJitter: 0.1 };

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {}

  reset(): void {
    this.stats.bursts = this.stats.fragments = 0;
    this.busy = false;
  }

  /**
   * One round going off at `point` on a surface facing `normal`. `struck` is the body the round itself hit there, which has
   * had the round and gets no fragments, or null for a wall.
   */
  at(point: THREE.Vector3, normal: THREE.Vector3, burst: BurstSpec, source: string, struck: EnemyInstance | null): void {
    const c = this.ctx;
    const scale = burst.scale ?? 1;
    this.stats.bursts++;
    c.fx.burst?.(point, normal, scale);

    const s = this.sound;
    s.position = point;
    // A bigger round is a touch louder and lower.
    s.volume = 0.8 + 0.2 * scale;
    s.pitch = 1 / Math.sqrt(scale);
    c.audio.play('cannon_burst', s);

    const t = TUNING.burst;
    const eye = c.player.parked ? Infinity : c.player.eye.distanceTo(point);
    const close = clamp(1 - eye / t.shakeRange);
    if (close > 0) this.combat.feel.shake(t.shake * scale * close * close);

    // A fragment that kills can set off anything a kill sets off. Whatever that fires bursts for the eye and the ear only.
    if (this.busy || burst.damage <= 0) return;
    this.busy = true;
    try {
      this.fragments(point, normal, burst, source, struck);
    } finally {
      this.busy = false;
    }
  }

  private fragments(point: THREE.Vector3, normal: THREE.Vector3, burst: BurstSpec, source: string, struck: EnemyInstance | null): void {
    const c = this.ctx;
    const radius = burst.radius;
    const center = this.center.copy(point).addScaledVector(normal, STANDOFF);
    const list = this.list;
    // `query` measures to the chest, which can be a body's height from the burst at its feet.
    const n = c.enemies.query(center, radius + 2.5, list) || 0;
    for (let i = 0; i < n; i++) {
      const e = list[i]!;
      if (e === struck || !e.alive) continue;
      const foot = this.foot.copy(e.position);
      const head = this.head.copy(e.position);
      head.y += e.char.rig.height;
      const near = closestOnSegment(center, foot, head, this.near);
      const way = this.way.subVectors(near, center);
      const span = way.length();
      const dist = Math.max(0, span - SKIN);
      if (dist > radius) continue;
      if (span > 0.05) {
        way.divideScalar(span);
        // Cover between the burst and the body stops a fragment, as it stops a blast.
        const wall = c.physics.raycast(center, way, span, CG.World);
        if (wall && wall.distance < span - SKIN) continue;
      } else {
        way.copy(normal).negate();
      }
      const o = this.combat.strikeOptions('bullet', source);
      o.force = TUNING.burst.force;
      o.severMult = 1;
      o.quiet = true;
      const amount = burst.damage * (1 - (dist / radius) * (1 - EDGE));
      const res = this.combat.strike(e, near, this.back.copy(way).negate(), way, undefined, undefined, amount, o);
      this.stats.fragments++;
      if (res.blocked) continue;
      if (e.machine) c.fx.sparks(near, way, 4);
      else c.fx.bloodHit(near, way, 0.5);
    }
    list.length = 0;
  }
}
