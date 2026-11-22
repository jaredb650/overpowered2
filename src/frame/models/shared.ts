/**
 * Shared palette, geometry helpers, and plug-in visual interfaces for Distraint Frame 3D models (`src/frame/models/`).
 * Every part model uses these materials and bevelled `prism` profiles so all Phase 1 lanes match the Frame's Bureau metal.
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { ModelBuilder, ModelMaterials } from '../../progression/modelkit';

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

/** Builds a shoulder weapon model in local mount space (origin = shoulder pylon mount, -Z = forward). */
export type ShoulderModelBuilder = (b: ModelBuilder) => void;

/** Animated legs assembly owned by a custom gait (`legs-sprinter.ts`, `legs-heavy.ts`, `legs-treads.ts`, `legs-spider.ts`). */
export interface LegsVisual {
  readonly group: THREE.Group;
  pose(
    stride: number, walk: number, effectiveSink: number, kneel: number, collapse: number,
    limpSide: -1 | 0 | 1, parked: boolean, jetMode: boolean,
  ): void;
}
export type LegsVisualBuilder = (materials: ModelMaterials, hipsY: number) => LegsVisual;

/** Custom cockpit exterior and/or first-person interior visual (`cockpit-twin.ts`, `cockpit-open.ts`, `cockpit-sensor.ts`). */
export interface CockpitVisual {
  /** Attached to the exterior `hull` group (hidden when `inside` is true). */
  readonly exterior?: THREE.Group;
  /** Attached to the first-person `cockpit` group (shown when `inside` is true). */
  readonly interior?: THREE.Group;
  /** Hide the standard interior cockpit roll-cage/glass (e.g. Open Frame). */
  readonly hideStandardInterior?: boolean;
  /** Hide the standard exterior visor slit (e.g. Open Frame). */
  readonly hideStandardVisor?: boolean;
}
export type CockpitVisualBuilder = (materials: ModelMaterials) => CockpitVisual;

/** Animated engine exterior visual attached to `hull` (`engine-kit.ts`: jet bells, helicopter rotor, afterburner wings, etc.). */
export interface EngineVisual {
  readonly group: THREE.Group;
  pose(
    dt: number, jets: boolean, flying: boolean, hovering: boolean, jetMode: boolean, stride: number, inside: boolean,
  ): void;
}
