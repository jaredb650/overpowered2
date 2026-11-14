/**
 * Wave director. Counts from the first game, scaled to a map nine times the size and a player three times the speed.
 * A wave is built as a queue of squads up front, then fed in as the alive cap allows.
 *
 * What a wave holds and when the bosses come are The Crucible's rules (rules.ts). The defaults are the standard game.
 */
import type { Ctx } from '../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../core/gameplay';
import { clamp, randInt } from '../core/math';
import { crucibleRules } from '../contracts/crucible';
import type { EnemyManager } from './EnemyManager';
import { ENEMIES } from './data';
import { DEFAULT_RULES, ROSTER, bossesFor, juggernautWave, rosterFor, titanWave, type CrucibleRules, type RosterEntry } from './rules';

/** The manager's hard cap, for every contract. The rules' `maxAlive` can only hold the feed below it. */
export const MAX_ALIVE = 48;
const FIRST_WAVE_DELAY = 3;
/** Countdown ticks over the last seconds of a break. */
const TICK_SECONDS = 3;
/** Count scale over the first game's 10 + 2 x wave. The swarm is slow, so numbers are its whole threat. */
const COUNT_SCALE = 2;

/** Waves 10, 20, 30 on the standard rules. */
export const isTitanWave = (wave: number, rules: CrucibleRules = DEFAULT_RULES): boolean => titanWave(wave, rules);
/** Juggernauts anchor the odd fives on the standard rules. From wave 15 they arrive in growing numbers. */
export const isJuggernautWave = (wave: number, rules: CrucibleRules = DEFAULT_RULES): boolean => juggernautWave(wave, rules);
export const isBossWave = (wave: number, rules: CrucibleRules = DEFAULT_RULES): boolean => bossesFor(wave, rules).length > 0;

/**
 * Builds the squads for one wave in the order they will arrive. `roster` is `rosterFor(rules)`, passed in by a caller that
 * builds many waves on one rule set.
 */
export function composeWave(wave: number, rules: CrucibleRules = DEFAULT_RULES, roster: readonly RosterEntry[] = rosterFor(rules)): EnemyId[][] {
  const out: EnemyId[][] = [];
  const unlocked = roster.filter(r => r.from <= wave);
  // A bigger wave lifts the caps with it, or the extra would all be fodder. A smaller one keeps them.
  const capScale = Math.max(1, rules.sizePct / 100);
  const growth = (1 + Math.floor(wave / 10)) * capScale;
  const counts = new Map<EnemyId, number>();
  let budget = Math.round((10 + 2 * wave) * COUNT_SCALE * (rules.sizePct / 100));
  // A boss wave is about the boss. Escorts keep the pressure on without burying it.
  if (isBossWave(wave, rules)) budget = Math.round(budget * (rules.escortPct / 100));

  const debuts = debutsOn(unlocked, wave);
  const debut = debuts[0];
  for (const r of debuts) {
    // The new type leads the wave, alone, so the player meets it before it hides in a crowd.
    const size = Math.min(r === debut ? r.pack[1] : r.pack[0], budget);
    if (size <= 0) break;
    out.push(new Array<EnemyId>(size).fill(r.id));
    counts.set(r.id, size);
    budget -= size;
  }

  // An escort waits for its own first wave, as every type does. The standard roster's escorts are always in by then.
  const arrived = new Set<EnemyId>(unlocked.map(r => r.id));
  let guard = Math.ceil(200 * capScale);
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
    if (entry.escort && arrived.has(entry.escort)) for (let i = 0; i < (entry.escorts ?? 0); i++) squad.push(entry.escort);
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + size);
    budget -= squad.length;
    out.push(squad);
  }
  return out;
}

/**
 * The types that first come in on `wave`, the one to lead it first: the latest of them in the standard game, so a type the
 * rules moved onto a busy wave, such as wave 1, still leads it and is the one announced. A tie keeps roster order, which is
 * the standard wave 1, husk then trooper, the only wave the standard game brings two types in on. No random draws.
 */
function debutsOn(roster: readonly RosterEntry[], wave: number): RosterEntry[] {
  return roster.filter(r => r.from === wave).sort((a, b) => DEFAULT_RULES.types[b.id].from - DEFAULT_RULES.types[a.id].from);
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
  /** The run's rules, taken once at its start. */
  rules: CrucibleRules = DEFAULT_RULES;

  private roster: readonly RosterEntry[] = ROSTER;
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

  /** `rules` is for the tests. A run plays the page's own (contracts/crucible.ts). */
  start(rules: CrucibleRules = crucibleRules()): void {
    this.reset();
    this.rules = rules;
    this.roster = rosterFor(rules);
    // Only this game sets these, after the manager's own reset put them back to 1.
    this.manager.tuning.health = rules.healthPct / 100;
    this.manager.tuning.damage = rules.damagePct / 100;
    this.manager.tuning.helmetsFrom = rules.helmetsFrom;
    this.running = true;
    // The plate reads the wave to come during a break, so a late start shows its own number from the first second.
    this.wave = rules.startWave - 1;
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
    // The first countdown of a run is silent.
    if (whole > 0 && whole <= TICK_SECONDS && this.wave >= this.rules.startWave) this.ctx.audio.play('wave_tick');
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.wave = wave;
    manager.setWave(wave);
    this.queue = composeWave(wave, this.rules, this.roster);
    this.queueCursor = 0;
    this.spawnClock = 0.4;
    // Popped from the end: Juggernauts land in turn, and a Titan, whose death clears the field, comes alone.
    const plan = bossesFor(wave, this.rules);
    const boss = plan.length > 0;
    this.lastWaveBoss = boss;
    this.bossIds.length = 0;
    for (const id of plan) this.bossIds.push(id);
    this.bossClock = 2.5;
    let total = this.bossIds.length;
    for (const squad of this.queue) total += squad.length;
    manager.queued = total;
    this.phase = boss ? 'boss' : 'spawning';
    if (wave >= 10) ctx.audio.music('hard');
    ctx.audio.play(boss ? 'boss_alarm' : wave >= 10 ? 'wave_start_hard' : 'wave_start');
    ctx.world.objects.setReactorState(plan.includes('titan') ? 'critical' : boss ? 'unstable' : 'stable');
    ctx.events.emit('wave:start', { wave, total, boss });
    // The type that leads this wave as its debut. A boss wave with no escort has no squad to name.
    const debut = debutsOn(this.roster, wave)[0];
    if (debut && this.queue[0]?.[0] === debut.id) ctx.hud.feed(`NEW THREAT: ${ENEMIES[debut.id].name.toUpperCase()}`, '#ff8a40');
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
    // Held back at the cap: the rest of the wave queues until kills make room. An empty field always takes the next squad.
    const alive = manager.alive.length;
    if (alive > 0 && alive + squad.length > this.rules.maxAlive) return;
    manager.spawner.spawnPack(squad);
    manager.queued -= squad.length;
    this.queueCursor++;
    this.spawnClock = (squad.length * clamp(0.55 - this.wave * 0.012, 0.22, 0.55)) / (this.rules.feedPct / 100);
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
    this.nextWaveIn = this.lastWaveBoss ? this.rules.bossBreakSeconds : this.rules.breakSeconds;
  }
}

