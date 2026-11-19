import { describe, expect, it } from 'vitest';
import { DELAY_MAX, DELAY_MIN, DELAY_PAD, EASE_OUT_MS, EXTRAPOLATE_MS, HostClock, MotionBuffer, SendClock, delayFor, motionSample } from './motion';

/** A thing walking +x at `speed` m/s, one state every `every` ms from host time 0. */
function walker(buffer: MotionBuffer, speed: number, every: number, from: number, to: number): void {
  for (let t = from; t <= to; t += every) buffer.push(t, speed * t / 1000, 0, 0, 0, speed, 0, 0);
}

describe('the host clock, read from stamps', () => {
  it('takes the fastest packet as the offset and ignores the slow ones', () => {
    const clock = new HostClock();
    expect(clock.empty).toBe(true);
    // The host's clock runs 5000 ms ahead; packets take 40 to 70 ms.
    const lags = [60, 40, 70, 55, 41, 66, 48];
    lags.forEach((lag, index) => clock.observe(5000 + index * 50, index * 50 + lag));
    expect(clock.empty).toBe(false);
    expect(clock.offset).toBe(5000 - 40);
    expect(clock.now(1000)).toBe(5960);
  });
  it('measures jitter as how late packets run: about the spread of a uniform delay, near zero on a clean link', () => {
    const clean = new HostClock(), rough = new HostClock();
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let index = 0; index < 400; index++) {
      clean.observe(index * 50, index * 50 + 20);
      rough.observe(index * 50, index * 50 + 80 + random() * 60);
    }
    expect(clean.jitter).toBeLessThan(1);
    expect(rough.jitter).toBeGreaterThan(40);
    expect(rough.jitter).toBeLessThan(80);
  });
  it('follows a route that got slower, within two windows, and a faster one at once', () => {
    const clock = new HostClock();
    for (let t = 0; t < 3000; t += 50) clock.observe(t, t + 30);
    expect(clock.offset).toBe(-30);
    for (let t = 3000; t < 9000; t += 50) clock.observe(t, t + 120);
    expect(clock.offset).toBe(-120);
    clock.observe(9000, 9010);
    expect(clock.offset).toBe(-10);
  });
  it('delay is one interval plus jitter plus a pad, inside its bounds', () => {
    expect(delayFor(50, 0)).toBe(50 + DELAY_PAD);
    expect(delayFor(100, 30)).toBe(150);
    expect(delayFor(10, 0)).toBe(DELAY_MIN);
    expect(delayFor(830, 200)).toBe(DELAY_MAX);
  });
});

