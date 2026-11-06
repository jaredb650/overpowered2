/** Numbers for whatever is under the crosshair, and for the last body thrown. DOM text, refreshed a few times a second. */
import * as THREE from 'three';
import type { GoreRegion } from '../characters/rig';
import type { Ctx, DamageType } from '../core/contracts';
import { DEFAULT_FORCE } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { Enemy } from '../enemies/Enemy';
import { rigInfo } from '../gore/rigInfo';

const REFRESH = 0.1;
const REACH = 120;
/** A body has finished being thrown after this long, however it lies. */
const WATCH_SECONDS = 6;

interface LastHit {
  enemy: Enemy;
  region: string;
  amount: number;
  type: DamageType;
  force: number;
  blocked: boolean;
  severed: string;
}

/** A body thrown by a kill, followed by its hips. */
export interface Throw {
  name: string;
  source: string;
  force: number;
  gibbed: boolean;
  distance: number;
  peakSpeed: number;
  peakHeight: number;
  seconds: number;
}

const _v = new THREE.Vector3();

export class AimOverlay {
  readonly el = document.createElement('pre');
  /** The body last killed, or null before the first kill. */
  lastThrow: Throw | null = null;
  private clock = 0;
  private last: LastHit | null = null;
  private char: Enemy['char'] | null = null;
  private readonly from = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private floor = 0;
  /** No speed can be read until there is a first position to measure from. */
  private fresh = false;

  constructor(private readonly ctx: Ctx) {
    this.el.className = 'lab-aim';
    document.body.appendChild(this.el);
    ctx.events.on('enemy:hit', e => {
      const d = e.damage;
      this.last = {
        enemy: e.enemy as Enemy,
        region: d.region ?? 'body',
        amount: e.result.dealt,
        type: d.type,
        force: (d.force || DEFAULT_FORCE[d.type]) * DevFlags.force,
        blocked: e.result.blocked,
        severed: e.result.severed.join(' '),
      };
    });
    ctx.events.on('enemy:killed', e => {
      const char = e.enemy.char;
      this.char = e.gibbed || e.sliced ? null : char;
      this.from.copy(e.enemy.position);
      this.fresh = true;
      this.floor = e.enemy.position.y;
      this.lastThrow = {
        name: (e.enemy as Enemy).def.name, source: e.damage.source, force: (e.damage.force || DEFAULT_FORCE[e.damage.type]) * DevFlags.force,
        gibbed: e.gibbed, distance: 0, peakSpeed: 0, peakHeight: 0, seconds: 0,
      };
    });
  }

  /** Follows the hips every frame, because a peak speed cannot be read at a few samples a second. */
  private follow(): void {
    const t = this.lastThrow;
    const char = this.char;
    const dt = this.ctx.time.dt;
    if (!t || !char || dt <= 0) return;
    t.seconds += dt;
    if (t.seconds > WATCH_SECONDS) {
      this.char = null;
      return;
    }
    _v.setFromMatrixPosition(char.bones[0]!.matrixWorld);
    t.distance = Math.max(t.distance, Math.hypot(_v.x - this.from.x, _v.z - this.from.z));
    t.peakHeight = Math.max(t.peakHeight, _v.y - this.floor);
    if (!this.fresh) t.peakSpeed = Math.max(t.peakSpeed, _v.distanceTo(this.prev) / dt);
    this.fresh = false;
    this.prev.copy(_v);
  }

  update(on: boolean): void {
    this.follow();
    this.el.style.display = on ? 'block' : 'none';
    if (!on) return;
    this.clock -= this.ctx.time.realDt;
    if (this.clock > 0) return;
    this.clock = REFRESH;
    this.el.textContent = this.text();
  }

  private text(): string {
    const { enemies, gore, player } = this.ctx;
    const lines: string[] = [];
    const hit = enemies.raycast(player.eye, player.forward, REACH);
    if (hit) {
      lines.push(...describe(hit.enemy as Enemy, hit.region));
      const last = this.last;
      if (last?.enemy === hit.enemy) lines.push(this.hitLine(last));
    } else {
      const corpse = gore.raycastCorpses(player.eye, player.forward, REACH);
      if (corpse) lines.push(`corpse  ${corpse.region}`);
      if (this.last) lines.push(this.hitLine(this.last));
    }
    const t = this.lastThrow;
    if (t) {
      lines.push(t.gibbed
        ? `kill  ${t.name} by ${t.source}: gibbed`
        : `kill  ${t.name} by ${t.source}: ${t.distance.toFixed(1)} m, peak ${t.peakSpeed.toFixed(1)} m/s, up ${t.peakHeight.toFixed(1)} m`);
    }
    return lines.join('\n');
  }

  private hitLine(h: LastHit): string {
    const mass = rigInfo(h.enemy.char.rig).mass;
    const cut = h.severed ? `  cut ${h.severed}` : '';
    const stopped = h.blocked ? ' blocked' : '';
    return `hit   ${h.region} ${h.amount.toFixed(0)} ${h.type}${stopped}  force ${h.force.toFixed(0)} N·s (${(h.force / mass).toFixed(2)} m/s)${cut}`;
  }
}

function describe(e: Enemy, region: GoreRegion): string[] {
  const limbs: string[] = [];
  for (const [r, hp] of e.limbHp) limbs.push(`${r} ${Math.max(0, hp).toFixed(0)}`);
  let plate = 0;
  for (const p of e.plates) if (p.hp > 0 && p.spec.regions.includes(region)) plate += p.hp;
  const aim = plate > 0 ? `${region} (plate ${plate.toFixed(0)})` : region;
  return [
    `${e.def.name.toUpperCase()} #${e.uid}`,
    `hp    ${e.health.toFixed(0)} / ${e.maxHealth.toFixed(0)}   armour ${e.armor.toFixed(0)}`,
    `aim   ${aim}`,
    `limbs ${limbs.join('  ')}`,
  ];
}
