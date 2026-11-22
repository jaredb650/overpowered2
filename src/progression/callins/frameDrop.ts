/**
 * The Distraint Frame as a call-in (combo 35). No mark: it comes down on its jets a few metres ahead of the player, the way a
 * supply pod lands, stands open, and E beside it puts the player in (`Frame.board`, src/frame/seat.ts) for `FRAME_DROP.seconds`.
 * Then the seat puts the player out beside it and it is gone. Left alone for `wait` seconds, it is taken back.
 *
 * Everything the Frame does once crewed is the Frame's own: the guns, the blows, the seat and its way out.
 *
 * It is built from the caller's loadout (src/frame/loadout.ts, chosen on the Frame loadout screen and kept in this browser): it
 * comes down already wearing it, and lands as it.
 */
import * as THREE from 'three';
import { lerp, rand, TAU } from '../../core/math';
import { CALLINS, FRAME_DROP as D } from '../data';
import { GroundRing } from './ground';
import type { NewsKind } from './link';
import { aboveFloor, type Strike, type StrikeKit } from './shared';
import { loadFrameLoadout, type FrameLoadout } from '../../frame/loadout';

const COLOR = CALLINS.frame.color;
/** Headroom a landing spot needs: the hull's top is 6.2 m over the feet. */
const ROOM = 7;
const FALL = D.height / D.speed;

const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _p = new THREE.Vector3();
const _at = new THREE.Vector3();

type Phase = 'warning' | 'falling' | 'waiting' | 'crewed';

/**
 * What the drop needs of a Frame: the player's own (`Frame`, src/frame/seat.ts), or in co-op the stand-in drawn for another
 * player's (`FramePuppet`, src/frame/puppet.ts), which stays `deployed` until destroyed.
 */
export interface DroppedFrame {
  readonly occupied: boolean;
  readonly deployed?: boolean;
  readonly walker: { readonly feet: THREE.Vector3 };
  stand(feet: THREE.Vector3, yaw: number): void;
  deploy?(feet: THREE.Vector3, yaw: number, loadout?: FrameLoadout): void;
  /** Shows the loadout it will land as, on the way down. */
  wear?(loadout: FrameLoadout): void;
  board(feet: THREE.Vector3, yaw: number, seconds?: number): void;
  hide(): void;
}

export class FrameDrop implements Strike {
  private phase: Phase = 'warning';
  private t = 0;
  /** Where it comes down and the way it faces. A co-op copy is given the caller's. */
  readonly feet = new THREE.Vector3();
  readonly yaw: number;
  /** Where the Frame is: in the air on its way down, then on its feet, then wherever its pilot walks it. */
  readonly where = new THREE.Vector3();
  private readonly ring: GroundRing;
  private flameIn = 0;
  private unmark: (() => void) | null = null;
  private unprompt: (() => void) | null = null;
  /** True once `deploy()` handed permanent parked ownership to `Frame`. */
  private handedOff = false;
  /** Co-op, on a copy: the caller's own is over. */
  private ended = false;
  /** The caller's loadout, read as the call goes out. A copy draws the caller's from what their Frame says. */
  private readonly loadout: FrameLoadout | null;

  constructor(private readonly kit: StrikeKit, private readonly frame: DroppedFrame, at?: { feet: THREE.Vector3; yaw: number }) {
    const { ctx } = kit;
    this.yaw = at ? at.yaw : ctx.player.yaw;
    if (at) this.feet.copy(at.feet);
    else this.spot(this.feet);
    this.where.copy(this.feet).setY(this.feet.y + D.height);
    this.loadout = kit.cosmetic ? null : loadFrameLoadout();
    if (this.loadout && !frame.occupied) frame.wear?.(this.loadout);
    this.ring = new GroundRing(ctx);
    this.ring.setColor(COLOR, 2);
    this.unmark = ctx.hud.marker(_p.copy(this.feet).setY(this.feet.y + 7), CALLINS.frame.name, COLOR);
    ctx.audio.play('cache_incoming');
  }

  /** Ahead of the player on open ground with the sky over it, else where the player stands. */
  private spot(out: THREE.Vector3): void {
    const { ctx, probe } = this.kit;
    const { player, world } = ctx;
    _p.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(D.ahead).add(player.position);
    if (!world.nav.nearest(_p, 12, out) || probe.headroom(out.x, out.y + 1, out.z, ROOM) < ROOM) out.copy(player.position);
    const floor = probe.heightAt(out.x, out.y + 2, out.z, 40);
    if (!Number.isNaN(floor)) out.y = floor;
  }

  news(kind: NewsKind): void {
    if (kind === 'end') this.ended = true;
  }

