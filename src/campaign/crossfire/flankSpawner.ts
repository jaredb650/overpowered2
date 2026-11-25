/**
 * Smart Anti-Spawn-Camp Multi-Angle Dynamic Reinforcement Spawner for Crossfire Part 1 ("Valken Airbase").
 *
 * Replaces static single-door wave loops (which players and friendly AI quickly spawn-camp) with a
 * sector-aware pool of concealed flanking spawn points that:
 *   1. Reject points inside the player's forward sight cone with unobstructed world LOS or within
 *      close proximity (`< 26 m`) so enemies never pop in visibly.
 *   2. Heavily penalize points near live friendly troops or friendly AI armor (`< 24 m`) so allied
 *      squads and technicals cannot sit on top of a doorway and spawn-camp arrivals.
 *   3. Monitor `enemy:killed` events for every spawned wave unit: if a soldier dies within `6 s` of
 *      spawning or within `12 m` of its spawn point, that point is immediately flagged as camped
 *      (`24–36 s` cooldown) and remaining wave arrivals immediately reroute to a fresh flanking angle.
 *   4. Favor rotating flanking angles (`45°–145°` off player facing) and penalize recently used
 *      points so enemy pressure continually arrives from unpredictable directions.
 */
import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../../core/contracts';
import type { EnemyId, EnemyInstance } from '../../core/gameplay';
import type { EnemyManager } from '../../enemies/EnemyManager';

export type AirbaseFlankSector = 'apron' | 'tower' | 'hangar';

export interface FlankSpawnPoint {
  readonly id: string;
  readonly sector: AirbaseFlankSector;
  readonly label: string;
  readonly at: readonly [number, number, number];
}

export interface FlankPointRuntime {
  readonly def: FlankSpawnPoint;
  lastUsedAt: number;
  campedUntil: number;
  campStrikes: number;
  recentCampKills: number;
  lastCampKillAt: number;
}

export interface FriendlyPositionSource {
  (): readonly THREE.Vector3[];
}

interface QueuedSpawn {
  sector: AirbaseFlankSector;
  pointId: string;
  origin: THREE.Vector3;
  men: EnemyId[];
  seat: number;
  squadFormed: boolean;
}

interface SpawnedRecord {
  readonly pointId: string;
  readonly spawnedAt: number;
  readonly x: number;
  readonly z: number;
}

const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _spawnPos = new THREE.Vector3();

/** Concealed multi-angle flank spawn points verified clear of colliders and inside `AIRBASE_NAV_BOUNDS`. */
export const AIRBASE_FLANK_POINTS: readonly FlankSpawnPoint[] = [
  // Sector 1 (`apron`): 6 concealed angles surrounding the Fuel Apron & Inner Blast Gate approach
  { id: 'apron_hangar1_west', sector: 'apron', label: 'Maint Hangar 01 West Bay', at: [-74, 0, 82] },
  { id: 'apron_hangar2_west', sector: 'apron', label: 'Maint Hangar 02 West Bay', at: [-74, 0, 42] },
  { id: 'apron_nw_alley', sector: 'apron', label: 'NW Hangar 02 Service Alley', at: [-68, 0, 18] },
  { id: 'apron_ne_gate_pocket', sector: 'apron', label: 'NE Inner Gate Pocket', at: [16, 0, 16] },
  { id: 'apron_east_deflector_mid', sector: 'apron', label: 'East Deflector Service Lane (Mid)', at: [32, 0, 54] },
  { id: 'apron_east_deflector_south', sector: 'apron', label: 'East Deflector Service Lane (South)', at: [32, 0, 84] },

  // Sector 2 (`tower`): 5 concealed angles flanking the ATC Courtyard & Tower base
  { id: 'tower_west_back', sector: 'tower', label: 'West Behind ATC Tower', at: [-74, 0, -16] },
  { id: 'tower_nw_revetment', sector: 'tower', label: 'NW West Raptor Revetment', at: [-38, 0, -88] },
  { id: 'tower_se_runway', sector: 'tower', label: 'SE Runway Approach Edge', at: [36, 0, -14] },
  { id: 'tower_east_hangar_lane', sector: 'tower', label: 'East Alert Hangar Corridor', at: [40, 0, -76] },
  { id: 'tower_north_hangar_back', sector: 'tower', label: 'North Behind Alert Hangar', at: [12, 0, -112] },

  // Sector 3 (`hangar`): 6 concealed angles converging on the Hardened Alert Hangar & Runway Plaza
  { id: 'hangar_north_apron', sector: 'hangar', label: 'North Behind Alert Hangar', at: [12, 0, -112] },
  { id: 'hangar_east_corridor', sector: 'hangar', label: 'East Alert Hangar Corridor', at: [40, 0, -76] },
  { id: 'hangar_far_east_revetment', sector: 'hangar', label: 'Far-East Raptor Revetment', at: [86, 0, -56] },
  { id: 'hangar_nw_revetment', sector: 'hangar', label: 'NW West Raptor Revetment', at: [-38, 0, -88] },
  { id: 'hangar_se_runway', sector: 'hangar', label: 'SE Runway Approach Edge', at: [36, 0, -14] },
  { id: 'hangar_west_atc', sector: 'hangar', label: 'West Behind ATC Tower', at: [-74, 0, -16] },
];

