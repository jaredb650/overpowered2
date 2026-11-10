/**
 * Effects. Every effect in the game goes through createFx(ctx).
 *
 * Particles live entirely on the GPU: emission writes a spawn record into a ring buffer and the vertex
 * shader evaluates motion from (record, time), so nothing is touched per frame after it is born.
 * Slow-mo, hit-stop and pause come for free from ctx.time.elapsed. See docs/notes/fx.md.
 */
import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import type {
  BeamKind, Ctx, EmitterHandle, EmitterPreset, ExplosionOptions, FxSystem, GameEvents, MuzzleKind, SlashKind,
  SurfaceKind, TracerKind,
} from '../core/contracts';
import { FxCore } from './core';
import { EmitterPool } from './emitters';
import { hotInto, type Rgb } from './layers/shared';
import { CHIP } from './palette';
import { bloodHit, bloodJet, bloodMist, gibBurst, headBurst } from './recipes/blood';
import { chipBurst, hellfireBurst } from './recipes/bursts';
import { burst as cannonBurst } from './recipes/cannon';
import { embers, explosion } from './recipes/explosions';
import { impact } from './recipes/impacts';
import * as misc from './recipes/misc';
import { listen } from './recipes/movement';
import { muzzleFlash, tracer } from './recipes/muzzle';

const _c: Rgb = { r: 0, g: 0, b: 0 };

const CASINGS = {
  pistol: { size: 0.017, color: CHIP.brass, bounce: 0.44 },
  rifle: { size: 0.022, color: CHIP.brass, bounce: 0.44 },
  shotgun: { size: 0.034, color: CHIP.red, bounce: 0.34 },
  cannon: { size: 0.07, color: CHIP.brassDark, bounce: 0.38 },
} as const;

type CasingKind = keyof typeof CASINGS;
const CASING_KINDS = Object.keys(CASINGS) as CasingKind[];

