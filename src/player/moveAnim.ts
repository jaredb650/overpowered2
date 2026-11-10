/**
 * The player's own body in first person: what the camera, the held weapon, the free hand and the legs do for each move.
 *
 * It only reads movement state and never changes it, and it holds plain numbers, so the tests can drive it with a fake
 * player. Player owns one and steps it at the end of its frame. CameraRig adds `cam*` to the view, the viewmodel rig adds
 * `gun*` to the weapon, gives the left arm to `hand*` and poses the legs from `legs*`.
 *
 * Three rules, each held by a test:
 *   - There is no pitch or yaw here, for any move. Shots leave along the look, so only roll and small offsets are safe.
 *   - Every channel returns to exactly 0, so a level view is level and a resting gun is where its ViewDef put it.
 *   - A move can end at any moment. Targets are shaped by curves and followed by springs, so a cut never shows as a jump.
 *
 * Off with `?moveanim=0`. `?movecam=0` keeps the hands and the weapon and drops the camera part.
 */
import { clamp, damp, lerp, smoothstep } from '../core/math';
import { springStep, type SpringState } from './moveMath';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** Everything the layer can be tuned by. Angles are radians, lengths meters in view space: +X right, +Y up, -Z ahead. */
export const ANIM = {
  enabled: query?.get('moveanim') !== '0',
  /** Scales every camera term. 0 leaves the view to the moves themselves. The comfort knob. */
  camera: query?.get('movecam') === '0' ? 0 : 1,
  /** First-person legs in a slide and a vault. */
  legs: query?.get('legs') !== '0',
  /** The most roll this layer may add, whatever stacks up. 4.6 degrees. */
  maxRoll: 0.08,
  maxOffset: 0.09,

  camOmega: 20,
  camZeta: 0.8,
  gunOmega: 17,
  gunZeta: 0.68,
  handOmega: 30,
  handZeta: 0.9,

  mantleRoll: 0.042,
  /** Seconds the hand stays on the ledge after the climb, pushing down and letting go. */
  mantleOut: 0.26,
  vaultRoll: 0.07,
  vaultOut: 0.18,
  slideRoll: 0.03,
  kickRoll: 1.3,
  dashRoll: 1.0,
  /** Landing speed where the crunch starts and where it is whole. A plain jump lands at 9.5. */
  landFrom: 10,
  landFull: 26,
  /** Fall speed where the arms start to float, and where they are fully up. */
  fallFrom: 6,
  fallFull: 18,
};

/** What the layer reads. Player satisfies it; tests pass a plain object. */
export interface MoveSource {
  alive: boolean;
  grounded: boolean;
  sliding: boolean;
  wallRunning: boolean;
  slamming: boolean;
  mantling: boolean;
  vaulting: boolean;
  /** -1 wall on the left of the view, +1 on the right. */
  wallSide: number;
  pitch: number;
  yaw: number;
  velocity: { x: number; y: number; z: number };
  eye: { y: number };
  stridePhase: number;
  /** 0..1 through the climb, and the world height of the ledge. */
  mantleProgress: number;
  mantleTopY: number;
  /** 0..1 through the vault. */
  vaultProgress: number;
}

export type LegsMode = 0 | 1 | 2;
export const LEGS_SLIDE = 1;
export const LEGS_VAULT = 2;

interface Clip {
  /** Seconds in, or negative when idle. */
  t: number;
  dur: number;
  /** Strength 0..1. */
  k: number;
  side: number;
}

const clip = (): Clip => ({ t: -1, dur: 1, k: 0, side: 0 });
const spring = (): SpringState => ({ x: 0, v: 0 });
const inOut = (t: number) => t * t * (3 - 2 * t);
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
/** Rises over a..b, holds, falls over c..d. */
const hold = (p: number, a: number, b: number, c: number, d: number) => inOut(seg(p, a, b)) * (1 - inOut(seg(p, c, d)));

