import * as THREE from 'three';
import { rand } from '../core/math';
import type { EmitterHandle, EmitterPreset } from '../core/contracts';
import type { FxCore } from './core';
import { BLOOD, SMOKE, SPARK } from './palette';
import { hot } from './layers/shared';
import { burnPuff } from './recipes/misc';

/** Hard cap. Attaching past it recycles the oldest emitter. */
const CAP = 64;

/** Seconds between trail beats, from the first game. */
const TRAIL_STEP = 0.06;

const HELLFIRE_CUBE = hot(0xff6600, 2.2);
const HELLFIRE_CUBE_2 = hot(0xffaa00, 2.4);
const EXHAUST = hot(0xff9030, 5);

interface Slot {
  preset: EmitterPreset;
  target: THREE.Object3D;
  hasOffset: boolean;
  offset: THREE.Vector3;
  last: THREE.Vector3;
  /** 0 = runs until stopped. */
  duration: number;
  age: number;
  acc: number;
  acc2: number;
  beat: number;
  /** Floor height sampled on the last heartbeat. */
  floor: number;
  primed: boolean;
  /** False for a free-standing Object3D, which is allowed to have no parent. */
  parented: boolean;
  generation: number;
  live: boolean;
}

class Handle implements EmitterHandle {
  constructor(private readonly slot: Slot, private readonly generation: number) {}

  stop(): void {
    if (this.alive) this.slot.live = false;
  }

  get alive(): boolean {
    return this.slot.live && this.slot.generation === this.generation;
  }
}

