/**
 * Chain Storm and Chain Reaction. Both run off a short queue instead of recursing inside the kill event: a blast
 * that kills inside `combat.explode` must not re-enter it, and the delay per link is what makes a chain read as a
 * chain and not one big bang.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../core/contracts';
import type { EnemyInstance, KillEvent } from '../core/gameplay';
import { CHAIN_REACTION, CHAIN_STORM, EFFECTS } from './data';

interface Link {
  position: THREE.Vector3;
  at: number;
  hop: number;
  live: boolean;
}

function ring(size: number): Link[] {
  const out: Link[] = [];
  for (let i = 0; i < size; i++) out.push({ position: new THREE.Vector3(), at: 0, hop: 0, live: false });
  return out;
}

const _dir = new THREE.Vector3();
const STORM_COLOR = EFFECTS.chainStorm.color;

export class ChainEffects {
  private readonly storm = ring(CHAIN_STORM.maxPending);
  private readonly blasts = ring(CHAIN_REACTION.maxPending);
  private stormNext = 0;
  private blastNext = 0;
  private clock = 0;
  /** Hop of the arc being resolved, read back when its damage kills. */
  private resolvingHop = 0;
  private readonly near: EnemyInstance[] = [];
  private readonly hit: DamageInfo = {
    amount: CHAIN_STORM.damage, type: 'shock', point: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0),
    force: 6, source: 'chain_storm',
  };

  constructor(private readonly ctx: Ctx) {}

  onKill(e: KillEvent, storm: boolean, reaction: boolean): void {
    if (storm && this.resolvingHop < CHAIN_STORM.hops) {
      const link = this.storm[this.stormNext]!;
      this.stormNext = (this.stormNext + 1) % this.storm.length;
      link.position.copy(e.enemy.center);
      link.at = this.clock + CHAIN_STORM.hopDelay;
      link.hop = this.resolvingHop + 1;
      link.live = true;
    }
    if (reaction) {
      const link = this.blasts[this.blastNext]!;
      this.blastNext = (this.blastNext + 1) % this.blasts.length;
      link.position.copy(e.enemy.center);
      link.at = this.clock + CHAIN_REACTION.delay;
      link.hop = 0;
      link.live = true;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    for (const link of this.storm) {
      if (link.live && this.clock >= link.at) {
        link.live = false;
        this.arcFrom(link);
      }
    }
    for (const link of this.blasts) {
      if (link.live && this.clock >= link.at) {
        link.live = false;
        this.ctx.combat.explode(link.position, {
          radius: CHAIN_REACTION.radius, damage: CHAIN_REACTION.damage, kind: 'barrel',
          source: 'chain_reaction', team: 'player', selfDamage: 0,
        });
      }
    }
  }

  private arcFrom(link: Link): void {
    const { audio, enemies, fx } = this.ctx;
    const from = link.position;
    const found = enemies.query(from, CHAIN_STORM.range, this.near);
    let arcs = 0;
    // Nearest first without a sort: `found` is short, and most kills only ever reach three.
    while (arcs < CHAIN_STORM.arcs) {
      let best: EnemyInstance | null = null;
      let bestD = Infinity;
      for (let i = 0; i < found; i++) {
        const e = this.near[i]!;
        if (!e.alive) continue;
        const d = e.center.distanceToSquared(from);
        if (d > 0.25 && d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) break;
      fx.arc(from, best.center, STORM_COLOR, 0.22, 0.16);
      fx.sparks(best.center, _dir.subVectors(best.center, from).normalize(), 10, STORM_COLOR);
      this.hit.point.copy(best.center);
      this.hit.dir.copy(_dir);
      this.resolvingHop = link.hop;
      const result = enemies.applyDamage(best, this.hit);
      this.resolvingHop = 0;
      // A survivor must not soak all three arcs.
      if (!result.killed) this.near[this.near.indexOf(best)] = this.near[found - 1]!;
      arcs++;
    }
    if (arcs > 0) audio.play('lightning_arc', { position: from, pitch: 1 + link.hop * 0.08 });
  }

  clear(): void {
    for (const link of this.storm) link.live = false;
    for (const link of this.blasts) link.live = false;
    this.resolvingHop = 0;
  }
}
