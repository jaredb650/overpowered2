/**
 * The autocannon's flak shells (the `autocannonFlak` mod): a proximity fuze. A shell that comes within `prox` of a body ahead, or
 * `wall` of a surface, goes off in the air short of it and throws a cone of shrapnel on down the line it was flying: a flying
 * claymore. Shoot at a man and it bursts in his face; shoot into a crowd and it clears the cone. The fuze is the AC-130's flak
 * fuze (callins/ac130Rounds.ts `fuze`), moved back off a body that is off the line so the cone still takes him in.
 *
 * The burst is a `Combat.explode`, so co-op draws it on everyone's screen, and the shrapnel is pellets through `Combat.fireRay`,
 * so it wounds and severs as any pellet does and a guest's hits are claimed like a shotgun's.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { EnemyInstance, ExplosionSpec, ShotSpec } from '../core/gameplay';
import { randomInCone } from '../core/math';
import type { Combat } from './Combat';

export const FLAK = {
  /** Metres off the shell's line a body sets the fuze off at, and the least distance short of him it bursts. */
  prox: 2.2, fuze: 2,
  /** Metres short of a wall or a floor it goes off. */
  wall: 1,
  /** Half-angle of the shrapnel cone, radians (26 degrees), and how far a fragment flies. */
  cone: 0.45, reach: 20,
  /** Fragments in the cone, what each does, and how many bodies each goes through. */
  pellets: 30, damage: 150, pierce: 2,
  /** A fragment's damage holds to `from` metres and falls to `floor` of it at `reach`. */
  from: 4, floor: 0.3,
  /** Every body in the cone, up to this many, also gets one fragment aimed at it, so nobody the cone covers is missed. */
  aimed: 12,
  /** The air burst itself, small: the shrapnel does the work. What the shell does to whatever it strikes square. */
  radius: 2.5, blast: 60, direct: 150,
} as const;

/** Off the line by `off`, a body is met this far back, so it stands inside the cone (most of its half-angle) when the shell goes. */
const BACK = 1 / Math.tan(FLAK.cone * 0.8);

/**
 * Where on this step of `step` metres a flak shell goes off, or -1 to fly on: `wall` short of the first surface `open` metres
 * ahead (Infinity for none), or short of a body `along` metres down the line and `off` metres off it (`along` Infinity for none).
 */
export function flakFuze(step: number, open: number, along: number, off: number): number {
  const body = along === Infinity || off > FLAK.prox ? Infinity : along - Math.max(FLAK.fuze, off * BACK);
  const first = Math.min(open - FLAK.wall, body);
  return first > step ? -1 : Math.max(0, first);
}

const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _shot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _near: EnemyInstance[] = [];

/** How far down a flak shell's line the fuze looks for a body: as far back as it bursts off a body at the edge of `prox`. */
export const FUZE_LOOK = FLAK.prox * BACK + FLAK.prox;

/**
 * The body nearest down the line from `from` along unit `dir`, within `step` + FUZE_LOOK, that would set the fuze off: written as
 * [along, off] into `out`, along Infinity for none. The burst point, if any, is `flakFuze` of it.
 */
export function nearestAhead(ctx: Ctx, from: THREE.Vector3, dir: THREE.Vector3, step: number, out: [number, number]): [number, number] {
  out[0] = Infinity;
  out[1] = 0;
  const reach = step + FUZE_LOOK;
  let best = Infinity;
  const n = ctx.enemies.query(_to.copy(from).addScaledVector(dir, reach / 2), reach / 2 + FLAK.prox, _near) || 0;
  for (let i = 0; i < n; i++) {
    const e = _near[i]!;
    if (!e.alive) continue;
    _to.subVectors(e.center, from);
    const along = _to.dot(dir);
    if (along <= 0 || along > reach) continue;
    const off = _to.addScaledVector(dir, -along).length();
    if (off > FLAK.prox) continue;
    const at = along - Math.max(FLAK.fuze, off * BACK);
    if (at < best) {
      best = at;
      out[0] = along;
      out[1] = off;
    }
  }
  _near.length = 0;
  return out;
}

const BURST: ExplosionSpec = {
  radius: FLAK.radius, damage: FLAK.blast, kind: 'shell', source: 'autocannon', team: 'player', selfDamage: 0, playerPush: 0, scale: 0.8,
};
const PELLET: ShotSpec = {
  damage: FLAK.damage, source: 'autocannon', team: 'player', maxDistance: FLAK.reach, force: 16, severMult: 3, type: 'pellet',
  pierce: FLAK.pierce, impactScale: 1.3, falloff: { from: FLAK.from, to: FLAK.reach, floor: FLAK.floor },
};

/** The fragments one burst throws, for tests: aimed ones, then the cone's. */
export const flakFired = { aimed: 0, cone: 0 };

/**
 * The air burst at `at`, flying along unit `dir`: the AC-130 flak's burst and ring, then the shrapnel, one fragment at each body
 * the cone covers and `pellets` more spread through it. Every other fragment draws a heavy tracer, the visible spray.
 */
export function flakBurst(ctx: Ctx, combat: Combat, at: THREE.Vector3, dir: THREE.Vector3, source: string): void {
  const { fx, audio, render } = ctx;
  BURST.source = PELLET.source = source;
  const from = _at.copy(at);
  const line = _dir.copy(dir);
  combat.explode(from, BURST);
  fx.ring(from, line, '#ff7030', FLAK.radius * 2);
  fx.sparks(from, line, 36, '#ffc070');
  render.lights.flash(from, '#ffb060', 22, 14, 0.09);
  audio.play('shotgun_fire', { position: from, volume: 0.7, pitch: 0.6 });

  flakFired.aimed = flakFired.cone = 0;
  const shot = _shot;
  const n = ctx.enemies.query(from, FLAK.reach, _near) || 0;
  for (let i = 0; i < n && flakFired.aimed < FLAK.aimed; i++) {
    const e = _near[i]!;
    if (!e.alive) continue;
    shot.subVectors(e.center, from);
    const d = shot.length();
    if (d < 1e-3 || d > FLAK.reach) continue;
    shot.divideScalar(d);
    // Within the cone, give or take half a body's width at that range.
    if (shot.dot(line) < Math.cos(FLAK.cone + Math.atan(0.3 / d))) continue;
    PELLET.tracer = flakFired.aimed % 2 === 0 ? 'heavy' : undefined;
    combat.fireRay(from, shot, PELLET);
    flakFired.aimed++;
  }
  _near.length = 0;
  for (let i = 0; i < FLAK.pellets; i++) {
    PELLET.tracer = i % 2 === 0 ? 'heavy' : undefined;
    combat.fireRay(from, randomInCone(line, FLAK.cone, shot), PELLET);
    flakFired.cone++;
  }
}
