/**
 * Shared shell impact, airburst proximity check, howitzer shockwave, and 40 mm HE helper used across arm weapon plug-ins
 * and co-op playback (`puppet.ts`). Re-exported from `src/frame/weapons.ts` for existing callers and tests.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, ExplosionKind, PlayOptions } from '../../core/contracts';
import type { EnemyInstance, EnemySystem, ExplosionSpec, ShotSpec } from '../../core/gameplay';
import { clamp, lerp, rand, randomInCone } from '../../core/math';
import { AC130 } from '../../progression/callins/ac130Data';
import type { Round40 } from '../../progression/callins/ac130Guns';
import { flakCone, type ImpactKind } from '../../progression/callins/ac130Rounds';
import { FRAME } from '../data';
import type { ArmUpdateContext } from './types';

const A = FRAME.rotaryAirburst;
const C = FRAME.cannon;
const H = FRAME.howitzer;
const B = AC130.bofors;

export const ROUNDS_40: readonly Round40[] = ['g40', 'ap', 'flak'];
export const ROUND_NAMES: Readonly<Record<Round40, string>> = { g40: 'HE', ap: 'AP', flak: 'FLAK' };

/** Below this the sight is on something right under the arm, and a round goes down the bore instead. */
export const NEAR_SIGHT = 6;
const UP = new THREE.Vector3(0, 1, 0);
const WALL_STANDOFF = 0.5;

const _hits: EnemyInstance[] = [];
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _play: PlayOptions = {};
const _pellets = Array.from({ length: B.flak.pellets }, () => new THREE.Vector3());
const _blow: DamageInfo = { amount: 0, type: 'crush', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'frame_stomp' };

function blast(source: string, radius: number, damage: number): ExplosionSpec {
  return { kind: 'shell', source, radius, damage, shake: 0.02, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true };
}

const BLASTS: Readonly<Record<Round40, ExplosionSpec>> = {
  g40: blast('frame_40mm', B.he.radius, B.he.damage),
  ap: blast('frame_40mm_ap', B.ap.radius, B.ap.damage),
  flak: blast('frame_flak', B.flak.radius, B.flak.damage),
};

const HOWITZER_BLAST: ExplosionSpec = {
  kind: 'finisher', source: 'frame_howitzer', radius: H.blastRadius, damage: H.blastDamage,
  shake: 0.14, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true,
};

const PELLET: ShotSpec = {
  damage: B.flak.pelletDamage, source: 'frame_flak', team: 'player', maxDistance: B.flak.reach, force: 14, severMult: 2.2, impactScale: 1.4,
};

/**
 * Proximity-fuzed mini-flak airburst check along `(origin, dir)` up to `maxDist` (e.g. nearest wall).
 * Returns true and writes the mid-air burst point slightly ahead of the closest enemy inside `A.prox`.
 */
export function airburstPoint(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  enemies: Pick<EnemySystem, 'alive'>,
  out: THREE.Vector3,
): boolean {
  const prox2 = A.prox * A.prox;
  let bestT = Infinity;
  const list = enemies.alive;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (!e.alive) continue;
    const dx = e.center.x - origin.x;
    const dy = e.center.y - origin.y;
    const dz = e.center.z - origin.z;
    const proj = dx * dir.x + dy * dir.y + dz * dir.z;
    if (proj <= 0.5 || proj > maxDist || proj >= bestT) continue;
    const px = dx - dir.x * proj;
    const py = dy - dir.y * proj;
    const pz = dz - dir.z * proj;
    if (px * px + py * py + pz * pz <= prox2) bestT = proj;
  }
  if (bestT === Infinity) return false;
  out.copy(origin).addScaledVector(dir, Math.max(0.8, bestT - A.standoff));
  return true;
}

/** Concussive 22 m shockwave radiating out from a 105 mm howitzer detonation, flinging infantry off their feet. */
export function howitzerShockwave(enemies: EnemySystem, at: THREE.Vector3): number {
  const n = Math.min(enemies.query(at, H.shockRadius, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const dx = e.position.x - at.x;
    const dz = e.position.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d > H.shockRadius) continue;
    const t = clamp(d / H.shockRadius);
    _blow.type = 'explosive';
    _blow.source = 'frame_howitzer';
    _blow.amount = lerp(180, 45, t);
    _blow.point.copy(e.center);
    if (d > 0.05) _blow.dir.set(dx / d, 0.65, dz / d).normalize();
    else _blow.dir.set(0, 1, 0);
    _blow.force = lerp(1100, 380, t);
    _blow.gib = d < H.blastRadius * 0.6;
    enemies.applyDamage(e, _blow);
    _blow.gib = false;
    _blow.type = 'crush';
    struck++;
  }
  return struck;
}

/**
 * A 40 mm or 105 mm howitzer round from the arm landing: the blast and its look. A function on the context alone, so the
 * copy of another player's Frame (co-op, puppet.ts) lands its shells through it too, on a context that hurts nothing.
 */
