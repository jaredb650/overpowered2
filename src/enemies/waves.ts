/**
 * Wave director. Counts from the first game, scaled to a map nine times the size and a player three times the speed.
 * A wave is built as a queue of squads up front, then fed in as the alive cap allows.
 */
import type { Ctx } from '../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../core/gameplay';
import { clamp, randInt } from '../core/math';
import type { EnemyManager } from './EnemyManager';
import { ENEMIES } from './data';

export const MAX_ALIVE = 48;
const INTERMISSION = 8;
const BOSS_INTERMISSION = 12;
const FIRST_WAVE_DELAY = 3;
/** Countdown ticks over the last seconds of a break. */
const TICK_SECONDS = 3;
/** Count scale over the first game's 10 + 2 x wave. The swarm is slow, so numbers are its whole threat. */
const COUNT_SCALE = 2;
/** Waves 5 and 10 are about the boss. Escorts keep the pressure on without burying it. */
const BOSS_WAVE_ESCORT = 0.45;

interface RosterEntry {
  id: EnemyId;
  /** Wave this type first appears. One new type per wave, so each gets its moment. */
  from: number;
  weight: number;
  pack: readonly [number, number];
  /** Most of this type in a wave, before growth. */
  cap?: number;
  /** Rides along with each pack of this type. */
  escort?: EnemyId;
  escorts?: number;
}

const ROSTER: readonly RosterEntry[] = [
  { id: 'husk', from: 1, weight: 10, pack: [5, 9] },
  { id: 'trooper', from: 1, weight: 3, pack: [2, 3] },
  { id: 'gunner', from: 2, weight: 3, pack: [2, 3] },
  { id: 'bomber', from: 3, weight: 2, pack: [2, 3] },
  { id: 'brute', from: 4, weight: 1.2, pack: [1, 1], cap: 2, escort: 'husk', escorts: 3 },
  // Rare on purpose. One ninja in a slow crowd is an event; a pack of them is the noise the owner asked to lose.
  { id: 'stalker', from: 6, weight: 0.5, pack: [1, 2], cap: 3 },
  { id: 'rocketeer', from: 7, weight: 1.4, pack: [1, 2], cap: 4, escort: 'trooper', escorts: 2 },
  { id: 'skitter', from: 8, weight: 2.2, pack: [5, 9] },
  { id: 'leaper', from: 9, weight: 1.8, pack: [2, 4], cap: 8 },
  { id: 'riot', from: 11, weight: 1.6, pack: [2, 3], cap: 6, escort: 'trooper', escorts: 2 },
  { id: 'sniper', from: 12, weight: 1, pack: [1, 2], cap: 3 },
  { id: 'drone', from: 13, weight: 1.6, pack: [2, 3], cap: 6 },
  { id: 'burner', from: 14, weight: 1.4, pack: [1, 2], cap: 4, escort: 'husk', escorts: 3 },
  { id: 'warden', from: 15, weight: 0.9, pack: [1, 1], cap: 2, escort: 'riot', escorts: 2 },
];

export const isTitanWave = (wave: number): boolean => wave % 10 === 0;
/** Juggernauts anchor the odd fives. From wave 15 they arrive in growing numbers. */
export const isJuggernautWave = (wave: number): boolean => wave % 10 === 5;
export const isBossWave = (wave: number): boolean => isTitanWave(wave) || isJuggernautWave(wave);

const waveSize = (wave: number): number => Math.round((10 + 2 * wave) * COUNT_SCALE);

/** Builds the squads for one wave in the order they will arrive. */
export function composeWave(wave: number): EnemyId[][] {
  const out: EnemyId[][] = [];
  const unlocked = ROSTER.filter(r => r.from <= wave);
  const growth = 1 + Math.floor(wave / 10);
  const counts = new Map<EnemyId, number>();
  let budget = waveSize(wave);
  if (isBossWave(wave)) budget = Math.round(budget * BOSS_WAVE_ESCORT);

  const debuts = unlocked.filter(r => r.from === wave);
  const debut = debuts[0];
  for (const r of debuts) {
    // The new type leads the wave, alone, so the player meets it before it hides in a crowd.
    const size = Math.min(r === debut ? r.pack[1] : r.pack[0], budget);
    out.push(new Array<EnemyId>(size).fill(r.id));
    counts.set(r.id, size);
    budget -= size;
  }

  let guard = 200;
  while (budget > 0 && guard-- > 0) {
    let total = 0;
    for (const r of unlocked) if (!capped(r, counts, growth)) total += rosterWeight(r, wave);
    if (total <= 0) break;
    let roll = Math.random() * total;
    let entry = unlocked[0]!;
    for (const r of unlocked) {
      if (capped(r, counts, growth)) continue;
      roll -= rosterWeight(r, wave);
      if (roll <= 0) {
        entry = r;
        break;
      }
    }
    const size = Math.min(randInt(entry.pack[0], entry.pack[1]), budget);
    const squad = new Array<EnemyId>(size).fill(entry.id);
    if (entry.escort) for (let i = 0; i < (entry.escorts ?? 0); i++) squad.push(entry.escort);
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + size);
    budget -= squad.length;
    out.push(squad);
  }
  return out;
}

