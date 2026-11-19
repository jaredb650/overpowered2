/**
 * Explosions on other screens. Every explosion a game makes goes out as `boom` (a guest's through the host), capped per second,
 * and is drawn and heard elsewhere without damage. The host also works out what an enemy's blast does to each remote player
 * (`hurt`, targeting.ts), and applies a guest's blast to vehicles, which live only on the host.
 */
import * as THREE from 'three';
import type { ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { EXPLOSIONS } from '../../weapons/data';
import type { WorldContext } from './context';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

/** An explosion someone else's game made: drawn and heard here, never damaging (the host already counted it). */
export type BoomEvent = { t: 'boom'; at: Vec; kind: string; radius: number; slot?: number; damage?: number; source?: string };

/** Explosions mirrored to other screens per second, at most: an AC-130 or a rotary of explosive rounds stays affordable. */
const BOOMS_PER_SECOND = 24;

export class Booms {
  private booms = 0;
  private boomSecond = 0;

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    w.router.both('boom', (value, from) => this.boomIn(value, from));
  }

  /** The local game made an explosion (Combat.explode). */
  blast(center: THREE.Vector3, spec: ExplosionSpec): void {
    const { session } = this.w;
    // Every explosion this game makes is drawn on the others': the host's for everyone, a guest's through the host.
    if (!spec.worldObject && this.w.ready && this.spend()) {
      this.w.send({ t: 'boom', at: center.toArray() as Vec, kind: spec.kind, radius: spec.radius, slot: session.lobby.me?.slot,
        ...(spec.team === 'player' && !session.hosting ? { damage: spec.damage, source: spec.source } : {}) });
    }
    if (!session.hosting || spec.team !== 'enemy') return;
    const def = EXPLOSIONS[spec.kind];
    for (const target of this.targeting.players()) {
      if (target.id === session.lobby.you || !target.player.alive) continue;
      const distance = target.player.eye.distanceTo(center);
      if (distance > spec.radius || (!def.ignoresCover && !this.w.visible(center.toArray() as Vec, target.player.eye.toArray() as Vec))) continue;
      this.targeting.hurt(target.id, { amount: spec.damage * (1 - distance / spec.radius * (1 - def.edgeDamage)), from: center, type: 'explosive', source: spec.source });
    }
  }

  /** Someone else's explosion, drawn and heard here. It hurts nobody: whatever it did, the host has already counted. */
  private boomIn(value: BoomEvent, from: string): void {
    const { ctx, session } = this.w;
    if (!validVec(value.at) || !Object.hasOwn(EXPLOSIONS, value.kind) || !Number.isFinite(value.radius) || value.radius <= 0 || value.radius > 60) return;
    if (session.hosting) {
      if (!this.spend()) return;
      const slot = session.lobby.players.find(p => p.id === from)?.slot;
      this.w.relay({ ...value, slot }, from);
    }
    const at = new THREE.Vector3(...value.at);
    const kind = value.kind as ExplosionKind;
    // A guest's rocket on a truck: vehicles live only on the host, so its blast is applied to them here.
    if (session.hosting && Number.isFinite(value.damage) && value.damage! > 0 && typeof value.source === 'string') {
      ctx.enemies.vehicles?.blast(at, { radius: value.radius, damage: Math.min(3000, value.damage!), kind, source: value.source.slice(0, 32), team: 'player' });
    }
    ctx.fx.explosion(at, { radius: value.radius, kind });
    for (const sound of EXPLOSIONS[kind as keyof typeof EXPLOSIONS].sounds) ctx.audio.play(sound.id, { ...sound, position: at });
    const near = ctx.player.eye.distanceTo(at);
    if (near < value.radius * 4) ctx.camera.addTrauma(0.35 * (1 - near / (value.radius * 4)));
  }

  private spend(): boolean {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.boomSecond) { this.boomSecond = second; this.booms = 0; }
    return ++this.booms <= BOOMS_PER_SECOND;
  }
}
