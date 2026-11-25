/**
 * Paint liveries, thruster flame themes, and zero-draw-call vertex-color remapping for the Distraint Frame.
 *
 * Every procedural mech model (legacy and v2) builds with the semantic Bureau hex constants in `shared.ts`.
 * `paletteBuilder(palette)` intercepts `ModelBuilder` calls and maps those semantic slots to the active
 * `FramePalette`, so every chassis, head, leg, engine, arm, and shoulder renders in the chosen livery with
 * zero extra draw calls (still 2 merged meshes: lit solid + HDR glow).
 */
import type * as THREE from 'three';
import { ModelBuilder, type Placement } from '../../progression/modelkit';

export type PaintKind =
  | 'bureau'
  | 'arctic'
  | 'hazard'
  | 'crimson'
  | 'desert'
  | 'stealth'
  | 'rust'
  | 'cobalt'
  | 'forest'
  | 'chrome';

export interface FramePalette {
  readonly id: PaintKind;
  readonly name: string;
  /** Primary armour hull tone (replaces OBSIDIAN). */
  readonly primary: string;
  /** Secondary structural casing (replaces GUNMETAL). */
  readonly secondary: string;
  /** Upper fairing / plate contrast (replaces PLATE). */
  readonly plate: string;
  /** Bare mechanical steel / pistons / rings (replaces STEEL). */
  readonly steel: string;
  /** Dark joint / intake metal (replaces IRON). */
  readonly iron: string;
  /** Deep recessed cavity / visor glass / treads (replaces DARK). */
  readonly dark: string;
  /** Hydraulic collars / clamps / trim accent (replaces BRASS). */
  readonly accent: string;
  /** Primary visor & inset line glow (replaces RED). */
  readonly glow: string;
  /** Secondary telemetry & indicator glow (replaces AMBER). */
  readonly secondaryGlow: string;
  /** Outer thruster exhaust cone color. */
  readonly thruster: string;
  /** Inner hot thruster core color. */
  readonly thrusterCore: string;
}

/** Optional 4-swatch user override layered on top of any preset livery. */
export interface CustomFrameColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  glow?: string;
}

export const BUREAU_PALETTE: FramePalette = {
  id: 'bureau',
  name: 'Bureau Standard',
  primary: '#15181d',
  secondary: '#2b313a',
  plate: '#47505c',
  steel: '#6b7582',
  iron: '#1e2228',
  dark: '#0b0d10',
  accent: '#a5894b',
  glow: '#ff2a1a',
  secondaryGlow: '#ffaa30',
  thruster: '#ff8828',
  thrusterCore: '#fff0b8',
};

export const FRAME_PALETTES: Readonly<Record<PaintKind, FramePalette>> = {
  bureau: BUREAU_PALETTE,
  arctic: {
    id: 'arctic',
    name: 'Arctic Prototype',
    primary: '#d8dfe8',
    secondary: '#93a1b2',
    plate: '#eef3f8',
    steel: '#6c7c8e',
    iron: '#28323e',
    dark: '#10161e',
    accent: '#4d7ea8',
    glow: '#38e8ff',
    secondaryGlow: '#82f4ff',
    thruster: '#28c8ff',
    thrusterCore: '#e2fbff',
  },
  hazard: {
    id: 'hazard',
    name: 'Hazard Demolition',
    primary: '#d49a1a',
    secondary: '#26292e',
    plate: '#e6b422',
    steel: '#767c84',
    iron: '#1b1d21',
    dark: '#0c0d0f',
    accent: '#c44d18',
    glow: '#ff7a14',
    secondaryGlow: '#ffd040',
    thruster: '#ff9624',
    thrusterCore: '#fff3c4',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Ace',
    primary: '#7a161c',
    secondary: '#1d1c20',
    plate: '#a8222a',
    steel: '#7b7f88',
    iron: '#141418',
    dark: '#09090b',
    accent: '#c79e46',
    glow: '#ff2438',
    secondaryGlow: '#ff9428',
    thruster: '#ff2838',
    thrusterCore: '#ffd6c4',
  },
  desert: {
    id: 'desert',
    name: 'Desert Enforcement',
    primary: '#9e8b68',
    secondary: '#525644',
    plate: '#baa780',
    steel: '#6e6a60',
    iron: '#2d2b25',
    dark: '#141310',
    accent: '#b07b3a',
    glow: '#ff9020',
    secondaryGlow: '#ffcf5c',
    thruster: '#ff8a24',
    thrusterCore: '#fff0c0',
  },
  stealth: {
    id: 'stealth',
    name: 'Stealth Night-Ops',
    primary: '#0e1116',
    secondary: '#191e26',
    plate: '#232a35',
    steel: '#465160',
    iron: '#11151b',
    dark: '#06080b',
    accent: '#2c6f8a',
    glow: '#1ce0ff',
    secondaryGlow: '#3ca0ff',
    thruster: '#18a8ff',
    thrusterCore: '#d4f6ff',
  },
  rust: {
    id: 'rust',
    name: 'Scrapyard Rust',
    primary: '#6e3b28',
    secondary: '#3b3330',
    plate: '#8c4e35',
    steel: '#6d6762',
    iron: '#25201e',
    dark: '#110e0d',
    accent: '#b8883c',
    glow: '#ff5c18',
    secondaryGlow: '#ffae34',
    thruster: '#ff6c1c',
    thrusterCore: '#ffe6a8',
  },
  cobalt: {
    id: 'cobalt',
    name: 'Cobalt Security',
    primary: '#1e3557',
    secondary: '#364963',
    plate: '#8c9eb4',
    steel: '#9aa7b8',
    iron: '#172336',
    dark: '#0a1019',
    accent: '#d67824',
    glow: '#42d8ff',
    secondaryGlow: '#ffaa38',
    thruster: '#34b8ff',
    thrusterCore: '#e8faff',
  },
  forest: {
    id: 'forest',
    name: 'Forest Heavy',
    primary: '#354531',
    secondary: '#262f26',
    plate: '#53654b',
    steel: '#677066',
    iron: '#1b201b',
    dark: '#0c0f0c',
    accent: '#a88a44',
    glow: '#ff5222',
    secondaryGlow: '#ffc23c',
    thruster: '#ff8828',
    thrusterCore: '#fff0b8',
  },
  chrome: {
    id: 'chrome',
    name: 'Chrome Experimental',
    primary: '#a4aeb8',
    secondary: '#3c434d',
    plate: '#cfd7e0',
    steel: '#dde4ec',
    iron: '#242930',
    dark: '#0e1116',
    accent: '#cfa444',
    glow: '#ff2868',
    secondaryGlow: '#ff70a0',
    thruster: '#ff2c68',
    thrusterCore: '#ffe2ec',
  },
};