class Fx implements FxSystem {
  private core!: FxCore;
  private emitters!: EmitterPool;
  private readonly casingEvent: GameEvents['fx:casing'] = { position: new THREE.Vector3(), kind: 'pistol', strength: 0 };

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    if (this.core) return;
    this.core = new FxCore(this.ctx);
    this.emitters = new EmitterPool(this.core);
    listen(this.ctx, this.core);
  }

  update(): void {
    this.emitters.update();
    this.core.runTinkles(this.onTinkle);
    this.core.runStains();
    this.core.syncFrame();
  }

  reset(): void {
    this.clear();
  }

  clear(): void {
    this.emitters.stopAll();
    this.core.clear();
  }

  /** `value` packs the casing kind in its integer part and the strength of the hit in its fraction. */
  private readonly onTinkle = (x: number, y: number, z: number, value: number): void => {
    const e = this.casingEvent;
    e.position.set(x, y, z);
    e.kind = CASING_KINDS[Math.floor(value)]!;
    e.strength = value - Math.floor(value);
    this.ctx.events.emit('fx:casing', e);
  };

  muzzleFlash(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind, view = false): void {
    muzzleFlash(this.core, position, dir, kind, view);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, kind: TracerKind): void {
    tracer(this.core, from, to, kind);
  }

  impact(position: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale?: number): void {
    impact(this.core, position, normal, surface, scale);
  }

  shellCasing(position: THREE.Vector3, velocity: THREE.Vector3, kind: CasingKind): void {
    const core = this.core;
    const f = CASINGS[kind];
    const { x, y, z } = position;
    const floor = core.floorAt(x, y, z);
    const g = -20;
    const c = core.chips.begin('casing', f.color, core.birth, 1.8, g, floor, f.bounce, 0.55, 0.8);
    c.add(x, y, z, velocity.x, velocity.y, velocity.z, f.size, rand(-28, 28), rand(-28, 28), rand(-28, 28));

    // Motion is on the GPU, but the arc is known exactly, so the sound can be booked now.
    const h = y - floor;
    if (floor > -1e5 && h >= 0) {
      const code = CASING_KINDS.indexOf(kind);
      let vy = velocity.y;
      let height = h;
      let t = 0;
      for (let i = 0; i < 3; i++) {
        const tc = (-vy - Math.sqrt(vy * vy - 2 * g * height)) / g;
        t += tc;
        if (t > 1.8) break;
        const hit = -(vy + g * tc);
        const px = x + velocity.x * t * 0.6;
        const pz = z + velocity.z * t * 0.6;
        core.bookTinkle(t, px, floor, pz, code + clamp(hit / 14, 0.05, 0.95));
        vy = hit * f.bounce;
        height = 0;
        if (vy < 1.2) break;
      }
    }
  }

  explosion(position: THREE.Vector3, options: ExplosionOptions): void {
    explosion(this.core, position, options);
  }

  ring(position: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, size?: number): void {
    misc.ring(this.core, position, dir, color, size);
  }

  sparks(position: THREE.Vector3, dir: THREE.Vector3, count: number, color?: THREE.ColorRepresentation): void {
    misc.sparks(this.core, position, dir, count, color);
  }

  smoke(position: THREE.Vector3, color?: THREE.ColorRepresentation, size?: number, seconds?: number): void {
    misc.smokePuff(this.core, position, color, size, seconds);
  }

  bloodJet(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void {
    bloodJet(this.core, position, dir, intensity);
  }

  bloodHit(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void {
    bloodHit(this.core, position, dir, intensity);
  }

  bloodMist(position: THREE.Vector3, size?: number): void {
    bloodMist(this.core, position, size);
  }

  headBurst(position: THREE.Vector3, dir: THREE.Vector3): void {
    headBurst(this.core, position, dir);
  }

  gibBurst(position: THREE.Vector3, dir: THREE.Vector3, force: number): void {
    gibBurst(this.core, position, dir, force);
  }

  attachEmitter(target: THREE.Object3D, preset: EmitterPreset, offset?: THREE.Vector3, seconds?: number): EmitterHandle {
    return this.emitters.attach(target, preset, offset, seconds);
  }

  chips(position: THREE.Vector3, color: THREE.ColorRepresentation, count: number, hellfire = false): void {
    const core = this.core;
    const { x, y, z } = position;
    const floor = core.floorAt(x, y, z);
    hotInto(_c, color, 2.1);
    if (hellfire) hellfireBurst(core, x, y, z, _c, count, floor);
    else chipBurst(core, x, y, z, _c, count, floor);
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, kind: BeamKind, width?: number, seconds?: number): void {
    misc.beam(this.core, from, to, kind, width, seconds);
  }

  arc(from: THREE.Vector3, to: THREE.Vector3, color?: THREE.ColorRepresentation, seconds?: number, width?: number): void {
    misc.arc(this.core, from, to, color, seconds, width);
  }

  slash(center: THREE.Vector3, normal: THREE.Vector3, startDir: THREE.Vector3, arc: number, radius: number, kind: SlashKind = 'light'): void {
    misc.slash(this.core, center, normal, startDir, arc, radius, kind);
  }

  flame(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void {
    misc.flame(this.core, position, dir, intensity);
  }

  frostShatter(position: THREE.Vector3, dir: THREE.Vector3, scale?: number): void {
    misc.frostShatter(this.core, position, dir, scale);
  }

  embers(position: THREE.Vector3, count: number, spread = 1): void {
    embers(this.core, position.x, position.y, position.z, spread, count);
  }

  dust(position: THREE.Vector3, normal: THREE.Vector3, scale?: number): void {
    misc.dust(this.core, position, normal, scale);
  }

  slam(position: THREE.Vector3, amount: number): void {
    misc.slam(this.core, position, amount);
  }

  dashStreaks(position: THREE.Vector3, dir: THREE.Vector3): void {
    misc.dashStreaks(this.core, position, dir);
  }

  jumpPad(position: THREE.Vector3, normal: THREE.Vector3, color?: THREE.ColorRepresentation): void {
    misc.jumpPad(this.core, position, normal, color);
  }

  pickupSparkle(position: THREE.Vector3, color?: THREE.ColorRepresentation): void {
    misc.pickupSparkle(this.core, position, color);
  }

  spawnIn(position: THREE.Vector3, color?: THREE.ColorRepresentation, height?: number): void {
    misc.spawnIn(this.core, position, color, height);
  }

  wallSparks(position: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3): void {
    misc.wallSparks(this.core, position, normal, along);
  }

  lensBlood(amount: number): void {
    this.core.lens?.splatter(clamp(amount));
  }

  heatShimmer(position: THREE.Vector3, radius: number, seconds: number): void {
    this.core.shimmer.add(position.x, position.y, position.z, radius, this.core.now, seconds, 1, 0);
  }

  burst(position: THREE.Vector3, normal: THREE.Vector3, scale?: number): void {
    cannonBurst(this.core, position, normal, scale);
  }

  /** Debug counters for sandboxes and the debug overlay. Scans the rings: not for per-frame use. */
  stats(): { particles: number; emitters: number } {
    return { particles: this.core.countParticles(), emitters: this.emitters.count };
  }
}

/** Builds the system. Call after ctx.render and ctx.physics exist; `update` runs once per frame. */
export function createFx(ctx: Ctx): Fx {
  const fx = new Fx(ctx);
  fx.init();
  return fx;
}

export type { Fx };
