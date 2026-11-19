/**
 * How a guest turns the host's stamped states into smooth motion. No game imports: plain numbers in, plain numbers out, and
 * nothing here allocates once built.
 *
 * - `HostClock` maps the host's clock onto this page's from the stamps themselves, and measures how unevenly packets arrive.
 * - `MotionBuffer` keeps one thing's last few states (an enemy, a vehicle, an ally), sorted by host time whatever order they
 *   came in, and draws it a little in the past, between the two states either side of its own playhead. When the playhead
 *   runs past the newest state it goes on along the last velocity for `EXTRAPOLATE_MS`, then slows to a stop; when the next
 *   state lands, the difference is eased away, never jumped.
 * - `SendClock` is the host's steady tick: no drift from frame timing, and at most one tick caught up after a stall.
 */

/** The longest a thing is carried on along its last velocity at full speed, ms. */
export const EXTRAPOLATE_MS = 100;
/** After that it slows to a stop with this time constant, ms: about this much more of its velocity, never a freeze mid-step. */
export const EASE_OUT_MS = 150;
/** How fast the gap between where a thing was drawn and where the buffer now says it is closes, ms (time constant). */
export const CORRECT_MS = 90;
/** And never faster than this, metres and radians a second: a body eases back at a run, it does not dart. */
export const CORRECT_SPEED = 4;
export const CORRECT_TURN = 7;
/** A step longer than this between two states, beyond what any speed explains, is a teleport: drawn as a cut, not a slide. */
export const TELEPORT_M = 6;
export const TELEPORT_SPEED = 45;
/** Drawn no nearer to the present than this, and no further back than `DELAY_MAX`, ms. */
export const DELAY_MIN = 50;
export const DELAY_MAX = 450;
/** On top of one send interval and the measured jitter: a frame of this page, and the host's own uneven frames. */
export const DELAY_PAD = 20;
/** The playhead closes on where it should be over about this long, and never runs faster or slower than these. */
export const SLEW_MS = 350;
export const SLEW_FAST = 1.25;
export const SLEW_SLOW = 0.75;
/** A playhead this far from where it should be (a tab that slept, a first state) is put there at once. */
export const SNAP_MS = 1000;

const WINDOW_MS = 2500;

/**
 * The host's clock, read from the stamps on its packets. A packet stamped `host` that arrives at local `now` says the two
 * clocks differ by at least `host - now`; the packet that crossed fastest gives the best figure, so the estimate is the
 * largest seen over the last few seconds (two windows, so an old best ages out and a route that got slower is followed).
 * Every other packet is late by `lateness`; its mean and spread give `jitter`, the extra delay that hides it.
 */
export class HostClock {
  /** Host time minus local time, ms. */
  offset = 0;
  /** How late packets run against the fastest one, ms: mean plus twice the mean deviation. */
  jitter = 0;
  /** No packet yet. */
  empty = true;
  private best = -Infinity;
  private previous = -Infinity;
  private windowAt = 0;
  private mean = 0;
  private deviation = 0;

  observe(host: number, now: number): void {
    const d = host - now;
    if (this.empty) {
      this.empty = false;
      this.best = this.offset = d;
      this.windowAt = now;
      return;
    }
    if (now - this.windowAt > WINDOW_MS) {
      this.previous = this.best;
      this.best = d;
      this.windowAt = now;
    } else if (d > this.best) this.best = d;
    this.offset = Math.max(this.best, this.previous);
    const late = Math.min(1000, this.offset - d);
    this.mean += (late - this.mean) * 0.1;
    this.deviation += (Math.abs(late - this.mean) - this.deviation) * 0.1;
    this.jitter = this.mean + 2 * this.deviation;
  }

  /** The host's time now, as nearly as its fastest packet tells. */
  now(local: number): number { return local + this.offset; }

  reset(): void {
    this.empty = true;
    this.offset = this.jitter = this.mean = this.deviation = 0;
    this.best = this.previous = -Infinity;
  }
}

/** How far in the past to draw something sent every `interval` ms, on a link with this much jitter. */
export const delayFor = (interval: number, jitter: number): number =>
  Math.min(DELAY_MAX, Math.max(DELAY_MIN, interval + jitter + DELAY_PAD));

