/** Player settings: persisted to localStorage, applied to the systems that own them. */
import type { Ctx } from '../core/contracts';
import { SWAY } from '../enemies/damage';
import { GoreTuning } from '../gore';
import { BloodTuning } from '../gore/blood';
import { ChunkTuning } from '../gore/chunks';
import { FireTuning } from '../gore/fire';
import { EASE_STEPS, GoreLoad, HEAPS, LoadTuning } from '../gore/load';
import { MESS, MESS_LEVELS, MessTuning, type MessBudget, type MessLevel } from '../gore/mess';
import { SliceTuning } from '../gore/sliced';
import { WoundTuning } from '../gore/wounds';
import { clamp } from '../core/math';
import { QUALITY, SETTINGS_KEY } from '../render/quality';
import { HIT_TEXT_LEVELS, HitText } from '../progression/data';
import { TUNING } from '../weapons/data';

/** The renderer reads the saved quality from the same place before the settings are applied (`savedQuality`). */
const STORAGE_KEY = SETTINGS_KEY;
/** The player's default radians per pixel. Sensitivity in settings is a multiple of this. */
const BASE_SENSITIVITY = 0.002;

export const GORE_LEVELS = ['Low', 'Full', 'Excessive'] as const;
/**
 * How much of a fight stays on the floor (`MESS` in gore/mess.ts, in the same order as `MESS_LEVELS`): bodies, blood, limbs
 * and pieces. Standard keeps 120 bodies and three times the blood for the whole match; "Clear at wave break" is Standard
 * until the wave ends, then the floor is cleared; Low is about what the game kept before; Everything is for a desktop card.
 */
export const MESS_NAMES = ['Low', 'Clear at wave break', 'Standard', 'Everything'] as const;
export const MESS_DEFAULT = MESS_LEVELS.indexOf('standard');
export const QUALITY_LEVELS = ['Low', 'Medium', 'High', 'Ultra'] as const;
/** Enemy chatter (docs/proposals/squad-chatter.md, 6.3). Off stops the text only: no tactic depends on a line being shown. */
export const CHATTER_LEVELS = ['Bubbles and feed', 'Feed only', 'Off'] as const;
export const CHATTER_BUBBLES = 0;
export const CHATTER_OFF = 2;

export interface Settings {
  /** Multiplier on the default mouse speed. */
  sensitivity: number;
  fov: number;
  invertY: boolean;
  master: number;
  sfx: number;
  music: number;
  quality: number;
  gore: number;
  /** What stays on the floor: an index into MESS_NAMES. */
  mess: number;
  /** Holding jump hops on every landing. */
  holdToHop: boolean;
  /** Aim down sights while the button is held. Off, a click toggles it, which is kinder to a trackpad. */
  aimHold: boolean;
  /** Mouse speed while aimed down sights, as a share of the hip-fire speed. */
  aimSensitivity: number;
  /** Floating text over a hit enemy: an index into HIT_TEXT_LEVELS. */
  hitText: number;
  /** Enemy lines: an index into CHATTER_LEVELS. */
  chatter: number;
  /** The enemy voices' level, 0 to 1, under master and effects. */
  voices: number;
}

export const DEFAULTS: Readonly<Settings> = {
  sensitivity: 1, fov: 90, invertY: false, master: 0.8, sfx: 1, music: 0.7, quality: 2, gore: 1, mess: MESS_DEFAULT, holdToHop: false,
  aimHold: false, aimSensitivity: TUNING.ads.sensitivity, hitText: 0, chatter: CHATTER_BUBBLES, voices: 1,
};

/** Raised from 4 to 10 for low-DPI mice. Values saved under the old cap (0.1 to 4) are inside the new range and load unchanged. */
export const SENSITIVITY_RANGE = [0.1, 10] as const;
/** The slider track is squared, so the low end (where a normal mouse lives) keeps fine control and the top gets the reach. */
export const SENSITIVITY_CURVE = 2;
export const sliderToValue = (t: number, min: number, max: number, curve = 1): number => min + (max - min) * clamp(t) ** curve;
export const valueToSlider = (v: number, min: number, max: number, curve = 1): number => clamp((v - min) / (max - min)) ** (1 / curve);
export const FOV_RANGE = [70, 120] as const;
export const AIM_SENSITIVITY_RANGE = [0.3, 1.5] as const;

