/**
 * Trying allies out, dev only: URL flags, `window.__allies` for bots, and an ALLIES section on the lab's panel.
 *
 *   ?allies=6        a squad of six, posted in an arc ahead of the player's start
 *   ?foes=5          an enemy squad at the far end (needs &contract=outpost for soldiers that fight)
 *   ?breach=1        a breach marked 14 m ahead, for the riot line
 *
 * `/?map=range&contract=outpost&allies=6&foes=5` is the test fight.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import type { EnemyManager } from '../enemies/EnemyManager';
import { ALLY, ALLY_ORDER, ALLY_TYPES, type AllyType } from './data';
import type { AllySystem } from './index';

const FOE_TYPES: readonly EnemyId[] = ['trooper', 'trooper', 'brute', 'gunner', 'trooper', 'rocketeer', 'trooper', 'gunner'];
/** Metres ahead of the player the enemy squad stands. */
const FOE_DISTANCE = 32;
const BREACH_AHEAD = 14;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class AllyLab {
  constructor(private readonly ctx: Ctx, private readonly allies: AllySystem) {}

  install(): void {
    (window as unknown as { __allies: AllyLab }).__allies = this;
    const params = new URLSearchParams(location.search);
    const squad = Number(params.get('allies') ?? 0);
    const foes = Number(params.get('foes') ?? 0);
    const breach = params.get('breach') === '1';
    this.ctx.events.on('run:start', () => {
      // After every system's reset, and after the player is stood at the spawn.
      setTimeout(() => {
        if (squad > 0) this.squad(squad);
        if (foes > 0) this.foes(foes);
        if (breach) this.breachAhead();
      }, 0);
      setTimeout(() => this.panel(), 300);
    });
  }

  get system(): AllySystem {
    return this.allies;
  }

  /** Where the player is looking, on the floor. */
  private aim(out: THREE.Vector3): THREE.Vector3 {
    const { physics, player, world } = this.ctx;
    const hit = physics.raycast(player.eye, player.forward, 40, CG.World);
    if (hit) out.copy(hit.point).addScaledVector(hit.normal, 0.6);
    else out.copy(player.eye).addScaledVector(player.forward, 12);
    if (!world.nav.nearest(out, 8, out)) out.copy(player.position);
    return out;
  }

  private yaw(): number {
    const f = this.ctx.player.forward;
    return Math.atan2(f.x, f.z);
  }

  squad(count = 6): number {
    return this.allies.spawnSquad(count, this.ctx.player.position, this.yaw()).length;
  }

  spawn(type: AllyType): boolean {
    this.aim(_a);
    return this.allies.spawn(type, _a.clone(), undefined, ALLY.postRadius, this.yaw()) !== null;
  }

  /** An enemy squad `FOE_DISTANCE` ahead. On the Outpost's contract they are a real squad with a brain. */
  foes(count = 5): number {
    const { player, world } = this.ctx;
    const enemies = this.ctx.enemies as unknown as EnemyManager;
    const f = player.forward;
    const flat = Math.hypot(f.x, f.z) || 1;
    _a.set(player.position.x + (f.x / flat) * FOE_DISTANCE, player.position.y + 1, player.position.z + (f.z / flat) * FOE_DISTANCE);
    if (!world.nav.nearest(_a, 20, _a)) return 0;
    const o = enemies.outpost;
    const squad = o?.muster(count, _a) ?? null;
    let n = 0;
    for (let i = 0; i < count; i++) {
      _b.set(_a.x + ((i % 4) - 1.5) * 2.2, _a.y + 1, _a.z + Math.floor(i / 4) * 2.2);
      if (!world.nav.nearest(_b, 4, _b)) continue;
      const id = FOE_TYPES[i % FOE_TYPES.length]!;
      const e = squad && o ? o.enlistInto(squad, id, _b) : enemies.spawn(id, _b);
      if (e) n++;
    }
    return n;
  }

  breachAhead(): void {
    const { player } = this.ctx;
    const f = player.forward;
    const flat = Math.hypot(f.x, f.z) || 1;
    _a.set(player.position.x + (f.x / flat) * BREACH_AHEAD, player.position.y + 1, player.position.z + (f.z / flat) * BREACH_AHEAD);
    this.ctx.world.nav.nearest(_a, 6, _a);
    this.allies.markBreach(_a, this.yaw());
  }

  breachAtCrosshair(): void {
    this.allies.markBreach(this.aim(_a), this.yaw());
  }

  /** Puts the nearest man on the floor, to try a revive. */
  downNearest(): boolean {
    const p = this.ctx.player.position;
    let best = null as AllySystem['allies'][number] | null;
    for (const a of this.allies.allies) if (a.state === 'up' && (!best || a.body.position.distanceTo(p) < best.body.position.distanceTo(p))) best = a;
    if (!best) return false;
    this.allies.hurt(best, best.health + 1, best.body.center, this.ctx.player.forward, undefined, 'chest', 'bullet', 'lab');
    return true;
  }

  clear(): void {
    this.allies.reset();
  }

  /** An ALLIES section on the lab's panel, if the lab is up. Built here so the lab's own files are left alone. */
  private panel(): void {
    const host = document.querySelector('.lab-panel');
    if (!host || host.querySelector('.lab-allies')) return;
    const section = document.createElement('div');
    section.className = 'lab-allies';
    const h = document.createElement('h2');
    h.textContent = 'ALLIES';
    const row = (): HTMLDivElement => {
      const r = document.createElement('div');
      r.className = 'lab-row';
      section.appendChild(r);
      return r;
    };
    const button = (parent: HTMLElement, label: string, run: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      parent.appendChild(b);
    };
    section.appendChild(h);
    const top = row();
    button(top, 'Squad of 6 ahead', () => this.squad(6));
    button(top, 'Squad of 8', () => this.squad(8));
    button(top, 'Enemy squad 32 m', () => this.foes(5));
    const grid = document.createElement('div');
    grid.className = 'lab-grid';
    for (const t of ALLY_ORDER) button(grid, ALLY_TYPES[t].label.split(' ')[0]!, () => this.spawn(t));
    section.appendChild(grid);
    const more = row();
    button(more, 'Breach at crosshair', () => this.breachAtCrosshair());
    button(more, 'Down nearest', () => this.downNearest());
    button(more, 'Clear allies', () => this.clear());
    for (const type of ['mousedown', 'wheel', 'keydown'] as const) section.addEventListener(type, e => e.stopPropagation());
    host.insertBefore(section, host.querySelector('.lab-keys'));
  }
}
