/**
 * Rooftop Mode Wave Director (`RooftopWaves`).
 *
 * Endless tactical SWAT assault across the 7-tower Rooftop Skyline with ZERO thin-air spawns
 * and NO Commander:
 *   1. Stairwell / elevator bulkhead breaches (`STAIRWELL_DOORS`)
 *   2. Fast-rope SWAT transport helicopters (`FastRopeHeli` -> `HOVER_DROP_ZONES`)
 *   3. Overhead transport jet paratrooper drops (`ParatrooperSystem` -> `PARATROOPER_ZONES`)
 *   4. Enemy air support from Wave 3+ (`EnemyDoorGunner` and `EnemyChopper` — NEVER enemy AC-130)
 *   5. Every-5-wave endless boss rotation:
 *        Wave 5 / 20 / 35 ...  -> Attack Helicopter (`EnemyChopper`)
 *        Wave 10 / 25 / 40 ... -> Juggernaut (`BOSS_DROP_ZONES` + SWAT escorts)
 *        Wave 15 / 30 / 45 ... -> Titan (`BOSS_DROP_ZONES` + SWAT escorts)
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../../core/gameplay';
import { rand } from '../../core/math';
import {
  BOSS_DROP_ZONES,
  FLYER_SPAWNS,
  HOVER_DROP_ZONES,
  PARATROOPER_ZONES,
  ROOFTOP_HUB,
  STAIRWELL_DOORS,
  type HoverDropZone,
  type ParatrooperZone,
  type StairwellDoor,
} from '../../world/map/rooftop/plan';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { composeOutpostWave, MAX_HOSTILE } from '../outpost/doctrine';
import { EnemyChopper } from '../vehicles/chopper';
import { EnemyDoorGunner } from '../vehicles/doorGunner';
import { FastRopeHeli } from '../vehicles/transport';
import { ParatrooperSystem } from './paratroopers';

export type RooftopBossKind = 'chopper' | 'juggernaut' | 'titan';
export type ReinforcementVector = 'stairwell' | 'heli' | 'paratrooper';
export type RooftopAirSupportKind = 'doorGunner' | 'chopper';

export const ROOFTOP_BOSS_CYCLE: readonly RooftopBossKind[] = ['chopper', 'juggernaut', 'titan'];

const INTERMISSION = 8;
const FIRST_WAVE_DELAY = 3;
const TICK_SECONDS = 3;
const MAN_GAP = 0.45;
const SQUAD_GAP = 3.2;
const BOSS_DELAY = 2.4;
const AIR_SUPPORT_DELAY = 6.5;
const MAX_ACTIVE_TRANSPORTS = 2;
const APPROACH_RADIUS = 118;

const FEED_HELI = '#ffba58';
const FEED_AIR = '#ff7242';
const FEED_BOSS = '#ff3d3d';

const _from = new THREE.Vector3();
const _lz = new THREE.Vector3();
const _pad = new THREE.Vector3();

/** Pure every-5-wave endless boss rotation: W5 Chopper -> W10 Juggernaut -> W15 Titan -> W20 Chopper ... */
export function rooftopBossForWave(wave: number): RooftopBossKind | null {
  if (wave < 5 || wave % 5 !== 0) return null;
  const idx = (Math.floor(wave / 5) - 1) % ROOFTOP_BOSS_CYCLE.length;
  return ROOFTOP_BOSS_CYCLE[idx]!;
}

/**
 * Pure air-support selector for non-boss waves (Wave 3+).
 * Strictly Door Gunner or Attack Chopper — NEVER an enemy AC-130.
 */
export function rooftopAirSupportForWave(wave: number): RooftopAirSupportKind | null {
  if (wave < 3 || rooftopBossForWave(wave) !== null) return null;
  // Door Gunner leads early air support and alternates with Attack Choppers on higher waves.
  if (wave >= 7 && wave % 3 === 1) return 'chopper';
  return 'doorGunner';
}