const _p = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class EmitterPool {
  private readonly slots: Slot[] = [];
  private cursor = 0;

  constructor(private readonly core: FxCore) {
    for (let i = 0; i < CAP; i++) {
      this.slots.push({
        preset: 'smokeTrail', target: null as unknown as THREE.Object3D, hasOffset: false,
        offset: new THREE.Vector3(), last: new THREE.Vector3(), duration: 0, age: 0, acc: 0, acc2: 0,
        beat: 0, floor: -1e6, primed: false, parented: false, generation: 0, live: false,
      });
    }
  }

  attach(target: THREE.Object3D, preset: EmitterPreset, offset?: THREE.Vector3, seconds?: number): EmitterHandle {
    let slot: Slot | undefined;
    for (let i = 0; i < CAP; i++) {
      const s = this.slots[(this.cursor + i) % CAP]!;
      if (!s.live) {
        slot = s;
        break;
      }
    }
    if (!slot) {
      slot = this.slots[this.cursor]!;
      this.cursor = (this.cursor + 1) % CAP;
    }
    slot.generation++;
    slot.live = true;
    slot.preset = preset;
    slot.target = target;
    slot.hasOffset = !!offset;
    if (offset) slot.offset.copy(offset);
    slot.duration = seconds ?? 0;
    slot.age = 0;
    slot.acc = TRAIL_STEP;
    slot.acc2 = 0;
    slot.beat = 0;
    slot.primed = false;
    slot.parented = target.parent !== null;
    return new Handle(slot, slot.generation);
  }

  update(): void {
    const { dt, realDt, paused } = this.core.ctx.time;
    if (paused) return;
    for (let i = 0; i < CAP; i++) {
      const s = this.slots[i]!;
      if (!s.live) continue;
      if (s.parented && s.target.parent === null) {
        // A despawned target stops its emitter, so nobody needs to remember to.
        s.live = false;
        continue;
      }
      s.age += dt;
      if (s.duration > 0 && s.age >= s.duration) {
        s.live = false;
        continue;
      }
      s.target.updateWorldMatrix(true, false);
      if (s.hasOffset) s.target.localToWorld(_p.copy(s.offset));
      else s.target.getWorldPosition(_p);
      if (!s.primed) {
        s.primed = true;
        s.last.copy(_p);
      }
      _prev.copy(s.last);
      s.last.copy(_p);

      switch (s.preset) {
        case 'rocketTrail': this.rocket(s, realDt, 0.35, 1, SMOKE.trail, true); break;
        case 'smokeTrail': this.rocket(s, realDt, 0.3, 1.2, SMOKE.light, false); break;
        case 'airstrikeTrail': this.rocket(s, realDt, 1, 1.8, SMOKE.trail, true); break;
        case 'hellfireTrail': this.hellfire(s, realDt); break;
        case 'fireTrail': this.fire(s, realDt, dt); break;
        case 'sparkTrail': this.spark(s, realDt); break;
        case 'shellTrail': this.shell(s, realDt); break;
        case 'bloodTrail': this.bloodTrail(s, dt); break;
        case 'stumpSpray': this.stump(s, dt); break;
        case 'burning': this.burning(s, dt); break;
      }
    }
  }

  /** Trail beats run on real time on purpose: in SLOWMO the projectile crawls and the puffs pack 4x denser. */
  private rocket(s: Slot, realDt: number, size: number, life: number, color: typeof SMOKE.trail, hot_: boolean): void {
    const core = this.core;
    this.travel(realDt);
    s.acc += realDt;
    while (s.acc >= TRAIL_STEP) {
      s.acc -= TRAIL_STEP;
      this.along(s.acc, realDt, 0.3);
      core.puffs.add(_pt.x + rand(-0.05, 0.05), _pt.y + rand(-0.05, 0.05), _pt.z + rand(-0.05, 0.05),
        rand(-0.25, 0.25), rand(0.5, 1.5), rand(-0.25, 0.25), color, 0.6, core.birth, life, size);
    }
    if (hot_) {
      s.acc2 += realDt;
      if (s.acc2 >= 0.02) {
        s.acc2 = 0;
        this.along(0, realDt, 0.18);
        core.flashes.star(_pt.x, _pt.y, _pt.z, EXHAUST, size * 0.72, core.now, 0.05, 6, 0.32, 0.6, 0.5, 9);
      }
    }
  }

  private hellfire(s: Slot, realDt: number): void {
    const core = this.core;
    this.travel(realDt);
    s.acc += realDt;
    while (s.acc >= TRAIL_STEP) {
      s.acc -= TRAIL_STEP;
      this.along(s.acc, realDt, 0.3);
      core.puffs.add(_pt.x, _pt.y, _pt.z, rand(-0.25, 0.25), rand(0.5, 1.5), rand(-0.25, 0.25), HELLFIRE_CUBE, 0.6, core.birth, 1.2, 0.4);
      if (Math.random() < 0.5) {
        core.puffs.add(_pt.x, _pt.y, _pt.z, rand(-0.25, 0.25), rand(0.5, 1.5), rand(-0.25, 0.25), HELLFIRE_CUBE_2, 0.6, core.birth, 0.8, 0.3);
      }
      core.flashes.star(_pt.x, _pt.y, _pt.z, EXHAUST, 0.4, core.now, 0.05, 6, 0.3, 0.6, 0.5, 9);
    }
  }

  /** A fireball in flight leaves a trail. Something on fire and barely moving burns. */
  private fire(s: Slot, realDt: number, dt: number): void {
    const core = this.core;
    this.travel(realDt);
    if (_vel.lengthSq() < 36) {
      this.burning(s, dt);
      return;
    }
    s.acc += realDt;
    while (s.acc >= 0.035) {
      s.acc -= 0.035;
      this.along(s.acc, realDt, 0.15);
      burnPuff(core, _pt.x, _pt.y, _pt.z, 0.34);
    }
  }

  private spark(s: Slot, realDt: number): void {
    const core = this.core;
    this.travel(realDt);
    s.acc += realDt;
    while (s.acc >= 0.02) {
      s.acc -= 0.02;
      this.along(s.acc, realDt, 0.1);
      const st = core.streaks.begin(SPARK.yellow, core.birth, 0.4, -20, -1e6, 0.02, 0.5);
      st.add(_pt.x, _pt.y, _pt.z, -_dir.x * 6 + rand(-3, 3), -_dir.y * 6 + rand(-1, 3), -_dir.z * 6 + rand(-3, 3), 0.032);
    }
  }

  /** Rings every 60 ms and cubes every 30 ms, so a shell flying at 200 m/s strings pulses 13 m apart. */
  private shell(s: Slot, realDt: number): void {
    const core = this.core;
    this.travel(realDt);
    s.acc += realDt;
    while (s.acc >= TRAIL_STEP) {
      s.acc -= TRAIL_STEP;
      this.along(s.acc, realDt, 0.2);
      core.trailRings.add(_pt.x, _pt.y, _pt.z, _dir.x, _dir.y, _dir.z, core.ringColor, 0.75, core.now, 0.1, 0.66);
    }
    s.acc2 += realDt;
    while (s.acc2 >= TRAIL_STEP * 0.5) {
      s.acc2 -= TRAIL_STEP * 0.5;
      this.along(s.acc2, realDt, 0.3);
      core.puffs.add(_pt.x, _pt.y, _pt.z, rand(-0.25, 0.25), rand(0.5, 1.5), rand(-0.25, 0.25), SMOKE.shell, 0.6, core.birth, 2, 0.1);
    }
  }

  /** Dotted droplets off a flying part: spaced by speed, thrown slightly backward. */
  private bloodTrail(s: Slot, dt: number): void {
    if (dt <= 0) return;
    this.travel(dt);
    const speed = _vel.length();
    if (speed <= 1) return;
    const core = this.core;
    const interval = Math.max(0.03, 0.1 - speed * 0.01);
    s.acc += dt;
    if (s.acc < interval) return;
    s.acc = 0;
    const n = speed > 5 ? 3 : 2;
    const floor = core.floorAt(_p.x, _p.y, _p.z);
    const c = core.chips.begin('droplet', BLOOD.deep, core.birth, 2, -12, floor, 0, 0);
    for (let i = 0; i < n; i++) {
      const back = rand(-0.2, -0.1);
      c.setLife(rand(1.5, 2));
      c.setColor(Math.random() < 0.3 ? BLOOD.bright : BLOOD.deep);
      c.add(_p.x + rand(-0.1, 0.1), _p.y + rand(-0.1, 0.1), _p.z + rand(-0.1, 0.1),
        _vel.x * back, _vel.y * back, _vel.z * back, rand(0.05, 0.11));
    }
  }

  /**
   * A heart pumping through a severed artery: hard spurts at 5:1 speed to jitter, with a weak dribble
   * between beats. Pressure drops and the beat slows as the body bleeds out. Sprays along the offset
   * when one is given, otherwise along the target's local +Y.
   */
  private stump(s: Slot, dt: number): void {
    if (dt <= 0) return;
    const core = this.core;
    s.target.getWorldQuaternion(_q);
    if (s.hasOffset) _dir.copy(s.offset).normalize();
    else _dir.set(0, 1, 0);
    _dir.applyQuaternion(_q);

    const span = s.duration > 0 ? s.duration : 4;
    const pressure = Math.max(0.2, 1 - s.age / span);
    const period = 0.42 + (1 - pressure) * 0.4;
    s.beat -= dt;
    if (s.beat <= 0) {
      s.beat = period;
      s.floor = core.floorAt(_p.x, _p.y, _p.z);
      const v = 11 * pressure + 3;
      const j = v / 5;
      const n = Math.round(8 + 12 * pressure);
      const c = core.chips.begin('droplet', BLOOD.bright, core.birth, 0.9, -15, s.floor, 0, 0);
      for (let i = 0; i < n; i++) {
        if (i === 3) c.setColor(BLOOD.deep);
        const k = rand(0.75, 1.15);
        c.add(_p.x, _p.y, _p.z, _dir.x * v * k + rand(-j, j), _dir.y * v * k + rand(-j, j), _dir.z * v * k + rand(-j, j), rand(0.05, 0.12));
      }
    }
    s.acc2 -= dt;
    if (s.acc2 <= 0) {
      s.acc2 = 0.06;
      const c = core.chips.begin('droplet', BLOOD.deep, core.birth, 0.6, -15, s.floor, 0, 0);
      c.add(_p.x, _p.y, _p.z, _dir.x * 2.2 + rand(-0.4, 0.4), _dir.y * 2.2 + rand(-0.4, 0.4), _dir.z * 2.2 + rand(-0.4, 0.4), rand(0.03, 0.06));
    }
  }

  /** Flames licking off a body. World time, so a burning corpse in SLOWMO burns slow with everything else. */
  private burning(s: Slot, dt: number): void {
    const core = this.core;
    s.acc += dt;
    while (s.acc >= 0.05) {
      s.acc -= 0.05;
      burnPuff(core, _p.x, _p.y, _p.z, 0.5);
    }
    s.acc2 += dt;
    if (s.acc2 >= 0.11) {
      s.acc2 = 0;
      const st = core.streaks.begin(SPARK.ember, core.birth, rand(0.7, 1.4), 3, -1e6, 0.03, 0.2, 1.4, 0.35);
      st.add(_p.x + rand(-0.2, 0.2), _p.y, _p.z + rand(-0.2, 0.2), rand(-0.8, 0.8), rand(1, 3), rand(-0.8, 0.8), rand(0.012, 0.022));
    }
  }

  /** Velocity and heading from this frame's movement, written to _vel and _dir. */
  private travel(step: number): void {
    _vel.subVectors(_p, _prev);
    const d = _vel.length();
    if (d > 1e-5) _dir.copy(_vel).multiplyScalar(1 / d);
    if (step > 0) _vel.multiplyScalar(1 / step);
  }

  /**
   * The point `behind` meters back from the projectile at the time of a beat. `left` is the time
   * still in the accumulator: fast projectiles cross several beats in one frame, and spacing the
   * puffs along the frame's path keeps the dots even at any frame rate.
   */
  private along(left: number, step: number, behind: number): void {
    const t = step > 0 ? Math.min(left / step, 1) : 0;
    _pt.lerpVectors(_p, _prev, t).addScaledVector(_dir, -behind);
  }

  stopAll(): void {
    for (const s of this.slots) s.live = false;
  }

  get count(): number {
    let n = 0;
    for (const s of this.slots) if (s.live) n++;
    return n;
  }
}