  update(dt: number): boolean {
    this.t += dt;
    if (this.ended) {
      this.gone();
      return true;
    }
    switch (this.phase) {
      case 'warning':
        this.showRing();
        if (this.t >= D.warn) this.next('falling');
        break;
      case 'falling': {
        const k = Math.min(1, this.t / FALL);
        // Slowing at the end on its jets, so it lands rather than arrives.
        const y = lerp(this.feet.y + D.height, this.feet.y, 1 - (1 - k) * (1 - k));
        this.frame.stand(_at.copy(this.feet).setY(y), this.yaw);
        this.where.copy(_at);
        this.showRing();
        this.burn(dt, k);
        if (k >= 1) this.land();
        break;
      }
      case 'waiting':
        // A copy of another player's (co-op) offers nobody a seat: it waits for its own pilot, whose word ends it.
        if (this.kit.cosmetic) {
          if (this.frame.occupied || this.frame.deployed) {
            this.unmark?.();
            this.unmark = null;
            this.next('crewed');
          } else this.frame.stand(this.feet, this.yaw);
          break;
        }
        // Persistent Frame: once landed via deploy(), Frame owns the parked marker and [E] BOARD prompt indefinitely.
        if (this.handedOff) {
          this.where.copy(this.frame.walker.feet);
          if (!this.frame.deployed) return true;
          if (this.frame.occupied) this.next('crewed');
          break;
        }
        this.offer();
        break;
      case 'crewed': {
        this.where.copy(this.frame.walker.feet);
        const alive = this.frame.deployed !== undefined ? (this.frame.deployed || this.frame.occupied) : this.frame.occupied;
        if (!alive) {
          this.gone();
          return true;
        }
        break;
      }
    }
    return false;
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }

  private showRing(): void {
    this.ring.show(this.feet, D.impactRadius);
    this.ring.setOpacity(0.6 + Math.sin(this.t * 9) * 0.3);
    this.ring.tick(this.t);
  }

  /** The jets under it on the way down, hardest at the end. */
  private burn(dt: number, k: number): void {
    const { fx } = this.kit.ctx;
    this.flameIn -= dt;
    if (this.flameIn > 0) return;
    this.flameIn = 0.04;
    for (const s of [-1, 1]) {
      _p.set(Math.cos(this.yaw) * s * 1.1, 3.4, -Math.sin(this.yaw) * s * 1.1).add(_at);
      fx.flame(_p, _down, 1 + k * 1.5);
    }
    if (k > 0.6) fx.smoke(_p.copy(this.feet), 0x9a9690, 2.4, 1.4);
  }

  private land(): void {
    const { audio, camera, combat, fx, player, render } = this.kit.ctx;
    const p = this.feet;
    this.next('waiting');
    this.where.copy(p);
    if (!this.kit.cosmetic && typeof this.frame.deploy === 'function') {
      this.unmark?.();
      this.unmark = null;
      this.handedOff = true;
      this.frame.deploy(p, this.yaw, this.loadout ?? undefined);
    } else {
      this.frame.stand(p, this.yaw);
    }
    this.ring.hide();
    combat.explode(aboveFloor(p), {
      radius: D.impactRadius, damage: D.impactDamage, kind: 'rocket', source: 'drop_pod', team: 'player', selfDamage: 0, playerPush: 14, mirrored: true,
    });
    fx.slam(p, 2.4);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      fx.dust(_p.set(p.x + Math.cos(a) * 3, p.y, p.z + Math.sin(a) * 3), _up, 2);
    }
    render.decals.add('crack', p, _up, 9, rand(0, TAU));
    audio.play('titan_stomp', { position: p, pitch: 0.85 });
    audio.play('land_hard', { position: p, pitch: 0.45 });
    audio.play('metal_groan', { position: p, pitch: 0.7 });
    camera.addTrauma(Math.max(0, 0.8 - player.position.distanceTo(p) / 60));
  }

  /** Fallback prompt for test mocks that don't implement `deploy()`. */
  private offer(): void {
    const { hud, input, player } = this.kit.ctx;
    const near = player.alive && Math.hypot(player.position.x - this.feet.x, player.position.z - this.feet.z) < D.reach
      && Math.abs(player.position.y - this.feet.y) < 3;
    if (near && !this.unprompt) {
      this.unprompt = hud.follow(_p.copy(this.feet).setY(this.feet.y + 2.4).clone(), `${input.labelFor?.('interact') ?? 'E'} BOARD`, COLOR);
    } else if (!near && this.unprompt) {
      this.unprompt();
      this.unprompt = null;
    }
    if (!near || !input.pressed('interact')) return;
    this.unprompt?.();
    this.unprompt = null;
    this.unmark?.();
    this.unmark = null;
    this.frame.board(this.feet, this.yaw, D.seconds);
    this.next('crewed');
  }

  /** Gone: smoke puff and hide if no longer deployed. */
  private gone(): void {
    const { audio, fx } = this.kit.ctx;
    const p = this.frame.walker.feet;
    _p.copy(this.phase === 'crewed' ? p : this.feet);
    for (let i = 0; i < 6; i++) fx.smoke(_at.copy(_p).setY(_p.y + 1 + i * 0.9), 0x8a8680, 3.5, 2.5);
    audio.play('steam_burst', { position: _p, pitch: 0.6 });
    this.frame.hide();
  }

  dispose(): void {
    this.ring.dispose();
    this.unmark?.();
    this.unmark = null;
    this.unprompt?.();
    this.unprompt = null;
    this.frame.hide();
  }
}
