/**
 * Enemy test arena at /?sandbox=arena. Boots the real game with whatever systems exist, then spawns by URL.
 *
 *   spawn=husk,brute   types to spawn, cycled.        count=10    total to spawn (default 10)
 *   dist=25            ring distance from the player.
 *   waves=1            run the real wave director.    wave=5      start at this wave
 *   god=1              player cannot die.             still=1     player keeps standing still (default)
 *
 * window.__arena drives scripted scenarios: spawn, hit, maim, clear, freeze, list, near, teleport, look, setWave, stats.
 */
import * as THREE from 'three';
import { Game, createCtx } from '../core/Game';
import type { GoreRegion } from '../characters/rig';
import type { Ctx, DamageInfo, DamageType } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { Enemy } from '../enemies/Enemy';
import type { Waves } from '../enemies/waves';

const KILL_LOG = 40;

/** Writes a walkable point on a ring around the player. */
function ringPoint(ctx: Ctx, angle: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
  const p = ctx.player.position;
  out.set(p.x + Math.sin(angle) * dist, p.y, p.z + Math.cos(angle) * dist);
  if (!ctx.world.nav.nearest(out, 12, out)) out.copy(p);
  return out;
}

export default async function arena(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = await createCtx(canvas);
  const game = new Game(ctx);
  const enemies = ctx.enemies as unknown as EnemyManager;
  const waves = ctx.waves as unknown as Waves;

  const kills: string[] = [];
  const counters = { spawned: 0, killed: 0, severed: 0, hits: 0, playerDamage: 0 };
  ctx.events.on('enemy:spawned', () => counters.spawned++);
  ctx.events.on('enemy:severed', () => counters.severed++);
  ctx.events.on('enemy:hit', () => counters.hits++);
  ctx.events.on('player:damaged', e => (counters.playerDamage += e.amount));
  ctx.events.on('enemy:killed', e => {
    counters.killed++;
    kills.push(`${e.enemy.id} ${e.damage.source}${e.headshot ? ' head' : ''}${e.gibbed ? ' gib' : ''}${e.sliced ? ' slice' : ''} severed:${e.severedCount}`);
    if (kills.length > KILL_LOG) kills.shift();
  });

  await game.init(() => {});
  game.run();
  game.newRun();

  const god = params.get('god') === '1';
  if (god) ctx.player.modifiers.invulnerable = true;

  const live = (): Enemy[] => enemies.alive;
  const v = new THREE.Vector3();
  const near = (id?: string): Enemy | null => {
    let best: Enemy | null = null;
    let d = Infinity;
    for (const e of live()) {
      if (id && e.id !== id) continue;
      const x = e.position.distanceTo(ctx.player.position);
      if (x < d) {
        d = x;
        best = e;
      }
    }
    return best;
  };

  const api = {
    ctx, game, enemies, waves, counters, kills,
    spawn(id: EnemyId, dist = 25, angle?: number): Enemy | null {
      const a = angle ?? Math.random() * Math.PI * 2;
      return enemies.spawn(id, ringPoint(ctx, a, dist, v));
    },
    /** Applies damage as a shot from the player's eye would. */
    hit(e: Enemy, region: GoreRegion, amount: number, type: DamageType = 'bullet', extra: Partial<DamageInfo> = {}) {
      const dir = new THREE.Vector3().subVectors(e.center, ctx.player.eye).normalize();
      const bone = e.char.rig.bones.findIndex(b => b.region === region);
      return enemies.applyDamage(e, {
        amount, type, point: e.center.clone(), dir, force: 0, source: 'arena', region, bone: bone >= 0 ? bone : undefined, ...extra,
      });
    },
    /** Cuts regions off a living enemy without killing it. */
    maim(e: Enemy, regions: GoreRegion[]) {
      for (const r of regions) {
        e.limbHp.set(r, 0.1);
        api.hit(e, r, 1);
      }
      e.stagger = 0;
    },
    /** Removes everything with no kill events, so no streak fires between scenarios. */
    clear() {
      enemies.reset();
      ctx.gore.clear();
    },
    /** Holds the world on one frame while the camera and renderer keep going, for a clean screenshot. */
    freeze(on: boolean) {
      ctx.time.paused = on;
    },
    near,
    list: () => live().map(e => enemies.describe(e)),
    teleport(x: number, y: number, z: number, yaw = 0) {
      ctx.player.teleport(new THREE.Vector3(x, y, z), yaw);
    },
    setWave(n: number) {
      enemies.setWave(n);
    },
    /** Points the camera at an enemy, or at a world point. */
    look(target: Enemy | THREE.Vector3) {
      const t = (target as Enemy).center ?? (target as THREE.Vector3);
      const d = new THREE.Vector3().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    },
    stats: () => ({
      ...game.stats(),
      alive: live().length,
      remaining: enemies.remaining,
      wave: waves.wave,
      phase: waves.phase,
      health: ctx.player.health,
      links: enemies.linksTaken,
      rescues: enemies.rescues,
      ...counters,
    }),
  };
  (window as unknown as { __arena: typeof api }).__arena = api;
  (window as unknown as { __op2: unknown }).__op2 = { ctx, game, stats: api.stats };

  const wantWaves = params.get('waves') === '1';
  if (wantWaves) {
    const wave = Number(params.get('wave') ?? 1);
    if (wave > 1) waves.jumpTo(wave);
  } else {
    waves.reset();
    const list = (params.get('spawn') ?? 'husk').split(',') as EnemyId[];
    const count = Number(params.get('count') ?? 10);
    const dist = Number(params.get('dist') ?? 25);
    for (let i = 0; i < count; i++) {
      api.spawn(list[i % list.length]!, dist, (i / count) * Math.PI * 2);
    }
  }
}
