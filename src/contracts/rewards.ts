/**
 * Back shots (DESIGN 14.4). The enemy rules say when a hit came from behind, by 'enemy:backshot', and this pays the
 * difference as a second hit on the same spot, so armour, limb pools and the kill all run through the damage model as
 * usual. Only contracts with a multiplier listen, so the swarm game pays nothing for it.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, DamageType } from '../core/contracts';
import type { DamageResult, EnemyInstance } from '../core/gameplay';
import { WEAPONS } from '../weapons/data';

/** Seconds between labels, because an SMG in someone's back would otherwise paint them twenty a second. */
const LABEL_GAP = 1;
const LABEL_COLOR = '#ffd400';
/** The event covers anything that lands from behind. A blast or a burn has no back to speak of. */
const DIRECT: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'pellet', 'melee', 'slash']);

/** Sword moves carry their own source names. A call-in or an enemy's stray round earns nothing here. */
export const isPlayerWeapon = (source: string): boolean => source in WEAPONS || source.startsWith('sword');

export class BackShots {
  private readonly extra: DamageInfo = {
    amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '',
  };
  private labelAt = -Infinity;

  constructor(private readonly ctx: Ctx, private readonly multiplier: number) {
    ctx.events.on('enemy:backshot', e => this.pay(e.enemy, e.damage, e.result));
  }

  private pay(enemy: EnemyInstance, d: DamageInfo, result: DamageResult): void {
    // A head hit has its own multiplier, and paying that twice would pay its score twice as well.
    if (d === this.extra || result.blocked || result.headshot || !enemy.alive) return;
    if (!DIRECT.has(d.type) || !isPlayerWeapon(d.source)) return;
    const { enemies, hud, time } = this.ctx;
    Object.assign(this.extra, d);
    this.extra.amount = d.amount * (this.multiplier - 1);
    // The caller is still holding this result, and its kill feedback should fire if the bonus finished the job.
    if (enemies.applyDamage(enemy, this.extra).killed) result.killed = true;
    if (time.realElapsed - this.labelAt >= LABEL_GAP) {
      this.labelAt = time.realElapsed;
      hud.floatText(enemy.center, 'BACK SHOT', LABEL_COLOR);
    }
  }
}
