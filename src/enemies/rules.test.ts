/**
 * The Crucible's rules. The first block holds the standard rules to the game as it was: a frozen copy of the wave logic from
 * before the rules existed runs beside the new one on the same seeded Math.random, wave by wave and frame by frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { mulberry32, randInt } from '../core/math';
import { ENEMIES } from './data';
import {
  COUNT_LIMIT, DEFAULT_RULES, EVERY_LIMIT, ROSTER, RULE_LIMITS, SWARM_IDS, WAVE_LIMIT, bossesFor, cloneRules, diffRules, firstEnemyWave,
  isCustom, juggernautCount, rosterFor, rulesEqual, sanitizeRules, snap, type CrucibleRules, type NumberRule,
} from './rules';
import { MAX_ALIVE, Waves, composeWave, isBossWave, isJuggernautWave, isTitanWave } from './waves';

// --- The wave logic as it was, copied before the rules went in. Do not edit. ------------------------------------------

const OLD_MAX_ALIVE = 48;
const OLD_INTERMISSION = 8;
const OLD_BOSS_INTERMISSION = 12;
const OLD_FIRST_WAVE_DELAY = 3;
const OLD_TICK_SECONDS = 3;
const OLD_COUNT_SCALE = 2;
const OLD_BOSS_WAVE_ESCORT = 0.45;

interface OldEntry {
  id: EnemyId;
  from: number;
  weight: number;
  pack: readonly [number, number];
  cap?: number;
  escort?: EnemyId;
  escorts?: number;
}

const OLD_ROSTER: readonly OldEntry[] = [
  { id: 'husk', from: 1, weight: 10, pack: [5, 9] },
  { id: 'trooper', from: 1, weight: 3, pack: [2, 3] },
  { id: 'gunner', from: 2, weight: 3, pack: [2, 3] },
  { id: 'bomber', from: 3, weight: 2, pack: [2, 3] },
  { id: 'brute', from: 4, weight: 1.2, pack: [1, 1], cap: 2, escort: 'husk', escorts: 3 },
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

const oldIsTitanWave = (wave: number): boolean => wave % 10 === 0;
const oldIsJuggernautWave = (wave: number): boolean => wave % 10 === 5;
const oldIsBossWave = (wave: number): boolean => oldIsTitanWave(wave) || oldIsJuggernautWave(wave);
const oldWaveSize = (wave: number): number => Math.round((10 + 2 * wave) * OLD_COUNT_SCALE);

function oldComposeWave(wave: number): EnemyId[][] {
  const out: EnemyId[][] = [];
  const unlocked = OLD_ROSTER.filter(r => r.from <= wave);
  const growth = 1 + Math.floor(wave / 10);
  const counts = new Map<EnemyId, number>();
  let budget = oldWaveSize(wave);
  if (oldIsBossWave(wave)) budget = Math.round(budget * OLD_BOSS_WAVE_ESCORT);
  const debuts = unlocked.filter(r => r.from === wave);
  const debut = debuts[0];
  for (const r of debuts) {
    const size = Math.min(r === debut ? r.pack[1] : r.pack[0], budget);
    out.push(new Array<EnemyId>(size).fill(r.id));
    counts.set(r.id, size);
    budget -= size;
  }
  let guard = 200;
  while (budget > 0 && guard-- > 0) {
    let total = 0;
    for (const r of unlocked) if (!oldCapped(r, counts, growth)) total += oldRosterWeight(r, wave);
    if (total <= 0) break;
    let roll = Math.random() * total;
    let entry = unlocked[0]!;
    for (const r of unlocked) {
      if (oldCapped(r, counts, growth)) continue;
      roll -= oldRosterWeight(r, wave);
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

function oldRosterWeight(r: OldEntry, wave: number): number {
  if (r.id === 'husk') return r.weight * Math.max(0.3, 1 - 0.055 * wave);
  return r.weight * (1 + 0.12 * (wave - r.from));
}

function oldCapped(r: OldEntry, counts: Map<EnemyId, number>, growth: number): boolean {
  return r.cap !== undefined && (counts.get(r.id) ?? 0) >= r.cap * growth;
}

const oldBosses = (wave: number): EnemyId[] => {
  if (oldIsTitanWave(wave)) return ['titan'];
  if (oldIsJuggernautWave(wave)) return new Array<EnemyId>(1 + Math.floor(wave / 15)).fill('juggernaut');
  return [];
};

class OldWaves {
  wave = 0;
  phase = 'intermission';
  nextWaveIn = 0;
  private ctx!: Harness['ctx'];
  private manager!: Harness['manager'];
  private queue: EnemyId[][] = [];
  private queueCursor = 0;
  private spawnClock = 0;
  private running = false;
  private bossIds: EnemyId[] = [];
  private bossClock = 0;
  private lastWaveBoss = false;
  private lastTick = 0;

  init(ctx: Harness['ctx']): void {
    this.ctx = ctx;
    this.manager = ctx.enemies;
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
    this.nextWaveIn = OLD_FIRST_WAVE_DELAY;
    this.ctx.audio.music('easy');
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
    if (whole > 0 && whole <= OLD_TICK_SECONDS && this.wave > 0) this.ctx.audio.play('wave_tick');
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.wave = wave;
    manager.setWave(wave);
    this.queue = oldComposeWave(wave);
    this.queueCursor = 0;
    this.spawnClock = 0.4;
    const boss = oldIsBossWave(wave);
    this.lastWaveBoss = boss;
    this.bossIds.length = 0;
    if (oldIsTitanWave(wave)) this.bossIds.push('titan');
    else if (oldIsJuggernautWave(wave)) for (let i = 0; i < 1 + Math.floor(wave / 15); i++) this.bossIds.push('juggernaut');
    this.bossClock = 2.5;
    let total = this.bossIds.length;
    for (const squad of this.queue) total += squad.length;
    manager.queued = total;
    this.phase = boss ? 'boss' : 'spawning';
    if (wave >= 10) ctx.audio.music('hard');
    ctx.audio.play(boss ? 'boss_alarm' : wave >= 10 ? 'wave_start_hard' : 'wave_start');
    ctx.world.objects.setReactorState(oldIsTitanWave(wave) ? 'critical' : boss ? 'unstable' : 'stable');
    ctx.events.emit('wave:start', { wave, total, boss });
    const debut = OLD_ROSTER.find(r => r.from === wave);
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
    if (manager.alive.length + squad.length > OLD_MAX_ALIVE) return;
    manager.spawner.spawnPack(squad);
    manager.queued -= squad.length;
    this.queueCursor++;
    this.spawnClock = squad.length * Math.min(0.55, Math.max(0.22, 0.55 - this.wave * 0.012));
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
    this.nextWaveIn = this.lastWaveBoss ? OLD_BOSS_INTERMISSION : OLD_INTERMISSION;
  }
}

// --- A stand-in game for either director ---------------------------------------------------------------------------

/** Kills one enemy, oldest first, every `killEvery` frames. A Titan's death clears the field, as bosses.ts does. */
function harness(killEvery = 5) {
  const log: string[] = [];
  let frame = 0;
  const at = (s: string) => log.push(`${frame} ${s}`);
  const alive: EnemyId[] = [];
  let peak = 0;
  const manager = {
    alive,
    queued: 0,
    fieldCleared: false,
    bossDying: false,
    tuning: { health: 1, damage: 1 },
    setWave: (w: number) => at(`setWave ${w}`),
    spawnBoss: (id: EnemyId) => {
      at(`boss ${id}`);
      alive.push(id);
      return {};
    },
    spawner: {
      spawnPack: (ids: readonly EnemyId[]) => {
        at(`pack ${ids.join(',')}`);
        alive.push(...ids);
        peak = Math.max(peak, alive.length);
      },
    },
  };
  const ctx = {
    time: { dt: 0.1 },
    enemies: manager,
    audio: { music: (m: string) => at(`music ${m}`), play: (s: string) => at(`play ${s}`) },
    world: { objects: { setReactorState: (s: string) => at(`reactor ${s}`) } },
    events: { emit: (name: string, e: unknown) => at(`${name} ${JSON.stringify(e)}`) },
    hud: { feed: (text: string, color?: string) => at(`feed ${text} ${color}`) },
  };
  const step =(w: { update(): void; wave: number; phase: string; nextWaveIn: number }) => {
    w.update();
    if (frame % killEvery === 0 && alive.length > 0) {
      const dead = alive.shift();
      if (dead === 'titan') {
        manager.fieldCleared = true;
        alive.length = 0;
      }
    }
    log.push(`${frame} | ${w.wave} ${w.phase} ${w.nextWaveIn} ${manager.queued} ${alive.length}`);
    frame++;
  };
  return { ctx, manager, log, step, peak: () => peak };
}
type Harness = ReturnType<typeof harness>;