interface SectorTuning {
  readonly interval: number;
  readonly maxActiveHostiles: number;
  readonly squadComps: readonly (readonly EnemyId[])[];
}

const SECTOR_TUNING: Readonly<Record<AirbaseFlankSector, SectorTuning>> = {
  apron: {
    interval: 6.2,
    maxActiveHostiles: 22,
    squadComps: [
      ['trooper', 'gunner', 'rocketeer', 'riot', 'trooper'],
      ['trooper', 'brute', 'gunner', 'trooper', 'rocketeer'],
      ['trooper', 'riot', 'gunner', 'rocketeer'],
      ['trooper', 'trooper', 'warden', 'gunner', 'rocketeer'],
    ],
  },
  tower: {
    interval: 8.8,
    maxActiveHostiles: 20,
    squadComps: [
      ['trooper', 'gunner', 'riot', 'rocketeer'],
      ['trooper', 'brute', 'gunner', 'trooper'],
      ['trooper', 'riot', 'rocketeer', 'warden'],
    ],
  },
  hangar: {
    interval: 7.5,
    maxActiveHostiles: 22,
    squadComps: [
      ['trooper', 'brute', 'gunner', 'rocketeer', 'riot'],
      ['trooper', 'gunner', 'rocketeer', 'trooper'],
      ['warden', 'riot', 'gunner', 'rocketeer'],
    ],
  },
};

const MIN_PLAYER_DIST = 26;
const HARD_FRIENDLY_DIST = 16;
const SOFT_FRIENDLY_DIST = 25;
const CAMP_MAX_AGE_S = 6.0;
const CAMP_MAX_DIST_M = 12.0;
const CAMP_BASE_COOLDOWN_S = 24.0;
const CAMP_ESCALATED_COOLDOWN_S = 36.0;
const STAGGER_GAP_S = 0.28;
const SPREAD_M = 1.65;

export class DynamicFlankSpawner {
  private readonly points = new Map<string, FlankPointRuntime>();
  private readonly spawned = new Map<number, SpawnedRecord>();
  private activeSector: AirbaseFlankSector | null = null;
  private now = 0;
  private waveCooldown = 0;
  private staggerClock = 0;
  private waveCounter = 0;
  private lastPickedId: string | null = null;
  private pending: QueuedSpawn | null = null;
  private unsubKilled: (() => void) | null = null;
  private friendlyVehiclesSource: FriendlyPositionSource | null = null;
  private totalSpawned = 0;
  private totalCampEvents = 0;

  constructor(
    private readonly ctx: Ctx,
    points: readonly FlankSpawnPoint[] = AIRBASE_FLANK_POINTS,
  ) {
    for (const def of points) {
      this.points.set(def.id, {
        def,
        lastUsedAt: -999,
        campedUntil: -999,
        campStrikes: 0,
        recentCampKills: 0,
        lastCampKillAt: -999,
      });
    }
    this.unsubKilled = this.ctx.events?.on?.('enemy:killed', ev => {
      this.onEnemyKilled(ev.enemy);
    }) ?? null;
  }

