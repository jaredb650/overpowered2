/**
 * What every aircraft call-in shares, so the gunship and the helicopters after it differ only in their shape, their
 * flight plan and their guns.
 *
 *   Airframe     a built model with spinning rotors, named mounts and a strobe, flown by position, heading and roll
 *   OrbitPath    a spiral in, a held circle and a spiral out, as a pure function of time
 *   EngineSound  looped engines that follow an aircraft far beyond what the distance model can reach
 *   soundPoint   the same trick for one-shot sounds from up there
 *
 * Models follow the Warthog: nose along +Z, up +Y, so the left wing is +X.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../../core/contracts';
import { clamp, smoothstep, TAU } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../modelkit';

export type Point = readonly [number, number, number];
export type SpinAxis = 'x' | 'y' | 'z';

export interface RotorSpec {
  /** Hub, in model space. */
  at: Point;
  axis: SpinAxis;
  /** Radians per second. The sign sets the direction. */
  rate: number;
  /** Draws the blades around the origin. */
  build(b: ModelBuilder): void;
  /** Radius of the faint disc that stands in for blades too fast and too thin to resolve. 0 draws none. */
  disc: number;
}

export interface AirframeSpec<M extends string> {
  name: string;
  build(b: ModelBuilder): void;
  rotors: readonly RotorSpec[];
  /** Muzzles, rails, doors, anywhere something leaves the aircraft. In model space. */
  mounts: Readonly<Record<M, Point>>;
  /** Lights that blink: the only part of an aircraft that reads at night from a long way off. */
  strobe?: { build(b: ModelBuilder): void; period: number; lit: number };
}