function seeded(seed: number): { draws: () => number } {
  const next = mulberry32(seed);
  let draws = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    draws++;
    return next();
  });
  return { draws: () => draws };
}

const newWaves = (h: Harness): Waves => {
  const w = new Waves();
  w.init(h.ctx as unknown as Ctx);
  return w;
};

/** Plays waves until `last` is cleared, or the frame budget runs out. */
function play(h: Harness, w: { update(): void; wave: number; phase: string; nextWaveIn: number }, last: number): void {
  for (let i = 0; i < 400_000; i++) {
    h.step(w);
    if (w.wave > last) return;
  }
  throw new Error(`stalled on wave ${w.wave}`);
}

function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `line ${i}: old "${a[i]}" new "${b[i]}"`;
  return null;
}

/** A private method, for tests that build one wave without playing it. */
const begin = (w: Waves, wave: number) => (w as unknown as { begin(n: number): void }).begin(wave);
const queueOf = (w: Waves) => (w as unknown as { queue: EnemyId[][] }).queue;
const bossesOf = (w: Waves) => (w as unknown as { bossIds: EnemyId[] }).bossIds;

const custom = (edit: (r: CrucibleRules) => void): CrucibleRules => {
  const r = cloneRules(DEFAULT_RULES);
  edit(r);
  return r;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// --- The standard rules are the old game ---------------------------------------------------------------------------

describe('the standard rules', () => {
  it('are the constants the game was built on', () => {
    expect(ROSTER.map(r => r.id)).toEqual([...SWARM_IDS]);
    expect(ROSTER).toEqual(OLD_ROSTER);
    for (const r of ROSTER) expect(DEFAULT_RULES.types[r.id]).toEqual({ on: true, from: r.from });
    expect(DEFAULT_RULES.juggernaut).toEqual({ on: true, first: 5, every: 10, count: 0 });
    expect(DEFAULT_RULES.titan).toEqual({ on: true, first: 10, every: 10 });
    expect(DEFAULT_RULES).toMatchObject({
      startWave: 1, sizePct: 100, escortPct: 45, maxAlive: 48, breakSeconds: 8, bossBreakSeconds: 12, feedPct: 100, healthPct: 100, damagePct: 100,
    });
    expect(DEFAULT_RULES.maxAlive).toBe(MAX_ALIVE);
    expect(RULE_LIMITS.maxAlive.max).toBe(MAX_ALIVE);
    expect(DEFAULT_RULES.escortPct / 100).toBe(OLD_BOSS_WAVE_ESCORT);
  });

  it('sit on their own grids, and cannot be edited in place', () => {
    for (const k of Object.keys(RULE_LIMITS) as NumberRule[]) expect(snap(DEFAULT_RULES[k], RULE_LIMITS[k], NaN)).toBe(DEFAULT_RULES[k]);
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RULES.types.husk)).toBe(true);
    expect(isCustom(DEFAULT_RULES)).toBe(false);
    expect(rosterFor(DEFAULT_RULES)).toBe(ROSTER);
    expect(rosterFor(cloneRules(DEFAULT_RULES))).toBe(ROSTER);
  });

  it('compose every wave from 1 to 60 exactly as before, on the same random numbers', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (let wave = 1; wave <= 60; wave++) {
        const before = seeded(seed * 1000 + wave);
        const old = oldComposeWave(wave);
        const oldDraws = before.draws();
        vi.restoreAllMocks();
        const after = seeded(seed * 1000 + wave);
        const now = composeWave(wave);
        expect(now, `seed ${seed} wave ${wave}`).toEqual(old);
        expect(after.draws(), `draws, seed ${seed} wave ${wave}`).toBe(oldDraws);
        vi.restoreAllMocks();
        const again = seeded(seed * 1000 + wave);
        expect(composeWave(wave, DEFAULT_RULES, rosterFor(DEFAULT_RULES))).toEqual(old);
        expect(again.draws()).toBe(oldDraws);
        vi.restoreAllMocks();
      }
    }
  });

  it('bring the same bosses on the same waves, in the same numbers', () => {
    for (let wave = 1; wave <= 300; wave++) {
      expect(bossesFor(wave, DEFAULT_RULES), `wave ${wave}`).toEqual(oldBosses(wave));
      expect(isTitanWave(wave)).toBe(oldIsTitanWave(wave));
      expect(isJuggernautWave(wave)).toBe(oldIsJuggernautWave(wave));
      expect(isBossWave(wave)).toBe(oldIsBossWave(wave));
    }
  });

  it('play waves 1 to 60 frame for frame as the old director did', () => {
    for (const seed of [7, 20251109]) {
      const oldH = harness();
      const old = new OldWaves();
      old.init(oldH.ctx);
      const a = seeded(seed);
      old.start();
      play(oldH, old, 60);
      const oldDraws = a.draws();
      vi.restoreAllMocks();

      const newH = harness();
      const now = newWaves(newH);
      const b = seeded(seed);
      now.start();
      play(newH, now, 60);
      expect(b.draws()).toBe(oldDraws);
      expect(firstDiff(oldH.log, newH.log)).toBeNull();
      expect(newH.log.length).toBe(oldH.log.length);
      // The run really reached the hold-back, so the cap is part of what matched, and it played every wave and boss.
      expect(oldH.peak()).toBeGreaterThan(OLD_MAX_ALIVE - 9);
      expect(newH.log.filter(l => l.includes('wave:clear')).length).toBe(60);
      expect(newH.log.filter(l => l.includes('boss titan')).length).toBe(6);
      expect(newH.log.filter(l => l.includes('boss juggernaut')).length).toBe([5, 15, 25, 35, 45, 55].reduce((n, w) => n + 1 + Math.floor(w / 15), 0));
      expect(newH.manager.tuning).toEqual({ health: 1, damage: 1, helmetsFrom: 8 });
      vi.restoreAllMocks();

      // And the comparison is sharp: one second more of break is a different game.
      const offH = harness();
      const off = newWaves(offH);
      seeded(seed);
      off.start(custom(r => { r.breakSeconds = 9; }));
      play(offH, off, 3);
      expect(firstDiff(oldH.log.slice(0, offH.log.length), offH.log)).not.toBeNull();
      vi.restoreAllMocks();
    }
  });
});