  /** Supplies live friendly vehicle positions (e.g. Jackals + Aegis MBT) so spawns stay clear of allied armor. */
  setFriendlyVehiclePositions(source: FriendlyPositionSource | null): void {
    this.friendlyVehiclesSource = source;
  }

  /** Activates multi-angle reinforcement waves for `sector`, or passes `null` to stop spawning. */
  setSector(sector: AirbaseFlankSector | null, initialDelay = 3.5): void {
    if (this.activeSector === sector) return;
    this.activeSector = sector;
    this.pending = null;
    this.waveCooldown = sector ? Math.max(0.5, initialDelay) : 0;
  }

  stop(): void {
    this.activeSector = null;
    this.pending = null;
  }

  /** Current clock (seconds) and debug/test inspection state. */
  get state() {
    return {
      activeSector: this.activeSector,
      totalSpawned: this.totalSpawned,
      totalCampEvents: this.totalCampEvents,
      lastPickedId: this.lastPickedId,
      campedPointIds: [...this.points.values()]
        .filter(p => this.now < p.campedUntil)
        .map(p => p.def.id),
    };
  }

  getPointRuntime(id: string): FlankPointRuntime | undefined {
    return this.points.get(id);
  }

  /** Checks whether the player has an unobstructed world line-of-sight to a candidate spawn point. */
  hasPlayerLineOfSight(px: number, py: number, pz: number, sx: number, sy: number, sz: number): boolean {
    const physics = this.ctx.physics;
    if (!physics || typeof physics.raycastInto !== 'function') return false;
    _origin.set(px, py + 1.55, pz);
    _target.set(sx, sy + 1.45, sz);
    _dir.subVectors(_target, _origin);
    const dist = _dir.length();
    if (dist < 1e-3) return true;
    _dir.multiplyScalar(1 / dist);
    const hit = physics.raycastInto(_origin, _dir, dist - 0.6, CG.World, _hit);
    // No world obstacle between player eye and spawn eye => unobstructed LOS!
    return !hit;
  }

  /** Scores a candidate spawn point; higher is better, strongly negative means unsafe/camped/visible. */
  scoreCandidate(rt: FlankPointRuntime): number {
    const [sx, sy, sz] = rt.def.at;
    let score = 100;

    // 1. Spawn-camp cooldown: decisively exclude recently camped points
    if (this.now < rt.campedUntil) {
      const remaining = rt.campedUntil - this.now;
      score -= 1000 + remaining * 10;
    }

    // 2. Player proximity, forward view cone & unobstructed LOS check
    const player = this.ctx.player;
    if (player?.position) {
      const px = player.position.x;
      const py = player.position.y;
      const pz = player.position.z;
      const dx = sx - px;
      const dz = sz - pz;
      const dist = Math.hypot(dx, dz);

      if (dist < MIN_PLAYER_DIST) {
        score -= 550 + (MIN_PLAYER_DIST - dist) * 12;
      } else if (dist >= 34 && dist <= 82) {
        score += 36;
      } else if (dist > 115) {
        score -= (dist - 115) * 0.8;
      }

      // Compute angle relative to player facing (-sin(yaw), -cos(yaw))
      const yaw = typeof player.yaw === 'number' ? player.yaw : 0;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const invD = dist > 1e-3 ? 1 / dist : 0;
      const dot = (dx * fx + dz * fz) * invD;

      const clearLos = dist < 105 && this.hasPlayerLineOfSight(px, py, pz, sx, sy, sz);
      if (dot > 0.32 && clearLos) {
        // Inside player's forward sight cone with clean LOS -> hard reject to prevent visible pop-in
        score -= 650;
      } else if (clearLos && dist < 44) {
        // Close with clear LOS even off-axis -> penalize strongly
        score -= 180;
      } else if (!clearLos) {
        // Concealed behind buildings/deflectors/walls -> strong realism bonus!
        score += 48;
      }

      // Prefer genuine flanking angles (45°..145° off forward look, dot in [-0.82, 0.70])
      if (dot >= -0.82 && dot <= 0.65) {
        score += 42;
      } else if (dot < -0.82) {
        // Behind player -> good ambush flank too
        score += 26;
      }
    }

    // 3. Friendly infantry & friendly AI vehicle proximity (prevents friendly squads/armor spawn-camping)
    const allies = this.ctx.allies?.allies;
    if (allies) {
      for (let i = 0; i < allies.length; i++) {
        const a = allies[i]!;
        if (!a.alive) continue;
        const ap = a.body?.position;
        if (!ap) continue;
        const d = Math.hypot(sx - ap.x, sz - ap.z);
        if (d < HARD_FRIENDLY_DIST) {
          score -= 480 + (HARD_FRIENDLY_DIST - d) * 14;
        } else if (d < SOFT_FRIENDLY_DIST) {
          score -= 160 * (1 - (d - HARD_FRIENDLY_DIST) / (SOFT_FRIENDLY_DIST - HARD_FRIENDLY_DIST));
        }
      }
    }

    const vehPositions = this.friendlyVehiclesSource?.();
    if (vehPositions) {
      for (let i = 0; i < vehPositions.length; i++) {
        const vp = vehPositions[i]!;
        const d = Math.hypot(sx - vp.x, sz - vp.z);
        if (d < HARD_FRIENDLY_DIST + 4) {
          score -= 520 + (HARD_FRIENDLY_DIST + 4 - d) * 16;
        } else if (d < SOFT_FRIENDLY_DIST + 6) {
          score -= 190 * (1 - (d - (HARD_FRIENDLY_DIST + 4)) / 11);
        }
      }
    }

    // 4. Rotation / anti-repeat penalty so consecutive waves come from fresh angles
    if (rt.def.id === this.lastPickedId) {
      score -= 150;
    }
    const sinceUse = this.now - rt.lastUsedAt;
    if (sinceUse < 22) {
      score -= (22 - sinceUse) * 4.5;
    }

    return score;
  }