/** Fodder gives way as the waves go on, and each type grows more common the longer it has been in the game. */
function rosterWeight(r: RosterEntry, wave: number): number {
  if (r.id === 'husk') return r.weight * Math.max(0.3, 1 - 0.055 * wave);
  return r.weight * (1 + 0.12 * (wave - r.from));
}

function capped(r: RosterEntry, counts: Map<EnemyId, number>, growth: number): boolean {
  return r.cap !== undefined && (counts.get(r.id) ?? 0) >= r.cap * growth;
}

export class Waves implements WaveSystem {
  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;

  private ctx!: Ctx;
  private manager!: EnemyManager;
  private queue: EnemyId[][] = [];
  private queueCursor = 0;
  private spawnClock = 0;
  private running = false;
  private bossIds: EnemyId[] = [];
  private bossClock = 0;
  private lastWaveBoss = false;
  private lastTick = 0;

  init(ctx: Ctx): void {
    this.ctx = ctx;
    this.manager = ctx.enemies as EnemyManager;
  }

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.nextWaveIn = 0;
    this.queue.length = 0;
    this.queueCursor = 0;
    this.running = false;
    this.lastWaveBoss = false;
    this.bossIds.length = 0;
    this.manager.queued = 0;
  }

  start(): void {
    this.reset();
    this.running = true;
    this.nextWaveIn = FIRST_WAVE_DELAY;
    this.ctx.audio.music('easy');
  }

  /** For tests and the arena: jump straight to a wave. */
  jumpTo(wave: number): void {
    this.running = true;
    this.wave = wave - 1;
    this.nextWaveIn = 0;
    this.phase = 'intermission';
  }

  update(): void {
    if (!this.running) return;
    const dt = this.ctx.time.dt;
    switch (this.phase) {
      case 'intermission':
        this.nextWaveIn -= dt;
        this.tickCountdown();
        if (this.nextWaveIn <= 0) this.begin(this.wave + 1);
        break;
      case 'spawning':
      case 'boss':
        this.feed(dt);
        this.checkClear();
        break;
      case 'clearing':
        this.checkClear();
        break;
    }
  }

  private tickCountdown(): void {
    const whole = Math.ceil(this.nextWaveIn);
    if (whole === this.lastTick) return;
    this.lastTick = whole;
    if (whole > 0 && whole <= TICK_SECONDS && this.wave > 0) this.ctx.audio.play('wave_tick');
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.wave = wave;
    manager.setWave(wave);
    this.queue = composeWave(wave);
    this.queueCursor = 0;
    this.spawnClock = 0.4;
    const boss = isBossWave(wave);
    this.lastWaveBoss = boss;
    this.bossIds.length = 0;
    if (isTitanWave(wave)) this.bossIds.push('titan');
    else if (isJuggernautWave(wave)) for (let i = 0; i < 1 + Math.floor(wave / 15); i++) this.bossIds.push('juggernaut');
    this.bossClock = 2.5;
    let total = this.bossIds.length;
    for (const squad of this.queue) total += squad.length;
    manager.queued = total;
    this.phase = boss ? 'boss' : 'spawning';
    if (wave >= 10) ctx.audio.music('hard');
    ctx.audio.play(boss ? 'boss_alarm' : wave >= 10 ? 'wave_start_hard' : 'wave_start');
    ctx.world.objects.setReactorState(isTitanWave(wave) ? 'critical' : boss ? 'unstable' : 'stable');
    ctx.events.emit('wave:start', { wave, total, boss });
    const debut = ROSTER.find(r => r.from === wave);
    if (debut) ctx.hud.feed(`NEW THREAT: ${ENEMIES[debut.id].name.toUpperCase()}`, '#ff8a40');
  }

  private feed(dt: number): void {
    const { manager } = this;
    if (manager.fieldCleared) {
      manager.fieldCleared = false;
      manager.queued = 0;
      this.queueCursor = this.queue.length;
    }
    if (this.bossIds.length > 0) {
      this.bossClock -= dt;
      if (this.bossClock <= 0 && manager.spawnBoss(this.bossIds[this.bossIds.length - 1]!)) {
        this.bossIds.pop();
        manager.queued--;
        this.bossClock = 6;
      }
    }
    if (this.queueCursor >= this.queue.length) {
      if (this.bossIds.length === 0 && this.phase === 'spawning') this.phase = 'clearing';
      return;
    }
    this.spawnClock -= dt;
    if (this.spawnClock > 0) return;
    const squad = this.queue[this.queueCursor]!;
    // Held back at the cap: the rest of the wave queues until kills make room.
    if (manager.alive.length + squad.length > MAX_ALIVE) return;
    manager.spawner.spawnPack(squad);
    manager.queued -= squad.length;
    this.queueCursor++;
    this.spawnClock = squad.length * clamp(0.55 - this.wave * 0.012, 0.22, 0.55);
  }

  private checkClear(): void {
    const { manager, ctx } = this;
    if (this.queueCursor < this.queue.length || this.bossIds.length > 0) return;
    if (manager.alive.length > 0 || manager.bossDying) return;
    const bonus = 500 + 150 * this.wave;
    ctx.audio.play('wave_clear');
    ctx.world.objects.setReactorState('stable');
    ctx.events.emit('wave:clear', { wave: this.wave, bonus });
    this.phase = 'intermission';
    this.nextWaveIn = this.lastWaveBoss ? BOSS_INTERMISSION : INTERMISSION;
  }
}