// --- The model -----------------------------------------------------------------------------------------------------

describe('checking stored rules', () => {
  it('gives the standard rules back for anything that is not a rule set', () => {
    for (const raw of [null, undefined, 5, 'rules', [], [1, 2], true, {}]) expect(sanitizeRules(raw)).toBe(DEFAULT_RULES);
    expect(sanitizeRules(diffRules(DEFAULT_RULES))).toBe(DEFAULT_RULES);
    expect(sanitizeRules(JSON.parse(JSON.stringify(DEFAULT_RULES)))).toBe(DEFAULT_RULES);
  });

  it('clamps out of range values and snaps them onto their steps', () => {
    const r = sanitizeRules({
      sizePct: 1000, escortPct: 47, maxAlive: 50, breakSeconds: 0, bossBreakSeconds: 99.6, feedPct: 60, healthPct: -40, damagePct: 137, startWave: 400,
    });
    expect(r).toMatchObject({ sizePct: 300, escortPct: 45, maxAlive: 48, breakSeconds: 3, bossBreakSeconds: 40, feedPct: 50, healthPct: 25, damagePct: 125, startWave: 60 });
    expect(sanitizeRules({ maxAlive: 13 }).maxAlive).toBe(12);
    expect(sanitizeRules({ maxAlive: 2 }).maxAlive).toBe(RULE_LIMITS.maxAlive.min);
    expect(sanitizeRules({ juggernaut: { count: 9, every: 77, first: 0 } }).juggernaut).toEqual({ on: true, first: 1, every: 30, count: 6 });
    expect(sanitizeRules({ juggernaut: { count: -3 } }).juggernaut.count).toBe(0);
    expect(sanitizeRules({ titan: { every: 0.4 } }).titan.every).toBe(0);
    expect(sanitizeRules({ types: { warden: { from: 150.2 } } }).types.warden.from).toBe(WAVE_LIMIT.max);
    expect(sanitizeRules({ types: { warden: { from: 3.4 } } }).types.warden.from).toBe(3);
  });

  it('ignores fields of the wrong type, unknown fields and unknown enemies', () => {
    const r = sanitizeRules({
      sizePct: '150', maxAlive: NaN, breakSeconds: Infinity, feedPct: null, healthPct: { v: 2 },
      types: { husk: { on: 'no', from: '4' }, zombie: { on: false, from: 2 }, titan: { on: false }, trooper: 'off' },
      juggernaut: { on: 1, first: '9' }, titan: 'never', mode: 'hardcore',
    });
    expect(r).toBe(DEFAULT_RULES);
  });

  it('survives an old or broken blob', () => {
    // A shape these rules never had: fractions, flat boss fields, a list of types.
    const old = { v: 0, size: 1.5, juggernautEvery: 5, titanEvery: 20, types: ['husk', 'trooper'], escort: 0.45 };
    expect(sanitizeRules(old)).toBe(DEFAULT_RULES);
    // Half right: what fits is kept, the rest takes its default.
    const half = sanitizeRules({ sizePct: 200, titan: { on: false, first: 'ten' }, types: { brute: { on: false, from: 'x' } } });
    expect(half.sizePct).toBe(200);
    expect(half.titan).toEqual({ on: false, first: 10, every: 10 });
    expect(half.types.brute).toEqual({ on: false, from: 4 });
  });

  it('brings the husk back when every type is off', () => {
    const types = Object.fromEntries(SWARM_IDS.map(id => [id, { on: false }]));
    const r = sanitizeRules({ types });
    expect(r.types.husk).toEqual({ on: true, from: 1 });
    expect(SWARM_IDS.filter(id => r.types[id].on)).toEqual(['husk']);
  });

  it('moves the earliest type that is on to the first wave when none is in it', () => {
    const r = sanitizeRules({ types: { husk: { from: 5 }, trooper: { from: 5 } } });
    expect(r.types.gunner.from).toBe(1);
    expect(r.types.husk.from).toBe(5);
    expect(firstEnemyWave(r)).toBe(1);
    const late = sanitizeRules({ startWave: 20 });
    expect(late.types.husk.from).toBe(1);
    const lateTypes = sanitizeRules({ startWave: 3, types: Object.fromEntries(SWARM_IDS.map(id => [id, { from: 30 }])) });
    expect(lateTypes.types.husk.from).toBe(3);
    expect(firstEnemyWave(lateTypes)).toBe(3);
  });

  it('calls any single change custom, and stores only the changes', () => {
    const changes: ((r: CrucibleRules) => void)[] = [
      r => { r.startWave = 2; }, r => { r.sizePct = 125; }, r => { r.escortPct = 50; }, r => { r.maxAlive = 44; },
      r => { r.breakSeconds = 9; }, r => { r.bossBreakSeconds = 11; }, r => { r.feedPct = 125; }, r => { r.healthPct = 125; },
      r => { r.damagePct = 75; }, r => { r.juggernaut.on = false; }, r => { r.juggernaut.first = 6; }, r => { r.juggernaut.every = 0; },
      r => { r.juggernaut.count = 1; }, r => { r.titan.on = false; }, r => { r.titan.first = 11; }, r => { r.titan.every = 5; },
      ...SWARM_IDS.map(id => (r: CrucibleRules) => { r.types[id].on = false; }),
      ...SWARM_IDS.map(id => (r: CrucibleRules) => { r.types[id].from = 1; }).slice(2),
    ];
    for (const change of changes) {
      const r = sanitizeRules(custom(change));
      expect(isCustom(r), change.toString()).toBe(true);
      expect(r).not.toBe(DEFAULT_RULES);
      const diff = diffRules(r);
      expect(diff, change.toString()).not.toBeNull();
      expect(Object.keys(diff!)).toHaveLength(1);
      expect(rulesEqual(sanitizeRules(JSON.parse(JSON.stringify(diff))), r)).toBe(true);
    }
    expect(diffRules(DEFAULT_RULES)).toBeNull();
    expect(diffRules(custom(r => { r.types.riot.on = false; r.titan.every = 0; }))).toEqual({ types: { riot: { on: false } }, titan: { every: 0 } });
  });

  it('keeps every limit sensible', () => {
    for (const limit of [...Object.values(RULE_LIMITS), WAVE_LIMIT, EVERY_LIMIT, COUNT_LIMIT]) {
      expect(limit.min).toBeLessThan(limit.max);
      expect((limit.max - limit.min) % limit.step).toBe(0);
    }
    // The biggest squad, a pack of 9, always fits under the lowest cap.
    const biggest = Math.max(...ROSTER.map(r => r.pack[1] + (r.escorts ?? 0)));
    expect(RULE_LIMITS.maxAlive.min).toBeGreaterThanOrEqual(biggest);
  });
});