  /** Picks the highest-scoring flank spawn point in `sector`, honoring camp cooldowns & concealment. */
  pickBestPoint(sector: AirbaseFlankSector, excludeId?: string): FlankPointRuntime | null {
    let best: FlankPointRuntime | null = null;
    let bestScore = -Infinity;

    for (const rt of this.points.values()) {
      if (rt.def.sector !== sector) continue;
      if (excludeId && rt.def.id === excludeId) continue;
      const score = this.scoreCandidate(rt);
      if (score > bestScore) {
        bestScore = score;
        best = rt;
      }
    }

    // Fallback if excluding the only candidate left nothing
    if (!best && excludeId) {
      return this.points.get(excludeId) ?? null;
    }
    return best;
  }

  /** Handles enemy death notifications to detect and immediately punish spawn-camping on any point. */
  private onEnemyKilled(enemy: EnemyInstance): void {
    const rec = this.spawned.get(enemy.uid);
    if (!rec) return;
    this.spawned.delete(enemy.uid);

    const age = this.now - rec.spawnedAt;
    const dist = Math.hypot(enemy.position.x - rec.x, enemy.position.z - rec.z);
    if (age > CAMP_MAX_AGE_S && dist > CAMP_MAX_DIST_M) return;

    const rt = this.points.get(rec.pointId);
    if (!rt) return;

    // Reset strike decay if the point hasn't been camped recently
    if (this.now - rt.lastCampKillAt > 30) {
      rt.recentCampKills = 0;
    }
    rt.recentCampKills++;
    rt.lastCampKillAt = this.now;
    rt.campStrikes++;
    this.totalCampEvents++;

    const cooldown = rt.campStrikes >= 2 ? CAMP_ESCALATED_COOLDOWN_S : CAMP_BASE_COOLDOWN_S;
    rt.campedUntil = Math.max(rt.campedUntil, this.now + cooldown);

    // If a wave is actively trickling out of this exact point right now, reroute remaining troops immediately!
    if (this.pending && this.pending.pointId === rec.pointId && this.pending.seat < this.pending.men.length) {
      const alt = this.pickBestPoint(this.pending.sector, rec.pointId);
      if (alt) {
        this.pending.pointId = alt.def.id;
        this.pending.origin.set(alt.def.at[0], alt.def.at[1], alt.def.at[2]);
        this.pending.squadFormed = false;
        alt.lastUsedAt = this.now;
        this.lastPickedId = alt.def.id;
      }
    }
  }

