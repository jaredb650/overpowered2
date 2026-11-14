/**
 * The E key for allies. Look at a man within reach and tap: he follows you, or goes back to his post. Hold: the whole squad does.
 * Hold on a man who is down: a stim goes into him and he gets up.
 *
 * E is shared. A prisoner in reach and in view keeps it (prisoners.ts), and nothing happens while the player is parked in a seat.
 * `focusDistance` says how far the man this would address stands, for anything else that wants E to compare against.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { Ally } from './ally';
import { ALLY, ALLY_DOWN_COLOR, ALLY_TEXT } from './data';
import { OrderKey, reviveCost } from './rules';

/** The prisoners' own reach and cone, so a man on his knees in front of the player keeps the key. */
const PRISONER_REACH = 3.1;
const PRISONER_COS = 0.55;

const _a = new THREE.Vector3();

export interface OrderHost {
  readonly allies: readonly Ally[];
  readonly stims: { count: number; spend(): boolean } | null;
  toggle(a: Ally): void;
  toggleSquad(): void;
  playerRevive(a: Ally): boolean;
}

export class Orders {
  readonly key = new OrderKey();
  focus: Ally | null = null;
  private unprompt: (() => void) | null = null;
  private prompted = '';
  private promptFor: Ally | null = null;
  /** Over his head, clear of the MAN DOWN tag on his chest. Followed live by the HUD. */
  private readonly promptAt = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly host: OrderHost) {}

  /** Metres to the man E would address now, or Infinity. */
  get focusDistance(): number {
    return this.focus ? this.focus.body.position.distanceTo(this.ctx.player.position) : Infinity;
  }

  reset(): void {
    this.clearPrompt();
    this.key.held = -1;
    this.focus = null;
  }

  private clearPrompt(): void {
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = '';
    this.promptFor = null;
  }

  private prompt(a: Ally | null, text: string, color: string): void {
    if (!a) {
      if (this.unprompt) this.clearPrompt();
      return;
    }
    if (text === this.prompted && a === this.promptFor) return;
    this.clearPrompt();
    this.prompted = text;
    this.promptFor = a;
    this.unprompt = this.ctx.hud.follow(this.promptAt, text, color);
  }

  /** The man the player is looking at, within reach. Down or up. */
  private nearest(): Ally | null {
    const p = this.ctx.player;
    let best: Ally | null = null;
    let bestD: number = ALLY.reach;
    for (const a of this.host.allies) {
      if (a.state === 'dead') continue;
      const d = a.body.position.distanceTo(p.position);
      if (d >= bestD) continue;
      _a.copy(a.body.center).sub(p.eye).normalize();
      if (_a.dot(p.forward) < ALLY.reachCos) continue;
      best = a;
      bestD = d;
    }
    return best;
  }

  /** A man on his knees in reach and in view: the prisoners' key, not ours. */
  private prisonerInReach(): boolean {
    const o = (this.ctx.enemies as unknown as EnemyManager).outpost;
    if (!o || o.prisoners <= 0) return false;
    const p = this.ctx.player;
    for (const s of o.soldiers) {
      if (!s.surrendered || s.released) continue;
      if (s.collared) return true;
      if (s.e.position.distanceTo(p.position) >= PRISONER_REACH) continue;
      _a.copy(s.e.center).sub(p.eye).normalize();
      if (_a.dot(p.forward) >= PRISONER_COS) return true;
    }
    return false;
  }

  private squadNear(): boolean {
    const p = this.ctx.player.position;
    for (const a of this.host.allies) if (a.state === 'up' && a.body.position.distanceTo(p) < ALLY.squadReach) return true;
    return false;
  }

  update(dt: number): void {
    const { input, player } = this.ctx;
    if (!player.alive || player.parked || this.host.allies.length === 0 || this.prisonerInReach()) {
      this.reset();
      return;
    }
    const focus = this.nearest();
    this.focus = focus;
    if (!focus && !this.squadNear()) {
      this.reset();
      return;
    }
    const reviving = focus?.state === 'down';
    const gesture = this.key.update(dt, input.pressed('interact'), input.isDown('interact'), reviving);
    if (gesture === 'tap' && focus?.state === 'up') this.host.toggle(focus);
    else if (gesture === 'hold') this.host.toggleSquad();
    else if (gesture === 'revive' && focus) this.host.playerRevive(focus);
    if (focus) this.promptAt.copy(focus.body.center).setY(focus.body.position.y + (reviving ? 1.1 : 2.2));
    this.label(focus, reviving);
  }

  private label(a: Ally | null, reviving: boolean): void {
    if (!a) {
      this.prompt(null, '', '');
      return;
    }
    const key = this.ctx.input.labelFor?.('interact') ?? 'E';
    if (reviving) {
      const cost = reviveCost(this.host.stims);
      const held = this.key.progress(true);
      if (cost === 'none') this.prompt(a, 'DOWN   NO STIMS TO REVIVE', ALLY_DOWN_COLOR_CSS);
      else if (held > 0) this.prompt(a, `REVIVING ${Math.round(held * 10) * 10}%`, ALLY_DOWN_COLOR_CSS);
      else this.prompt(a, `HOLD ${key} REVIVE${cost === 'stim' ? ` (1 OF ${this.host.stims!.count} STIMS)` : ''}`, ALLY_DOWN_COLOR_CSS);
      return;
    }
    const what = a.order === 'follow' ? 'BACK TO POST' : 'FOLLOW ME';
    this.prompt(a, `${a.def.label.toUpperCase()}   ${key} ${what}   HOLD ${key} SQUAD`, ALLY_TEXT);
  }
}

const ALLY_DOWN_COLOR_CSS = `#${ALLY_DOWN_COLOR.toString(16).padStart(6, '0')}`;
