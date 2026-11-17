/** Player settings: persisted to localStorage, applied to the systems that own them. */
import type { Ctx } from '../core/contracts';
import { GoreTuning } from '../gore';
import { BloodTuning } from '../gore/blood';
import { ChunkTuning } from '../gore/chunks';
import { WoundTuning } from '../gore/wounds';
import { clamp } from '../core/math';
import { HIT_TEXT_LEVELS, HitText } from '../progression/data';
import { TUNING } from '../weapons/data';

const STORAGE_KEY = 'op2.settings.v1';
/** The player's default radians per pixel. Sensitivity in settings is a multiple of this. */
const BASE_SENSITIVITY = 0.002;

export const GORE_LEVELS = ['Low', 'Full', 'Excessive'] as const;
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
  sensitivity: 1, fov: 90, invertY: false, master: 0.8, sfx: 1, music: 0.7, quality: 2, gore: 1, holdToHop: false,
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
 * What a gore level changes: how much stays on the map and for how long. Damage, severing and the blood sprayed by
 * a hit are the same at every level, because gameplay must not change with this setting and a spray is one recipe in fx.
 * Full is the game as tuned, and the design's hard caps (40 corpses) are its ceiling, so Excessive buys time rather than
 * more bodies: longer stump spray, chunks that stay, more blood reaching the floor, and corpses that come apart sooner.
 */
const FULL = {
  corpses: GoreTuning.maxCorpses, limbs: GoreTuning.maxLimbs, liveLimbs: GoreTuning.maxLiveLimbs, stump: GoreTuning.stumpSeconds,
  corpseLimb: GoreTuning.corpseLimbHealth, limbBurst: GoreTuning.limbBurstHealth,
  rays: BloodTuning.raysPerFrame, chunks: ChunkTuning.maxBodies, linger: ChunkTuning.linger,
};
const GORE_TABLE: readonly (typeof FULL)[] = [
  { ...FULL, corpses: 12, limbs: 12, liveLimbs: 8, stump: 1.5, rays: 6, chunks: 20, linger: 4 },
  FULL,
  { ...FULL, stump: 9, corpseLimb: 30, limbBurst: 45, rays: 48, linger: 45 },
];

function applyGore(level: number): void {
  const g = GORE_TABLE[level] ?? FULL;
  WoundTuning.level = level;
  GoreTuning.maxCorpses = g.corpses;
  GoreTuning.maxLimbs = g.limbs;
  GoreTuning.maxLiveLimbs = g.liveLimbs;
  GoreTuning.stumpSeconds = g.stump;
  GoreTuning.corpseLimbHealth = g.corpseLimb;
  GoreTuning.limbBurstHealth = g.limbBurst;
  BloodTuning.raysPerFrame = g.rays;
  ChunkTuning.maxBodies = g.chunks;
  ChunkTuning.linger = g.linger;
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
  HitText.level = s.hitText;
}

export function applyQuality(ctx: Ctx, s: Settings): void {
  ctx.render.setQuality?.(s.quality);
}
