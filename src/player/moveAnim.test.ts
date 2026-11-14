/** The body layer on its own, driven by a fake player: what each move asks of the camera, the weapon and the free hand. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIM, LEGS_SLIDE, LEGS_VAULT, MoveAnim, type MoveSource } from './moveAnim';

const DT = 1 / 120;

function source(): MoveSource {
  return {
    alive: true, grounded: true, sliding: false, wallRunning: false, slamming: false, mantling: false, vaulting: false,
    wallSide: 0, pitch: 0, yaw: 0, velocity: { x: 0, y: 0, z: -12 }, eye: { y: 1.62 }, stridePhase: 0,
    mantleProgress: 0, mantleTopY: 0, vaultProgress: 0,
  };
}

interface Peaks { roll: number; rollSigned: number; camY: number; gunY: number; gunDown: number; gunPitch: number; hand: number; step: number; legs: number; }

/** Steps the layer for `seconds`, with `each` free to move the fake player, and reports the extremes. */
function run(a: MoveAnim, s: MoveSource, seconds: number, each?: (t: number) => void): Peaks {
  const p: Peaks = { roll: 0, rollSigned: 0, camY: 0, gunY: 0, gunDown: 0, gunPitch: 0, hand: 0, step: 0, legs: 0 };
  let last = [a.camRoll, a.camX, a.camY, a.gunX, a.gunY, a.gunZ, a.gunPitch, a.gunYaw, a.gunRoll];
  for (let t = 0; t < seconds; t += DT) {
    each?.(t);
    a.update(DT, s);
    const now = [a.camRoll, a.camX, a.camY, a.gunX, a.gunY, a.gunZ, a.gunPitch, a.gunYaw, a.gunRoll];
    for (let i = 0; i < now.length; i++) p.step = Math.max(p.step, Math.abs(now[i]! - last[i]!));
    last = now;
    if (Math.abs(a.camRoll) > p.roll) { p.roll = Math.abs(a.camRoll); p.rollSigned = a.camRoll; }
    p.camY = Math.min(p.camY, a.camY);
    p.gunY = Math.max(p.gunY, Math.abs(a.gunY));
    p.gunDown = Math.min(p.gunDown, a.gunY);
    p.gunPitch = Math.min(p.gunPitch, a.gunPitch);
    p.hand = Math.max(p.hand, a.handW);
    p.legs = Math.max(p.legs, a.legsW);
  }
  return p;
}

function mantle(a: MoveAnim, s: MoveSource, seconds = 0.3): Peaks {
  s.grounded = false;
  s.mantleTopY = s.eye.y + 0.4;
  const from = s.eye.y;
  const p = run(a, s, seconds, t => {
    s.mantling = true;
    s.mantleProgress = t / seconds;
    s.eye.y = from + 2 * s.mantleProgress;
  });
  s.mantling = false;
  s.grounded = true;
  return p;
}

function vault(a: MoveAnim, s: MoveSource, seconds = 0.3): Peaks {
  s.grounded = false;
  const p = run(a, s, seconds, t => {
    s.vaulting = true;
    s.vaultProgress = t / seconds;
  });
  s.vaulting = false;
  s.grounded = true;
  return p;
}

afterEach(() => {
  ANIM.enabled = true;
  ANIM.camera = 1;
  ANIM.legs = true;
});