export function shellImpact(ctx: Ctx, kind: ImpactKind | 'howitzer', point: THREE.Vector3, normal: THREE.Vector3 | null, dir: THREE.Vector3): void {
  if (kind === 'g105' || kind === 'howitzer') {
    const { combat, fx, audio, enemies, physics, world, render, camera } = ctx;
    const n = normal ?? UP;
    _at.copy(point);
    if (normal) _at.addScaledVector(normal, WALL_STANDOFF);
    combat.explode(_at, HOWITZER_BLAST);
    howitzerShockwave(enemies, _at);
    world?.objects?.damageExplosivesInRadius?.(_at, H.shockRadius, H.blastDamage, 'frame_howitzer');
    _v.copy(dir).setY(0.75).normalize();
    enemies.vehicles?.frameBlow?.(_at, H.shockRadius, 280, _v, 'frame_howitzer');
    physics?.radialImpulse?.(_at, H.shockRadius, 280);
    fx.explosion(point, { kind: 'howitzer' as ExplosionKind, radius: H.blastRadius, scale: 1.5, normal: normal ?? undefined });
    fx.ring(point, n, '#ff9030', H.blastRadius * 2.1);
    fx.ring(point, UP, '#ffd8a0', H.shockRadius * 1.35);
    fx.sparks(point, n, 48, '#ffbb55');
    fx.chips(point, 0x6a645d, 36);
    fx.smoke(_w.copy(point).setY(point.y + 3.2), 0x2c2825, 11, 5.5);
    fx.heatShimmer?.(point, H.blastRadius * 1.2, 1.8);
    render?.lights?.flash?.(_at, 0xffaa44, 14, H.shockRadius * 1.4, 0.35);
    render?.decals?.add?.('scorch', point, n, H.blastRadius * 1.15, rand(0, Math.PI * 2));
    render?.post?.radialBlur?.(0.32, 0.25);
    camera?.addTrauma?.(0.35);
    audio.play('hellfirerocket_explode', { position: point, volume: 1.25, pitch: 0.62 });
    audio.play('vehicle_explode', { position: point, volume: 1.1, pitch: 0.72 });
    audio.play('explosion_debris', { position: point, volume: 1.0, pitch: 0.78 });
    return;
  }
  if (kind !== 'g40' && kind !== 'ap' && kind !== 'flak') return;
  const { combat, fx, audio } = ctx;
  _at.copy(point);
  if (normal) _at.addScaledVector(normal, WALL_STANDOFF);
  const spec = BLASTS[kind];
  combat.explode(_at, spec);
  ctx.world?.objects?.damageExplosivesInRadius?.(_at, spec.radius, spec.damage, spec.source);
  if (kind === 'g40') {
    fx.explosion(point, { kind: 'shell', radius: B.he.radius, scale: 1, normal: normal ?? undefined });
    fx.ring(point, normal ?? UP, '#ffb040', B.he.radius * 1.5);
    audio.play('30mmshell_explode', { position: point, volume: 0.9 });
  } else if (kind === 'ap') {
    fx.explosion(point, { kind: 'hellfireBullet', radius: B.ap.radius, scale: 1.1, normal: normal ?? undefined });
    fx.sparks(point, normal ?? UP, 24, '#cfe4ff');
    audio.play('30mmshell_explode', { position: point, volume: 0.8, pitch: 1.25 });
  } else {
    fx.explosion(point, { kind: 'shell', radius: B.flak.radius, scale: 0.8 });
    fx.ring(point, dir, '#ff7030', B.flak.radius * 2);
    audio.play('30mmshell_explode', { position: point, pitch: 0.8 });
    audio.play('shotgun_fire', { position: point, volume: 0.7, pitch: 0.6 });
    flakCone(dir, B.flak.cone, _pellets);
    for (let i = 0; i < _pellets.length; i++) {
      PELLET.tracer = i % 3 === 0 ? 'heavy' : undefined;
      combat.fireRay(point, _pellets[i]!, PELLET);
    }
  }
}

/** Fires one 40 mm shell (`round`) from `u.arm` toward `u.sight`. Shared by Cannon40 and Phase 0 arm placeholders. */
export function fireCannon40Shell(u: ArmUpdateContext, round: Round40): void {
  const { audio, camera, fx } = u.ctx;
  u.arm.muzzle(_muzzle);
  u.arm.bore(_bore);
  if (u.sight.range > NEAR_SIGHT) _aim.copy(u.sight.point);
  else _aim.copy(_muzzle).addScaledVector(_bore, 60);
  randomInCone(_dir.subVectors(_aim, _muzzle).normalize(), C.spread, _dir);
  const reach = _muzzle.distanceTo(_aim) + (round === 'ap' ? B.ap.beyond : 0);
  _aim.copy(_muzzle).addScaledVector(_dir, reach);
  u.rounds.fire(round, _muzzle, _aim, reach / C.speed, 0, Infinity);
  u.onShell?.(round, _muzzle, _aim, reach / C.speed, u.side);
  u.rounds.flash(_muzzle, 1.6, 0.07, 9, 10, 5, 1.4);
  fx.muzzleFlash(_muzzle, _bore, 'autocannon');
  _v.set(-_bore.z, 0, _bore.x).multiplyScalar(2.6);
  _v.y = rand(1.6, 3.0);
  fx.shellCasing(_at.copy(_muzzle).addScaledVector(_bore, -2.1), _v, 'cannon');
  fx.smoke(_v.copy(_muzzle).addScaledVector(_bore, 3), 0xb4bcc4, 0.5, 0.8);
  _play.volume = 1.4;
  _play.pitch = round === 'ap' ? 0.8 : 0.72;
  _play.position = undefined;
  audio.play('autocannon_fire', _play);
  u.arm.recoil(0.48);
  if (u.recoilMult > 0) {
    camera.addTrauma(C.trauma * u.recoilMult);
    camera.kick(C.kick * u.recoilMult, rand(-0.004, 0.004) * u.recoilMult);
  }
}
