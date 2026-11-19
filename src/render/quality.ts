/** Quality presets. Everything that scales with hardware lives here so a preset is one readable row. */
export interface QualityPreset {
  /** MSAA samples on the scene target. 0 uses edge AA in the final pass, which costs a fraction of it. */
  msaa: number;
  /** Most canvas pixels. The canvas takes the largest whole stretch of the screen that fits, so this is a ceiling. */
  maxPixels: number;
  ao: boolean;
  aoSlices: number;
  aoSteps: number;
  fog: boolean;
  fogSteps: number;
  bloomLevels: number;
  /** Whole-map cached moon shadow map edge. */
  shadowStatic: number;
  /** Per-frame dynamic moon shadow map edge. 0 turns character shadows off. */
  shadowDynamic: number;
  /** PCF taps per shadow lookup. */
  shadowTaps: number;
  /** Live point lights. Changing this recompiles lit shaders, so it only changes with the preset. */
  dynamicLights: number;
  /** Ray steps for screen-space reflections on wet and polished surfaces. 0 turns them off. */
  ssrSteps: number;
  /**
   * The decal sheet's size as a share of 2048 x 4096 (`SHEET`): 89 MB of texture at 1, 22 MB at 0.5. Blood is kept on the
   * sheet as fields the shader thresholds (render.md, "The decal sheet"), so a stain's edge stays sharp at half size;
   * what softens is the marks (bullet holes, cracks) and the fine specks. Baked at load from the saved setting, and
   * baked again when the setting crosses the line (`Renderer.setQuality`).
   */
  decalSheet: number;
  /** Floor tiles that keep dried blood once its decal is overwritten (`BloodMap`): 16 is all of them, 0 none. */
  bloodTiles: number;
  /** Share of the "Mess" setting's big stains in use (`MESS[...].big`): the 2 m stains are the decals that fill a screen. */
  bigStains: number;
  /** Bodies whose struck part swings on physics at once (`SWAY.max`); the rest keep the animated flinch. */
  swayBodies: number;
  /** Burning bodies that light the floor round them at once (`FireTuning.lights`). */
  fireLights: number;
}

export const QUALITY: readonly QualityPreset[] = [
  { msaa: 0, maxPixels: 1024 * 640, ao: false, aoSlices: 1, aoSteps: 3, fog: true, fogSteps: 9, bloomLevels: 4, shadowStatic: 2048, shadowDynamic: 0, shadowTaps: 1, dynamicLights: 4, ssrSteps: 0, decalSheet: 0.5, bloodTiles: 0, bigStains: 0.5, swayBodies: 3, fireLights: 1 },
  { msaa: 0, maxPixels: 1440 * 900, ao: true, aoSlices: 2, aoSteps: 4, fog: true, fogSteps: 10, bloomLevels: 5, shadowStatic: 2048, shadowDynamic: 1024, shadowTaps: 2, dynamicLights: 6, ssrSteps: 0, decalSheet: 0.5, bloodTiles: 8, bigStains: 0.75, swayBodies: 5, fireLights: 2 },
  { msaa: 0, maxPixels: 1920 * 1088, ao: true, aoSlices: 2, aoSteps: 4, fog: true, fogSteps: 12, bloomLevels: 6, shadowStatic: 4096, shadowDynamic: 2048, shadowTaps: 4, dynamicLights: 8, ssrSteps: 24, decalSheet: 1, bloodTiles: 16, bigStains: 1, swayBodies: 8, fireLights: 3 },
  { msaa: 4, maxPixels: 1920 * 1200, ao: true, aoSlices: 3, aoSteps: 5, fog: true, fogSteps: 22, bloomLevels: 7, shadowStatic: 4096, shadowDynamic: 2048, shadowTaps: 8, dynamicLights: 8, ssrSteps: 40, decalSheet: 1, bloodTiles: 16, bigStains: 1, swayBodies: 8, fireLights: 3 },
];

export const DEFAULT_QUALITY = 2;

/** Where the settings screen keeps the player's choices (`ui/settings.ts`, which checks the two agree). */
export const SETTINGS_KEY = 'op2.settings.v1';

/**
 * The quality level the player last chose, read straight from storage, or the default. For what is sized once at load,
 * before the settings are applied: the decal sheet (a Low or Medium machine never allocates the full one).
 */
export function savedQuality(): number {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY);
    const level = raw ? (JSON.parse(raw) as { quality?: unknown }).quality : undefined;
    if (typeof level === 'number' && Number.isFinite(level)) return Math.min(Math.max(Math.round(level), 0), QUALITY.length - 1);
  } catch {
    // Blocked or corrupt storage: the default.
  }
  return DEFAULT_QUALITY;
}