/** Endless SWAT wave composition built on Outpost doctrine, scaling past wave 10 without capping. */
export function composeRooftopWave(wave: number, roll: () => number = Math.random): EnemyId[][] {
  const boss = rooftopBossForWave(wave);
  const base = composeOutpostWave(wave, roll);

  if (boss) {
    // Boss waves keep focused SWAT escort squads so the boss stays the centerpiece.
    const escortSquads = boss === 'chopper' ? 2 : Math.min(3, 2 + Math.floor(wave / 20));
    return base.slice(0, escortSquads);
  }

  // Endless escalation past wave 10: append extra veteran SWAT squads every 5 waves.
  const extra = wave > 10 ? Math.min(4, Math.floor((wave - 6) / 5)) : 0;
  for (let i = 0; i < extra; i++) {
    const more = composeOutpostWave(wave, roll);
    if (more[0]) base.push(more[0]);
  }
  return base;
}

/** Selects one of the 3 concrete reinforcement vectors (zero thin-air spawns). */
export function chooseReinforcementVector(
  wave: number,
  squadIndex: number,
  canFlyHeli: boolean,
): ReinforcementVector {
  if (wave <= 1) {
    if (squadIndex === 0) return 'stairwell';
    return canFlyHeli ? 'heli' : 'stairwell';
  }
  const order: readonly ReinforcementVector[] = ['heli', 'paratrooper', 'stairwell'];
  const picked = order[(wave + squadIndex) % order.length]!;
  if (picked === 'heli' && !canFlyHeli) return 'paratrooper';
  return picked;
}

interface DoorStream {
  door: StairwellDoor;
  ids: EnemyId[];
  seat: number;
  nextIn: number;
}

export class RooftopWaves implements WaveSystem {
  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;

  readonly paratroopers: ParatrooperSystem;

  private queue: EnemyId[][] = [];
  private cursor = 0;
  private squadClock = 0;
  private running = false;
  private lastTick = 0;
  private doorStream: DoorStream | null = null;
  private pendingBoss: RooftopBossKind | null = null;
  private bossClock = 0;
  private pendingAirSupport: RooftopAirSupportKind | null = null;
  private airSupportClock = 0;
  private readonly doorUsedAt = new Map<string, number>();
  private readonly lzUsedAt = new Map<string, number>();
  private readonly paraUsedAt = new Map<string, number>();
  private bossSerial = 0;
  private airSerial = 0;