const discMaterial = new THREE.MeshBasicMaterial({
  color: '#9fb0bf', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

const _look = new THREE.Vector3();

interface Spinner {
  part: THREE.Object3D;
  axis: SpinAxis;
  rate: number;
}

export class Airframe<M extends string> {
  /** Parent this to the scene only: `mount` reads its transform directly. */
  readonly root = new THREE.Group();
  private readonly spinners: Spinner[] = [];
  private readonly strobe: THREE.Object3D | null = null;
  private strobeClock = 0;

  constructor(materials: ModelMaterials, scene: THREE.Scene, private readonly spec: AirframeSpec<M>) {
    const body = new ModelBuilder();
    spec.build(body);
    this.root.name = spec.name;
    this.root.add(materials.group(body));
    for (const rotor of spec.rotors) this.addRotor(materials, rotor);
    if (spec.strobe) {
      const lights = new ModelBuilder();
      spec.strobe.build(lights);
      this.strobe = materials.group(lights);
      this.root.add(this.strobe);
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  private addRotor(materials: ModelMaterials, rotor: RotorSpec): void {
    const blades = new ModelBuilder();
    rotor.build(blades);
    const part = materials.group(blades);
    part.position.set(rotor.at[0], rotor.at[1], rotor.at[2]);
    this.root.add(part);
    this.spinners.push({ part, axis: rotor.axis, rate: rotor.rate });
    if (rotor.disc <= 0) return;
    const circle = new THREE.CircleGeometry(rotor.disc, 24);
    if (rotor.axis === 'x') circle.rotateY(Math.PI / 2);
    else if (rotor.axis === 'y') circle.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(circle, discMaterial);
    disc.position.copy(part.position);
    this.root.add(disc);
  }

  /** Transparent materials this owns, for the shader warm-up. */
  get shaders(): readonly THREE.Material[] {
    return [discMaterial];
  }

  /** `roll` is radians about the nose. Negative dips the left wing. */
  fly(position: THREE.Vector3, forward: THREE.Vector3, roll: number): void {
    const r = this.root;
    r.visible = true;
    r.position.copy(position);
    r.lookAt(_look.copy(position).add(forward));
    r.rotateZ(roll);
  }

  update(dt: number): void {
    for (const s of this.spinners) s.part.rotation[s.axis] = (s.part.rotation[s.axis] + s.rate * dt) % TAU;
    const strobe = this.spec.strobe;
    if (!strobe || !this.strobe) return;
    this.strobeClock = (this.strobeClock + dt) % strobe.period;
    this.strobe.visible = this.strobeClock < strobe.lit;
  }

  /** A named mount in world space, valid from the last `fly`. */
  mount(name: M, out: THREE.Vector3): THREE.Vector3 {
    const m = this.spec.mounts[name];
    return out.set(m[0], m[1], m[2]).applyQuaternion(this.root.quaternion).add(this.root.position);
  }

  hide(): void {
    this.root.visible = false;
  }
}

export interface OrbitPlan {
  radius: number;
  /** Height above the centre. */
  altitude: number;
  /** Radians per second. Negative is the gunship's left-hand circle, with the left wing toward the centre. */
  rate: number;
  /** Roll held on the circle, in radians, toward the centre. */
  bank: number;
  entrySeconds: number;
  /** Extra radius at the start of the entry. */
  entryReach: number;
  holdSeconds: number;
  exitSeconds: number;
  /** Extra radius at the end of the exit. */
  exitReach: number;
  /** Extra height at the end of the exit. */
  exitClimb: number;
}

/**
 * Angle always runs at `rate` and only the radius changes, so speed falls away as the aircraft joins the circle and
 * builds as it leaves it. There is no join to get wrong, and any moment of the flight can be read without simulating it.
 */
export class OrbitPath {
  readonly center = new THREE.Vector3();
  private startAngle = 0;

  constructor(readonly plan: OrbitPlan) {}

  get holdsFrom(): number {
    return this.plan.entrySeconds;
  }

  get holdsUntil(): number {
    return this.plan.entrySeconds + this.plan.holdSeconds;
  }

  get ends(): number {
    return this.holdsUntil + this.plan.exitSeconds;
  }

  /** `arriveAt` is the angle on the circle, in the XZ plane from +X toward +Z, at the moment the entry ends. */
  begin(center: THREE.Vector3, arriveAt: number): void {
    this.center.copy(center);
    this.startAngle = arriveAt - this.plan.rate * this.plan.entrySeconds;
  }

  /** Where the flight is `t` seconds after it began. */
  at(t: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.plan;
    const coming = 1 - smoothstep(0, this.holdsFrom, t);
    const going = smoothstep(this.holdsUntil, this.ends, t);
    const r = p.radius + coming * coming * p.entryReach + going * going * p.exitReach;
    const a = this.startAngle + p.rate * t;
    return out.set(
      this.center.x + Math.cos(a) * r,
      this.center.y + p.altitude + going * going * p.exitClimb,
      this.center.z + Math.sin(a) * r,
    );
  }

  /** Unit direction of flight at `t`, climb included. */
  heading(t: number, out: THREE.Vector3): THREE.Vector3 {
    this.at(t, _look);
    return this.at(t + 0.05, out).sub(_look).normalize();
  }

  /** Roll at `t`, wings levelling off as the aircraft leaves. Radians, ready for `Airframe.fly`. */
  roll(t: number): number {
    const p = this.plan;
    const held = smoothstep(this.holdsFrom * 0.35, this.holdsFrom, t) * (1 - smoothstep(this.holdsUntil, this.holdsUntil + p.exitSeconds * 0.4, t));
    return Math.sign(p.rate) * p.bank * held;
  }
}

/** Sound takes this long to come down from the aircraft to the listener. */
export const flightDelay = (metres: number): number => metres / 343;

/**
 * The distance model reaches a few hundred metres at most and filters what it does reach to mud, while an aircraft has
 * to be heard from further than that. So the sound plays from a point `range` metres out along the true direction: it
 * pans as the real thing would, and the caller sets its level. Writes `out` and returns the true distance.
 */
export function soundPoint(source: THREE.Vector3, listener: THREE.Vector3, range: number, out: THREE.Vector3): number {
  out.subVectors(source, listener);
  const distance = out.length();
  out.multiplyScalar(range / Math.max(distance, 1e-3)).add(listener);
  return distance;
}

export interface EngineLayer {
  id: string;
  volume: number;
  pitch: number;
}

export interface EngineSoundPlan {
  layers: readonly EngineLayer[];
  /** Full level inside this distance. */
  near: number;
  /** Silent beyond this distance. */
  far: number;
}

/** Inside every loop's `near`, so its own distance model stays flat and this class alone sets the level. */
const ENGINE_RANGE = 3;
const ENGINE_TICK = 0.1;
/** A player teleported across the map would otherwise read as a supersonic aircraft. */
const MAX_DOPPLER = 0.12;

const _point = new THREE.Vector3();

/** Looped engines heard from a long way off. Gain falls with true distance and `swell` adds anything the caller wants. */
export class EngineSound {
  private readonly loops: LoopHandle[] = [];
  private clock = 0;
  private lastDistance = -1;

  constructor(private readonly ctx: Ctx, private readonly plan: EngineSoundPlan) {}

  start(fadeIn: number): void {
    for (const layer of this.plan.layers) {
      this.loops.push(this.ctx.audio.startLoop(layer.id, { position: this.ctx.player.eye, volume: 0, pitch: layer.pitch, fadeIn, unaffectedByTime: true }));
    }
  }

  update(position: THREE.Vector3, swell: number, dt: number): void {
    const { near, far, layers } = this.plan;
    const distance = soundPoint(position, this.ctx.player.eye, ENGINE_RANGE, _point);
    for (const loop of this.loops) loop.setPosition(_point);
    this.clock -= dt;
    if (this.clock > 0) return;
    const closing = this.lastDistance < 0 ? 0 : (this.lastDistance - distance) / (ENGINE_TICK * 343);
    this.lastDistance = distance;
    this.clock = ENGINE_TICK;
    const gain = clamp(near / distance) * (1 - smoothstep(near, far, distance)) * swell;
    const shift = 1 + clamp(closing, -MAX_DOPPLER, MAX_DOPPLER);
    for (let i = 0; i < this.loops.length; i++) {
      this.loops[i]!.setVolume(layers[i]!.volume * gain, ENGINE_TICK * 2);
      this.loops[i]!.setPitch(layers[i]!.pitch * shift, ENGINE_TICK * 3);
    }
  }

  stop(fadeOut: number): void {
    for (const loop of this.loops) loop.stop(fadeOut);
    this.loops.length = 0;
  }
}
