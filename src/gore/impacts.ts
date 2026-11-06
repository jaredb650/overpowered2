/**
 * Bodies hitting things, for whoever wants to hear it. Gore says what landed and how hard; audio picks the sound.
 *
 * Nothing here calls Rapier. Rag.measure and the chunk and half sweeps already read every velocity each frame, so
 * a landing costs a subtraction. Contact force events would mean a Rapier event queue drained across the WASM
 * boundary every step, for a question those reads already answer.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { clamp } from '../core/math';
import type { BoneDef } from '../characters/rig';

export type ImpactKind = 'body' | 'limb' | 'head' | 'organ';

declare module '../core/contracts' {
  interface GameEvents {
    /** Flesh landed hard. `strength` is 0..1. The payload object is reused, so read it and do not keep it. */
    'gore:impact': { position: THREE.Vector3; strength: number; kind: ImpactKind };
  }
}

/**
 * Per kind: `min` is the impulse that makes a sound, `full` the speed going in that is as loud as it gets, and
 * `cooldown` the shortest gap between two sounds from one body.
 *
 * `min` is per kilogram, which is speed lost in m/s, because rigs run from a 40 kg crawler to a 300 kg titan and
 * one figure in newton-seconds would be silent on the first or constant on the last. Loudness comes from the speed
 * going in, not the speed lost: a body stops over several frames, so its first frame of contact, the only one that
 * can be reported without lag, loses about the same from any height.
 */
export const ImpactTuning = {
  body: { min: 0.9, full: 12, cooldown: 0.25 },
  limb: { min: 2.5, full: 11, cooldown: 0.16 },
  head: { min: 2, full: 10, cooldown: 0.2 },
  organ: { min: 3.5, full: 12, cooldown: 0.14 },
  /** A chunk this size or larger is at full strength. Smaller ones fall off to `organFloor`. */
  organFullSize: 0.1,
  organFloor: 0.35,
  /** Events per frame across everything. A gib lands thirty pieces at once and the mixer only keeps a few. */
  perFrame: 6,
};

/** Which sound a part of a body makes. */
export function impactKind(def: BoneDef): ImpactKind {
  const role = def.joint?.role;
  if (role === 'head') return 'head';
  return role === 'arm' || role === 'leg' ? 'limb' : 'body';
}

export class ImpactEvents {
  private readonly payload: { position: THREE.Vector3; strength: number; kind: ImpactKind } = {
    position: new THREE.Vector3(), strength: 0, kind: 'body',
  };
  private left = ImpactTuning.perFrame;

  constructor(private readonly ctx: Ctx) {}

  /** Call once a frame, before anything lands. */
  frame(): void {
    this.left = ImpactTuning.perFrame;
  }

  /**
   * Reports a landing if it is hard enough and this body is off cooldown. Returns when it may next be heard, for
   * the caller to keep. `lost` is impulse per kilogram, `speed` how fast it was going before it hit.
   */
  land(kind: ImpactKind, lost: number, speed: number, at: THREE.Vector3, readyAt: number, scale = 1): number {
    const t = ImpactTuning[kind];
    const now = this.ctx.time.elapsed;
    if (lost < t.min || now < readyAt || this.left <= 0) return readyAt;
    this.left--;
    const p = this.payload;
    p.position.copy(at);
    p.strength = clamp(speed / t.full) * scale;
    p.kind = kind;
    this.ctx.events.emit('gore:impact', p);
    return now + t.cooldown;
  }
}
