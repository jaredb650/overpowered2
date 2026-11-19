/**
 * A game context for another player's call-in, flown here for the look (co-op, mirror.ts). The strike classes run unchanged on
 * it: the same aircraft, paths, rounds in flight, flashes, sounds and shake. What it takes away is everything that would make
 * this screen's copy count for something, because the caller's own game already claims the damage:
 *
 *   combat.explode / spawnProjectile   drawn, heard and felt (`cosmetic`, `ghost`): nobody is hurt, nothing is broken, nothing is sent on
 *   combat.fireRay                      a tracer to where the world stops it, and the impact there
 *   enemies.applyDamage / afflict       nothing: no hit, no fire, no frost
 *   hud.banner / hud.feed               nothing: the crew's chatter and banners are the caller's
 *   input                               no key is ever down: a copy is never flown from this keyboard
 *   time.hitStop                        nothing
 *
 * Everything else is the real game, so a copy's sounds are placed in the world and its shove reaches this player too.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import type { DamageResult, ExplosionSpec, ProjectileSpec, ShotResult, ShotSpec } from '../../core/gameplay';
import { SURFACE_SOUND } from '../../weapons/data';

const MAX_RANGE = 500;
const NO_DAMAGE: DamageResult = { dealt: 0, killed: false, headshot: false, severed: [], blocked: false };
const _dir = new THREE.Vector3();

/**
 * `target` with some members replaced. A member not replaced is the real one, called on the real object: a plain
 * `Object.create` would let a method write its state onto the copy.
 */
function over<T extends object>(target: T, replaced: Partial<T>): T {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(real, key) {
      if (Object.hasOwn(replaced, key)) return (replaced as Record<PropertyKey, unknown>)[key];
      const value = (real as Record<PropertyKey, unknown>)[key];
      if (typeof value !== 'function') return value;
      let fn = bound.get(key);
      if (!fn) bound.set(key, fn = (value as (...args: unknown[]) => unknown).bind(real));
      return fn;
    },
  });
}

/** Counts what a copy drew, for the proofs: a watcher asserts on these that the blasts and the fire arrived. */
export interface GhostStats {
  blasts: number;
  projectiles: number;
  rays: number;
  /**
   * Set while a copy is being run forward to where its caller's is (mirror.ts: a player who arrived part-way, a screen that
   * fell behind): nothing of the stretch being skipped is drawn or heard. No blast, round, tracer, sound or shake.
   */
  quiet?: boolean;
}

export function ghostCtx(ctx: Ctx, stats: GhostStats): Ctx {
  const real = ctx.combat;
  const result: ShotResult = { hitEnemy: false, headshot: false, killed: false, kills: 0, end: new THREE.Vector3() };
  const combat = over(real, {
    explode(position: THREE.Vector3, spec: ExplosionSpec): void {
      if (stats.quiet) return;
      stats.blasts++;
      // The specs are shared constants: marked for this one call and put back.
      const was = spec.cosmetic;
      spec.cosmetic = true;
      try { real.explode(position, spec); } finally { spec.cosmetic = was; }
    },
    spawnProjectile(spec: ProjectileSpec): void {
      if (stats.quiet) return;
      stats.projectiles++;
      const was = spec.ghost;
      spec.ghost = true;
      try { real.spawnProjectile(spec); } finally { spec.ghost = was; }
    },
    fireRay(origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec): ShotResult {
      if (stats.quiet) { result.end.copy(origin).addScaledVector(_dir.copy(dir).normalize(), spec.maxDistance ?? MAX_RANGE); return result; }
      stats.rays++;
      const { audio, fx, physics } = ctx;
      const reach = spec.maxDistance ?? MAX_RANGE;
      _dir.copy(dir).normalize();
      const wall = physics.raycast(origin, _dir, reach, CG.World);
      if (wall) result.end.copy(wall.point);
      else result.end.copy(origin).addScaledVector(_dir, reach);
      if (spec.tracer) fx.tracer(spec.tracerFrom ?? origin, result.end, spec.tracer);
      if (wall) {
        fx.impact(wall.point, wall.normal, wall.surface, spec.impactScale ?? 1);
        if (spec.burst) {
          fx.burst?.(wall.point, wall.normal, spec.burst.scale ?? 1);
          audio.play(spec.burst.sound ?? 'cannon_burst', { position: wall.point, volume: 0.8 });
        } else {
          audio.play(SURFACE_SOUND[wall.surface], { position: wall.point, volume: 0.7, pitchJitter: 0.06 });
        }
      }
      return result;
    },
  } as Partial<Ctx['combat']>);
  const enemies = over(ctx.enemies, { applyDamage: () => NO_DAMAGE, afflict: () => undefined } as Partial<Ctx['enemies']>);
  const hud = over(ctx.hud, { banner: () => undefined, feed: () => undefined } as Partial<Ctx['hud']>);
  const time = over(ctx.time, { hitStop: () => undefined } as Partial<Ctx['time']>);
  const input = over(ctx.input, { isDown: () => false, pressed: () => false, released: () => false } as Partial<Ctx['input']>);
  const audio = over(ctx.audio, { play: (id: string, options?: Parameters<Ctx['audio']['play']>[1]) => { if (!stats.quiet) ctx.audio.play(id, options); } } as Partial<Ctx['audio']>);
  const camera = over(ctx.camera, { addTrauma: (amount: number) => { if (!stats.quiet) ctx.camera.addTrauma(amount); } } as Partial<Ctx['camera']>);
  // Reads fall through to the live context, so a system set on it later (co-op itself) is seen here too.
  return Object.create(ctx, {
    combat: { value: combat }, enemies: { value: enemies }, hud: { value: hud }, time: { value: time }, input: { value: input },
    audio: { value: audio }, camera: { value: camera },
  }) as Ctx;
}
