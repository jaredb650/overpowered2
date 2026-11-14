/**
 * The Crucible's rules: when each enemy type joins, when the bosses come, how big, how fast and how tough a wave is. The
 * defaults are the standard, ranked game and reproduce it exactly; rules.test.ts runs the old wave logic beside the new one
 * on the same random numbers to hold that. Plain data and arithmetic, so the menu and the tests load it without three.js.
 * What the player has set is kept by contracts/crucible.ts.
 *
 * Every multiplier is a whole percent. 45 / 100 is the same double as 0.45 and 100 / 100 is exactly 1, so the standard
 * game's arithmetic is bit for bit what it was, and two rule sets compare with ===.
 */
import type { EnemyId } from '../core/gameplay';

/**
 * The swarm's types, in roster order. That order is the walk of the weighted roll. When several types come in on one wave,
 * the one the standard game brings latest leads it, roster order breaking a tie (waves.ts, debutsOn).
 */
export const SWARM_IDS = [
  'husk', 'trooper', 'gunner', 'bomber', 'brute', 'stalker', 'rocketeer', 'skitter', 'leaper', 'riot', 'sniper', 'drone', 'burner', 'warden',
] as const;
export type SwarmId = (typeof SWARM_IDS)[number];

export interface RosterEntry {
  id: SwarmId;
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

export const ROSTER: readonly RosterEntry[] = [
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

export interface TypeRule {
  on: boolean;
  /** First wave. Kept while the type is off, so turning it back on puts it where it was. */
  from: number;
}

export interface BossRule {
  on: boolean;
  first: number;
  /** Waves between appearances. 0 is the first wave only. */
  every: number;
}

export interface JuggernautRule extends BossRule {
  /** How many come. 0 is the standard growth, one more every 15 waves. */
  count: number;
}

export interface CrucibleRules {
  types: Record<SwarmId, TypeRule>;
  juggernaut: JuggernautRule;
  /** On a wave both bosses would share, the Titan comes alone, as it always has. Its death clears the field. */
  titan: BossRule;
  startWave: number;
  /** Enemies in a wave, as a percent of the standard count. */
  sizePct: number;
  /** A boss wave's escort, as a percent of what that wave would otherwise hold. */
  escortPct: number;
  /** The feed holds squads back above this. The manager's hard cap of 48 sits behind it. */
  maxAlive: number;
  breakSeconds: number;
  bossBreakSeconds: number;
  /** How fast squads arrive, as a percent. */
  feedPct: number;
  healthPct: number;
  damagePct: number;
  /** From this wave on, Gunners and Rocketeers wear their helmets as armour. 0: never. */
  helmetsFrom: number;
}

export type NumberRule = Exclude<keyof CrucibleRules, 'types' | 'juggernaut' | 'titan'>;

export interface Limit {
  min: number;
  max: number;
  step: number;
}

/** Wave numbers a type or a boss can be set to start on. */
export const WAVE_LIMIT: Limit = { min: 1, max: 99, step: 1 };
export const EVERY_LIMIT: Limit = { min: 0, max: 30, step: 1 };
export const COUNT_LIMIT: Limit = { min: 0, max: 6, step: 1 };

export const RULE_LIMITS: Readonly<Record<NumberRule, Limit>> = {
  startWave: { min: 1, max: 60, step: 1 },
  sizePct: { min: 25, max: 300, step: 25 },
  escortPct: { min: 0, max: 100, step: 5 },
  // A squad is at most 9, so even the lowest setting always fits a whole one.
  maxAlive: { min: 12, max: 48, step: 4 },
  // Three seconds at least, so the countdown ticks still fit.
  breakSeconds: { min: 3, max: 30, step: 1 },
  bossBreakSeconds: { min: 3, max: 40, step: 1 },
  feedPct: { min: 50, max: 300, step: 25 },
  healthPct: { min: 25, max: 400, step: 25 },
  damagePct: { min: 25, max: 400, step: 25 },
  helmetsFrom: { min: 0, max: 60, step: 1 },
};

const NUMBER_RULES = Object.keys(RULE_LIMITS) as NumberRule[];

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Today's Crucible. Frozen: edit a `cloneRules` copy. */
export const DEFAULT_RULES: CrucibleRules = freeze({
  types: Object.fromEntries(ROSTER.map(r => [r.id, { on: true, from: r.from }])) as Record<SwarmId, TypeRule>,
  juggernaut: { on: true, first: 5, every: 10, count: 0 },
  titan: { on: true, first: 10, every: 10 },
  startWave: 1,
  sizePct: 100,
  escortPct: 45,
  maxAlive: 48,
  breakSeconds: 8,
  bossBreakSeconds: 12,
  feedPct: 100,
  healthPct: 100,
  damagePct: 100,
  // Between the first Juggernaut and the first Titan: armour joins the climb as the Commander's helmets do in Endless Humans.
  helmetsFrom: 8,
});

export function cloneRules(r: CrucibleRules): CrucibleRules {
  const types = {} as Record<SwarmId, TypeRule>;
  for (const id of SWARM_IDS) types[id] = { ...r.types[id] };
  return { ...r, types, juggernaut: { ...r.juggernaut }, titan: { ...r.titan } };
}

export function rulesEqual(a: CrucibleRules, b: CrucibleRules): boolean {
  if (a === b) return true;
  for (const k of NUMBER_RULES) if (a[k] !== b[k]) return false;
  for (const id of SWARM_IDS) if (a.types[id].on !== b.types[id].on || a.types[id].from !== b.types[id].from) return false;
  const ja = a.juggernaut;
  const jb = b.juggernaut;
  if (ja.on !== jb.on || ja.first !== jb.first || ja.every !== jb.every || ja.count !== jb.count) return false;
  return a.titan.on === b.titan.on && a.titan.first === b.titan.first && a.titan.every === b.titan.every;
}

/** Anything off the standard game. A custom run is unranked. */
export const isCustom = (r: CrucibleRules): boolean => !rulesEqual(r, DEFAULT_RULES);

/** On the grid of `limit`, inside it. Anything that is not a finite number is `fallback`. */
export function snap(v: unknown, limit: Limit, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const stepped = limit.min + Math.round((v - limit.min) / limit.step) * limit.step;
  return Math.min(limit.max, Math.max(limit.min, stepped));
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function bossFrom(raw: unknown, base: BossRule): BossRule {
  const o = record(raw);
  if (!o) return { ...base };
  return { on: flag(o.on, base.on), first: snap(o.first, WAVE_LIMIT, base.first), every: snap(o.every, EVERY_LIMIT, base.every) };
}

/** The earliest wave any type that is on can be in. Infinity with every type off. */
export function firstEnemyWave(r: CrucibleRules): number {
  let first = Infinity;
  for (const id of SWARM_IDS) if (r.types[id].on && r.types[id].from < first) first = r.types[id].from;
  return first;
}

/**
 * Any blob in, a whole valid rule set out: each field is taken only when its type is right, then put on its grid and
 * inside its range; unknown fields and ids are dropped and missing ones take their default. Two repairs keep every wave
 * fightable: with every type off the husk comes back, and if no type that is on is in the first wave, the earliest of
 * them moves to it. The standard rules come back as DEFAULT_RULES itself.
 */
export function sanitizeRules(raw: unknown): CrucibleRules {
  const o = record(raw);
  if (!o) return DEFAULT_RULES;
  const out = cloneRules(DEFAULT_RULES);
  for (const k of NUMBER_RULES) out[k] = snap(o[k], RULE_LIMITS[k], DEFAULT_RULES[k]);
  const types = record(o.types);
  if (types) {
    for (const id of SWARM_IDS) {
      const t = record(types[id]);
      if (!t) continue;
      out.types[id] = { on: flag(t.on, out.types[id].on), from: snap(t.from, WAVE_LIMIT, out.types[id].from) };
    }
  }
  const jug = record(o.juggernaut);
  out.juggernaut = { ...bossFrom(jug, DEFAULT_RULES.juggernaut), count: snap(jug?.count, COUNT_LIMIT, DEFAULT_RULES.juggernaut.count) };
  out.titan = bossFrom(o.titan, DEFAULT_RULES.titan);

  if (!SWARM_IDS.some(id => out.types[id].on)) out.types.husk.on = true;
  if (firstEnemyWave(out) > out.startWave) {
    let earliest: SwarmId = 'husk';
    let at = Infinity;
    for (const id of SWARM_IDS) if (out.types[id].on && out.types[id].from < at) [earliest, at] = [id, out.types[id].from];
    out.types[earliest].from = out.startWave;
  }
  return rulesEqual(out, DEFAULT_RULES) ? DEFAULT_RULES : out;
}

/** Only what differs from the defaults, for storage: a later retune of a default still reaches the player. Null when nothing does. */
export function diffRules(r: CrucibleRules): Record<string, unknown> | null {
  const d = DEFAULT_RULES;
  const out: Record<string, unknown> = {};
  for (const k of NUMBER_RULES) if (r[k] !== d[k]) out[k] = r[k];
  const types: Record<string, Partial<TypeRule>> = {};
  for (const id of SWARM_IDS) {
    const t: Partial<TypeRule> = {};
    if (r.types[id].on !== d.types[id].on) t.on = r.types[id].on;
    if (r.types[id].from !== d.types[id].from) t.from = r.types[id].from;
    if (Object.keys(t).length) types[id] = t;
  }
  if (Object.keys(types).length) out.types = types;
  for (const boss of ['juggernaut', 'titan'] as const) {
    const a = r[boss] as unknown as Record<string, unknown>;
    const b = d[boss] as unknown as Record<string, unknown>;
    const delta: Record<string, unknown> = {};
    for (const k of Object.keys(b)) if (a[k] !== b[k]) delta[k] = a[k];
    if (Object.keys(delta).length) out[boss] = delta;
  }
  return Object.keys(out).length ? out : null;
}

// --- The schedule ----------------------------------------------------------------------------------------------------

export const onCadence = (wave: number, c: BossRule): boolean =>
  c.on && wave >= c.first && (c.every === 0 ? wave === c.first : (wave - c.first) % c.every === 0);

export const juggernautCount = (wave: number, r: CrucibleRules): number =>
  r.juggernaut.count === 0 ? 1 + Math.floor(wave / 15) : r.juggernaut.count;

export const titanWave = (wave: number, r: CrucibleRules): boolean => onCadence(wave, r.titan);
export const juggernautWave = (wave: number, r: CrucibleRules): boolean => !titanWave(wave, r) && onCadence(wave, r.juggernaut);

/** The bosses a wave brings, in the order they land. The Titan wins a wave both would share. */
export function bossesFor(wave: number, r: CrucibleRules): EnemyId[] {
  if (titanWave(wave, r)) return ['titan'];
  if (onCadence(wave, r.juggernaut)) return new Array<EnemyId>(juggernautCount(wave, r)).fill('juggernaut');
  return [];
}

const typeOn = (r: CrucibleRules, id: EnemyId): boolean => !(SWARM_IDS as readonly EnemyId[]).includes(id) || r.types[id as SwarmId].on;

/**
 * The roster these rules play: types that are off are gone, escorts of a type that is off included, and each keeps its own
 * first wave. Roster order always, never sorted, because the order is part of the roll. The standard rules get ROSTER itself.
 * An escort whose type is on but has not come in yet is left off its squad by composeWave until its own first wave.
 */
export function rosterFor(r: CrucibleRules): readonly RosterEntry[] {
  if (ROSTER.every(row => r.types[row.id].on && r.types[row.id].from === row.from)) return ROSTER;
  return ROSTER.filter(row => r.types[row.id].on).map(row => {
    const from = r.types[row.id].from;
    const escorted = row.escort === undefined || typeOn(r, row.escort);
    if (from === row.from && escorted) return row;
    return escorted ? { ...row, from } : { ...row, from, escort: undefined, escorts: 0 };
  });
}