  private pruneOldRecords(): void {
    if (this.spawned.size === 0) return;
    for (const [uid, rec] of this.spawned) {
      if (this.now - rec.spawnedAt > 45) {
        this.spawned.delete(uid);
      }
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.now += dt;
    this.pruneOldRecords();

    if (!this.activeSector) return;
    const tuning = SECTOR_TUNING[this.activeSector];
    const enemies = this.ctx.enemies as unknown as EnemyManager | undefined;
    if (!enemies || typeof enemies.spawn !== 'function') return;

    // 1. Drain any active staggered squad spawn
    if (this.pending) {
      this.staggerClock -= dt;
      if (this.staggerClock > 0) return;

      const cur = this.pending;
      const aliveCount = enemies.alive?.length ?? 0;
      if (aliveCount >= 26) {
        // Cap full — drop remainder so we don't freeze the queue
        this.pending = null;
        return;
      }

      if (!cur.squadFormed) {
        cur.squadFormed = true;
        const remaining = cur.men.length - cur.seat;
        enemies.outpost?.formSquad?.(remaining, cur.origin);
      }

      const angle = cur.seat * 2.39996;
      const radius = cur.seat === 0 ? 0 : SPREAD_M * Math.sqrt(cur.seat);
      _spawnPos.set(
        cur.origin.x + Math.cos(angle) * radius,
        cur.origin.y,
        cur.origin.z + Math.sin(angle) * radius,
      );
      if (this.ctx.world?.nav?.nearest) {
        if (!this.ctx.world.nav.nearest(_spawnPos, 5.5, _spawnPos)) {
          _spawnPos.copy(cur.origin);
        }
      }

      const kind = cur.men[cur.seat]!;
      const body = enemies.spawn(kind, _spawnPos);
      if (body) {
        this.totalSpawned++;
        this.spawned.set(body.uid, {
          pointId: cur.pointId,
          spawnedAt: this.now,
          x: _spawnPos.x,
          z: _spawnPos.z,
        });
      }

      cur.seat++;
      this.staggerClock = STAGGER_GAP_S;
      if (cur.seat >= cur.men.length) {
        this.pending = null;
      }
      return;
    }

    // 2. Schedule next flanking wave when sector hostile count drops below target pressure
    this.waveCooldown -= dt;
    if (this.waveCooldown > 0) return;

    const aliveCount = enemies.alive?.length ?? 0;
    if (aliveCount >= tuning.maxActiveHostiles) {
      this.waveCooldown = 1.8;
      return;
    }

    const picked = this.pickBestPoint(this.activeSector);
    if (!picked) {
      this.waveCooldown = 2.0;
      return;
    }

    const comp = tuning.squadComps[this.waveCounter % tuning.squadComps.length]!;
    this.waveCounter++;
    picked.lastUsedAt = this.now;
    this.lastPickedId = picked.def.id;

    // Trim squad size cleanly if close to cap
    const room = Math.max(2, Math.min(comp.length, 26 - aliveCount));
    this.pending = {
      sector: this.activeSector,
      pointId: picked.def.id,
      origin: new THREE.Vector3(picked.def.at[0], picked.def.at[1], picked.def.at[2]),
      men: comp.slice(0, room),
      seat: 0,
      squadFormed: false,
    };
    this.staggerClock = 0;
    this.waveCooldown = tuning.interval;
  }

  reset(): void {
    this.activeSector = null;
    this.pending = null;
    this.spawned.clear();
    this.now = 0;
    this.waveCooldown = 0;
    this.staggerClock = 0;
    this.waveCounter = 0;
    this.lastPickedId = null;
    this.totalSpawned = 0;
    this.totalCampEvents = 0;
    for (const rt of this.points.values()) {
      rt.lastUsedAt = -999;
      rt.campedUntil = -999;
      rt.campStrikes = 0;
      rt.recentCampKills = 0;
      rt.lastCampKillAt = -999;
    }
  }

  dispose(): void {
    this.unsubKilled?.();
    this.unsubKilled = null;
    this.reset();
  }
}
