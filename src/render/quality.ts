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
}

export const QUALITY: readonly QualityPreset[] = [
  { msaa: 0, maxPixels: 1024 * 640, ao: false, aoSlices: 1, aoSteps: 3, fog: true, fogSteps: 9, bloomLevels: 4, shadowStatic: 2048, shadowDynamic: 0, shadowTaps: 1, dynamicLights: 4, ssrSteps: 0 },
  { msaa: 0, maxPixels: 1440 * 900, ao: true, aoSlices: 2, aoSteps: 4, fog: true, fogSteps: 10, bloomLevels: 5, shadowStatic: 2048, shadowDynamic: 1024, shadowTaps: 2, dynamicLights: 6, ssrSteps: 0 },
  { msaa: 0, maxPixels: 1920 * 1088, ao: true, aoSlices: 2, aoSteps: 4, fog: true, fogSteps: 12, bloomLevels: 6, shadowStatic: 4096, shadowDynamic: 2048, shadowTaps: 4, dynamicLights: 8, ssrSteps: 24 },
  { msaa: 4, maxPixels: 1920 * 1200, ao: true, aoSlices: 3, aoSteps: 5, fog: true, fogSteps: 22, bloomLevels: 7, shadowStatic: 4096, shadowDynamic: 2048, shadowTaps: 8, dynamicLights: 8, ssrSteps: 40 },
];

export const DEFAULT_QUALITY = 2;