describe('the interpolation buffer', () => {
  it('draws between the two states either side of the playhead', () => {
    const buffer = new MotionBuffer();
    buffer.push(0, 0, 0, 0, 0, 2, 0, 0);
    buffer.push(100, 1, 2, 3, 1, 4, 0, 0);
    const s = buffer.read(25, motionSample());
    expect(s.mode).toBe(0);
    expect([s.x, s.y, s.z, s.yaw, s.vx]).toEqual([0.25, 0.5, 0.75, 0.25, 2.5]);
    expect(buffer.read(-50, motionSample())).toMatchObject({ x: 0, mode: 0, at: 0 });
    expect(buffer.read(100, motionSample())).toMatchObject({ x: 1, at: 1 });
  });
  it('turns the short way round', () => {
    const buffer = new MotionBuffer();
    buffer.push(0, 0, 0, 0, 3.0, 0, 0, 0);
    buffer.push(100, 0, 0, 0, -3.0, 0, 0, 0);
    const yaw = buffer.read(50, motionSample()).yaw;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.01);
  });
  it('takes states in any order, drops a repeat, and keeps the newest eight', () => {
    const buffer = new MotionBuffer();
    expect(buffer.push(200, 2, 0, 0, 0, 0, 0, 0)).toBe(true);
    expect(buffer.push(0, 0, 0, 0, 0, 0, 0, 0)).toBe(true);
    expect(buffer.push(100, 1, 0, 0, 0, 0, 0, 0)).toBe(true);
    expect(buffer.push(100, 9, 0, 0, 0, 0, 0, 0)).toBe(false);
    expect(buffer.count).toBe(3);
    expect(buffer.read(150, motionSample()).x).toBe(1.5);
    expect(buffer.read(50, motionSample()).x).toBe(0.5);
    for (let t = 300; t <= 1200; t += 100) buffer.push(t, t / 100, 0, 0, 0, 0, 0, 0);
    expect(buffer.count).toBe(8);
    expect(buffer.newest).toBe(1200);
    // Older than everything held: no room for it.
    expect(buffer.push(10, 0, 0, 0, 0, 0, 0, 0)).toBe(false);
    // A late one that still fits between held states goes in, and the oldest goes out.
    expect(buffer.push(1150, 11.5, 0, 0, 0, 0, 0, 0)).toBe(true);
    expect(buffer.count).toBe(8);
    expect(buffer.read(1175, motionSample()).x).toBeCloseTo(11.75);
  });
  it('carries on along the last velocity when it runs dry, then slows to a stop: never a jump back, never past a bound', () => {
    const buffer = new MotionBuffer();
    buffer.push(0, 0, 0, 0, 0, 4, 0, 0);
    buffer.push(100, 0.4, 0, 0, 0, 4, 0, 0);
    const s = motionSample();
    expect(buffer.read(100 + EXTRAPOLATE_MS, s)).toMatchObject({ mode: 1 });
    expect(s.x).toBeCloseTo(0.4 + 4 * EXTRAPOLATE_MS / 1000);
    expect(s.vx).toBe(4);
    let last = s.x;
    for (let over = EXTRAPOLATE_MS; over < 3000; over += 16) {
      const x = buffer.read(100 + over, s).x;
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
    // In the end it has gone the full-speed part and one easing constant more, and stands.
    expect(last).toBeCloseTo(0.4 + 4 * (EXTRAPOLATE_MS + EASE_OUT_MS) / 1000, 3);
    expect(buffer.read(4000, s).vx).toBeLessThan(0.001);
  });
  it('a step no speed explains is a cut: drawn at the old place until its time, then at the new', () => {
    const buffer = new MotionBuffer();
    buffer.push(0, 0, 0, 0, 0, 0, 0, 0);
    buffer.push(100, 40, 0, 0, 0, 0, 0, 0);
    expect(buffer.read(50, motionSample()).x).toBe(0);
    expect(buffer.read(99, motionSample()).x).toBe(0);
    expect(buffer.read(100, motionSample()).x).toBe(40);
    // A fast enemy's honest step is not one.
    const runner = new MotionBuffer();
    runner.push(0, 0, 0, 0, 0, 0, 0, 0);
    runner.push(200, 5, 0, 0, 0, 0, 0, 0);
    expect(runner.read(100, motionSample()).x).toBe(2.5);
  });
  it('keeps whole numbers with each state, read at the playhead', () => {
    const buffer = new MotionBuffer();
    buffer.push(0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4);
    buffer.push(100, 0, 0, 0, 0, 0, 0, 0, 5, 6, 7, 8);
    const early = buffer.read(99, motionSample()), late = buffer.read(100, motionSample());
    expect([0, 1, 2, 3].map(which => buffer.tag(early.at, which))).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map(which => buffer.tag(late.at, which))).toEqual([5, 6, 7, 8]);
    expect(buffer.tag(-1, 0)).toBe(0);
  });
});