/** A stored value from an older build, or a hand-edited one, must not reach the camera. */
function sanitize(s: Settings): void {
  s.sensitivity = clamp(s.sensitivity, ...SENSITIVITY_RANGE);
  s.fov = clamp(s.fov, ...FOV_RANGE);
  s.aimSensitivity = clamp(s.aimSensitivity, ...AIM_SENSITIVITY_RANGE);
  s.master = clamp(s.master);
  s.sfx = clamp(s.sfx);
  s.music = clamp(s.music);
  s.quality = clamp(Math.round(s.quality), 0, QUALITY_LEVELS.length - 1);
  s.gore = clamp(Math.round(s.gore), 0, GORE_LEVELS.length - 1);
  s.mess = clamp(Math.round(s.mess), 0, MESS_NAMES.length - 1);
  s.hitText = clamp(Math.round(s.hitText), 0, HIT_TEXT_LEVELS.length - 1);
  s.chatter = clamp(Math.round(s.chatter), 0, CHATTER_LEVELS.length - 1);
  s.voices = clamp(s.voices);
}

export function loadSettings(): Settings {
  const out = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const stored = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      const value = stored[key];
      if (typeof value === typeof DEFAULTS[key]) (out[key] as unknown) = value;
    }
    sanitize(out);
  } catch {
    // A blocked or corrupt store falls back to the defaults.
  }
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Settings still hold for this session when storage is unavailable.
  }
}

interface FovRig {
  setBaseFov?: (degrees: number) => void;
}

interface AimOwner {
  aimHold?: boolean;
  aimSensitivity?: number;
}

interface LookOwner {
  sensitivity?: number;
  invertY?: boolean;
  holdToHop?: boolean;
}

/**
 * What a gore level changes: how violently a body comes apart. Damage, severing and the blood sprayed by a hit are the
 * same at every level, because gameplay must not change with this setting and a spray is one recipe in fx. Full is the
 * game as tuned. Excessive: longer stump spray, more blood reaching the floor, corpses that come apart sooner. How much of
 * it then stays on the floor (bodies, limbs, pieces, blood) is the "Mess" setting's, below.
 */
const FULL = {
  liveLimbs: GoreTuning.maxLiveLimbs, stump: GoreTuning.stumpSeconds,
  corpseLimb: GoreTuning.corpseLimbHealth, limbBurst: GoreTuning.limbBurstHealth,
  rays: BloodTuning.raysPerFrame, chunks: ChunkTuning.maxBodies, blood: BloodTuning.amount,
};
const GORE_TABLE: readonly (typeof FULL)[] = [
  { ...FULL, liveLimbs: 8, stump: 1.5, rays: 6, chunks: 20, blood: 0.65 },
  FULL,
  { ...FULL, stump: 9, corpseLimb: 30, limbBurst: 45, rays: 48, blood: 1.3 },
];

function applyGore(level: number): void {
  const g = GORE_TABLE[level] ?? FULL;
  WoundTuning.level = level;
  GoreTuning.maxLiveLimbs = g.liveLimbs;
  GoreTuning.stumpSeconds = g.stump;
  GoreTuning.corpseLimbHealth = g.corpseLimb;
  GoreTuning.limbBurstHealth = g.limbBurst;
  BloodTuning.raysPerFrame = g.rays;
  BloodTuning.amount = g.blood;
  ChunkTuning.maxBodies = g.chunks;
}

interface DecalOwner {
  setLimit?(ring: 'scorch' | 'big' | 'blood' | 'mark', limit: number): void;
  soak?: number;
}

/** As the game is tuned, what the step-down's shares are taken of: dead bodies simulating at once, bodies dying on their feet, and how far from the player enemies wake the dead they walk into. */
const RAGDOLLS = GoreTuning.maxRagdolls;
const COLLAPSES = GoreTuning.maxCollapses;
const ENEMY_RANGE = MessTuning.enemyRange;

/** Every cap of the gore update that a setting or the automatic step-down decides (gore/load.ts says why these). */
export interface Load {
  /** The Mess level's caps, with the step's cuts to `drawn` and `full`. */
  budget: MessBudget;
  /** Bodies at rest leave their capsules, so the dead heap. */
  heaps: boolean;
  ragdolls: number;
  collapses: number;
  /** Metres from the player inside which enemies wake the dead they walk into. 0: they do not. */
  enemyPushRange: number;
  /** Seconds a still piece lies before it shrinks away. */
  pieceLinger: number;
  swayBodies: number;
  fireLights: number;
  /** Slots of the big-stain ring in use. */
  bigStains: number;
}