const HEX_RE = /^#[0-9a-f]{6}$/i;
const validHex = (v: string | undefined): string | undefined => (v && HEX_RE.test(v) ? v : undefined);

/** Resolves a preset `PaintKind` plus optional custom 4-swatch overrides into a concrete `FramePalette`. */
export function resolvePalette(kind: PaintKind = 'bureau', custom?: CustomFrameColors): FramePalette {
  const base = FRAME_PALETTES[kind] ?? BUREAU_PALETTE;
  if (!custom) return base;
  const primary = validHex(custom.primary);
  const secondary = validHex(custom.secondary);
  const accent = validHex(custom.accent);
  const glow = validHex(custom.glow);
  if (!primary && !secondary && !accent && !glow) return base;
  return {
    ...base,
    primary: primary ?? base.primary,
    secondary: secondary ?? base.secondary,
    plate: secondary ?? base.plate,
    accent: accent ?? base.accent,
    glow: glow ?? base.glow,
    thruster: glow ?? base.thruster,
  };
}

/** Deterministic key representing a palette so `StandIn` and `ArmRack` know when to rebuild cached meshes. */
export function paletteKey(p: FramePalette): string {
  return `${p.id}|${p.primary}|${p.secondary}|${p.plate}|${p.accent}|${p.glow}`;
}

/** Maps semantic Bureau hex constants in any model builder onto `palette` colors. */
export function remapColor(color: THREE.ColorRepresentation, palette: FramePalette): THREE.ColorRepresentation {
  if (typeof color !== 'string') return color;
  switch (color.toLowerCase()) {
    case '#15181d': return palette.primary;
    case '#2b313a': return palette.secondary;
    case '#47505c': return palette.plate;
    case '#6b7582': return palette.steel;
    case '#1e2228': return palette.iron;
    case '#0b0d10': return palette.dark;
    case '#a5894b': return palette.accent;
    case '#ff2a1a': return palette.glow;
    case '#ffaa30': return palette.secondaryGlow;
    default: return color;
  }
}

/**
 * `ModelBuilder` subclass that transparently maps the Bureau semantic hex codes (`OBSIDIAN`, `GUNMETAL`, `PLATE`,
 * `STEEL`, `IRON`, `DARK`, `BRASS`, `RED`, `AMBER`) to `palette` on every `solid`, `glow`, `box`, and `cyl` call.
 * Zero extra draw calls; every existing and new model inherits full livery & custom paint support automatically.
 */
export class PaletteModelBuilder extends ModelBuilder {
  constructor(private readonly palette: FramePalette) {
    super();
  }

  override solid(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, p?: Placement): this {
    return super.solid(geo, remapColor(color, this.palette), p);
  }

  override glow(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, boost = 3, p?: Placement): this {
    return super.glow(geo, remapColor(color, this.palette), boost, p);
  }
}

export function createFrameBuilder(palette: FramePalette = BUREAU_PALETTE): ModelBuilder {
  return palette === BUREAU_PALETTE ? new ModelBuilder() : new PaletteModelBuilder(palette);
}