// --- Custom rules ----------------------------------------------------------------------------------------------------

describe('the boss schedule on custom rules', () => {
  it('brings a Juggernaut every 2 waves', () => {
    const r = custom(r => { r.juggernaut.first = 2; r.juggernaut.every = 2; r.titan.on = false; });
    for (let w = 1; w <= 60; w++) {
      expect(bossesFor(w, r), `wave ${w}`).toEqual(w % 2 === 0 ? new Array(1 + Math.floor(w / 15)).fill('juggernaut') : []);
      expect(isBossWave(w, r)).toBe(w % 2 === 0);
    }
  });

  it('brings a Titan every 2 waves, alone on a wave it shares with a Juggernaut', () => {
    const r = custom(r => { r.titan.first = 2; r.titan.every = 2; });
    expect(bossesFor(2, r)).toEqual(['titan']);
    expect(bossesFor(3, r)).toEqual([]);
    expect(bossesFor(5, r)).toEqual(['juggernaut']);
    const shared = custom(r => { r.juggernaut.first = 10; r.juggernaut.every = 2; });
    expect(bossesFor(10, shared)).toEqual(['titan']);
    expect(isTitanWave(10, shared)).toBe(true);
    expect(isJuggernautWave(10, shared)).toBe(false);
    expect(bossesFor(12, shared)).toEqual(['juggernaut']);
  });

  it('can bring a boss once, a fixed number of them, or none', () => {
    const once = custom(r => { r.juggernaut.first = 3; r.juggernaut.every = 0; r.juggernaut.count = 4; r.titan.on = false; });
    const waves = Array.from({ length: 60 }, (_, i) => i + 1).filter(w => bossesFor(w, once).length > 0);
    expect(waves).toEqual([3]);
    expect(bossesFor(3, once)).toEqual(['juggernaut', 'juggernaut', 'juggernaut', 'juggernaut']);
    expect(juggernautCount(45, once)).toBe(4);
    expect(juggernautCount(45, DEFAULT_RULES)).toBe(4);
    expect(juggernautCount(14, DEFAULT_RULES)).toBe(1);
    const none = custom(r => { r.juggernaut.on = false; r.titan.on = false; });
    for (let w = 1; w <= 100; w++) expect(bossesFor(w, none)).toEqual([]);
  });

  it('gives each boss wave the escort share, and the director the plan', () => {
    const r = custom(r => { r.juggernaut.first = 2; r.juggernaut.every = 2; r.titan.on = false; r.escortPct = 0; });
    seeded(3);
    expect(composeWave(4, r)).toEqual([]);
    expect(composeWave(3, r).flat().length).toBeGreaterThanOrEqual(Math.round((10 + 2 * 3) * 2));
    const h = harness();
    const w = newWaves(h);
    w.start(r);
    begin(w, 4);
    expect(queueOf(w)).toEqual([]);
    expect(bossesOf(w)).toEqual(['juggernaut']);
    expect(w.phase).toBe('boss');
    expect(h.log.some(l => l.includes('reactor unstable'))).toBe(true);
    expect(h.log.some(l => l.includes('boss_alarm'))).toBe(true);
  });
});