  /** Telemetry for verification & tests: records every enemy aircraft kind dispatched. */
  readonly spawnedAircraft: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly o: Outpost,
    private readonly manager: EnemyManager,
  ) {
    this.paratroopers = new ParatrooperSystem(ctx, o, manager);
  }

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.nextWaveIn = 0;
    this.queue = [];
    this.cursor = 0;
    this.squadClock = 0;
    this.running = false;
    this.lastTick = 0;
    this.doorStream = null;
    this.pendingBoss = null;
    this.bossClock = 0;
    this.pendingAirSupport = null;
    this.airSupportClock = 0;
    this.doorUsedAt.clear();
    this.lzUsedAt.clear();
    this.paraUsedAt.clear();
    this.spawnedAircraft.length = 0;
    this.paratroopers.reset();
    this.manager.queued = 0;
  }

  start(): void {
    this.reset();
    this.running = true;
    this.nextWaveIn = FIRST_WAVE_DELAY;
    this.ctx.audio.music('easy');
  }

  /** Jump straight to a wave (useful for tests & arena debugging). */
  jumpTo(wave: number): void {
    this.running = true;
    this.wave = wave - 1;
    this.nextWaveIn = 0;
    this.phase = 'intermission';
  }

  update(): void {
    if (!this.running) return;
    const dt = this.ctx.time.dt;
    this.paratroopers.update(dt);

    if (this.phase === 'intermission') {
      this.nextWaveIn -= dt;
      const whole = Math.ceil(this.nextWaveIn);
      if (whole !== this.lastTick) {
        this.lastTick = whole;
        if (whole > 0 && whole <= TICK_SECONDS && this.wave > 0) this.ctx.audio.play('wave_tick');
      }
      if (this.nextWaveIn <= 0) this.begin(this.wave + 1);
      return;
    }

    if (this.manager.fieldCleared) {
      this.manager.fieldCleared = false;
      this.cancelRemainingQueue();
    }

    this.updateBoss(dt);
    this.updateAirSupport(dt);
    this.updateDoorStream(dt);
    if (this.phase === 'spawning' || this.phase === 'boss') this.feed(dt);
    this.checkClear();
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.wave = wave;
    manager.setWave(wave);

    const boss = rooftopBossForWave(wave);
    this.queue = composeRooftopWave(wave, Math.random);
    this.cursor = 0;
    this.doorStream = null;
    this.squadClock = 0.4;
    this.pendingBoss = boss;
    this.bossClock = boss ? BOSS_DELAY : 0;
    this.pendingAirSupport = rooftopAirSupportForWave(wave);
    this.airSupportClock = this.pendingAirSupport ? AIR_SUPPORT_DELAY : 0;

    let total = boss === 'juggernaut' || boss === 'titan' ? 1 : 0;
    for (const squad of this.queue) total += squad.length;
    manager.queued = total;

    this.phase = boss ? 'boss' : 'spawning';
    if (wave >= 10 || boss) ctx.audio.music('hard');
    ctx.audio.play(boss ? 'boss_alarm' : wave >= 10 ? 'wave_start_hard' : 'wave_start');
    ctx.events.emit('wave:start', { wave, total, boss: boss !== null });
    this.o.onWaveStart();

    if (boss) {
      const label = boss === 'chopper' ? 'ATTACK HELICOPTER' : boss === 'juggernaut' ? 'JUGGERNAUT' : 'TITAN';
      ctx.hud.feed(`BOSS WAVE ${wave}: ${label}`, FEED_BOSS);
    }
  }

  private cancelRemainingQueue(): void {
    let dropped = 0;
    while (this.cursor < this.queue.length) {
      dropped += this.queue[this.cursor]!.length;
      this.cursor++;
    }
    if (this.doorStream) {
      dropped += Math.max(0, this.doorStream.ids.length - this.doorStream.seat);
      this.doorStream = null;
    }
    if (this.pendingBoss === 'juggernaut' || this.pendingBoss === 'titan') dropped++;
    this.pendingBoss = null;
    this.pendingAirSupport = null;
    this.manager.queued = Math.max(0, this.manager.queued - dropped);
  }

  private feed(dt: number): void {
    if (this.cursor >= this.queue.length) {
      if (!this.doorStream && !this.pendingBoss && this.phase === 'spawning') {
        this.phase = 'clearing';
      }
      return;
    }
    if (this.doorStream) return;

    this.squadClock -= dt;
    if (this.squadClock > 0) return;

    const squad = this.queue[this.cursor]!;
    // Include descending paratroopers and onboard heli troops against MAX_HOSTILE so waves pace cleanly.
    const inFlight = this.paratroopers.pendingCount + this.onboardTransportTroops();
    if (this.o.hostile + inFlight > 0 && this.o.hostile + inFlight + squad.length > MAX_HOSTILE) return;

    const canFlyHeli = this.manager.vehicles !== null && this.activeTransportCount() < MAX_ACTIVE_TRANSPORTS;
    const vector = this.pendingBoss && this.cursor === 0 && canFlyHeli
      ? 'heli'
      : chooseReinforcementVector(this.wave, this.cursor, canFlyHeli);

    this.dispatchSquad(squad, vector);
    this.cursor++;
    this.squadClock = SQUAD_GAP * this.o.dread.hesitation;
  }

  private dispatchSquad(squad: EnemyId[], vector: ReinforcementVector): void {
    if (vector === 'heli' && this.manager.vehicles) {
      const zone = this.pickHoverZone();
      this.lzUsedAt.set(zone.id, this.ctx.time.elapsed);
      this.approachPoint(zone.x, zone.hoverY + 18, zone.z, _from);
      _lz.set(zone.x, zone.y, zone.z);
      this.manager.vehicles.spawnTransport(_from, _lz, zone.hoverY, squad, null);
      this.spawnedAircraft.push('transport');
      this.ctx.hud.feed('SWAT TRANSPORT INBOUND', FEED_HELI);
      return;
    }

    if (vector === 'paratrooper') {
      const zone = this.pickParatrooperZone();
      this.paraUsedAt.set(zone.id, this.ctx.time.elapsed);
      this.paratroopers.launchDrop(zone, squad);
      this.spawnedAircraft.push('paratrooper_jet');
      return;
    }

    // Stairwell / elevator bulkhead breach
    const door = this.pickStairwellDoor();
    this.doorUsedAt.set(door.id, this.ctx.time.elapsed);
    const threshold = new THREE.Vector3(door.x + door.nx * 0.65, door.y, door.z + door.nz * 0.65);
    this.ctx.world.nav.nearest(threshold, 3, threshold);
    this.o.formSquad(squad.length, threshold);
    this.doorStream = { door, ids: squad, seat: 0, nextIn: 0 };
  }

  private updateDoorStream(dt: number): void {
    const stream = this.doorStream;
    if (!stream) return;
    stream.nextIn -= dt;
    if (stream.nextIn > 0) return;

    const id = stream.ids[stream.seat]!;
    this.o.sendIn(id);
    const spawned = this.manager.alive[this.manager.alive.length - 1];
    if (spawned) {
      spawned.yaw = Math.atan2(stream.door.nx, stream.door.nz);
    }
    this.manager.queued = Math.max(0, this.manager.queued - 1);
    stream.seat++;
    if (stream.seat >= stream.ids.length) {
      this.doorStream = null;
      return;
    }
    stream.nextIn = MAN_GAP;
  }

  private updateBoss(dt: number): void {
    if (!this.pendingBoss) return;
    this.bossClock -= dt;
    if (this.bossClock > 0) return;

    const boss = this.pendingBoss;
    this.pendingBoss = null;

    if (boss === 'chopper') {
      this.spawnAttackChopper(`rooftop_boss_chopper_${++this.bossSerial}`, true);
      return;
    }

    // Juggernaut or Titan drop onto a wide BOSS_DROP_ZONES rooftop pad
    const pad = this.pickBossDropZone();
    _pad.set(pad.x, pad.y, pad.z);
    this.ctx.world.nav.nearest(_pad, 4, _pad);
    const spawned = this.manager.spawnBoss(boss, _pad);
    if (spawned) {
      this.manager.queued = Math.max(0, this.manager.queued - 1);
    } else {
      // Retry next frame if alive cap was briefly full
      this.pendingBoss = boss;
      this.bossClock = 1;
    }
  }

  private updateAirSupport(dt: number): void {
    if (!this.pendingAirSupport) return;
    // Don't hold up an already-cleared ground wave waiting on a delayed support timer.
    if (this.cursor >= this.queue.length && !this.doorStream && this.o.hostile === 0 && this.paratroopers.pendingCount === 0) {
      this.pendingAirSupport = null;
      return;
    }
    this.airSupportClock -= dt;
    if (this.airSupportClock > 0) return;

    // Never stack multiple enemy attack gunships simultaneously.
    if (this.hasActiveAttackAircraft()) {
      this.airSupportClock = 3;
      return;
    }

    const kind = this.pendingAirSupport;
    this.pendingAirSupport = null;
    if (kind === 'chopper') {
      this.spawnAttackChopper(`rooftop_air_chopper_${++this.airSerial}`, false);
    } else {
      this.spawnDoorGunner(`rooftop_door_gunner_${++this.airSerial}`);
    }
  }

  private spawnDoorGunner(tag: string): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    const focus = this.ctx.player.alive ? this.ctx.player.position.clone() : ROOFTOP_HUB.clone();
    this.perimeterSkyPoint(focus.y + 20, _from);
    vehicles.spawnDoorGunner(_from, focus, tag);
    vehicles.target(tag);
    this.spawnedAircraft.push('doorGunner');
    this.ctx.hud.feed('ENEMY DOOR GUNNER ON STATION', FEED_AIR);
  }

  private spawnAttackChopper(tag: string, isBoss: boolean): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    this.perimeterSkyPoint(58, _from);
    const marks = BOSS_DROP_ZONES.map(z => new THREE.Vector3(z.x, z.y + 18, z.z));
    vehicles.spawnChopper(_from, marks, tag);
    vehicles.target(tag);
    this.spawnedAircraft.push('chopper');
    if (!isBoss) this.ctx.hud.feed('ENEMY ATTACK CHOPPER INBOUND', FEED_AIR);
  }

  private checkClear(): void {
    const { ctx, manager } = this;
    if (this.cursor < this.queue.length) return;
    if (this.doorStream !== null) return;
    if (this.pendingBoss !== null) return;
    if (this.paratroopers.pendingCount > 0) return;
    if (manager.queued > 0) return;
    if (this.o.hostile > 0) return;
    if (manager.bossDying) return;
    if (this.hasBlockingAircraft()) return;

    const bossWave = rooftopBossForWave(this.wave) !== null;
    const bonus = 500 + 150 * this.wave + (bossWave ? 400 : 0);
    ctx.audio.play('wave_clear');
    this.phase = 'intermission';
    ctx.events.emit('wave:clear', { wave: this.wave, bonus });
    this.nextWaveIn = INTERMISSION;
  }

  private activeTransportCount(): number {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return 0;
    let n = 0;
    for (const v of vehicles.live) {
      if (v instanceof FastRopeHeli && v.alive && v.hasActivePayload) n++;
    }
    return n;
  }

  private onboardTransportTroops(): number {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return 0;
    let n = 0;
    for (const v of vehicles.live) {
      if (v instanceof FastRopeHeli && v.alive) n += v.onboardCount;
    }
    return n;
  }

  private hasActiveAttackAircraft(): boolean {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return false;
    for (const v of vehicles.live) {
      if (!v.alive || v.retired) continue;
      if (v instanceof EnemyChopper || v instanceof EnemyDoorGunner) return true;
    }
    return false;
  }

  /** Hostile gunships or transports still carrying/rappelling SWAT troops block wave clear; empty egressing transports do not. */
  private hasBlockingAircraft(): boolean {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return false;
    for (const v of vehicles.live) {
      if (!v.alive || v.retired) continue;
      if (v instanceof EnemyChopper || v instanceof EnemyDoorGunner) return true;
      if (v instanceof FastRopeHeli && v.hasActivePayload) return true;
    }
    return false;
  }

  private pickStairwellDoor(): StairwellDoor {
    const now = this.ctx.time.elapsed;
    const p = this.ctx.player.position;
    let best = STAIRWELL_DOORS[0]!;
    let bestScore = -Infinity;
    for (const d of STAIRWELL_DOORS) {
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      const rested = now - (this.doorUsedAt.get(d.id) ?? -99) > 12;
      // Sweet spot: 20..65 m away so reinforcements emerge cleanly from adjacent rooftops or behind cover.
      const band = dist >= 18 && dist <= 68 ? 35 : dist < 14 ? -50 : -Math.max(0, dist - 68) * 0.4;
      const score = band + (rested ? 25 : 0) + rand(0, 18);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  private pickHoverZone(): HoverDropZone {
    const now = this.ctx.time.elapsed;
    const p = this.ctx.player.position;
    let best = HOVER_DROP_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of HOVER_DROP_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      const rested = now - (this.lzUsedAt.get(z.id) ?? -99) > 14;
      const band = dist >= 16 && dist <= 72 ? 40 : dist < 12 ? -35 : -Math.max(0, dist - 72) * 0.35;
      const score = band + (rested ? 30 : 0) + rand(0, 20);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private pickParatrooperZone(): ParatrooperZone {
    const now = this.ctx.time.elapsed;
    const p = this.ctx.player.position;
    let best = PARATROOPER_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of PARATROOPER_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      const rested = now - (this.paraUsedAt.get(z.id) ?? -99) > 12;
      const band = dist >= 15 && dist <= 75 ? 40 : -Math.abs(dist - 40) * 0.4;
      const score = band + (rested ? 25 : 0) + rand(0, 20);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private pickBossDropZone(): ParatrooperZone {
    const p = this.ctx.player.position;
    let best = BOSS_DROP_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of BOSS_DROP_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      // Prefer a dramatic visible drop 22..58 m from the player on a wide pad.
      const score = -Math.abs(dist - 38) + rand(0, 10);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private approachPoint(lx: number, y: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    // Approach from outside the skyline perimeter away from the center so the helicopter visibly flies between/over towers.
    const angle = Math.hypot(lx, lz) > 8 ? Math.atan2(lz, lx) + rand(-0.6, 0.6) : rand(0, Math.PI * 2);
    return out.set(Math.cos(angle) * APPROACH_RADIUS, y, Math.sin(angle) * APPROACH_RADIUS);
  }

  private perimeterSkyPoint(y: number, out: THREE.Vector3): THREE.Vector3 {
    const raw = FLYER_SPAWNS[Math.floor(rand(0, FLYER_SPAWNS.length))] ?? [60, 58, 60];
    const len = Math.max(1, Math.hypot(raw[0], raw[2]));
    return out.set((raw[0] / len) * APPROACH_RADIUS, Math.max(y, raw[1]), (raw[2] / len) * APPROACH_RADIUS);
  }
}