describe('things that only say where they are (vehicles, allies)', () => {
  it('get a velocity from their last two places, so they too are carried on, and say how far between two states they are drawn', () => {
    const buffer = new MotionBuffer();
    buffer.place(0, 0, 0, 0, 0, 0, 0, 0, 1);
    buffer.place(200, 1, 0, 2, 0.5, 0, 1, 0, 0);
    const s = buffer.read(150, motionSample());
    expect(s.k).toBeCloseTo(0.75);
    expect(buffer.tag(s.at, 3)).toBe(1);
    expect(buffer.tag(s.at + 1, 1)).toBe(1);
    expect(buffer.tag(s.at + 2, 1)).toBe(0);
    // Past the newest: on at 5 and 10 m/s, as it was going.
    const on = buffer.read(260, motionSample());
    expect(on.mode).toBe(1);
    expect(on.k).toBe(0);
    expect([on.x, on.z]).toEqual([1 + 5 * 0.06, 2 + 10 * 0.06]);
    // A place a second or more after the last says nothing about speed; nor does a teleport.
    buffer.place(2000, 9, 0, 9, 0);
    expect(buffer.read(2000, motionSample()).vx).toBe(0);
    buffer.place(2100, 99, 0, 9, 0);
    expect(buffer.read(2100, motionSample()).vx).toBe(0);
  });
});

describe('the playhead', () => {
  /** Runs a 60 fps guest for `ms`, feeding states as `arrive(t)` allows; returns the largest error and frame-to-frame step. */
  function play(buffer: MotionBuffer, speed: number, every: number, ms: number, lost: (t: number) => boolean, latency = 30) {
    const s = motionSample();
    let worst = 0, step = 0, back = 0, last = NaN, sent = -every;
    for (let now = 0; now < ms; now += 1000 / 60) {
      while (sent + every + latency <= now) { sent += every; if (!lost(sent)) buffer.push(sent, speed * sent / 1000, 0, 0, 0, speed, 0, 0); }
      if (buffer.count === 0) continue;
      buffer.advance(1000 / 60, now - latency, 0, s);
      if (now > 600) {
        worst = Math.max(worst, Math.abs(s.x - speed * buffer.playhead / 1000));
        if (!Number.isNaN(last)) { step = Math.max(step, s.x - last); back = Math.min(back, s.x - last); }
      }
      last = s.x;
    }
    return { worst, step, back };
  }
  it('settles one interval and a pad behind the host and plays a steady walk exactly', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const run = play(buffer, 3, 50, 3000, () => false);
    expect(run.worst).toBeLessThan(0.002);
    // 3 m/s at 60 fps is 5 cm a frame: no frame steps much more, none goes backwards.
    expect(run.step).toBeLessThan(0.06);
    expect(run.back).toBeGreaterThanOrEqual(0);
    expect(3000 - 30 - buffer.playhead).toBeGreaterThan(50);
    expect(3000 - 30 - buffer.playhead).toBeLessThan(50 + DELAY_PAD + 20);
  });
  it('loses one packet in five without a jump or a step back, and stays within centimetres', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const run = play(buffer, 3, 50, 6000, t => (t / 50) % 5 === 2);
    expect(run.worst).toBeLessThan(0.02);
    expect(run.step).toBeLessThan(0.07);
    expect(run.back).toBeGreaterThanOrEqual(0);
  });
  it('rides out half a second of nothing: slows, then closes the gap smoothly when states return', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const run = play(buffer, 3, 50, 6000, t => t > 2000 && t < 2500);
    // Never a jump: at most the walk's own step (5 cm a frame) plus the catch-up at a run (under 7 cm a frame).
    expect(run.step).toBeLessThan(0.13);
    expect(run.back).toBeGreaterThanOrEqual(-1e-9);
  });
  it('eases a state that changes the picture in over a few frames instead of stepping', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const s = motionSample();
    walker(buffer, 4, 50, 0, 200);
    for (let now = 0; now <= 420; now += 10) buffer.advance(10, now, 0, s);
    // It has run 150 ms past its newest state on its old heading. The next state says it had turned round.
    const before = s.x;
    buffer.push(400, 0.4, 0, 0, 0, -4, 0, 0);
    buffer.advance(10, 430, 0, s);
    // 10 ms: its own 4 m/s the other way, and the correction at no more than 4 m/s.
    expect(Math.abs(s.x - before)).toBeLessThan(0.085);
    for (let now = 440; now <= 1500; now += 10) buffer.advance(10, now, 0, s);
    expect(s.x).toBeCloseTo(0.4 + -4 * EXTRAPOLATE_MS / 1000 + -4 * EASE_OUT_MS / 1000, 1);
  });
  it('a body drawn somewhere else (its own ragdoll) is eased back to the host\'s place', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const s = motionSample();
    for (let t = 0; t <= 3000; t += 50) buffer.push(t, 5, 0, 5, 0, 0, 0, 0);
    buffer.advance(16, 500, 0, s);
    buffer.advance(16, 516, 0, s);
    // The frame it is handed back on is drawn where the body is, not at the buffer's place.
    buffer.drawnAt(6.5, 0, 5, 0.4, s);
    expect(s.x).toBeCloseTo(6.5, 6);
    expect(s.yaw).toBeCloseTo(0.4, 6);
    buffer.advance(16, 532, 0, s);
    expect(s.x).toBeGreaterThan(6.1);
    expect(s.yaw).toBeGreaterThan(0.3);
    for (let now = 548; now < 1500; now += 16) buffer.advance(16, now, 0, s);
    expect(s.x).toBeCloseTo(5, 2);
    expect(s.yaw).toBeCloseTo(0, 2);
  });
  it('moves to a longer delay (near to far tier) by running slow, not by jumping', () => {
    const buffer = new MotionBuffer();
    buffer.interval = 50;
    const s = motionSample();
    walker(buffer, 2, 50, 0, 1000);
    for (let now = 0; now <= 1000; now += 10) buffer.advance(10, now, 0, s);
    const near = 1000 - buffer.playhead;
    buffer.interval = 200;
    let last = s.x;
    for (let now = 1010; now <= 3000; now += 10) {
      if (now % 200 === 0) buffer.push(now, 2 * now / 1000, 0, 0, 0, 2, 0, 0);
      buffer.advance(10, now, 0, s);
      expect(s.x - last).toBeGreaterThan(0);
      expect(s.x - last).toBeLessThan(0.03);
      last = s.x;
    }
    expect(3000 - buffer.playhead).toBeGreaterThan(near + 100);
    expect(3000 - buffer.playhead).toBeCloseTo(200 + DELAY_PAD, -1);
  });
  it('a tab that slept is put on the present, not played through', () => {
    const buffer = new MotionBuffer();
    const s = motionSample();
    walker(buffer, 2, 100, 0, 500);
    buffer.advance(16, 500, 0, s);
    walker(buffer, 2, 100, 60000, 60500);
    buffer.advance(16, 60500, 0, s);
    expect(60500 - buffer.playhead).toBeLessThan(200);
  });
});

