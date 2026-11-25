/**
 * Badlands Mode Wave Director (`BadlandsWaves`).
 *
 * Open-desert combined-arms survival built specifically for Distraint Frame (mech) combat and flight:
 *   - High human-per-wave counts starting at 26 on Wave 1 (+6/wave up to 96; max 36 simultaneous hostiles)
 *   - Every hostile vehicle class in the game converges on the desert basin:
 *       1. Technicals (`humvee`) rolling down 8 radial convoy roads with roof gunners + assault fireteams
 *       2. Troop Trucks (`truck`) delivering 6–8 man squads along the inner ring road
 *       3. Main Battle Tanks (`tank`) laying 120 mm cannon fire from Wave 2+
 *       4. Fast-Roping Transport Helicopters (`FastRopeHeli`) dropping squads onto open basin LZs
 *       5. Overhead Transport Jets (`ParatrooperSystem`) dropping paratrooper squads from Wave 2+
 *       6. Orbiting Enemy Door Gunners (`EnemyDoorGunner`) strafing from Wave 2+
 *       7. Attack Helicopters (`EnemyChopper`) hunting the player across the sky from Wave 3+
 *   - Every 5th wave is a combined-arms Boss Wave (Attack Helicopter + Tanks + Juggernaut / Titan / both).
 *   - Zero Commander (`noCommander: true`), infinite wave scaling, and dynamic flank rerouting so
 *     ground vehicles pursue the player across the 352 m × 352 m basin when flying in a Frame.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import {
  BADLANDS_BOSS_ZONES,
  BADLANDS_BOUNDS,
  BADLANDS_CONVOY_LANES,
  BADLANDS_HOVER_ZONES,
  BADLANDS_HUB,
  BADLANDS_PARATROOPER_ZONES,
  BADLANDS_RING_WAYPOINTS,
  BADLANDS_SKY_SPAWNS,
  type BadlandsDropZone,
  type BadlandsHoverZone,
  type ConvoyLane,
} from '../../world/map/badlands';
import type { EnemyManager } from '../EnemyManager';
import type { AiJetKind } from '../dogfight/aiJet';
import type { Outpost } from '../outpost';
import { SQUAD_TEMPLATES } from '../outpost/doctrine';
import { ParatrooperSystem } from '../rooftop/paratroopers';
import { EnemyChopper } from '../vehicles/chopper';
import { EnemyDoorGunner } from '../vehicles/doorGunner';
import { GroundVehicle } from '../vehicles/ground';
import { FastRopeHeli } from '../vehicles/transport';
import { BadlandsJetController } from './airstrike';

export type BadlandsDeliveryKind = 'humvee' | 'truck' | 'heli' | 'paratrooper';
export type BadlandsAirSupportKind = 'doorGunner' | 'chopper';
export type BadlandsGroundBossKind = 'juggernaut' | 'titan';

export interface BadlandsDelivery {
  readonly kind: BadlandsDeliveryKind;
  readonly men: EnemyId[];
}

/** High-density mech-shredding infantry scaling: 26 on Wave 1, +6/wave up to 96. */
export const BADLANDS_FIRST_WAVE = 26;
export const BADLANDS_PER_WAVE = 6;
export const BADLANDS_MAX_STRENGTH = 96;
/** Double Outpost's 18-hostile cap while staying cleanly under EnemyManager's MAX_ALIVE = 48. */
export const BADLANDS_MAX_HOSTILE = 36;
/** First wave on which hostile combat jets can enter Badlands airspace (strictly after Wave 5). */
export const BADLANDS_JET_MIN_WAVE = 6;

const INTERMISSION = 9;
const FIRST_WAVE_DELAY = 3;
const TICK_SECONDS = 3;
const DELIVERY_GAP = 2.1;
const TANK_DELAY = 4.0;
const TANK_GAP = 6.5;
const AIR_DELAY = 5.5;
const AIR_GAP = 9.0;
const JET_DELAY = 8.5;
const JET_GAP = 6.5;
const BOSS_DELAY = 3.0;
const REROUTE_EVERY = 3.5;
const REROUTE_DIST = 68;

const MAX_ACTIVE_GROUND = 5;
const MAX_ACTIVE_TRANSPORTS = 2;
const MAX_ACTIVE_JETS = 3;
const APPROACH_RADIUS = 178;

