/**
 * Boarding up by hand, as in Call of Duty's zombies mode: stand at a damaged or breached wall or gate and hold E. Each stage takes
 * `ECONOMY.handSeconds` of hammering and pays `ECONOMY.handPay` the moment it goes up; a chip on a wall still standing is half of both.
 * Letting go or walking off starts the stage over, and so does a hit, after which E has to be let go before it counts again. It works in
 * a wave and in a break. The Barracks' crew (a bought repair) is the other way: any wall, from anywhere. A piece the crew is on is theirs.
 */
import * as THREE from 'three';
import type { Ctx, Structure } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import { WALL, type StructureSpec, type Structures } from '../../world/structures';
import { ECONOMY } from './data';

type Piece = Structure & { readonly spec: StructureSpec };

/** Seconds between hammer blows. */
const BLOW = 0.42;
/** The label's height over the piece's foot. */
const LABEL_Y = 2.5;
export const REPAIR_COLOR = '#ffc14a';

const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Where a piece stands on its ladder: 0 whole, the last breached. */
const stageIndex = (p: Structure): number => (p.stage === 'intact' ? 0 : p.stage === 'damaged' ? 1 : p.kind === 'wall' ? 2 : 1);

/** Credits and seconds for the next stage of `p`. */
export const handPay = (p: Structure): number => (p.stage === 'intact' ? ECONOMY.handPay / 2 : ECONOMY.handPay);
export const handSeconds = (p: Structure): number => (p.stage === 'intact' ? ECONOMY.handSeconds / 2 : ECONOMY.handSeconds);

export class HandRepair {
  /** The piece in reach that needs work, or null. */
  piece: Piece | null = null;
  /** 0..1 through the stage under the hammer. */
  progress = 0;
  working = false;
  /** Stages put up by hand this run. */
  stages = 0;
  /** Waiting on the gap to clear before the last stage of a breach goes up. */
  blocked = false;
  /** Over the stretch being worked on, for the prompt. */
  readonly label = new THREE.Vector3();
  /** Set by a hit: E has to be let go before it counts again. */
  private locked = false;
  private blowIn = 0;
  private unprompt: (() => void) | null = null;
  private prompted = '';

  constructor(private readonly ctx: Ctx, private readonly pay: (credits: number) => void) {}

  init(): void {
    this.ctx.events.on('player:damaged', () => this.interrupt());
  }

  private get walls(): Structures | null {
    return (this.ctx.world.objects as unknown as { walls?: Structures }).walls ?? null;
  }

  reset(): void {
    this.stop();
    this.piece = null;
    this.stages = 0;
    this.locked = false;
    this.prompt('');
  }

  /** A hit: the stage starts over, and E has to come up first. */
  interrupt(): void {
    if (!this.working) return;
    this.stop();
    this.locked = true;
  }

  private stop(): void {
    this.working = false;
    this.blocked = false;
    this.progress = 0;
  }

  /** Once a frame. `busy` is E wanted by something nearer: a counter, a man in front of the player, a mounted gun. */
  update(dt: number, busy: boolean): void {
    const { input, player } = this.ctx;
    const walls = this.walls;
    const piece = !busy && walls && player.alive && !player.parked ? this.nearest(walls) : null;
    if (piece !== this.piece) {
      this.piece = piece;
      this.stop();
    }
    const held = input.isDown('interact');
    if (!held) this.locked = false;
    if (!piece || !walls) {
      this.prompt('');
      return;
    }
    this.place(piece);
    if (held && !this.locked) {
      if (!this.working) this.blowIn = 0;
      this.working = true;
      this.progress = Math.min(1, this.progress + dt / handSeconds(piece));
      if (!this.blocked) this.hammer(dt, piece);
      if (this.progress >= 1) this.finish(walls, piece);
    } else this.stop();
    const key = input.labelFor?.('interact') ?? 'E';
    const what = piece.kind === 'gate' ? 'GATE' : 'WALL';
    this.prompt(this.blocked ? 'CLEAR THE GAP' : this.working ? `BOARDING UP ${what}  +${handPay(piece)}` : `HOLD ${key} BOARD UP ${what}  +${handPay(piece)}`);
  }

  /** The stage goes up and is paid for, unless someone is standing in the gap a breach is about to close. */
  private finish(walls: Structures, piece: Piece): void {
    const index = stageIndex(piece);
    this.blocked = index === (piece.kind === 'wall' ? 2 : 1) && walls.occupied(piece);
    if (this.blocked) return;
    const credits = handPay(piece);
    walls.setStage(piece, Math.max(0, index - 1), true);
    this.pay(credits);
    this.stages++;
    this.progress = 0;
    this.ctx.hud.floatText(this.label, `+${credits}`, REPAIR_COLOR);
  }

  /** The nearest wall or gate in reach that is not whole and has no crew on it. */
  private nearest(walls: Structures): Piece | null {
    const p = this.ctx.player.position;
    let best: Piece | null = null;
    let bestD: number = ECONOMY.handReach;
    for (const q of walls.all as unknown as Piece[]) {
      if (q.kind === 'shack' || q.repairing >= 0 || (q.stage === 'intact' && q.health >= q.maxHealth)) continue;
      const d = walls.distance(q, p);
      if (d >= bestD) continue;
      best = q;
      bestD = d;
    }
    return best;
  }

  /** The label over the stretch of the piece nearest the player. */
  private place(piece: Piece): void {
    const s = piece.spec;
    const ux = Math.cos(s.yaw), uz = -Math.sin(s.yaw);
    const half = (s.length - WALL.pillar) / 2;
    const p = this.ctx.player.position;
    const along = clamp((p.x - s.x) * ux + (p.z - s.z) * uz, -half, half);
    this.label.set(s.x + ux * along, s.y + LABEL_Y, s.z + uz * along);
  }

  /** The existing foley: a nail driven home, and the board or the plate under it. */
  private hammer(dt: number, piece: Piece): void {
    this.blowIn -= dt;
    if (this.blowIn > 0) return;
    this.blowIn = BLOW * rand(0.85, 1.15);
    const { audio, fx } = this.ctx;
    const at = _n.copy(this.label).setY(this.label.y - 1.2);
    audio.play('stake_hit_wall', { position: at, volume: 0.75, pitchJitter: 0.12 });
    audio.play(piece.kind === 'gate' ? 'impact_metal' : 'impact_concrete', { position: at, volume: 0.35, pitchJitter: 0.2 });
    fx.dust(at, UP, 0.5);
  }

  private prompt(text: string): void {
    if (text === this.prompted) return;
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = text;
    if (text) this.unprompt = this.ctx.hud.follow(this.label, text, REPAIR_COLOR);
  }
}
