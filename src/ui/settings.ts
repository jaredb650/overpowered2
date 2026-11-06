/** Player settings: persisted to localStorage, applied to the systems that own them. */
import type { Ctx } from '../core/contracts';

const STORAGE_KEY = 'op2.settings.v1';
/** The player's default radians per pixel. Sensitivity in settings is a multiple of this. */
const BASE_SENSITIVITY = 0.002;

export const GORE_LEVELS = ['Low', 'Full', 'Excessive'] as const;
export const QUALITY_LEVELS = ['Low', 'Medium', 'High', 'Ultra'] as const;

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
}

export const DEFAULTS: Readonly<Settings> = {
  sensitivity: 1, fov: 90, invertY: false, master: 0.8, sfx: 1, music: 0.7, quality: 2, gore: 1,
};

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

interface LookOwner {
  sensitivity?: number;
  invertY?: boolean;
}

interface GoreDial {
  setLevel?: (level: number) => void;
}

/** Sends every value to its owner. `quality` is separate because changing it recompiles shaders. */
export function applySettings(ctx: Ctx, s: Settings): void {
  const look = ctx.player as unknown as LookOwner;
  look.sensitivity = BASE_SENSITIVITY * s.sensitivity;
  look.invertY = s.invertY;
  (ctx.camera as unknown as FovRig).setBaseFov?.(s.fov);
  ctx.audio.setVolumes?.(s.master, s.sfx, s.music);
  (ctx.gore as unknown as GoreDial).setLevel?.(s.gore);
}

export function applyQuality(ctx: Ctx, s: Settings): void {
  ctx.render.setQuality?.(s.quality);
}