const TAG_HUMVEE = 'badlands_humvee';
const TAG_TRUCK = 'badlands_truck';
const TAG_TANK = 'badlands_tank';
const TAG_CHOPPER = 'badlands_chopper';
const TAG_GUNNER = 'badlands_gunner';

const FEED_CONVOY = '#ffba58';
const FEED_TANK = '#ff6a3c';
const FEED_AIR = '#ff7242';
const FEED_JET = '#ff4d3d';
const FEED_BOSS = '#ff3d3d';

const _from = new THREE.Vector3();
const _lz = new THREE.Vector3();
const _pad = new THREE.Vector3();

/** Total human infantry count for `wave` (26 on W1, +6/wave, capped at 96). */
export function badlandsWaveStrength(wave: number): number {
  const w = Math.max(1, Math.floor(wave));
  return Math.min(BADLANDS_FIRST_WAVE + BADLANDS_PER_WAVE * (w - 1), BADLANDS_MAX_STRENGTH);
}

/** Main battle tanks deployed on `wave`: 0 on W1, 1 on W2–3, 2 on W4–7, 3 on W8+ (plus +1 on boss waves). */
export function badlandsTankCount(wave: number): number {
  if (wave < 2) return 0;
  const base = wave < 4 ? 1 : wave < 8 ? 2 : 3;
  return badlandsBossForWave(wave).length > 0 ? Math.min(3, base + 1) : base;
}

/** Ground bosses on every 5th wave: W5 Juggernaut -> W10 Titan -> W15 Juggernaut + Titan -> repeats. */
export function badlandsBossForWave(wave: number): readonly BadlandsGroundBossKind[] {
  if (wave < 5 || wave % 5 !== 0) return [];
  const cycle = (Math.floor(wave / 5) - 1) % 3;
  if (cycle === 0) return ['juggernaut'];
  if (cycle === 1) return ['titan'];
  return ['juggernaut', 'titan'];
}

/** Enemy gunship / door-gunner air support dispatched on `wave`. */
export function badlandsAirSupportForWave(wave: number): readonly BadlandsAirSupportKind[] {
  if (wave < 2) return [];
  if (wave === 2) return ['doorGunner'];
  if (wave === 3) return ['chopper'];
  if (wave === 4) return ['doorGunner'];
  if (wave % 5 === 0) return ['chopper'];
  if (wave >= 6 && wave % 2 === 0) return ['doorGunner', 'chopper'];
  return ['chopper'];
}

/** Probability (0..1) that hostile combat jets conduct an airstrike on `wave` (0 on W1–5, escalating W6+). */
export function badlandsJetRaidChance(wave: number): number {
  if (wave < BADLANDS_JET_MIN_WAVE) return 0;
  if (wave % 5 === 0) return 1;
  if (wave === 6) return 0.55;
  if (wave === 7) return 0.65;
  if (wave === 8) return 0.72;
  return Math.min(0.9, 0.78 + (wave - 9) * 0.04);
}

/**
 * Rolls an optional hostile combat jet squadron for `wave` (always empty on Waves 1–5).
 * Escalates from single CAS strikers (W6) to mixed Warthog/Harrier/Hornet/Lancer/Raptor flights (W7+).
 */
export function badlandsJetRaidForWave(wave: number, roll: () => number = Math.random): readonly AiJetKind[] {
  const chance = badlandsJetRaidChance(wave);
  if (chance <= 0 || roll() >= chance) return [];

  const pick = <T>(pool: readonly T[]): T => pool[Math.min(pool.length - 1, Math.floor(roll() * pool.length))]!;

  // Boss waves after Wave 5 (W10, W15, W20...): heavy bomber/CAS strike + air-superiority ace escort!
  if (wave % 5 === 0) {
    const heavy = pick<AiJetKind>(['warthog', 'lancer']);
    const escort = pick<AiJetKind>(wave >= 10 ? ['raptor', 'hornet'] : ['hornet', 'harrier']);
    return wave >= 15 ? [heavy, escort, pick<AiJetKind>(['warthog', 'harrier', 'hornet'])] : [heavy, escort];
  }

  if (wave === 6) {
    return [pick<AiJetKind>(['warthog', 'harrier', 'hornet'])];
  }
  if (wave <= 8) {
    const pool: readonly AiJetKind[] = ['warthog', 'harrier', 'hornet', 'lancer'];
    const count = wave >= 8 && roll() < 0.55 ? 2 : 1;
    const out: AiJetKind[] = [];
    for (let i = 0; i < count; i++) out.push(pick(pool));
    return out;
  }

  const pool: readonly AiJetKind[] = wave >= 10
    ? ['warthog', 'harrier', 'hornet', 'lancer', 'raptor']
    : ['warthog', 'harrier', 'hornet', 'lancer'];
  const count = wave >= 12 && roll() < 0.45 ? 3 : 2;
  const out: AiJetKind[] = [];
  for (let i = 0; i < count; i++) out.push(pick(pool));
  return out;
}