function follow(s: SpringState, target: number, omega: number, zeta: number, dt: number): void {
  s.x -= target;
  springStep(s, omega, zeta, dt);
  s.x += target;
}

/** A weight on its way to a target. Exponential decay never arrives, and a resting view has to be exactly at rest. */
function fade(w: number, target: number, rate: number, dt: number): number {
  const next = damp(w, target, rate, dt);
  return Math.abs(next - target) < 1e-3 ? target : next;
}

function start(c: Clip, dur: number, k = 1, side = 0): void {
  c.t = 0;
  c.dur = dur;
  c.k = k;
  c.side = side;
}

function advance(c: Clip, dt: number): number {
  if (c.t < 0) return -1;
  c.t += dt;
  if (c.t >= c.dur) {
    c.t = -1;
    return -1;
  }
  return c.t / c.dur;
}

export class MoveAnim {
  // --- Output: camera. Added by CameraRig on top of the look. No pitch, no yaw.
  camRoll = 0;
  camX = 0;
  camY = 0;
  // --- Output: weapon, added to the gun's view-space pose.
  gunX = 0;
  gunY = 0;
  gunZ = 0;
  gunPitch = 0;
  gunYaw = 0;
  gunRoll = 0;
  // --- Output: the left hand. `handW` is how much of it the move owns; the rest stays with the weapon.
  handW = 0;
  handX = 0;
  handY = 0;
  handZ = 0;
  /** Euler YXZ of the hand frame: fingers along -Z, back of the hand +Y. */
  handPitch = 0;
  handYaw = 0;
  handRoll = 0;
  /** 0 keeps the weapon's finger pose, 1 is a flat open palm. */
  handOpen = 0;
  // --- Output: legs.
  legsMode: LegsMode = 0;
  legsW = 0;
  legsPhase = 0;

  private readonly roll = spring();
  private readonly cx = spring();
  private readonly cy = spring();
  private readonly gx = spring();
  private readonly gy = spring();
  private readonly gz = spring();
  private readonly gp = spring();
  private readonly gyaw = spring();
  private readonly gr = spring();
  private readonly hx = spring();
  private readonly hy = spring();
  private readonly hz = spring();
  private readonly hp = spring();
  private readonly hyaw = spring();
  private readonly hr = spring();

  private slideW = 0;
  private wallW = 0;
  private wallSide = 0;
  private slamW = 0;
  private fallW = 0;
  private mantleW = 0;
  private mantleOut = -1;
  private mantleTop = 0;
  private vaultW = 0;
  private vaultOut = -1;
  private vaultP = 0;
  private sinceSlide = 9;
  private sinceJump = 9;

  private readonly brace = clip();
  private readonly kick = clip();
  private readonly tuck = clip();
  private readonly crunch = clip();
  private readonly plant = clip();

  private was = { grounded: true, sliding: false, mantling: false, vaulting: false };
  private readonly springs = [
    this.roll, this.cx, this.cy, this.gx, this.gy, this.gz, this.gp, this.gyaw, this.gr, this.hx, this.hy, this.hz, this.hp, this.hyaw, this.hr,
  ];
  private readonly clips = [this.brace, this.kick, this.tuck, this.crunch, this.plant];
  /** False while anything may be off its rest, so a layer that is switched off is cleared once and not every frame. */
  private clean = true;

  // --- Events, forwarded by Player -----------------------------------------------------------------------------

  jumped(kind: 'ground' | 'double' | 'wall' | 'bounce', side = 0): void {
    if (!ANIM.enabled) return;
    this.clean = false;
    this.sinceJump = 0;
    if (kind === 'wall') {
      // Away from the wall: the head tips off it and the body is shoved sideways.
      this.roll.v += side * ANIM.kickRoll;
      this.cx.v -= side * 0.55;
      start(this.kick, 0.26, 1, side);
      if (side >= 0) {
        // The wall is on the gun's side, so the gun takes the shove.
        this.gx.v -= 0.5;
        this.gr.v += 2.6;
      }
      return;
    }
    if (kind === 'double') {
      start(this.tuck, 0.3);
      this.cy.v += 0.22;
      return;
    }
    if (this.sinceSlide < 0.12) {
      // Slide-jump: the gun pops up out of the cant as the legs come under the body.
      this.gy.v += 0.5;
      this.gp.v += 2.2;
      this.cy.v += 0.3;
    }
  }

