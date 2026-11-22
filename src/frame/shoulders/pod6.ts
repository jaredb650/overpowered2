/**
 * Six-tube Missile Pod shoulder weapon plug-in (`pod6`), moved intact from `weapons.ts`.
 * Hold the shoulder key (G / V / B) to paint up to 6 targets, release to launch all six tubes.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget, ProjectileSpec } from '../../core/gameplay';
import { randomInCone } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import { TUNING } from '../../weapons/data';
import { Painter, type PaintCandidate } from '../../weapons/swarm';
import { NEAR_SIGHT } from '../arms/shared';
import { FRAME } from '../data';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

const P = FRAME.pod;
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _right = new THREE.Vector3();

/** The pod: paint while held, a salvo of every tube on release (spares on the marks, as the Quiver's), then a reload. */
export class Pod {
  readonly painter = new Painter(P.paintEvery);
  ammo: number = P.tubes;
  /** Seconds left of the reload, or -1. */
  reloading = -1;
  /** One per tube still to leave, its target or null for a dumb one. Read and emptied by the owner. */
  readonly queue: (MissileTarget | null)[] = [];
  private salvo: (MissileTarget | null)[] = [];
  private gap = 0;

  get progress(): number {
    return this.reloading < 0 ? -1 : 1 - this.reloading / P.reload;
  }

  /** `look` answers who is in the cone and in sight now. Returns the target marked this frame, or null. */
  update(dt: number, held: boolean, look: () => readonly PaintCandidate[]): MissileTarget | null {
    const p = this.painter;
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading < 0) {
        this.reloading = -1;
        this.ammo = P.tubes;
      }
    }
    this.queue.length = 0;
    if (this.salvo.length > 0) {
      this.gap -= dt;
      while (this.salvo.length > 0 && this.gap <= 0) {
        this.queue.push(this.salvo.shift()!);
        this.gap += P.gap;
      }
      if (this.salvo.length === 0) this.reloading = P.reload;
      return null;
    }
    if (!p.painting) {
      if (held && this.ammo === P.tubes) p.begin(P.tubes);
      return null;
    }
    if (held) return p.update(dt, look);
    p.release(this.salvo, this.ammo, look());
    this.ammo = 0;
    this.gap = 0;
    return null;
  }

  reset(): void {
    this.painter.cancel();
    this.ammo = P.tubes;
    this.reloading = -1;
    this.salvo.length = 0;
    this.queue.length = 0;
  }
}

/** The pod's missile, less where it starts, where it is going and who it is after. */
export function podMissile(): ProjectileSpec {
  return {
    origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'rocket', team: 'player', damage: P.damage,
    source: 'frame_pod', trail: 'swarm', gib: true, severMult: 1, force: 70,
    turnRate: TUNING.quiver.turnRate, steerDelay: TUNING.quiver.steerDelay, weave: TUNING.quiver.weave, accel: TUNING.quiver.accel,
    topSpeed: TUNING.quiver.topSpeed, size: 0.7, target: null,
    explosion: { radius: P.radius, damage: P.blast, kind: 'rocket', selfDamage: 0, playerPush: 0, scale: TUNING.quiver.blastScale, shake: TUNING.quiver.blastShake, mirrored: true },
  };
}

export class Pod6Shoulder implements FrameShoulderWeapon {
  readonly kind = 'pod6' as const;
  readonly clock = new Pod();
  private tube = 0;
  private readonly projectile: ProjectileSpec = podMissile();

  constructor(private readonly ctx: Ctx) {}

  get marks(): readonly MissileTarget[] {
    return this.clock.painter.marks;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    const { audio } = this.ctx;
    const pod = this.clock;
    const wasPainting = pod.painter.painting;
    const wasLoading = pod.reloading >= 0;
    const marked = pod.update(dt, u.online && u.held, () => u.gatherTargets());
    if (!wasPainting && pod.painter.painting) audio.play('quiver_arm');
    if (marked) {
      audio.play('quiver_lock', { pitch: 1 + (pod.painter.marks.length - 1) * 0.12 });
      if (pod.painter.full) audio.play('quiver_full');
    }
    for (const target of pod.queue) this.missile(target, u);
    if (wasLoading && pod.reloading < 0) audio.play('reload_rocket', { volume: 0.8 });
    if (u.pressed && (!u.online || pod.ammo < P.tubes)) audio.play('weapon_dry');
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt, false, () => []);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = P.tubes;
    if (!online) {
      row.name = `${keyLabel} POD // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    const painting = this.clock.painter.painting;
    row.name = painting ? `${keyLabel} POD // PAINTING ${this.clock.painter.marks.length}` : `${keyLabel} POD // HOLD TO PAINT`;
    row.ammo = painting ? this.clock.painter.marks.length : this.clock.ammo;
    row.reload = this.clock.progress;
  }

  reset(): void {
    this.clock.reset();
    this.tube = 0;
  }

  private missile(target: MissileTarget | null, u: ShoulderUpdateContext): void {
    const { combat, fx, audio, camera } = this.ctx;
    const q = TUNING.quiver;
    const p = this.projectile;
    const dumb = target === null;
    const i = this.tube++ % P.tubes;
    u.mountPos(p.origin);
    _right.crossVectors(u.sight.aim, UP).normalize();
    _w.crossVectors(_right, u.sight.aim).normalize();
    p.origin.addScaledVector(_right, ((i % 3) - 1) * 0.28).addScaledVector(_w, i < 3 ? 0.18 : -0.18);
    _dir.subVectors(u.sight.range > NEAR_SIGHT ? u.sight.point : _v.copy(u.sight.view.position).addScaledVector(u.sight.aim, 60), p.origin).normalize();
    const sx = (i % 3) - 1;
    const sy = i < 3 ? 1 : -1;
    if (dumb) {
      _dir.addScaledVector(_right, sx * q.fan * 0.5).addScaledVector(_w, (sy + 1) * q.fan * 0.4).normalize();
      randomInCone(_dir, q.dumbSpread, _dir);
    } else {
      _dir.addScaledVector(_right, sx * q.fan).addScaledVector(_w, sy * q.fan * 0.7 + q.fan * 0.9).normalize();
    }
    p.velocity.copy(_dir).multiplyScalar(q.launchSpeed);
    p.target = dumb ? null : target;
    combat.spawnProjectile(p);
    u.onMissile?.(p.origin, p.velocity);
    fx.smoke(p.origin, 0xb9b4aa, 0.9, 1.4);
    fx.sparks(p.origin, _v.copy(_dir).negate(), 5, 0xffa040);
    audio.play('quiver_fire', { pitchJitter: 0.05, pitch: 0.85 });
    camera.addTrauma(0.06);
  }
}

export const POD6_PLUGIN: ShoulderPlugin = {
  kind: 'pod6',
  create: ctx => new Pod6Shoulder(ctx),
};