describe('the send clock', () => {
  it('ticks 20 times a second on a 60 fps host, not 18', () => {
    const clock = new SendClock(50);
    let ticks = 0;
    for (let now = 0; now < 10_000; now += 1000 / 60) if (clock.due(now)) ticks++;
    expect(ticks).toBeGreaterThanOrEqual(199);
    expect(ticks).toBeLessThanOrEqual(201);
    expect(clock.actual).toBeGreaterThan(45);
    expect(clock.actual).toBeLessThan(55);
  });
  it('ticks every frame of a 12 fps host and says how far apart they really are', () => {
    const clock = new SendClock(50);
    let ticks = 0;
    for (let now = 0; now < 10_000; now += 1000 / 12) if (clock.due(now)) ticks++;
    expect(ticks).toBe(120);
    expect(clock.actual).toBeCloseTo(1000 / 12, 0);
  });
  it('catches up by one tick after a stall and drops the rest', () => {
    const clock = new SendClock(50);
    expect(clock.due(0)).toBe(true);
    expect(clock.due(20)).toBe(false);
    expect(clock.due(50)).toBe(true);
    // Two seconds of nothing: one tick now, the next a whole interval later.
    expect(clock.due(2050)).toBe(true);
    expect(clock.due(2060)).toBe(false);
    expect(clock.due(2100)).toBe(true);
    expect(clock.tick).toBe(4);
  });
});