describe('move animation layer', () => {
  it('has nothing to say while standing or running', () => {
    const a = new MoveAnim();
    const s = source();
    run(a, s, 1, t => { s.stridePhase = t * 3; });
    expect(a.idle).toBe(true);
  });

  it('offers the camera roll and offsets only: there is no pitch or yaw to drift the aim', () => {
    const a = new MoveAnim() as unknown as Record<string, unknown>;
    const camera = Object.keys(a).filter(k => k.startsWith('cam'));
    expect(camera.sort()).toEqual(['camRoll', 'camX', 'camY']);
  });

  it('gives each move its own read', () => {
    const s = source();
    const m = mantle(new MoveAnim(), s);
    expect(m.hand).toBeGreaterThan(0.9);
    expect(m.gunDown).toBeLessThan(-0.05);
    expect(m.roll).toBeGreaterThan(0.02);
    expect(m.legs).toBe(0);

    const a = new MoveAnim();
    const v = vault(a, source());
    expect(v.hand).toBeGreaterThan(0.9);
    expect(v.legs).toBeGreaterThan(0.9);
    expect(v.roll).toBeGreaterThan(0.03);
    // The gun is carried up over cover and dipped under a climb.
    expect(v.gunDown).toBeGreaterThan(-0.02);

    const slide = source();
    const sa = new MoveAnim();
    slide.sliding = true;
    const sl = run(sa, slide, 0.6);
    expect(sa.legsMode).toBe(LEGS_SLIDE);
    expect(sl.legs).toBeGreaterThan(0.9);
    expect(sl.hand).toBeGreaterThan(0.5);
    // The brace is a touch on the way down, not a hold: the hand is back on the weapon while the slide carries on.
    run(sa, slide, 0.6);
    expect(sa.handW).toBe(0);
    expect(sa.camRoll).toBeCloseTo(ANIM.slideRoll, 3);
  });

  it('shows vault legs only in a vault', () => {
    const a = new MoveAnim();
    const s = source();
    s.vaulting = true;
    s.grounded = false;
    s.vaultProgress = 0.5;
    run(a, s, 0.1);
    expect(a.legsMode).toBe(LEGS_VAULT);
    ANIM.legs = false;
    run(a, s, 0.1);
    expect(a.legsW).toBe(0);
  });

  it('trails the hand on a wall to the left, and leaves it on the weapon for a wall to the right', () => {
    const left = source();
    left.grounded = false;
    left.wallRunning = true;
    left.wallSide = -1;
    const a = new MoveAnim();
    run(a, left, 0.6);
    expect(a.handW).toBeGreaterThan(0.9);
    expect(a.handX).toBeLessThan(-0.3);
    // Head away from the wall.
    expect(a.camX).toBeGreaterThan(0.02);

    const right = source();
    right.grounded = false;
    right.wallRunning = true;
    right.wallSide = 1;
    const b = new MoveAnim();
    run(b, right, 0.6);
    expect(b.handW).toBe(0);
    expect(b.camX).toBeLessThan(-0.02);
  });

  it('kicks the view away from the wall on a wall jump, either side', () => {
    for (const side of [-1, 1]) {
      const a = new MoveAnim();
      const s = source();
      s.grounded = false;
      a.jumped('wall', side);
      const p = run(a, s, 0.4);
      expect(Math.sign(p.rollSigned)).toBe(side);
      expect(p.roll).toBeGreaterThan(0.02);
      expect(p.hand > 0.5).toBe(side < 0);
    }
  });

  it('scales the landing crunch with the fall, and leaves a plain jump alone', () => {
    const crunch = (impact: number) => {
      const a = new MoveAnim();
      a.landed(impact);
      return run(a, source(), 0.6);
    };
    expect(crunch(9.5).gunY).toBe(0);
    const soft = crunch(14);
    const hard = crunch(26);
    expect(soft.gunDown).toBeLessThan(0);
    expect(hard.gunDown).toBeLessThan(soft.gunDown * 2);
    expect(hard.camY).toBeLessThan(soft.camY);
    expect(hard.gunPitch).toBeLessThan(-0.15);
  });

  it('leans into a dash to the side and not into one straight ahead', () => {
    const a = new MoveAnim();
    a.dashed(1, 0);
    const side = run(a, source(), 0.4);
    expect(side.rollSigned).toBeLessThan(-0.02);
    const b = new MoveAnim();
    b.dashed(0, 1);
    expect(run(b, source(), 0.4).roll).toBe(0);
  });

  it('floats the arms on a long fall and dips the view walking off an edge', () => {
    const a = new MoveAnim();
    const s = source();
    run(a, s, 0.1);
    s.grounded = false;
    s.velocity.y = -1;
    const p = run(a, s, 0.6, t => { s.velocity.y = -1 - 32 * t; });
    expect(p.camY).toBeLessThan(-0.005);
    expect(a.gunY).toBeGreaterThan(0.01);
    expect(a.gunPitch).toBeGreaterThan(0.04);
  });

  it('returns every channel to exactly zero after each move', () => {
    const cases: ((a: MoveAnim, s: MoveSource) => void)[] = [
      (a, s) => { mantle(a, s); },
      (a, s) => { vault(a, s); },
      (a, s) => { s.sliding = true; run(a, s, 0.8); s.sliding = false; },
      (a, s) => { s.grounded = false; s.wallRunning = true; s.wallSide = -1; run(a, s, 0.8); s.wallRunning = false; s.wallSide = 0; a.jumped('wall', -1); run(a, s, 0.3); s.grounded = true; },
      (a, s) => { s.grounded = false; s.slamming = true; run(a, s, 0.3); s.slamming = false; s.grounded = true; a.slammed(12); a.landed(40); },
      a => { a.jumped('double'); a.dashed(-1, 0.3); a.landed(30); },
    ];
    for (const play of cases) {
      const a = new MoveAnim();
      const s = source();
      play(a, s);
      run(a, s, 1.2);
      expect(a.idle).toBe(true);
      expect(a.camRoll).toBe(0);
    }
  });

  it('never moves a channel in a jump, however a move is cut short', () => {
    const a = new MoveAnim();
    const s = source();
    let worst = 0;
    // A mantle cut by a throw, straight into a slide, a wall jump out of that, and a slam on top.
    worst = Math.max(worst, mantle(a, s, 0.1).step);
    s.grounded = false;
    s.velocity.y = 20;
    worst = Math.max(worst, run(a, s, 0.05).step);
    s.grounded = true;
    s.sliding = true;
    worst = Math.max(worst, run(a, s, 0.08).step);
    s.sliding = false;
    s.grounded = false;
    a.jumped('wall', 1);
    worst = Math.max(worst, run(a, s, 0.05).step);
    worst = Math.max(worst, vault(a, s, 0.12).step);
    a.slammed(12);
    a.landed(40);
    worst = Math.max(worst, run(a, s, 0.5).step);
    // The largest target is a 0.42 rad gun pitch. A cut would show as most of that in one 120 Hz frame.
    expect(worst).toBeLessThan(0.05);
  });

  it('puts the gun away for a climb, keeps a hand on the wall while clinging, fists the floor on a big slam, and rests after', () => {
    const a = new MoveAnim();
    const s = source();
    s.grounded = false;
    const climb = run(a, s, 0.45, t => {
      s.climbing = true;
      s.climbProgress = t / 0.45;
    });
    s.climbing = false;
    expect(climb.gunDown).toBeLessThan(-0.25);
    expect(climb.hand).toBeGreaterThan(0.9);
    // A big holster, but eased in: no channel jumps in a frame.
    expect(climb.step).toBeLessThan(0.06);
    // Clinging, still facing the wall (yaw 0 looks down -Z, the wall is there): the gun is back and a hand is on the wall.
    s.clinging = true;
    s.climbNormal = { x: 0, z: 1 };
    const cling = run(a, s, 0.4);
    expect(cling.step).toBeLessThan(0.06);
    expect(a.gunY).toBeGreaterThan(-0.02);
    expect(a.handW).toBeGreaterThan(0.8);
    // Turned with the wall on the right, the hand goes back to the gun. With it on the left, it stays on the wall.
    s.yaw = Math.PI / 2;
    run(a, s, 0.4);
    expect(a.handW).toBeLessThan(0.05);
    s.yaw = -Math.PI / 2;
    run(a, s, 0.4);
    expect(a.handW).toBeGreaterThan(0.8);
    s.clinging = false;
    s.grounded = true;
    s.yaw = 0;
    a.slammed(8, true);
    a.landed(40);
    const slam = run(a, s, 0.3);
    expect(slam.camY).toBeLessThan(-0.045);
    expect(slam.gunDown).toBeLessThan(-0.08);
    expect(slam.hand).toBeGreaterThan(0.9);
    expect(a.handOpen).toBe(0);
    run(a, s, 1.2);
    expect(a.idle).toBe(true);
    expect(a.camRoll).toBe(0);
  });

  it('stays inside the roll limit when everything stacks', () => {
    const a = new MoveAnim();
    const s = source();
    s.sliding = true;
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      a.jumped('wall', 1);
      a.dashed(-1, 0);
      peak = Math.max(peak, run(a, s, 0.03).roll);
    }
    expect(peak).toBeLessThanOrEqual(ANIM.maxRoll);
  });

  it('gives the same motion at 30 and 240 fps, to within what one 30 Hz sample of a curve allows', () => {
    const at = (fps: number) => {
      const a = new MoveAnim();
      const s = source();
      a.landed(26);
      a.jumped('wall', -1);
      for (let i = 0; i < fps * 0.2; i++) a.update(1 / fps, s);
      return [a.camRoll, a.camY, a.gunY, a.gunPitch];
    };
    const slow = at(30);
    const fast = at(240);
    // The springs are exact at any step. The curves they follow are read once a frame, which is the difference left.
    for (let i = 0; i < slow.length; i++) expect(Math.abs(slow[i]! - fast[i]!)).toBeLessThan(0.015);
  });

  it('is silent when switched off, and keeps the hands when only the camera is', () => {
    const s = source();
    ANIM.camera = 0;
    const a = new MoveAnim();
    const m = mantle(a, s);
    expect(m.roll).toBe(0);
    expect(m.camY).toBe(0);
    expect(m.hand).toBeGreaterThan(0.9);
    ANIM.enabled = false;
    const b = new MoveAnim();
    const off = mantle(b, source());
    b.landed(40);
    b.jumped('wall', 1);
    expect(off.hand).toBe(0);
    expect(run(b, source(), 0.3).roll).toBe(0);
    expect(b.idle).toBe(true);
  });

  it('clears itself once when switched off mid-move, not on every frame after', () => {
    const s = source();
    const a = new MoveAnim();
    s.sliding = true;
    run(a, s, 0.2);
    expect(a.idle).toBe(false);
    const reset = vi.spyOn(a, 'reset');
    ANIM.enabled = false;
    run(a, s, 0.5);
    expect(a.idle).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
    // And it starts clean when it comes back.
    ANIM.enabled = true;
    s.sliding = false;
    expect(run(a, s, 0.3).step).toBe(0);
  });
});