/** The caps for a Mess level, a quality level and an automatic step (0: none). Pure. */
export function loadFor(mess: MessLevel, quality: number, ease: number): Load {
  const b = MESS[mess];
  const q = QUALITY[clamp(Math.round(quality), 0, QUALITY.length - 1)]!;
  const e = clamp(Math.round(ease), 0, EASE_STEPS);
  const t = LoadTuning;
  return {
    budget: e === 0 ? b : { ...b, drawn: Math.max(8, Math.round(b.drawn * t.drawn[e]!)), full: Math.max(3, Math.round(b.full * t.full[e]!)) },
    heaps: HEAPS[mess] && t.heaps[e]!,
    ragdolls: Math.max(6, Math.round(RAGDOLLS * t.ragdolls[e]!)),
    collapses: Math.max(2, Math.round(COLLAPSES * t.collapses[e]!)),
    enemyPushRange: t.enemiesPush[e]! ? ENEMY_RANGE : 0,
    pieceLinger: Math.min(b.pieceLinger, t.pieceLinger[e]!),
    swayBodies: Math.max(1, Math.round(q.swayBodies * t.sway[e]!)),
    fireLights: Math.max(1, q.fireLights - t.fireLights[e]!),
    bigStains: Math.max(16, Math.round(b.big * q.bigStains)),
  };
}

/**
 * Writes every cap to the system that keeps it, from `GoreLoad` (the Mess setting, the quality level, the automatic
 * step). `trim`: the player changed a setting, so what is over the new caps goes now (a decal ring shortened, pieces past
 * their share retired). The step-down passes false: it never takes anything off the floor in front of the player.
 */
export function applyLoad(ctx: Ctx, trim: boolean): void {
  const load = loadFor(GoreLoad.mess, GoreLoad.quality, GoreLoad.ease);
  const b = load.budget;
  MessTuning.level = GoreLoad.mess;
  MessTuning.eased = GoreLoad.ease > 0 ? b : null;
  MessTuning.heaps = load.heaps;
  GoreTuning.maxRagdolls = load.ragdolls;
  GoreTuning.maxCollapses = load.collapses;
  MessTuning.enemyRange = load.enemyPushRange;
  ChunkTuning.linger = load.pieceLinger;
  SWAY.max = load.swayBodies;
  FireTuning.lights = load.fireLights;
  GoreLoad.changed = () => applyLoad(ctx, false);
  if (!trim) return;
  GoreTuning.maxCorpses = b.corpses;
  GoreTuning.maxLimbs = b.limbs;
  SliceTuning.maxHalves = b.halves;
  SliceTuning.hardCap = b.halvesHard;
  ChunkTuning.share = b.pieces;
  const decals = ctx.render?.decals as DecalOwner | undefined;
  if (decals?.setLimit) {
    decals.setLimit('blood', b.blood);
    decals.setLimit('mark', b.marks);
    decals.setLimit('scorch', b.scorches);
    decals.setLimit('big', load.bigStains);
    decals.soak = b.soak;
  }
  (ctx.gore as { chunks?: { trim?(): void } } | undefined)?.chunks?.trim?.();
}

/**
 * The "Mess" setting: how many bodies, limbs, pieces and how much blood stay, and whether the dead heap. The caps and
 * where their numbers come from are `MESS` in gore/mess.ts. Lowering it trims what is over the new caps; raising it gives
 * the room back from here on.
 */
export function applyMess(ctx: Ctx, level: number): void {
  GoreLoad.mess = MESS_LEVELS[clamp(Math.round(level), 0, MESS_LEVELS.length - 1)]!;
  applyLoad(ctx, true);
}

/** Sends every value to its owner. `quality` is separate because changing it recompiles shaders. */
export function applySettings(ctx: Ctx, s: Settings): void {
  const look = ctx.player as unknown as LookOwner;
  look.sensitivity = BASE_SENSITIVITY * s.sensitivity;
  look.invertY = s.invertY;
  look.holdToHop = s.holdToHop;
  const aim = ctx.weapons as unknown as AimOwner;
  aim.aimHold = s.aimHold;
  aim.aimSensitivity = s.aimSensitivity;
  (ctx.camera as unknown as FovRig).setBaseFov?.(s.fov);
  ctx.audio.setVolumes?.(s.master, s.sfx, s.music);
  applyGore(s.gore);
  applyMess(ctx, s.mess);
  HitText.level = s.hitText;
}

/**
 * The renderer's preset, and the gore update's parts that follow it (`QualityPreset`: the decal sheet's size and the floor
 * tiles are the renderer's own; the big stains kept, the struck parts on physics and the burning bodies' lights are
 * written here).
 */
export function applyQuality(ctx: Ctx, s: Settings): void {
  ctx.render.setQuality?.(s.quality);
  GoreLoad.quality = s.quality;
  applyLoad(ctx, true);
}
