/**
 * Sensor Cockpit wall-seeing enemy outline controller — Phase 0 stub (Lane K replaces with Thermal brain chip outlines
 * within `range` metres and co-op teammate mark sharing).
 */
import type * as THREE from 'three';
import type { Ctx } from '../core/contracts';

export class FrameCockpitSensor {
  update(_ctx: Ctx, _range: number, _feet: THREE.Vector3, _active: boolean): void {
    // Lane K implements wall-seeing outlines within `range` m (70 m for Sensor Cockpit).
  }

  clear(): void {
    // Lane K clears outlines when disembarking or clearing the Frame.
  }
}