  landed(impact: number): void {
    if (!ANIM.enabled) return;
    this.clean = false;
    // A slam lands twice in one tick, once as a slam and once as a landing. The rig already throws the gun down for it.
    if (this.plant.t === 0) return;
    const k = smoothstep(ANIM.landFrom, ANIM.landFull, impact);
    if (k <= 0) return;
    start(this.crunch, 0.22 + 0.26 * k, k);
    this.cy.v -= 1.1 * k;
  }

  /** `side` and `fwd` are the dash direction in the view's frame, each -1..1. */
  dashed(side: number, fwd: number): void {
    if (!ANIM.enabled) return;
    this.clean = false;
    this.roll.v -= side * ANIM.dashRoll;
    this.cx.v -= side * 0.4;
    this.gx.v -= side * 0.9;
    this.gr.v -= side * 2.4;
    this.gz.v += fwd * 0.5;
  }

  slammed(impact: number): void {
    if (!ANIM.enabled) return;
    this.clean = false;
    const k = clamp(impact / 12, 0.4, 1);
    // A harder slam keeps the hand down longer. It always goes all the way down: half a plant is no pose at all.
    start(this.plant, 0.34 + 0.2 * k, k);
    this.cy.v -= 0.9 * k;
  }

  // --- Frame ---------------------------------------------------------------------------------------------------