function pickHumanSquad(wave: number, size: number, roll: () => number): EnemyId[] {
  const open = SQUAD_TEMPLATES.filter(t => t.from <= Math.max(1, wave));
  let totalWeight = 0;
  for (const t of open) totalWeight += t.weight;

  const out: EnemyId[] = [];
  while (out.length < size) {
    let r = roll() * totalWeight;
    let picked = open[0]!;
    for (const t of open) {
      r -= t.weight;
      if (r <= 0) {
        picked = t;
        break;
      }
    }
    for (const id of picked.members) {
      if (out.length >= size) break;
      out.push(id);
    }
  }
  return out;
}

/**
 * Builds the wave's combined-arms infantry delivery manifest so the exact total human count equals
 * `badlandsWaveStrength(wave)` and mixes Technicals, Troop Trucks, Fast-Rope Choppers, and (W2+) Paratrooper Jets.
 */
export function composeBadlandsWave(wave: number, roll: () => number = Math.random): BadlandsDelivery[] {
  const target = badlandsWaveStrength(wave);
  const deliveries: BadlandsDelivery[] = [];
  let remaining = target;

  // Wave 1 showcases technicals, troop trucks, AND fast-roping choppers immediately (26 humans total).
  if (wave <= 1) {
    const plan: readonly [BadlandsDeliveryKind, number][] = [
      ['humvee', 4],
      ['truck', 7],
      ['heli', 5],
      ['humvee', 4],
      ['truck', 6],
    ];
    for (const [kind, count] of plan) {
      deliveries.push({ kind, men: pickHumanSquad(1, count, roll) });
    }
    return deliveries;
  }

  // Wave 2+ cycles through all four infantry delivery vectors: humvee, truck, heli, paratrooper.
  const cycle: readonly [BadlandsDeliveryKind, number][] = [
    ['truck', 7],
    ['humvee', 4],
    ['heli', 5],
    ['paratrooper', 5],
    ['truck', 6],
    ['humvee', 4],
  ];

  let idx = (wave - 2) % cycle.length;
  while (remaining > 0) {
    const [kind, nominal] = cycle[idx % cycle.length]!;
    idx++;
    if (remaining <= 3 && deliveries.length > 0) {
      // Absorb tiny remainder into existing deliveries so no 1-man stub spawns.
      const extra = pickHumanSquad(wave, remaining, roll);
      for (let i = 0; i < extra.length; i++) {
        deliveries[i % deliveries.length]!.men.push(extra[i]!);
      }
      remaining = 0;
      break;
    }
    const count = remaining - nominal < 3 && remaining <= 8 ? remaining : Math.min(nominal, remaining);
    deliveries.push({ kind, men: pickHumanSquad(wave, count, roll) });
    remaining -= count;
  }

  return deliveries;
}

export class BadlandsWaves implements WaveSystem {
  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;

  readonly paratroopers: ParatrooperSystem;
  readonly jets: BadlandsJetController;

  private queue: BadlandsDelivery[] = [];
  private cursor = 0;
  private deliveryClock = 0;
  private pendingTanks = 0;
  private tankClock = 0;
  private pendingAir: BadlandsAirSupportKind[] = [];
  private airClock = 0;
  private pendingJets: AiJetKind[] = [];
  private jetClock = 0;
  private pendingBosses: BadlandsGroundBossKind[] = [];
  private bossClock = 0;
  private rerouteClock = REROUTE_EVERY;
  private running = false;
  private lastTick = 0;
  private targetsRegistered = false;

