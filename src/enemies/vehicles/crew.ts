/**
 * The people in the machine. They arrive with it, get out at the end of the road one at a time, and if it dies with them aboard they die
 * with it or come out burning. Everyone counted under a mission's tag ends in exactly one `unitGone`: a man who never reached the ground
 * is reported here, and one who did is the host's to report like any other.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { chance, rand } from '../../core/math';
import type { Enemy } from '../Enemy';
import { leapTo } from '../movement';
import { MAX_HOSTILE } from '../outpost/doctrine';
import type { OutpostSquad } from '../outpost/squad';
import { EXIT_GAP } from './data';
import type { VehicleSystem } from './index';

/** Share of those aboard a blast kills outright. The rest come out on fire. */
const LOST_IN_BLAST = 0.55;
const BURN_SECONDS = 7;
const LEAP_SECONDS = 0.55;
const LEAP_OUT = 2.2;

const _on = new THREE.Vector3();
const _land = new THREE.Vector3();
const _away = new THREE.Vector3();
const _hit: DamageInfo = { amount: 0, type: 'explosive', point: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0), force: 0, source: '' };

export class Crew {
  private readonly men: EnemyId[];
  private seat = 0;
  private exitIn = 0;
  private squad: OutpostSquad | null = null;

  constructor(private readonly sys: VehicleSystem, men: readonly EnemyId[], private readonly tag: string | null) {
    this.men = [...men];
  }

  get aboard(): number {
    return this.men.length - this.seat;
  }

  private next(at: THREE.Vector3): Enemy | null {
    const { manager, ctx } = this.sys;
    const id = this.men[this.seat++]!;
    const o = manager.outpost;
    if (o && !this.squad) this.squad = o.muster(this.aboard + 1, at);
    const e = o && this.squad ? o.enlistInto(this.squad, id, at) : manager.spawn(id, at);
    if (this.tag !== null) {
      if (e) ctx.campaign.enlist(e, this.tag);
      else ctx.campaign.unitGone(this.tag, false, '');
    }
    return e;
  }

  /** One man out every EXIT_GAP. `exit` writes where he leaves from and which way he goes, and he lands on `ground`. */
  dismount(dt: number, exit: (seat: number, at: THREE.Vector3, away: THREE.Vector3) => void, ground: number): void {
    if (this.aboard <= 0) return;
    this.exitIn -= dt;
    if (this.exitIn > 0) return;
    const o = this.sys.manager.outpost;
    // The same rule as the waves: they sit tight until there is room in the fight.
    if (o && !this.squad && o.hostile + this.aboard > MAX_HOSTILE) return;
    this.exitIn = EXIT_GAP;
    exit(this.seat, _on, _away);
    const e = this.next(_on);
    if (!e) return;
    _land.set(_on.x + _away.x * LEAP_OUT, ground, _on.z + _away.z * LEAP_OUT);
    e.yaw = Math.atan2(_away.x, _away.z);
    e.char.anim.play('leap');
    leapTo(e, _land, LEAP_SECONDS, 1);
  }

  /** It went up with them inside. */
  spill(at: THREE.Vector3, source: string): void {
    const { ctx, manager } = this.sys;
    while (this.aboard > 0) {
      _on.set(at.x + rand(-1.2, 1.2), at.y, at.z + rand(-1.2, 1.2));
      const dies = chance(LOST_IN_BLAST);
      const e = this.next(_on);
      if (!e) continue;
      _land.set(_on.x + rand(-5, 5), at.y, _on.z + rand(-5, 5));
      leapTo(e, _land, LEAP_SECONDS * 1.3, 2);
      if (dies) {
        _hit.amount = e.health + 1;
        _hit.point.copy(e.center);
        _hit.source = source;
        _hit.dir.set(_land.x - at.x, 2, _land.z - at.z).normalize();
        _hit.blastKind = 'barrel';
        _hit.reach = 0.35;
        ctx.enemies.applyDamage(e, _hit);
      } else {
        manager.model.ignite(e, BURN_SECONDS);
      }
    }
  }

  /** The mission is over for them: nobody gets out, and nobody is left on the books. */
  writeOff(): void {
    while (this.aboard > 0) {
      this.seat++;
      if (this.tag !== null) this.sys.ctx.campaign.unitGone(this.tag, false, '');
    }
  }
}
