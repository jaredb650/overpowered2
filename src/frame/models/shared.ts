/**
 * Shared palette, geometry helpers, and plug-in visual interfaces for Distraint Frame 3D models (`src/frame/models/`).
 * Every part model uses these semantic Bureau materials and bevelled `prism` profiles; `PaletteModelBuilder` maps
 * them transparently onto whichever `FramePalette` livery or custom paint the player equipped.
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { BUREAU_PALETTE, createFrameBuilder, type FramePalette } from './palette';

export { BUREAU_PALETTE, FRAME_PALETTES, createFrameBuilder, paletteKey, remapColor, resolvePalette } from './palette';
export type { CustomFrameColors, FramePalette, PaintKind } from './palette';

export const OBSIDIAN = '#15181d';
export const GUNMETAL = '#2b313a';
export const PLATE = '#47505c';
export const STEEL = '#6b7582';
export const IRON = '#1e2228';
export const DARK = '#0b0d10';
export const BRASS = '#a5894b';
export const RED = '#ff2a1a';
export const AMBER = '#ffaa30';

export const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
export const ACROSS: readonly [number, number, number] = [0, Math.PI / 2, 0];
export const FLAT: readonly [number, number, number] = [-Math.PI / 2, 0, 0];

/** A 2D outline extruded `depth` with a chamfer on every edge, centred on its depth. With `rot: ACROSS`, `[u, v]` maps to `z = -u, y = v`. */
export function prism(points: readonly (readonly [number, number])[], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const core = Math.max(0.01, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
  });
  return geo.translate(0, 0, -core / 2);
}

export function ngon(r: number, n: number, turn = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU + turn) * r, Math.sin((i / n) * TAU + turn) * r] as [number, number]);
}

/** Per-chassis hardpoint coordinates in torso space (`x` right, `y` up from hips, `-z` ahead). */
export interface ChassisPlaces {
  readonly eye: readonly [number, number, number];
  /** Where the Head / Sensor Crown mounts on top of (or forward of) the torso. */
  readonly head: readonly [number, number, number];
  /** Left arm gun pivot. */
  readonly leftArm: readonly [number, number, number];
  /** Right arm gun pivot. */
  readonly rightArm: readonly [number, number, number];
  /** Up to 3 shoulder hardpoints: slot 0 right, slot 1 left, slot 2 dorsal center. */
  readonly shoulders: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  /** Rear jet / reactor exhaust center. */
  readonly jets: readonly [number, number, number];
  /** Optional twin back thruster cone mount positions (`[x, y, z]`) for standard jet cones. */
  readonly jetNozzles?: readonly (readonly [number, number, number])[];
  /** Optional forward posture pitch offset in radians (e.g. Kestrel leans forward). */
  readonly posturePitch?: number;
}

/** Builds a shoulder weapon model in local mount space (origin = shoulder pylon mount, -Z = forward). */
export type ShoulderModelBuilder = (b: ModelBuilder) => void;

/** Animated legs assembly owned by a custom gait (`legs-*.ts`). */
export interface LegsVisual {
  readonly group: THREE.Group;
  pose(
    stride: number, walk: number, effectiveSink: number, kneel: number, collapse: number,
    limpSide: -1 | 0 | 1, parked: boolean, jetMode: boolean,
    extra?: { hovering?: boolean; flying?: boolean; dt?: number; turnRate?: number; speed?: number },
  ): void;
}
export type LegsVisualBuilder = (materials: ModelMaterials, hipsY: number, palette?: FramePalette) => LegsVisual;

/** Custom cockpit/chassis exterior and first-person interior visual. */
export interface CockpitVisual {
  /** Attached to the exterior `hull` (or replaces it entirely when `replacesHull` is true). */
  readonly exterior?: THREE.Group;
  /** Attached to the first-person `cockpit` group (shown when `inside` is true). */
  readonly interior?: THREE.Group;
  /** Hide the standard interior cockpit roll-cage/glass. */
  readonly hideStandardInterior?: boolean;
  /** Hide the standard exterior visor slit. */
  readonly hideStandardVisor?: boolean;
  /** When true, hides the standard `hull()` mesh completely so this chassis defines a totally new silhouette! */
  readonly replacesHull?: boolean;
  /** Optional custom hardpoint coordinates for arms, shoulders, head, eye, and jets. */
  readonly places?: ChassisPlaces;
  /** Optional visor meshes controlled by active/standby state when `replacesHull` is true. */
  readonly visorActive?: THREE.Object3D;
  readonly visorStandby?: THREE.Object3D;
}
export type CockpitVisualBuilder = (materials: ModelMaterials, palette?: FramePalette) => CockpitVisual;

/** Sculpted Head / Sensor Crown mounted at `places.head` on the exterior torso. */
export interface HeadVisual {
  readonly group: THREE.Group;
  pose?(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean): void;
}
export type HeadVisualBuilder = (materials: ModelMaterials, palette?: FramePalette) => HeadVisual;

/** Animated engine exterior visual attached to `torso` (`engine-kit.ts`, `engine-v2.ts`). */
export interface EngineVisual {
  readonly group: THREE.Group;
  pose(
    dt: number, jets: boolean, flying: boolean, hovering: boolean, jetMode: boolean, stride: number, inside: boolean,
    extra?: { charging?: boolean; redline?: number; dashDirX?: number; dashDirZ?: number },
  ): void;
}

/** Helper to instantiate a palette-aware `ModelBuilder` inside any part builder. */
export function frameBuilder(palette?: FramePalette): ModelBuilder {
  return createFrameBuilder(palette ?? BUREAU_PALETTE);
}
