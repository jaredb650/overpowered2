/**
 * Mix profiles: how a class of sounds behaves in the game. Every catalogue entry starts from a
 * profile, so the balance between weapons, voices and stingers is set here in one place.
 */
export type BusName = 'sfx' | 'ui';

export interface MixProfile {
  bus: BusName;
  /** Linear level. */
  volume: number;
  /** Higher survives voice stealing. */
  priority: number;
  /** Simultaneous voices of this id. */
  maxVoices: number;
  /** Plays of this id allowed on one frame. Extras would only add level, never information. */
  perFrame: number;
  /** Shared cap across a family of ids, so 48 enemies cannot fill the mixer with one kind of sound. */
  family?: string;
  familyMax?: number;
  /** Full volume inside this distance, in meters. */
  near: number;
  /** Silent beyond this distance. */
  far: number;
  /** Reverb send at point blank. Rises with distance. */
  send: number;
  /** Eligible for HRTF when close. */
  hrtf: boolean;
  /** Ignores slow-mo. */
  exempt: boolean;
  /** Default random pitch range. */
  pitchJitter: number;
  /** Music duck amount (0..1) and hold seconds. */
  duck?: readonly [amount: number, seconds: number];
  /** Arrives late at long range, at the speed of sound. */
  airDelay: boolean;
  fadeIn: number;
  fadeOut: number;
}

const base: MixProfile = {
  bus: 'sfx', volume: 0.5, priority: 4, maxVoices: 4, perFrame: 1, near: 5, far: 90, send: 0.12, hrtf: false,
  exempt: false, pitchJitter: 0, airDelay: false, fadeIn: 0.05, fadeOut: 0.12,
};

export const MIX = {
  /** The player's own guns, played 2D. */
  gun: { ...base, volume: 0.62, priority: 8, maxVoices: 4, send: 0.15, pitchJitter: 0.025 },
  /** Enormous single shots that deserve the room. */
  gunHeavy: { ...base, volume: 0.8, priority: 8, maxVoices: 3, send: 0.28, pitchJitter: 0.02, duck: [0.2, 0.25] },
  /** Reloads, handling, casings. */
  foley: { ...base, volume: 0.42, priority: 3, maxVoices: 4, send: 0.05, near: 2, far: 25, pitchJitter: 0.03 },
  impact: { ...base, volume: 0.42, priority: 4, maxVoices: 5, perFrame: 3, family: 'impact', familyMax: 12, near: 5, far: 80, send: 0.12, pitchJitter: 0.09 },
  gore: { ...base, volume: 0.6, priority: 5, maxVoices: 4, perFrame: 2, family: 'gore', familyMax: 10, near: 6, far: 70, send: 0.08, pitchJitter: 0.1 },
  body: { ...base, volume: 0.42, priority: 2, maxVoices: 4, perFrame: 2, family: 'gore', familyMax: 10, near: 4, far: 45, send: 0.06, pitchJitter: 0.12 },
  blast: { ...base, volume: 0.85, priority: 9, maxVoices: 5, perFrame: 2, near: 16, far: 340, send: 0.42, pitchJitter: 0.07, airDelay: true, duck: [0.3, 0.5] },
  blastSmall: { ...base, volume: 0.62, priority: 7, maxVoices: 5, perFrame: 2, near: 10, far: 220, send: 0.32, pitchJitter: 0.08, airDelay: true },
  blastHuge: { ...base, volume: 1, priority: 10, maxVoices: 2, near: 60, far: 900, send: 0.5, pitchJitter: 0, airDelay: true, exempt: true, duck: [0.8, 3] },
  player: { ...base, volume: 0.45, priority: 6, maxVoices: 3, send: 0.07, pitchJitter: 0.04 },
  playerHurt: { ...base, volume: 0.62, priority: 8, maxVoices: 2, send: 0.04, pitchJitter: 0.05 },
  step: { ...base, volume: 0.24, priority: 2, maxVoices: 3, family: 'step', familyMax: 6, near: 3, far: 35, send: 0.04, pitchJitter: 0.06 },
  voice: { ...base, volume: 0.5, priority: 3, maxVoices: 3, family: 'voice', familyMax: 7, near: 6, far: 70, send: 0.13, hrtf: true, pitchJitter: 0.08 },
  voiceBig: { ...base, volume: 0.85, priority: 7, maxVoices: 2, near: 18, far: 240, send: 0.3, pitchJitter: 0.05, duck: [0.3, 1] },
  enemyGun: { ...base, volume: 0.42, priority: 5, maxVoices: 4, family: 'enemyGun', familyMax: 9, near: 8, far: 130, send: 0.2, hrtf: true, pitchJitter: 0.07 },
  enemyFx: { ...base, volume: 0.48, priority: 5, maxVoices: 3, near: 7, far: 90, send: 0.14, hrtf: true, pitchJitter: 0.05 },
  machine: { ...base, volume: 0.42, priority: 3, maxVoices: 4, family: 'machine', familyMax: 8, near: 6, far: 70, send: 0.1, pitchJitter: 0.1 },
  giantStep: { ...base, volume: 0.8, priority: 7, maxVoices: 3, near: 22, far: 300, send: 0.3, pitchJitter: 0.05, airDelay: true },
  /** Reward stingers: never slowed and never stolen by gunfire. */
  stinger: { ...base, volume: 0.62, priority: 9, maxVoices: 2, exempt: true, send: 0.1, duck: [0.35, 0.9] },
  /** Short reward blips that must stay crisp in a firefight. */
  reward: { ...base, volume: 0.42, priority: 7, maxVoices: 3, exempt: true, send: 0.03 },
  ui: { ...base, bus: 'ui' as BusName, volume: 0.42, priority: 10, maxVoices: 3, exempt: true, send: 0 },
  loop2d: { ...base, volume: 0.5, priority: 7, maxVoices: 2, send: 0.1, fadeIn: 0.06, fadeOut: 0.15 },
  loop3d: { ...base, volume: 0.5, priority: 5, maxVoices: 6, near: 6, far: 70, send: 0.14, fadeIn: 0.08, fadeOut: 0.2 },
  ambience: { ...base, volume: 0.3, priority: 6, maxVoices: 2, send: 0, exempt: false, fadeIn: 2.5, fadeOut: 2.5 },
} as const satisfies Record<string, MixProfile>;

export type MixClass = keyof typeof MIX;