  private readonly laneUsedAt = new Map<string, number>();
  private readonly lzUsedAt = new Map<string, number>();
  private readonly paraUsedAt = new Map<string, number>();

  /** Telemetry for tests & debugging: records every vehicle class dispatched across the run. */
  readonly spawnedVehicles: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly o: Outpost,
    private readonly manager: EnemyManager,
  ) {
    this.paratroopers = new ParatrooperSystem(ctx, o, manager);
    this.jets = new BadlandsJetController(ctx, manager);
  }

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.nextWaveIn = 0;
    this.queue = [];
    this.cursor = 0;
    this.deliveryClock = 0;
    this.pendingTanks = 0;
    this.tankClock = 0;
    this.pendingAir = [];
    this.airClock = 0;
    this.pendingJets = [];
    this.jetClock = 0;
    this.pendingBosses = [];
    this.bossClock = 0;
    this.rerouteClock = REROUTE_EVERY;
    this.running = false;
    this.lastTick = 0;
    this.targetsRegistered = false;
    this.laneUsedAt.clear();
    this.lzUsedAt.clear();
    this.paraUsedAt.clear();
    this.spawnedVehicles.length = 0;
    this.paratroopers.reset();
    this.jets.reset();
    this.manager.queued = 0;
  }

  dispose(): void {
    this.jets.dispose();
  }

  start(): void {
    this.reset();
    this.running = true;
    this.nextWaveIn = FIRST_WAVE_DELAY;
    this.registerVehicleTargets();
    this.ctx.audio.music('easy');
  }

  /** Jump straight to a wave (useful for tests & arena debugging). */
  jumpTo(wave: number): void {
    this.running = true;
    this.registerVehicleTargets();
    this.wave = wave - 1;
    this.nextWaveIn = 0;
    this.phase = 'intermission';
  }

  private registerVehicleTargets(): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles || this.targetsRegistered) return;
    this.targetsRegistered = true;
    vehicles.target(TAG_HUMVEE);
    vehicles.target(TAG_TRUCK);
    vehicles.target(TAG_TANK);
    vehicles.target(TAG_CHOPPER);
    vehicles.target(TAG_GUNNER);
  }

  update(): void {
    if (!this.running) return;
    const dt = this.ctx.time.dt;
    this.paratroopers.update(dt);
    this.jets.update(dt);

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

    this.updateBosses(dt);
    this.updateTanks(dt);
    this.updateAirSupport(dt);
    this.updateEnemyJets(dt);
    if (this.phase === 'spawning' || this.phase === 'boss') this.feedDeliveries(dt);
    this.updateGroundPursuit(dt);
    this.checkClear();
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.registerVehicleTargets();
    this.wave = wave;
    manager.setWave(wave);

    this.queue = composeBadlandsWave(wave, Math.random);
    this.cursor = 0;
    this.deliveryClock = 0.25;

    this.pendingTanks = badlandsTankCount(wave);
    this.tankClock = this.pendingTanks > 0 ? TANK_DELAY : 0;

    this.pendingAir = [...badlandsAirSupportForWave(wave)];
    this.airClock = this.pendingAir.length > 0 ? AIR_DELAY : 0;

    this.pendingJets = [...badlandsJetRaidForWave(wave, Math.random)];
    this.jetClock = this.pendingJets.length > 0 ? JET_DELAY : 0;

    this.pendingBosses = [...badlandsBossForWave(wave)];
    this.bossClock = this.pendingBosses.length > 0 ? BOSS_DELAY : 0;

    let total = this.pendingBosses.length;
    for (const d of this.queue) total += d.men.length;
    manager.queued = total;

    const isBoss = this.pendingBosses.length > 0;
    this.phase = isBoss ? 'boss' : 'spawning';
    if (wave >= 5 || isBoss) ctx.audio.music('hard');
    ctx.audio.play(isBoss ? 'boss_alarm' : wave >= 5 ? 'wave_start_hard' : 'wave_start');
    ctx.events.emit('wave:start', { wave, total, boss: isBoss });
    this.o.onWaveStart();

    if (isBoss) {
      const label = this.pendingBosses.length > 1
        ? 'JUGGERNAUT + TITAN + AIRSTRIKE'
        : this.pendingBosses[0] === 'titan'
          ? (this.pendingJets.length > 0 ? 'TITAN + ARMOUR + FAST MOVERS' : 'TITAN + ARMOUR COLUMN')
          : 'JUGGERNAUT + ARMOUR COLUMN';
      ctx.hud.feed(`BOSS WAVE ${wave}: ${label}`, FEED_BOSS);
    } else if (wave === 1) {
      ctx.hud.feed('CONVOY & AIR ASSAULT — BOARD FRAME OR USE TERMINAL [E]', FEED_CONVOY);
    }
  }

  private cancelRemainingQueue(): void {
    let dropped = 0;
    while (this.cursor < this.queue.length) {
      dropped += this.queue[this.cursor]!.men.length;
      this.cursor++;
    }
    dropped += this.pendingBosses.length;
    this.pendingBosses.length = 0;
    this.pendingTanks = 0;
    this.pendingAir.length = 0;
    this.pendingJets.length = 0;
    this.jets.reset();
    this.manager.queued = Math.max(0, this.manager.queued - dropped);
  }

  private feedDeliveries(dt: number): void {
    if (this.cursor >= this.queue.length) {
      if (this.pendingTanks <= 0 && this.pendingBosses.length === 0 && this.phase === 'spawning') {
        this.phase = 'clearing';
      }
      return;
    }

    this.deliveryClock -= dt;
    if (this.deliveryClock > 0) return;

    const delivery = this.queue[this.cursor]!;
    const inFlight = this.paratroopers.pendingCount + this.onboardTransportTroops() + this.onboardGroundTroops();
    if (this.o.hostile + inFlight > 0 && this.o.hostile + inFlight + delivery.men.length > BADLANDS_MAX_HOSTILE) {
      return;
    }

    const vehicles = this.manager.vehicles;
    let kind = delivery.kind;

    // Prevent ground vehicle cap from stalling infantry flow: divert overflow to fast-rope or paratroopers.
    if ((kind === 'humvee' || kind === 'truck') && (!vehicles || this.activeGroundCount() >= MAX_ACTIVE_GROUND || !this.hasLiveSlot())) {
      kind = vehicles && this.activeTransportCount() < MAX_ACTIVE_TRANSPORTS && this.hasLiveSlot() ? 'heli' : 'paratrooper';
    } else if (kind === 'heli' && (!vehicles || this.activeTransportCount() >= MAX_ACTIVE_TRANSPORTS || !this.hasLiveSlot())) {
      kind = 'paratrooper';
    }

    this.dispatchDelivery(kind, delivery.men);
    this.cursor++;
    this.deliveryClock = DELIVERY_GAP;
  }

  private dispatchDelivery(kind: BadlandsDeliveryKind, men: EnemyId[]): void {
    const vehicles = this.manager.vehicles;

    if ((kind === 'humvee' || kind === 'truck') && vehicles) {
      const lane = this.pickConvoyLane();
      this.laneUsedAt.set(lane.id, this.ctx.time.elapsed);
      const route = this.buildGroundRoute(lane);
      vehicles.spawnGround(kind, {
        x: lane.spawn[0],
        y: 0,
        z: lane.spawn[1],
        route,
        tag: kind === 'humvee' ? TAG_HUMVEE : TAG_TRUCK,
        crew: men,
        crewTag: null,
        holds: false,
        holdYaw: NaN,
        parked: false,
        maxHostile: BADLANDS_MAX_HOSTILE,
        waveQueued: true,
      });
      this.spawnedVehicles.push(kind);
      return;
    }

    if (kind === 'heli' && vehicles) {
      const zone = this.pickHoverZone();
      this.lzUsedAt.set(zone.id, this.ctx.time.elapsed);
      this.approachPoint(zone.x, zone.hoverY + 20, zone.z, _from);
      _lz.set(zone.x, zone.y, zone.z);
      vehicles.spawnTransport(_from, _lz, zone.hoverY, men, null);
      this.spawnedVehicles.push('transport');
      this.ctx.hud.feed('FAST-ROPE TRANSPORT INBOUND', FEED_CONVOY);
      return;
    }

    // Paratrooper jet drop over an open desert sector (also serves as graceful fallback if VehicleSystem is absent).
    const zone = this.pickParatrooperZone();
    this.paraUsedAt.set(zone.id, this.ctx.time.elapsed);
    this.paratroopers.launchDrop(zone, men);
    this.spawnedVehicles.push('paratrooper_jet');
  }

  private updateTanks(dt: number): void {
    if (this.pendingTanks <= 0) return;
    const vehicles = this.manager.vehicles;
    if (!vehicles) {
      this.pendingTanks = 0;
      return;
    }
    this.tankClock -= dt;
    if (this.tankClock > 0) return;
    if (this.activeGroundCount() >= MAX_ACTIVE_GROUND || !this.hasLiveSlot()) {
      this.tankClock = 2.0;
      return;
    }

    const lane = this.pickConvoyLane();
    this.laneUsedAt.set(lane.id, this.ctx.time.elapsed);
    const route = this.buildGroundRoute(lane);
    vehicles.spawnGround('tank', {
      x: lane.spawn[0],
      y: 0,
      z: lane.spawn[1],
      route,
      tag: TAG_TANK,
      crew: [],
      crewTag: null,
      holds: false,
      holdYaw: NaN,
      parked: false,
      maxHostile: BADLANDS_MAX_HOSTILE,
      waveQueued: false,
    });
    this.pendingTanks--;
    this.tankClock = TANK_GAP;
    this.spawnedVehicles.push('tank');
    this.ctx.hud.feed('ENEMY BATTLE TANK ENTERING BASIN', FEED_TANK);
  }

  private updateAirSupport(dt: number): void {
    if (this.pendingAir.length === 0) return;
    const vehicles = this.manager.vehicles;
    if (!vehicles) {
      this.pendingAir.length = 0;
      return;
    }
    // Don't hold up an already-wiped ground wave on a delayed secondary air-support timer.
    if (this.cursor >= this.queue.length && this.o.hostile === 0 && this.paratroopers.pendingCount === 0 && this.activeGroundCount() === 0) {
      this.pendingAir.length = 0;
      return;
    }
    this.airClock -= dt;
    if (this.airClock > 0) return;

    const next = this.pendingAir[0]!;
    if (next === 'chopper' && this.hasActiveChopper()) {
      this.airClock = 3.0;
      return;
    }
    if (next === 'doorGunner' && this.hasActiveDoorGunner()) {
      this.airClock = 3.0;
      return;
    }
    if (vehicles.live.length >= 8) {
      this.airClock = 2.0;
      return;
    }

    this.pendingAir.shift();
    this.airClock = AIR_GAP;

    if (next === 'chopper') {
      this.perimeterSkyPoint(58, _from);
      const marks = BADLANDS_BOSS_ZONES.map(z => new THREE.Vector3(z.x, z.y + 20, z.z));
      vehicles.spawnChopper(_from, marks, TAG_CHOPPER);
      this.spawnedVehicles.push('chopper');
      this.ctx.hud.feed('ENEMY ATTACK HELICOPTER INBOUND', FEED_AIR);
    } else {
      const focus = this.ctx.player.alive ? this.ctx.player.position.clone() : BADLANDS_HUB.clone();
      this.perimeterSkyPoint(focus.y + 24, _from);
      vehicles.spawnDoorGunner(_from, focus, TAG_GUNNER);
      this.spawnedVehicles.push('doorGunner');
      this.ctx.hud.feed('ENEMY DOOR GUNNER ON STATION', FEED_AIR);
    }
  }

  private updateEnemyJets(dt: number): void {
    if (this.pendingJets.length === 0) return;
    // Don't hold up an already-wiped ground wave on a delayed secondary jet timer.
    if (
      this.cursor >= this.queue.length &&
      this.o.hostile === 0 &&
      this.paratroopers.pendingCount === 0 &&
      this.activeGroundCount() === 0 &&
      this.jets.aliveCount === 0
    ) {
      this.pendingJets.length = 0;
      return;
    }

    this.jetClock -= dt;
    if (this.jetClock > 0) return;
    if (this.jets.aliveCount >= MAX_ACTIVE_JETS) {
      this.jetClock = 3.0;
      return;
    }

    const kind = this.pendingJets.shift()!;
    const jet = this.jets.spawnJet(kind, this.wave);
    this.jetClock = JET_GAP;
    this.spawnedVehicles.push(`jet:${kind}`);
    this.ctx.hud.feed(`ENEMY ${jet.name} AIRSTRIKE INBOUND!`, FEED_JET);
  }

  private updateBosses(dt: number): void {
    if (this.pendingBosses.length === 0) return;
    this.bossClock -= dt;
    if (this.bossClock > 0) return;

    const boss = this.pendingBosses[0]!;
    const pad = this.pickBossDropZone();
    _pad.set(pad.x, pad.y, pad.z);
    this.ctx.world.nav.nearest(_pad, 5, _pad);
    const spawned = this.manager.spawnBoss(boss, _pad);
    if (spawned) {
      this.pendingBosses.shift();
      this.manager.queued = Math.max(0, this.manager.queued - 1);
      this.bossClock = 2.5;
    } else {
      this.bossClock = 1.0;
    }
  }

  /** Reroutes settled mobile ground vehicles toward a flank ring around the player when the player flies far away. */
  private updateGroundPursuit(dt: number): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    this.rerouteClock -= dt;
    if (this.rerouteClock > 0) return;
    this.rerouteClock = REROUTE_EVERY;

    const p = this.ctx.player.position;
    for (const v of vehicles.live) {
      if (!(v instanceof GroundVehicle) || !v.settled || !v.canDrive || v.crewAboard > 0) continue;
      const dist = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (dist < REROUTE_DIST) continue;
      const angle = Math.atan2(v.position.z - p.z, v.position.x - p.x) + rand(-0.55, 0.55);
      const standOff = v.def.kind === 'tank' ? 46 : 34;
      const tx = clamp(p.x + Math.cos(angle) * standOff, BADLANDS_BOUNDS.x0 + 26, BADLANDS_BOUNDS.x1 - 26);
      const tz = clamp(p.z + Math.sin(angle) * standOff, BADLANDS_BOUNDS.z0 + 26, BADLANDS_BOUNDS.z1 - 26);
      v.drive.reroute([{ x: tx, z: tz, hold: 0 }], false);
    }
  }

  private checkClear(): void {
    const { ctx, manager } = this;
    if (this.cursor < this.queue.length) return;
    if (this.pendingTanks > 0) return;
    if (this.pendingBosses.length > 0) return;
    if (this.paratroopers.pendingCount > 0) return;
    if (manager.queued > 0) return;
    if (this.o.hostile > 0) return;
    if (manager.bossDying) return;
    if (this.hasBlockingVehicles()) return;

    const bossWave = badlandsBossForWave(this.wave).length > 0;
    const bonus = 600 + 180 * this.wave + (bossWave ? 500 : 0);
    ctx.audio.play('wave_clear');
    this.phase = 'intermission';
    ctx.events.emit('wave:clear', { wave: this.wave, bonus });
    this.nextWaveIn = INTERMISSION;
  }

  private hasLiveSlot(): boolean {
    const vehicles = this.manager.vehicles;
    return vehicles !== null && vehicles.live.length < 7;
  }

  private activeGroundCount(): number {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return 0;
    let n = 0;
    for (const v of vehicles.live) {
      if (v instanceof GroundVehicle && v.alive && !v.retired) n++;
    }
    return n;
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

  private onboardGroundTroops(): number {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return 0;
    let n = 0;
    for (const v of vehicles.live) {
      if (v instanceof GroundVehicle && v.alive) n += v.crewAboard;
    }
    return n;
  }

  private hasActiveChopper(): boolean {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return false;
    for (const v of vehicles.live) {
      if (v instanceof EnemyChopper && v.alive && !v.retired) return true;
    }
    return false;
  }

  private hasActiveDoorGunner(): boolean {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return false;
    for (const v of vehicles.live) {
      if (v instanceof EnemyDoorGunner && v.alive && !v.retired) return true;
    }
    return false;
  }

  /** Live hostile ground vehicles, gunships, door gunners, jets, and payload-bearing transports block wave clear. */
  private hasBlockingVehicles(): boolean {
    if (this.jets.aliveCount > 0) return true;
    const vehicles = this.manager.vehicles;
    if (!vehicles) return false;
    for (const v of vehicles.live) {
      if (!v.alive || v.retired) continue;
      if (v instanceof GroundVehicle) return true;
      if (v instanceof EnemyChopper || v instanceof EnemyDoorGunner) return true;
      if (v instanceof FastRopeHeli && v.hasActivePayload) return true;
    }
    return false;
  }

  /** Picks a clear convoy entry lane with no vehicle blocking the entry mouth. */
  private pickConvoyLane(): ConvoyLane {
    const now = this.ctx.time.elapsed;
    const vehicles = this.manager.vehicles;
    let best = BADLANDS_CONVOY_LANES[0]!;
    let bestScore = -Infinity;

    for (const lane of BADLANDS_CONVOY_LANES) {
      let blocked = false;
      if (vehicles) {
        for (const v of vehicles.live) {
          if (Math.hypot(v.position.x - lane.spawn[0], v.position.z - lane.spawn[1]) < 24) {
            blocked = true;
            break;
          }
        }
      }
      const rested = now - (this.laneUsedAt.get(lane.id) ?? -99);
      const score = (blocked ? -100 : 0) + Math.min(rested, 30) + rand(0, 14);
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    return best;
  }

  private buildGroundRoute(lane: ConvoyLane): { x: number; z: number; hold: number }[] {
    const pts = lane.route.map(([x, z]) => ({ x, z, hold: 0 }));
    // Extend onto the next inner-ring waypoint closer to the player so vehicles spread around the basin.
    const p = this.ctx.player.position;
    let bestRing = BADLANDS_RING_WAYPOINTS[0]!;
    let bestDist = Infinity;
    for (const rw of BADLANDS_RING_WAYPOINTS) {
      const d = Math.hypot(rw[0] - p.x, rw[1] - p.z);
      if (d < bestDist) {
        bestDist = d;
        bestRing = rw;
      }
    }
    const last = pts[pts.length - 1]!;
    if (Math.hypot(bestRing[0] - last.x, bestRing[1] - last.z) > 16) {
      pts.push({ x: bestRing[0], z: bestRing[1], hold: 0 });
    }
    return pts;
  }

  private pickHoverZone(): BadlandsHoverZone {
    const now = this.ctx.time.elapsed;
    const p = this.ctx.player.position;
    let best = BADLANDS_HOVER_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of BADLANDS_HOVER_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      const rested = now - (this.lzUsedAt.get(z.id) ?? -99) > 12;
      const band = dist >= 22 && dist <= 96 ? 40 : dist < 16 ? -35 : -Math.max(0, dist - 96) * 0.3;
      const score = band + (rested ? 28 : 0) + rand(0, 18);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private pickParatrooperZone(): BadlandsDropZone {
    const now = this.ctx.time.elapsed;
    const p = this.ctx.player.position;
    let best = BADLANDS_PARATROOPER_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of BADLANDS_PARATROOPER_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      const rested = now - (this.paraUsedAt.get(z.id) ?? -99) > 10;
      const band = dist >= 20 && dist <= 110 ? 40 : -Math.abs(dist - 55) * 0.35;
      const score = band + (rested ? 25 : 0) + rand(0, 18);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private pickBossDropZone(): BadlandsDropZone {
    const p = this.ctx.player.position;
    let best = BADLANDS_BOSS_ZONES[0]!;
    let bestScore = -Infinity;
    for (const z of BADLANDS_BOSS_ZONES) {
      const dist = Math.hypot(z.x - p.x, z.z - p.z);
      const score = -Math.abs(dist - 48) + rand(0, 12);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      }
    }
    return best;
  }

  private approachPoint(lx: number, y: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const angle = Math.hypot(lx, lz) > 8 ? Math.atan2(lz, lx) + rand(-0.55, 0.55) : rand(0, Math.PI * 2);
    return out.set(Math.cos(angle) * APPROACH_RADIUS, y, Math.sin(angle) * APPROACH_RADIUS);
  }

  private perimeterSkyPoint(y: number, out: THREE.Vector3): THREE.Vector3 {
    const raw = BADLANDS_SKY_SPAWNS[Math.floor(rand(0, BADLANDS_SKY_SPAWNS.length))] ?? [120, 56, -120];
    const len = Math.max(1, Math.hypot(raw[0], raw[2]));
    return out.set((raw[0] / len) * APPROACH_RADIUS, Math.max(y, raw[1]), (raw[2] / len) * APPROACH_RADIUS);
  }
}