/** What `MotionBuffer.sample` writes. `mode`: 0 between two states, 1 carried on past the newest, 2 nothing to go on. */
export interface MotionSample {
  x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number;
  /** The state at or before the playhead: its index for `MotionBuffer.tag`, -1 when there is none. */
  at: number;
  /** How far from that state toward the next the playhead is, 0..1 (0 when there is no next, or across a cut). */
  k: number;
  mode: 0 | 1 | 2;
}

export const motionSample = (): MotionSample => ({ x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, at: -1, k: 0, mode: 2 });

const CAPACITY = 8;
// Per state: t, x, y, z, yaw, vx, vy, vz, cut, tag0..tag3.
const T = 0, X = 1, Y = 2, Z = 3, YAW = 4, VX = 5, VY = 6, VZ = 7, CUT = 8, TAG = 9;
const TAGS = 4;
const STRIDE = TAG + TAGS;

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class MotionBuffer {
  /** Host time being drawn, ms. */
  playhead = 0;
  /** Ms between this thing's states, as the host says it sends them. */
  interval = 100;
  /** States held. */
  count = 0;
  /** Host time of the newest state. */
  newest = -Infinity;
  private readonly s = new Float64Array(CAPACITY * STRIDE);
  private started = false;
  /** Set when a state lands, until the next `advance` has eased the difference in. */
  private dirty = false;
  private readonly before = motionSample();
  private readonly after = motionSample();
  private ox = 0; private oy = 0; private oz = 0; private oyaw = 0;
  private lastMode: 0 | 1 | 2 = 2;

  /**
   * A state stamped `t` (host ms). Any order; a second state for a time already held, or one older than everything held in
   * a full buffer, is dropped (false). `tags` are up to four whole numbers kept with the state (flags, posture) for `tag`.
   */
  push(t: number, x: number, y: number, z: number, yaw: number, vx: number, vy: number, vz: number, tag0 = 0, tag1 = 0, tag2 = 0, tag3 = 0): boolean {
    const s = this.s;
    let at = this.count;
    while (at > 0 && s[(at - 1) * STRIDE + T]! > t) at--;
    if (at > 0 && s[(at - 1) * STRIDE + T] === t) return false;
    if (this.count === CAPACITY) {
      if (at === 0) return false;
      s.copyWithin(0, STRIDE, at * STRIDE);
      at--;
    } else {
      s.copyWithin((at + 1) * STRIDE, at * STRIDE, this.count * STRIDE);
      this.count++;
    }
    const o = at * STRIDE;
    s[o + T] = t; s[o + X] = x; s[o + Y] = y; s[o + Z] = z; s[o + YAW] = yaw; s[o + VX] = vx; s[o + VY] = vy; s[o + VZ] = vz;
    s[o + TAG] = tag0; s[o + TAG + 1] = tag1; s[o + TAG + 2] = tag2; s[o + TAG + 3] = tag3;
    s[o + CUT] = at > 0 && this.jumped(o - STRIDE, o) ? 1 : 0;
    if (at + 1 < this.count) s[o + STRIDE + CUT] = this.jumped(o, o + STRIDE) ? 1 : 0;
    if (t > this.newest) this.newest = t;
    this.dirty = true;
    return true;
  }

  private jumped(a: number, b: number): boolean {
    const s = this.s;
    const d = Math.hypot(s[b + X]! - s[a + X]!, s[b + Y]! - s[a + Y]!, s[b + Z]! - s[a + Z]!);
    return d > Math.max(TELEPORT_M, TELEPORT_SPEED * (s[b + T]! - s[a + T]!) / 1000);
  }

  /**
   * A state that says only where the thing is (a vehicle, an ally): its velocity is worked out from the newest state held,
   * so it too is carried on when the buffer runs dry. Its four tags are free for whatever else is blended (a quaternion).
   */
  place(t: number, x: number, y: number, z: number, yaw: number, tag0 = 0, tag1 = 0, tag2 = 0, tag3 = 0): boolean {
    let vx = 0, vy = 0, vz = 0;
    const o = (this.count - 1) * STRIDE;
    if (this.count > 0 && t > this.newest && t - this.newest < 1000) {
      const seconds = (t - this.newest) / 1000;
      vx = (x - this.s[o + X]!) / seconds; vy = (y - this.s[o + Y]!) / seconds; vz = (z - this.s[o + Z]!) / seconds;
      if (Math.hypot(vx, vy, vz) > TELEPORT_SPEED) vx = vy = vz = 0;
    }
    return this.push(t, x, y, z, yaw, vx, vy, vz, tag0, tag1, tag2, tag3);
  }

  /** A number kept with the state `at` (as `sample.at`, or one past it for the state being blended toward). 0 if there is none. */
  tag(at: number, which: number): number { return at < 0 || at >= this.count ? 0 : this.s[at * STRIDE + TAG + which]!; }

  /**
   * Moves the playhead on by `dt` ms of this page's time, toward `hostNow - delay`, and writes where the thing is drawn.
   * The playhead runs a little fast or slow to close on its place, so a change of delay never shows as a jump.
   */
  advance(dt: number, hostNow: number, jitter: number, out: MotionSample): MotionSample {
    const target = hostNow - delayFor(this.interval, jitter);
    const previous = this.playhead;
    if (!this.started) {
      // Drawn at once from its first state, where the host had it; the playhead then waits for the buffer to fill behind it.
      this.started = true;
      this.playhead = Math.min(target, this.newest);
      if (!Number.isFinite(this.playhead)) this.playhead = target;
      this.dirty = false;
      this.lastMode = this.read(this.playhead, out).mode;
      return out;
    }
    if (this.dirty) {
      // A state landed. Where the old states had this thing a frame ago, against where the new set has it at that same
      // moment: the difference is carried as an offset and eased away, so nothing steps when a late state fills in.
      this.dirty = false;
      if (this.lastMode !== 0) {
        const now = this.read(previous, this.after);
        const was = this.before;
        if (now.mode !== 2 && was.mode !== 2 && Math.hypot(was.x - now.x, was.y - now.y, was.z - now.z) < TELEPORT_M) {
          this.ox += was.x - now.x; this.oy += was.y - now.y; this.oz += was.z - now.z;
          this.oyaw = wrap(this.oyaw + was.yaw - now.yaw);
        }
      }
    }
    const error = target - (previous + dt);
    if (Math.abs(error) > SNAP_MS) {
      this.playhead = target;
      this.ox = this.oy = this.oz = this.oyaw = 0;
    } else this.playhead = previous + dt * Math.min(SLEW_FAST, Math.max(SLEW_SLOW, 1 + error / SLEW_MS));
    const raw = this.read(this.playhead, out);
    const b = this.before;
    b.x = raw.x; b.y = raw.y; b.z = raw.z; b.yaw = raw.yaw; b.mode = raw.mode;
    this.lastMode = raw.mode;
    // The offset closes at its own pace, but never faster than a body could run: a big gap is walked off, not darted across.
    const gap = Math.hypot(this.ox, this.oy, this.oz);
    const keep = Math.max(Math.exp(-dt / CORRECT_MS), gap > 1e-6 ? 1 - CORRECT_SPEED * dt / 1000 / gap : 0);
    this.ox *= keep; this.oy *= keep; this.oz *= keep;
    const turn = Math.abs(this.oyaw);
    this.oyaw *= Math.max(Math.exp(-dt / CORRECT_MS), turn > 1e-6 ? 1 - CORRECT_TURN * dt / 1000 / turn : 0);
    out.x += this.ox; out.y += this.oy; out.z += this.oz; out.yaw += this.oyaw;
    return out;
  }

  /**
   * It is drawn at this place now, wherever the buffer has it (a body that got up where its own ragdoll left it): eased back.
   * `out` is this frame's sample, already taken by `advance`: it is put at that place too, so the frame the body is handed
   * back on is not drawn at the buffer's place and the next back where it lay.
   */
  drawnAt(x: number, y: number, z: number, yaw: number, out?: MotionSample): void {
    const b = this.before;
    if (b.mode === 2) return;
    this.ox = x - b.x; this.oy = y - b.y; this.oz = z - b.z;
    this.oyaw = wrap(yaw - b.yaw);
    if (Math.hypot(this.ox, this.oy, this.oz) > TELEPORT_M * 2) this.ox = this.oy = this.oz = this.oyaw = 0;
    if (out) { out.x = b.x + this.ox; out.y = b.y + this.oy; out.z = b.z + this.oz; out.yaw = b.yaw + this.oyaw; }
  }

  /** Where the states alone put it at host time `t`, with no easing. */
  read(t: number, out: MotionSample): MotionSample {
    const s = this.s;
    const n = this.count;
    out.k = 0;
    if (n === 0) { out.mode = 2; out.at = -1; return out; }
    let i = n - 1;
    while (i > 0 && s[i * STRIDE + T]! > t) i--;
    const a = i * STRIDE;
    const ta = s[a + T]!;
    if (t <= ta) return this.copy(a, i, 0, out);
    if (i === n - 1) {
      // Past the newest state: on along its velocity, then slowing to a stop.
      const over = t - ta;
      const full = Math.min(over, EXTRAPOLATE_MS);
      const fade = over > EXTRAPOLATE_MS ? Math.exp(-(over - EXTRAPOLATE_MS) / EASE_OUT_MS) : 1;
      const seconds = (full + (over > EXTRAPOLATE_MS ? EASE_OUT_MS * (1 - fade) : 0)) / 1000;
      out.x = s[a + X]! + s[a + VX]! * seconds; out.y = s[a + Y]! + s[a + VY]! * seconds; out.z = s[a + Z]! + s[a + VZ]! * seconds;
      out.yaw = s[a + YAW]!;
      out.vx = s[a + VX]! * fade; out.vy = s[a + VY]! * fade; out.vz = s[a + VZ]! * fade;
      out.at = i; out.mode = 1;
      return out;
    }
    const b = a + STRIDE;
    if (s[b + CUT] === 1) return this.copy(a, i, 0, out);
    const k = (t - ta) / (s[b + T]! - ta);
    out.x = s[a + X]! + (s[b + X]! - s[a + X]!) * k; out.y = s[a + Y]! + (s[b + Y]! - s[a + Y]!) * k; out.z = s[a + Z]! + (s[b + Z]! - s[a + Z]!) * k;
    out.yaw = s[a + YAW]! + wrap(s[b + YAW]! - s[a + YAW]!) * k;
    out.vx = s[a + VX]! + (s[b + VX]! - s[a + VX]!) * k; out.vy = s[a + VY]! + (s[b + VY]! - s[a + VY]!) * k; out.vz = s[a + VZ]! + (s[b + VZ]! - s[a + VZ]!) * k;
    out.at = i; out.k = k; out.mode = 0;
    return out;
  }

  private copy(o: number, index: number, mode: 0 | 1 | 2, out: MotionSample): MotionSample {
    const s = this.s;
    out.x = s[o + X]!; out.y = s[o + Y]!; out.z = s[o + Z]!; out.yaw = s[o + YAW]!;
    out.vx = s[o + VX]!; out.vy = s[o + VY]!; out.vz = s[o + VZ]!;
    out.at = index; out.mode = mode;
    return out;
  }

  reset(): void {
    this.count = 0;
    this.newest = -Infinity;
    this.started = this.dirty = false;
    this.ox = this.oy = this.oz = this.oyaw = 0;
    this.before.mode = this.lastMode = 2;
  }
}

/**
 * The host's send tick. `due(now)` is true once per `interval` ms of real time whatever the frame rate: the next tick is
 * counted from the last tick's own time, not from the frame that noticed it, so a 60 fps host ticks 20 times a second and
 * not 18. After a stall it catches up by one tick and drops the rest of the backlog.
 */
export class SendClock {
  /** Ticks so far. */
  tick = 0;
  /** Ms between the last two ticks as they really happened, smoothed: what a slow host's guests should expect. */
  actual: number;
  private next = -Infinity;
  private last = -Infinity;

  constructor(readonly interval: number) { this.actual = interval; }

  due(now: number): boolean {
    if (now < this.next) return false;
    this.next = this.next === -Infinity || now - this.next > this.interval ? now + this.interval : this.next + this.interval;
    if (this.last !== -Infinity) this.actual += (Math.min(1000, now - this.last) - this.actual) * 0.2;
    this.last = now;
    this.tick++;
    return true;
  }
}