  update(dt: number, s: MoveSource): void {
    if (!ANIM.enabled || dt <= 0) {
      if (!ANIM.enabled && !this.clean) this.reset();
      return;
    }
    this.clean = false;
    const was = this.was;
    const air = !s.grounded && !s.mantling && !s.vaulting;
    this.sinceSlide = s.sliding ? 0 : this.sinceSlide + dt;
    this.sinceJump += dt;

    // Edges.
    if (s.sliding && !was.sliding) {
      start(this.brace, 0.44);
      this.cy.v -= 0.22;
    }
    if (was.grounded && air && s.alive && this.sinceJump > 0.1 && !was.vaulting && !was.mantling && s.velocity.y <= 0.5) {
      // Walked off an edge: the step that was not there.
      this.cy.v -= 0.32;
      this.gp.v += 1.1;
    }
    if (was.mantling && !s.mantling) {
      this.mantleOut = 0;
      this.cy.v -= 0.5;
      this.roll.v -= 0.22;
    }
    if (was.vaulting && !s.vaulting) {
      this.vaultOut = 0;
      this.cy.v -= 0.45;
    }

    // Weights of the held states.
    this.slideW = fade(this.slideW, s.sliding ? 1 : 0, 12, dt);
    this.wallW = fade(this.wallW, s.wallRunning ? 1 : 0, s.wallRunning ? 9 : 12, dt);
    if (s.wallSide !== 0) this.wallSide = s.wallSide;
    this.slamW = fade(this.slamW, s.slamming ? 1 : 0, 14, dt);
    const falling = air && !s.slamming && !s.wallRunning ? smoothstep(ANIM.fallFrom, ANIM.fallFull, -s.velocity.y) : 0;
    this.fallW = fade(this.fallW, falling, falling > this.fallW ? 5 : 14, dt);

    if (s.mantling) {
      this.mantleW = Math.min(1, this.mantleW + dt / 0.07);
      this.mantleOut = -1;
      this.mantleTop = s.mantleTopY;
    } else if (this.mantleOut >= 0) {
      this.mantleOut += dt;
      this.mantleW = 1 - inOut(clamp(this.mantleOut / ANIM.mantleOut));
      if (this.mantleOut >= ANIM.mantleOut) {
        this.mantleOut = -1;
        this.mantleW = 0;
      }
    } else {
      this.mantleW = 0;
    }

    if (s.vaulting) {
      this.vaultW = Math.min(1, this.vaultW + dt / 0.06);
      this.vaultOut = -1;
      this.vaultP = s.vaultProgress;
    } else if (this.vaultOut >= 0) {
      this.vaultOut += dt;
      this.vaultW = 1 - inOut(clamp(this.vaultOut / ANIM.vaultOut));
      if (this.vaultOut >= ANIM.vaultOut) {
        this.vaultOut = -1;
        this.vaultW = 0;
      }
    } else {
      this.vaultW = 0;
    }

    const braceP = advance(this.brace, dt);
    const kickP = advance(this.kick, dt);
    const tuckP = advance(this.tuck, dt);
    const crunchP = advance(this.crunch, dt);
    const plantP = advance(this.plant, dt);

    // --- Camera targets.
    let roll = 0;
    let cx = 0;
    const mw = this.mantleW;
    const vw = this.vaultW;
    const vp = this.vaultP;
    if (s.mantling) roll += ANIM.mantleRoll * Math.sin(Math.PI * clamp(s.mantleProgress));
    if (s.vaulting) {
      const lean = Math.sin(Math.PI * clamp(vp));
      // The head goes over the planted hand while the legs pass on the other side.
      roll += ANIM.vaultRoll * lean;
      cx -= 0.04 * lean;
    }
    roll += ANIM.slideRoll * this.slideW;
    cx -= this.wallSide * 0.03 * this.wallW;

    // --- Weapon targets.
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let gp = 0;
    let gyaw = 0;
    let gr = 0;
    // Mantle: the gun drops out of the way of the climb.
    gx += 0.03 * mw;
    gy -= 0.085 * mw;
    gz += 0.02 * mw;
    gp -= 0.42 * mw;
    gyaw += 0.14 * mw;
    gr += 0.3 * mw;
    // Vault: carried high and canted outward, clear of the cover.
    gx += 0.04 * vw;
    gy += 0.02 * vw;
    gp += 0.12 * vw;
    gyaw -= 0.1 * vw;
    gr -= 0.34 * vw;
    // Slide: a little more cant on top of the rig's own.
    gx -= 0.01 * this.slideW;
    gy -= 0.012 * this.slideW;
    gr += 0.12 * this.slideW;
    // Slam: both arms drive down with the body.
    gy += 0.02 * this.slamW;
    gr -= 0.18 * this.slamW;
    // A long fall: the arms float up.
    gy += 0.022 * this.fallW;
    gp += 0.1 * this.fallW;
    gr -= 0.05 * this.fallW;
    if (tuckP >= 0) {
      const b = Math.sin(Math.PI * tuckP);
      gz += 0.035 * b;
      gy += 0.02 * b;
      gp += 0.14 * b;
      gr -= 0.08 * b;
    }
    if (crunchP >= 0) {
      // Down hard in the first fifth, then a slow recovery: the weight of the landing is in how long it takes to come back.
      const b = hold(crunchP, 0, 0.18, 0.3, 1) * this.crunch.k;
      gy -= 0.07 * b;
      gp -= 0.3 * b;
      gr += 0.12 * b;
      gz += 0.015 * b;
    }

    // --- The left hand. One target at a time, the most committed move first.
    let hw = 0;
    let hx = this.hx.x;
    let hy = this.hy.x;
    let hz = this.hz.x;
    let hpitch = this.hp.x;
    let hyaw = this.hyaw.x;
    let hroll = this.hr.x;
    let bx = 0;
    let by = 0;
    let bz = 0;
    if (mw > 0) {
      // On the ledge. The ledge holds still in the world, so the hand comes down the screen as the body goes up.
      const rel = clamp(this.mantleTop - s.eye.y, -1.2, 0.8);
      const out = this.mantleOut >= 0 ? clamp(this.mantleOut / ANIM.mantleOut) : 0;
      // Compressed to what the view can show: 23 cm of screen at arm's length, where the true travel is over a metre.
      by = clamp(rel * 0.35 - 0.02, -0.19, 0.12) - 0.14 * out;
      bx = -0.19;
      bz = -0.43 + 0.12 * out;
      // Reaching up the palm faces the wall. Above the ledge it lies flat, then pushes off.
      hpitch = lerp(1.0, -0.35, clamp((0.12 - by) / 0.31));
      hyaw = -0.35;
      hroll = 0;
      hw = mw;
    } else if (vw > 0) {
      // On top of the cover, sweeping back along the bottom of the view as the body passes over it.
      const out = this.vaultOut >= 0 ? clamp(this.vaultOut / ANIM.vaultOut) : 0;
      const back = inOut(clamp(vp));
      bx = -0.22;
      by = lerp(-0.2, -0.155, back) - 0.1 * out;
      bz = lerp(-0.62, -0.3, back) + 0.08 * out;
      hpitch = -0.1 - 0.45 * clamp(vp);
      hyaw = 0.55;
      hroll = 0;
      hw = vw;
    } else if (plantP >= 0) {
      // Slam: one hand to the ground.
      bx = -0.24;
      by = -0.2;
      bz = -0.42;
      hpitch = -0.2;
      hyaw = 0.4;
      hroll = 0;
      hw = hold(plantP, 0, 0.14, 0.55, 1);
    } else if (kickP >= 0 && this.kick.side < 0) {
      // Push off a wall on the left: the arm straightens against it.
      const out = 1 - (1 - kickP) ** 3;
      bx = -0.33 - 0.04 * out;
      by = -0.12;
      bz = -0.38 + 0.16 * out;
      hpitch = 0.3;
      hyaw = 0.15;
      hroll = -1.35;
      hw = 1 - inOut(seg(kickP, 0.5, 1));
    } else if (this.wallW > 0.02 && this.wallSide < 0) {
      // Trailing on a wall to the left. It rides the stride, so the hand slides rather than hovers.
      const ph = s.stridePhase * Math.PI;
      bx = -0.36;
      by = -0.13 + 0.012 * Math.sin(ph * 2);
      bz = -0.44 + 0.03 * Math.cos(ph);
      hpitch = 0.3;
      hyaw = 0.12;
      hroll = -1.35;
      hw = smoothstep(0.15, 0.9, this.wallW);
    } else if (braceP >= 0) {
      // Slide: a hand to the floor on the way down.
      bx = -0.27;
      by = -0.2;
      bz = -0.42;
      hpitch = -0.25;
      hyaw = 0.45;
      hroll = 0;
      hw = hold(braceP, 0, 0.22, 0.6, 1);
    }
    if (hw > 0) {
      // Targets are in the body's frame. The view pitches about the eye, so looking down brings a planted hand up the screen.
      const p = clamp(s.pitch, -0.7, 0.7) * 0.6;
      const c = Math.cos(p);
      const sn = Math.sin(p);
      hx = bx;
      hy = by * c + bz * sn;
      hz = -by * sn + bz * c;
    }

    // --- Step.
    const { camOmega: co, camZeta: cz, gunOmega: go, gunZeta: gzeta, handOmega: ho, handZeta: hzeta } = ANIM;
    follow(this.roll, roll, co, cz, dt);
    follow(this.cx, cx, co, cz, dt);
    follow(this.cy, 0, co, cz, dt);
    follow(this.gx, gx, go, gzeta, dt);
    follow(this.gy, gy, go, gzeta, dt);
    follow(this.gz, gz, go, gzeta, dt);
    follow(this.gp, gp, go, gzeta, dt);
    follow(this.gyaw, gyaw, go, gzeta, dt);
    follow(this.gr, gr, go, gzeta, dt);

    if (this.handW < 0.02 && hw > 0) {
      // Nothing held the hand, so there is nothing to blend from: the weight alone carries it off the weapon.
      this.hx.x = hx; this.hy.x = hy; this.hz.x = hz;
      this.hp.x = hpitch; this.hyaw.x = hyaw; this.hr.x = hroll;
      this.hx.v = this.hy.v = this.hz.v = this.hp.v = this.hyaw.v = this.hr.v = 0;
    } else {
      follow(this.hx, hx, ho, hzeta, dt);
      follow(this.hy, hy, ho, hzeta, dt);
      follow(this.hz, hz, ho, hzeta, dt);
      follow(this.hp, hpitch, ho, hzeta, dt);
      follow(this.hyaw, hyaw, ho, hzeta, dt);
      follow(this.hr, hroll, ho, hzeta, dt);
    }
    // Up fast, because a vault at a run is over in a fifth of a second and the hand has to be there for it.
    this.handW = hw > this.handW ? damp(this.handW, hw, 42, dt) : damp(this.handW, hw, 18, dt);
    if (hw === 0 && this.handW < 1e-3) this.handW = 0;

    // --- Write.
    const cam = ANIM.camera;
    this.camRoll = clamp(this.roll.x, -ANIM.maxRoll, ANIM.maxRoll) * cam;
    this.camX = clamp(this.cx.x, -ANIM.maxOffset, ANIM.maxOffset) * cam;
    this.camY = clamp(this.cy.x, -ANIM.maxOffset, ANIM.maxOffset) * cam;
    this.gunX = this.gx.x;
    this.gunY = this.gy.x;
    this.gunZ = this.gz.x;
    this.gunPitch = this.gp.x;
    this.gunYaw = this.gyaw.x;
    this.gunRoll = this.gr.x;
    this.handX = this.hx.x;
    this.handY = this.hy.x;
    this.handZ = this.hz.x;
    this.handPitch = this.hp.x;
    this.handYaw = this.hyaw.x;
    this.handRoll = this.hr.x;
    this.handOpen = clamp(this.handW * 1.4);

    if (!ANIM.legs) {
      this.legsMode = 0;
      this.legsW = 0;
    } else if (vw > 0.001) {
      this.legsMode = LEGS_VAULT;
      this.legsW = vw;
      this.legsPhase = clamp(vp + (this.vaultOut >= 0 ? 0.25 * clamp(this.vaultOut / ANIM.vaultOut) : 0), 0, 1.25);
    } else if (this.slideW > 0.01) {
      this.legsMode = LEGS_SLIDE;
      this.legsW = this.slideW;
      this.legsPhase = 0;
    } else {
      this.legsMode = 0;
      this.legsW = 0;
    }

    was.grounded = s.grounded;
    was.sliding = s.sliding;
    was.mantling = s.mantling;
    was.vaulting = s.vaulting;
  }

  /** True when nothing is playing and every output is at rest. */
  get idle(): boolean {
    return this.camRoll === 0 && this.camX === 0 && this.camY === 0 && this.handW === 0 && this.legsW === 0
      && this.gunX === 0 && this.gunY === 0 && this.gunZ === 0 && this.gunPitch === 0 && this.gunYaw === 0 && this.gunRoll === 0;
  }

  reset(): void {
    for (const s of this.springs) s.x = s.v = 0;
    for (const c of this.clips) c.t = -1;
    this.clean = true;
    this.slideW = this.wallW = this.slamW = this.fallW = this.mantleW = this.vaultW = 0;
    this.mantleOut = this.vaultOut = -1;
    this.sinceSlide = this.sinceJump = 9;
    this.camRoll = this.camX = this.camY = 0;
    this.gunX = this.gunY = this.gunZ = this.gunPitch = this.gunYaw = this.gunRoll = 0;
    this.handW = this.handOpen = 0;
    this.legsMode = 0;
    this.legsW = 0;
    this.was.grounded = true;
    this.was.sliding = this.was.mantling = this.was.vaulting = false;
  }
}