describe('composing waves on custom rules', () => {
  it('never sends a type that is off, not even as an escort', () => {
    const r = custom(r => { r.types.husk.on = false; r.types.skitter.on = false; });
    let brutes = 0;
    for (let seed = 1; seed <= 5; seed++) {
      seeded(seed);
      for (let w = 1; w <= 60; w++) {
        const squads = composeWave(w, r);
        const ids = new Set(squads.flat());
        expect(ids.has('husk'), `wave ${w}`).toBe(false);
        expect(ids.has('skitter')).toBe(false);
        // A brute, whose escort is husks, now comes alone.
        for (const s of squads) if (s[0] === 'brute') brutes++;
      }
      vi.restoreAllMocks();
    }
    expect(brutes).toBeGreaterThan(0);
    expect(rosterFor(r).find(e => e.id === 'brute')).toMatchObject({ escorts: 0 });
    expect(rosterFor(r).find(e => e.id === 'rocketeer')).toBe(ROSTER.find(e => e.id === 'rocketeer'));
    // The trooper leads wave 1 now, with its bigger pack, and it is the one announced.
    seeded(1);
    expect(composeWave(1, r)[0]).toEqual(['trooper', 'trooper', 'trooper']);
    const h = harness();
    const w = newWaves(h);
    w.start(r);
    begin(w, 1);
    expect(h.log.filter(l => l.includes('NEW THREAT'))).toEqual([expect.stringContaining('NEW THREAT: TROOPER')]);
  });

  it('brings a type in at wave 1 when told to, with its debut squad', () => {
    const r = custom(r => { r.types.warden.from = 1; });
    seeded(5);
    const first = composeWave(1, r);
    // The warden is the latest type in the standard game, so it leads, alone; the husk and the trooper follow with their small packs.
    expect(first[0]).toEqual(['warden']);
    expect(first[1]).toEqual(new Array(5).fill('husk'));
    expect(first[2]).toEqual(['trooper', 'trooper']);
    vi.restoreAllMocks();
    const h1 = harness();
    const w1 = newWaves(h1);
    w1.start(r);
    seeded(5);
    begin(w1, 1);
    expect(h1.log.filter(l => l.includes('NEW THREAT'))).toEqual([expect.stringContaining('NEW THREAT: WARDEN')]);
    vi.restoreAllMocks();
    // Nothing comes in at wave 15 any more, so nothing is announced there.
    const h = harness();
    const w = newWaves(h);
    w.start(r);
    seeded(5);
    begin(w, 15);
    expect(h.log.some(l => l.includes('NEW THREAT'))).toBe(false);

    // A swarm type moved onto wave 1 with the husk off leads it over the trooper, and is the one announced.
    const skitter = custom(r => { r.types.husk.on = false; r.types.skitter.from = 1; });
    vi.restoreAllMocks();
    seeded(5);
    const opening = composeWave(1, skitter);
    expect(opening[0]).toEqual(new Array(9).fill('skitter'));
    expect(opening[1]).toEqual(['trooper', 'trooper']);
    const h3 = harness();
    const w3 = newWaves(h3);
    w3.start(skitter);
    begin(w3, 1);
    expect(h3.log.filter(l => l.includes('NEW THREAT'))).toEqual([expect.stringContaining('NEW THREAT: SKITTER')]);

    const alone = custom(r => { r.types.husk.on = false; r.types.trooper.on = false; r.types.warden.from = 1; });
    vi.restoreAllMocks();
    seeded(5);
    expect(composeWave(1, alone)[0]).toEqual(['warden']);
    const h2 = harness();
    const w2 = newWaves(h2);
    w2.start(alone);
    begin(w2, 1);
    expect(h2.log.filter(l => l.includes('NEW THREAT'))).toEqual([expect.stringContaining('NEW THREAT: WARDEN')]);
  });

  it('never sends an escort before its own first wave', () => {
    const r = sanitizeRules(diffRules(custom(r => { r.types.husk.from = 30; r.types.riot.from = 40; r.types.warden.from = 3; })));
    expect(r.types.husk.from).toBe(30);
    const seen = new Map<EnemyId, number>();
    let lone = 0;
    for (let seed = 1; seed <= 8; seed++) {
      seeded(seed);
      for (let w = 1; w <= 45; w++) {
        const squads = composeWave(w, r);
        for (const id of squads.flat()) if (!seen.has(id) || seen.get(id)! > w) seen.set(id, w);
        // Brutes and burners ride without husks, and wardens without riots, until those come in.
        for (const s of squads) if ((s[0] === 'brute' && w < 30) || (s[0] === 'warden' && w < 40)) lone += s.every(id => id === s[0]) ? 1 : 0;
      }
      vi.restoreAllMocks();
    }
    expect(seen.get('husk')).toBe(30);
    expect(seen.get('riot')).toBe(40);
    expect(seen.get('warden')).toBe(3);
    expect(lone).toBeGreaterThan(0);
    // Once they are in, the escorts ride again.
    seeded(2);
    const late = Array.from({ length: 20 }, (_, i) => composeWave(41 + (i % 4), r)).flat();
    expect(late.some(s => s[0] === 'warden' && s.includes('riot'))).toBe(true);
  });

  it('does not hang or crash with every type off, and the checks never let that be played', () => {
    const off = custom(r => { for (const id of SWARM_IDS) r.types[id].on = false; });
    for (let w = 1; w <= 60; w++) expect(composeWave(w, off)).toEqual([]);
    expect(rosterFor(off)).toEqual([]);
    expect(firstEnemyWave(off)).toBe(Infinity);
    expect(SWARM_IDS.some(id => sanitizeRules(off).types[id].on)).toBe(true);
  });

  it('scales the wave, and lifts the caps and the guard with it', () => {
    for (const sizePct of [25, 50, 200, 300]) {
      const r = custom(r => { r.sizePct = sizePct; });
      seeded(sizePct);
      for (const w of [1, 7, 33, 60]) {
        let budget = Math.round((10 + 2 * w) * 2 * (sizePct / 100));
        if (isBossWave(w, r)) budget = Math.round(budget * 0.45);
        const total = composeWave(w, r).flat().length;
        expect(total, `size ${sizePct} wave ${w}`).toBeGreaterThanOrEqual(budget);
        expect(total).toBeLessThanOrEqual(budget + 3);
      }
      vi.restoreAllMocks();
    }
  });

  it('starts late, holds the field to the rule, keeps its breaks and its feed rate, and sets health and damage', () => {
    const r = custom(r => {
      r.startWave = 30; r.maxAlive = 12; r.breakSeconds = 4; r.bossBreakSeconds = 20; r.feedPct = 200; r.healthPct = 250; r.damagePct = 50;
    });
    const h = harness(1_000_000);
    const w = newWaves(h);
    seeded(9);
    w.start(r);
    expect(w.wave).toBe(29);
    expect(w.nextWaveIn).toBe(3);
    expect(h.manager.tuning).toEqual({ health: 2.5, damage: 0.5, helmetsFrom: 8 });
    // The first countdown is silent, and wave 30 is the first one played.
    for (let i = 0; i < 40 && w.wave === 29; i++) h.step(w);
    expect(w.wave).toBe(30);
    expect(h.log.some(l => l.includes('wave_tick'))).toBe(false);
    expect(bossesOf(w)).toEqual(['titan']);
    // Nobody dies here, so the squads stop at the rule. The Titan comes in over it, as it would at the hard cap.
    for (let i = 0; i < 600; i++) h.step(w);
    const packs = h.manager.alive.filter(id => id !== 'titan').length;
    expect(packs).toBeLessThanOrEqual(12);
    expect(packs).toBeGreaterThanOrEqual(12 - 9);

    // The break after a boss wave, then after a plain one.
    const clear = (wave: number) => {
      const fresh = harness();
      const d = newWaves(fresh);
      d.start(r);
      begin(d, wave);
      for (let i = 0; i < 20_000 && d.phase !== 'intermission'; i++) fresh.step(d);
      return d.nextWaveIn;
    };
    expect(clear(30)).toBe(20);
    expect(clear(31)).toBe(4);
  });

  it('feeds squads faster or slower by the spawn speed', () => {
    const gaps = (feedPct: number): number[] => {
      const h = harness(1);
      const w = newWaves(h);
      seeded(4);
      w.start(custom(r => { r.feedPct = feedPct; }));
      begin(w, 3);
      for (let i = 0; i < 400; i++) h.step(w);
      const frames = h.log.filter(l => l.includes(' pack ')).map(l => Number(l.split(' ')[0]));
      vi.restoreAllMocks();
      return frames.slice(1, 4).map((f, i) => f - frames[i]!);
    };
    const normal = gaps(100);
    const fast = gaps(200);
    expect(normal.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(fast[i]!).toBeLessThan(normal[i]!);
  });
});
