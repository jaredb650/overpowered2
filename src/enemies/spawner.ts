/**
 * Puts enemies on the map. Every entrance happens out of the player's sight and within reach by path, so the fight
 * always comes to the player, and the bigger map never turns into a long walk with nothing on it.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { rand, randInt } from '../core/math';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import type { EnemyManager } from './EnemyManager';

/** By route. At a shamble that is about 8 to 15 seconds of walking, so a wave reaches the player while it matters. */
const PATH_MIN = 30;
const PATH_MAX = 60;
/** A point stays cold for this long, so packs do not arrive through one door. */
const REUSE_SECONDS = 4;
const DROP_HEIGHT = 15;
const PACK_SPREAD = 3.2;
const MAX_TRIES = 28;
/** Coprime with the point count, or the scan would keep landing on the same few spawns. */
const SCAN_STEP = 37;
/** Clear air a boss needs above a landing site, in metres. */
const BOSS_SKY = 16;
/** Height above the feet that the player has to be able to see, in metres. */
const BOSS_CHEST = 3;
/** Metres of extra walk a landing in view is worth over one out of it. */
const UNSEEN_LANDING = 60;

const _p = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Spawner {
  /** Spawn point index to the world time it can be used again. */
  private coldUntil = new Map<SpawnPoint, number>();

  constructor(private readonly w: AiWorld, private readonly m: EnemyManager) {}

  reset(): void {
    this.coldUntil.clear();
  }

  private inSight(p: THREE.Vector3): boolean {
    const player = this.w.player;
    _to.subVectors(p, player.eye);
    const dist = _to.length();
    if (dist < 1) return true;
    _to.multiplyScalar(1 / dist);
    // Behind the camera is out of sight, whatever the walls do.
    if (_to.dot(player.forward) < 0.25) return false;
    _eye.copy(p);
    _eye.y += 1.6;
    return this.w.director.clearLine(_eye, player.eye);
  }

  /** Best point for an entrance. Widens the band rather than failing, because a wave must always spawn. */
  pick(kinds: readonly SpawnPoint['kind'][], minPath = PATH_MIN, maxPath = PATH_MAX): SpawnPoint | null {
    const points = this.w.ctx.world.spawnPoints;
    const n = points.length;
    if (n === 0) return null;
    const { nav, objects } = this.w.ctx.world;
    const now = this.w.now;
    let fallback: SpawnPoint | null = null;
    let fallbackScore = Infinity;
    const start = randInt(0, n - 1);
    let tried = 0;
    for (let i = 0; i < n && tried < MAX_TRIES; i++) {
      const s = points[(start + i * SCAN_STEP) % n]!;
      if (!kinds.includes(s.kind)) continue;
      if (now < (this.coldUntil.get(s) ?? 0)) continue;
      const path = s.kind === 'air' ? s.position.distanceTo(this.w.player.position) : nav.pathDistance(s.position);
      if (!Number.isFinite(path) || objects.hazardAt(s.position)) continue;
      tried++;
      const off = path < minPath ? minPath - path : path > maxPath ? path - maxPath : 0;
      const seen = this.inSight(s.position);
      if (off === 0 && !seen) {
        this.coldUntil.set(s, now + REUSE_SECONDS);
        return s;
      }
      // Being seen is the worst thing a spawn can do, then being close. A long walk is the cheapest compromise, so a
      // point just inside the band must still lose to one a long way past it.
      const score = off + (seen ? 400 : 0) + (path < minPath ? 200 : 0);
      if (score < fallbackScore) {
        fallbackScore = score;
        fallback = s;
      }
    }
    if (fallback) this.coldUntil.set(fallback, now + REUSE_SECONDS);
    return fallback;
  }

  /**
   * A landing site for a boss: open sky over it, and in plain view. Coming down in a pit behind a wall would waste the
   * entrance, so the player's eye must reach the point where its chest will be.
   */
  pickArena(minPath: number, maxPath: number): SpawnPoint | null {
    const { ctx, director, player } = this.w;
    const nav = ctx.world.nav;
    const points = ctx.world.spawnPoints;
    let best: SpawnPoint | null = null;
    let bestScore = Infinity;
    for (const s of points) {
      if (s.kind === 'air') continue;
      const path = nav.pathDistance(s.position);
      if (!Number.isFinite(path)) continue;
      const off = path < minPath ? minPath - path : path > maxPath ? path - maxPath : 0;
      if (off >= bestScore) continue;
      _p.copy(s.position);
      _p.y += 1.5;
      if (ctx.physics.raycast(_p, UP, BOSS_SKY) !== null) continue;
      _p.y += BOSS_CHEST;
      const score = off + (director.clearLine(_p, player.eye) ? 0 : UNSEEN_LANDING);
      if (score < bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return best ?? this.pick(['ground', 'gate'], minPath, maxPath);
  }

  /** Spawns a pack around one point. Returns how many made it in. */
  spawnPack(ids: readonly EnemyId[]): number {
    const air = ids[0] === 'drone';
    const point = this.pick(air ? ['air'] : ['ground', 'gate']) ?? this.pick(['ground', 'gate', 'air']);
    if (!point) return 0;
    const { director, player } = this.w;
    const bearing = Math.atan2(point.position.x - player.position.x, point.position.z - player.position.z);
    const squad = director.makeSquad(ids.length, bearing);
    let made = 0;
    for (let i = 0; i < ids.length; i++) {
      const e = this.spawnAt(ids[i]!, point, i);
      if (!e) continue;
      director.joinSquad(e, squad, i);
      made++;
    }
    return made;
  }

  private spawnAt(id: EnemyId, point: SpawnPoint, index: number): Enemy | null {
    const nav = this.w.ctx.world.nav;
    _p.copy(point.position);
    if (index > 0) {
      const a = index * 2.399963;
      const r = PACK_SPREAD * Math.sqrt(index / 4);
      _p.x += Math.sin(a) * r;
      _p.z += Math.cos(a) * r;
      if (point.kind !== 'air' && !nav.nearest(_p, 4, _p)) _p.copy(point.position);
    }
    const e = this.m.spawn(id, _p);
    if (!e) return null;
    this.enter(e, point);
    return e;
  }

  /** The way in depends on the point. Flyers need none: they start where they belong. */
  enter(e: Enemy, point: SpawnPoint): void {
    const { fx, audio } = this.w.ctx;
    if (point.kind === 'gate') this.gate(e);
    else if (e.id !== 'drone') this.drop(e);
    fx.spawnIn(point.position, 0x59d8ff, e.char.rig.height);
    audio.play('enemy_spawn', { position: point.position });
  }

  /** Falls in from out of frame. A thud at range tells the player where the next squad is. */
  private drop(e: Enemy): void {
    e.entrance = 'drop';
    e.airborne = true;
    e.position.y += DROP_HEIGHT;
    e.verticalSpeed = -rand(16, 24);
    e.velocity.set(0, 0, 0);
  }

  /** Walks out of a door. */
  private gate(e: Enemy): void {
    e.entrance = 'gate';
    e.entranceTime = rand(0.5, 0.9);
    if (!this.w.ctx.world.nav.flowDirection(e.position, e.entranceDir)) e.entranceDir.set(0, 0, 1);
  }
}
