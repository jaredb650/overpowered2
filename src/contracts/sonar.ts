/**
 * Sonar ping, key T (DESIGN 14.5). The left hand taps the helmet, and on contact a ring goes out and every enemy shows
 * through walls as it is reached. It costs nothing, so its whole job is that no round is ever held up by a lost straggler.
 *
 * Runs on the player's clock: it is the player's own kit, so SLOWMO does not stretch it and a hit-stop does.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { SonarState } from '../core/gameplay';
import { SONAR } from './data';

const _size = new THREE.Vector3();

export function sonarCooldown(remaining: number): number {
  return remaining <= SONAR.lastEnemies ? SONAR.lastCooldown : SONAR.cooldown;
}

export class Sonar implements SonarState {
  live = 0;
  limit: number = SONAR.cooldown;
  /** Seconds since the key last started a ping. */
  private since = Infinity;
  /** Seconds left of the hand reaching the helmet. */
  private lead = 0;
  /** Metres per second of this ping's ring. */
  private speed = 1;
  private readonly origin = new THREE.Vector3();
  private readonly lit: THREE.Object3D[] = [];

  constructor(private readonly ctx: Ctx) {}

  get wait(): number {
    return Math.max(0, this.limit - this.since);
  }

  update(): void {
    const { enemies, input, time } = this.ctx;
    const dt = time.playerDt;
    this.since += dt;
    this.limit = sonarCooldown(enemies.remaining);
    if (input.pressed('sonar')) this.press();
    if (this.lead > 0) {
      this.lead -= dt;
      if (this.lead <= 0) this.ping();
    }
    if (this.live > 0) {
      this.live -= dt;
      this.reveal();
    }
  }

  private press(): void {
    const { audio, events, player } = this.ctx;
    if (!player.alive) return;
    if (this.wait > 0) {
      audio.play('ui_error');
      return;
    }
    this.since = 0;
    this.lead = SONAR.tapLead;
    events.emit('sonar:tap', {});
  }

  private ping(): void {
    const { audio, events, player, render, world } = this.ctx;
    this.origin.copy(player.eye);
    this.live = SONAR.reveal;
    world.bounds.getSize(_size);
    const reach = Math.hypot(_size.x, _size.z) * SONAR.sweepShare;
    this.speed = reach / SONAR.sweepSeconds;
    audio.play('sonar_ping', { unaffectedByTime: true });
    render.sweep(this.origin, SONAR.ringColor, this.speed, reach);
    events.emit('sonar:ping', { origin: this.origin });
  }

  private reveal(): void {
    const { enemies, render } = this.ctx;
    const reached = (SONAR.reveal - this.live) * this.speed;
    const reach2 = reached * reached;
    const { lit } = this;
    lit.length = 0;
    for (const e of enemies.alive) {
      if (e.position.distanceToSquared(this.origin) <= reach2) lit.push(e.char.mesh);
    }
    render.highlight(lit, SONAR.enemyColor, Math.min(1, this.live / SONAR.fade));
  }

  reset(): void {
    this.since = Infinity;
    this.lead = 0;
    this.live = 0;
  }
}
