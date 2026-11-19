// Co-op proof: how well a guest's enemies follow the host's. Two pages, a crowd that never stops moving, and a recorder on
// each page. Every frame the guest notes where it drew each enemy; every frame the host notes where each one really was.
// Afterwards each drawn position is compared with where the host had that enemy at the moment being drawn.
//
//   OP2_NO_HMR=1 npx vite --port 5320 --strictPort          (your own port)
//   MOTION_ENEMIES=48 MOTION_NET=lag:80,jitter:30,loss:0.03 MOTION_HOST_FPS=20 MOTION_TAG=after \
//     node tools/shot.mjs --port 5320 --w 1280 --h 720 --wait 500 --timeout 300 \
//       --script tools/scripts/coop-motion-measure.mjs --out tools/out/coop/enemy-motion/measure.png
//
//   MOTION_ENEMIES   how many enemies (default 20; 48 is the cap)
//   MOTION_NET       the game's network simulator on both pages, e.g. lag:80,jitter:30,loss:0.03 (default: a clean network)
//   MOTION_HOST_FPS  cap the host's frame rate (default 0: none; 20 is the slow-host case)
//   MOTION_SECONDS   how long to record (default 20)
//   MOTION_GUEST     shadow (default): the guest stays 14 m from the host, in the crowd, panning its view across it and
//                    away. circles: it runs its own circle and drifts 40 to 70 m off (most of the crowd is then far)
//   MOTION_TAG       a word for the evidence file's name (e.g. baseline, after)
//   MOTION_SHOTS     take this many screenshots of the guest's view, 120 ms apart, after recording
//   MOTION_STRICT    1: fail unless the pages really ran and the motion is inside LIMITS below
//   Beside the evidence it keeps the two recordings (<name>.raw.json.gz): `analyse(raw.host, raw.guest)` measures them again.
//
// What it reports (written to motion-<tag>-<enemies>e-<fps>-<net>.json beside --out, and returned):
//   delay       how far in the past the guest draws, ms: the one delay that fits the whole run best
//   error       metres between where an enemy is drawn and where the host had it that long ago: p50, p95, max
//   declared    the same against the moment the guest itself says it is drawing (its playhead), where it has one
//   yaw         the same for facing, degrees
//   stalls      frames an enemy stood still on the guest (under 0.03 m/s) while its host twin moved (over 0.5 m/s), and how many times
//               a minute that began, for the whole crowd and per enemy
//   step        how far a frame's movement on the guest is from the host's over the same moment, metres: stepping and darts
//   bytes       what the host sent this guest a second: snapshots, and everything
//   common      ONE YARDSTICK FOR ANY LANE, old or new, taken only from the two recordings (nothing the netcode says of
//               itself), for all enemies and for near and far ones apart (far by the host's own rule, snapshot.ts `tierOf`,
//               from the guest's body as the host has it):
//                 lagMs        how old each drawn frame really is: when the host's twin was at the point of its path
//                              nearest the drawn body
//                 offPath      metres from the drawn body to that point: it is somewhere the real one never was
//                 nowError     metres between where it is drawn and where the host has it at that same instant
//                 speedError   m/s between its drawn frame-to-frame velocity and its host twin's
//                 stall        frames and time it stood still (under 0.03 m/s) while its host twin moved (over 0.5 m/s)
//                 jumps        frames it moved over 10 cm further than its twin's fastest speed nearby explains
//                 backsteps    frames it moved against the way its twin was going
//               also for `seen` (on the guest's screen), `entered` (on it for under a second) and `unseen`; frames an
//               enemy is knocked down on either screen (`down`) and the 3 s after (`rising`) are kept out of the rest
//   frames      each page's frame times, ms: a page that hitches draws late whatever the netcode does
//
// The pages DRAW (look: true): this proof is about what is seen and how fast the pages run, so fast mode is off.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { calm, kit, live, netStats, resetNet, startParty } from './coop-kit.mjs';

/** One run's settings, from the environment unless the caller (coop-motion-matrix.mjs) gives its own. */
const fromEnv = () => ({ enemies: Number(process.env.MOTION_ENEMIES ?? 20), net: process.env.MOTION_NET ?? '', hostFps: Number(process.env.MOTION_HOST_FPS ?? 0), guest: process.env.MOTION_GUEST ?? 'shadow',
  seconds: Number(process.env.MOTION_SECONDS ?? 20), tag: process.env.MOTION_TAG ?? 'run', shots: Number(process.env.MOTION_SHOTS ?? 0), strict: process.env.MOTION_STRICT === '1' });
/** With MOTION_STRICT: what the new netcode must hold on any of the networks this proof is run on. */
const LIMITS = { errorP50: 0.08, errorP95: 0.35, stallsPerEnemyMinute: 1, snapshotBytes: 30_000 };

/** In the host page before anything loads: its frames capped, the guests' left alone. */
function capFrames(fps) {
  if (!fps || window.__motionCap) return;
  window.__motionCap = true;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const deadline = performance.now() + 1000 / fps - 8;
    const tick = now => (now >= deadline ? callback(now) : raf(tick));
    return raf(tick);
  };
}

/** In a page: the player runs in a wide circle for ever, so whatever is after them never arrives. */
function runInCircles(turn) {
  const { ctx } = window.__op2;
  ctx.input.simulate('forward', true);
  let last = performance.now();
  const step = now => {
    ctx.player.yaw += turn * Math.min(0.1, (now - last) / 1000);
    last = now;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * In the guest's page: the player keeps `distance` metres from the host, circling them, so the crowd that is after the host
 * is all around this player too; and pans the view across the crowd and away, `sweep` radians either side every `period`
 * ms, as a player glancing about does. Enemies are close, cross the screen, leave it and come back onto it.
 */
function shadowHost(distance, sweep, period) {
  const { ctx } = window.__op2;
  const start = performance.now();
  const step = now => {
    requestAnimationFrame(step);
    let root = null;
    for (const remote of ctx.coop.remotes.values()) if (remote.char?.root?.visible) { root = remote.char.root; break; }
    if (!root) return;
    const me = ctx.player.position;
    const dx = root.position.x - me.x, dz = root.position.z - me.z, d = Math.hypot(dx, dz) || 1;
    // The view: at the host, panned from side to side.
    const yaw = Math.atan2(-dx, -dz) + sweep * Math.sin((now - start) / period * 2 * Math.PI);
    ctx.player.yaw = yaw;
    // The feet: around the host at `distance`, closing or opening the gap when it is off.
    const radial = Math.max(-1, Math.min(1, (d - distance) / 4)), around = 1 - Math.abs(radial) * 0.5;
    const wx = dx / d * radial - dz / d * around, wz = dz / d * radial + dx / d * around;
    // Into this player's own axes: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
    const forward = -wx * Math.sin(yaw) - wz * Math.cos(yaw), right = wx * Math.cos(yaw) - wz * Math.sin(yaw);
    ctx.input.simulate('forward', forward > 0.35); ctx.input.simulate('back', forward < -0.35);
    ctx.input.simulate('right', right > 0.35); ctx.input.simulate('left', right < -0.35);
  };
  requestAnimationFrame(step);
}

/**
 * In a page: records every enemy every frame. Host: where it is, whether it is far from the guest by the host's own rule
 * (snapshot.ts `tierOf`, from the guest's body as the host has it) and whether it is knocked down. Guest: where it is
 * drawn, the playhead and send interval if the lane has them, and whether it is knocked down here.
 */
function record(seconds) {
  const { ctx } = window.__op2;
  const world = ctx.coop.world;
  const hosting = ctx.coop.hosting;
  const fields = hosting ? 7 : 8;
  // Per frame: the time, the count, and on the guest where the player stands, looks, half the width of their view, and
  // the lane's jitter estimate and clock offset.
  const header = hosting ? 2 : 9;
  const clock = world.enemies?.clock;
  const data = new Float64Array(Math.ceil(seconds * 130) * (header + 48 * fields));
  let at = 0, frames = 0;
  const rec = () => {
    if (at + header + 48 * fields > data.length) return;
    const head = at;
    data[at++] = performance.timeOrigin + performance.now();
    at++;
    if (!hosting) {
      const camera = ctx.render.camera;
      data[at++] = ctx.player.eye.x; data[at++] = ctx.player.eye.y; data[at++] = ctx.player.eye.z; data[at++] = ctx.player.yaw;
      data[at++] = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
      // The new lane's own measure of how unevenly packets arrive, and its clock offset (NaN on a lane without them).
      data[at++] = clock?.jitter ?? NaN; data[at++] = clock?.offset ?? NaN;
    }
    let n = 0;
    if (hosting) {
      let root = null;
      for (const remote of ctx.coop.remotes.values()) if (remote.char?.root?.visible) { root = remote.char.root; break; }
      const fx = root ? Math.sin(root.rotation.y) : 0, fz = root ? Math.cos(root.rotation.y) : 0;
      const few = ctx.enemies.alive.length <= 4;
      for (const e of ctx.enemies.alive) {
        if (n === 48) break;
        let far = 0;
        if (root && !few && !e.isBoss) {
          const dx = e.position.x - root.position.x, dy = e.position.y - root.position.y, dz = e.position.z - root.position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          far = d2 <= 625 || (d2 <= 4900 && dx * fx + dz * fz > 0.5 * Math.hypot(dx, dz)) ? 0 : 1;
        }
        data[at++] = e.uid; data[at++] = e.position.x; data[at++] = e.position.y; data[at++] = e.position.z; data[at++] = e.yaw; data[at++] = far; data[at++] = e.downed ? 1 : 0; n++;
      }
    } else {
      for (const [uid, r] of world.replicas) {
        if (n === 48) break;
        const e = r.enemy;
        data[at++] = uid; data[at++] = e.position.x; data[at++] = e.position.y; data[at++] = e.position.z; data[at++] = e.yaw;
        data[at++] = r.motion ? r.motion.playhead : NaN; data[at++] = r.motion ? r.motion.interval : NaN; data[at++] = e.downed ? 1 : 0; n++;
      }
    }
    data[head + 1] = n;
    frames++;
  };
  // The host is read as its snapshot would read it (before the world's update sends); the guest as it has just been drawn.
  if (hosting) { const update = world.update.bind(world); world.update = () => { rec(); update(); }; }
  else { const update = world.updateGuests.bind(world); world.updateGuests = () => { update(); rec(); }; }
  window.__motion = { read: () => ({ origin: performance.timeOrigin, fields, header, frames, data: Array.from(data.subarray(0, at)) }) };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);
const spread = values => {
  const sorted = Float64Array.from(values).sort();
  const r = v => Math.round(v * 10000) / 10000;
  return { n: sorted.length, p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), p99: r(quantile(sorted, 0.99)), max: r(sorted.at(-1) ?? NaN) };
};
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The two recordings compared. */
export function analyse(hostRec, guestRec) {
  const HF = hostRec.fields ?? 5, GF = guestRec.fields ?? 6, HH = hostRec.header ?? 2, GH = guestRec.header ?? 2;
  // The host's truth, per enemy, as tracks over wall time.
  const truth = new Map();
  const hostTimes = [];
  for (let at = 0; at < hostRec.data.length;) {
    const t = hostRec.data[at], n = hostRec.data[at + 1];
    at += HH;
    hostTimes.push(t);
    for (let i = 0; i < n; i++, at += HF) {
      const uid = hostRec.data[at];
      let track = truth.get(uid);
      if (!track) truth.set(uid, track = { t: [], x: [], y: [], z: [], yaw: [], far: [], down: [] });
      track.t.push(t); track.x.push(hostRec.data[at + 1]); track.y.push(hostRec.data[at + 2]); track.z.push(hostRec.data[at + 3]); track.yaw.push(hostRec.data[at + 4]);
      track.far.push(HF > 5 ? hostRec.data[at + 5] : 0);
      track.down.push(HF > 6 ? hostRec.data[at + 6] : 0);
    }
  }
  // Where the host itself moved an enemy in one frame (a stranded one re-entering through a spawn point, one set on a ledge
  // 3 m up, a leap's landing correction): no netcode can draw that as motion, so half a second either side of it is left
  // out of the comparison. Over 3 m in a frame, or over 1 m at more than 30 m/s (no enemy runs a third as fast).
  let teleports = 0;
  for (const track of truth.values()) {
    track.jumps = [];
    for (let i = 1; i < track.t.length; i++) {
      const step = Math.hypot(track.x[i] - track.x[i - 1], track.y[i] - track.y[i - 1], track.z[i] - track.z[i - 1]);
      if (step > 3 || (step > 1 && step > 0.03 * (track.t[i] - track.t[i - 1]))) { track.jumps.push(track.t[i]); teleports++; }
    }
  }
  const scratch = { x: 0, y: 0, z: 0, yaw: 0, far: 0, down: 0 };
  const where = (uid, t, out = scratch) => {
    const track = truth.get(uid);
    if (!track || t < track.t[0] || t > track.t.at(-1)) return null;
    for (const jump of track.jumps) if (Math.abs(t - jump) < 500) return null;
    let lo = 0, hi = track.t.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track.t[mid] <= t) lo = mid; else hi = mid; }
    // A gap in the host's own record (the enemy was not alive in between) is not a place.
    if (track.t[hi] - track.t[lo] > 400) return null;
    const k = track.t[hi] === track.t[lo] ? 0 : (t - track.t[lo]) / (track.t[hi] - track.t[lo]);
    out.x = track.x[lo] + (track.x[hi] - track.x[lo]) * k; out.y = track.y[lo] + (track.y[hi] - track.y[lo]) * k; out.z = track.z[lo] + (track.z[hi] - track.z[lo]) * k;
    out.yaw = track.yaw[lo] + Math.atan2(Math.sin(track.yaw[hi] - track.yaw[lo]), Math.cos(track.yaw[hi] - track.yaw[lo])) * k;
    out.far = track.far[k < 0.5 ? lo : hi];
    out.down = track.down[lo] || track.down[hi];
    return out;
  };
  // The guest's drawing, per enemy.
  const drawn = new Map();
  const frameTimes = [], jitters = [];
  for (let at = 0; at < guestRec.data.length;) {
    const t = guestRec.data[at], n = guestRec.data[at + 1];
    // Where the guest stood and looked this frame: is an enemy on their screen? (Flat: the proof's players do not look up.)
    if (GH >= 9 && Number.isFinite(guestRec.data[at + 7])) jitters.push(guestRec.data[at + 7]);
    const eye = GH >= 7 ? { x: guestRec.data[at + 2], z: guestRec.data[at + 4], fx: -Math.sin(guestRec.data[at + 5]), fz: -Math.cos(guestRec.data[at + 5]), cos: Math.cos(guestRec.data[at + 6]) } : null;
    at += GH;
    frameTimes.push(t);
    for (let i = 0; i < n; i++, at += GF) {
      const uid = guestRec.data[at];
      let track = drawn.get(uid);
      if (!track) drawn.set(uid, track = []);
      const x = guestRec.data[at + 1], z = guestRec.data[at + 3];
      const seen = eye ? (x - eye.x) * eye.fx + (z - eye.z) * eye.fz > eye.cos * Math.hypot(x - eye.x, z - eye.z) : false;
      track.push({ t, x, y: guestRec.data[at + 2], z, yaw: guestRec.data[at + 4], playhead: guestRec.data[at + 5], interval: GF > 6 ? guestRec.data[at + 6] : NaN, down: GF > 7 ? guestRec.data[at + 7] === 1 : false, seen });
    }
  }
  // The one delay that fits best: the guest draws the past, and how far back is not an error.
  const cost = delay => {
    let sum = 0, n = 0;
    for (const [uid, track] of drawn) for (let i = 0; i < track.length; i += 3) {
      const s = track[i], h = where(uid, s.t - delay);
      if (h) { sum += Math.min(2, Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z)); n++; }
    }
    return n ? sum / n : Infinity;
  };
  let delay = 0, best = Infinity;
  for (let d = 0; d <= 700; d += 10) { const c = cost(d); if (c < best) { best = c; delay = d; } }
  for (let d = Math.max(0, delay - 10); d <= delay + 10; d += 1) { const c = cost(d); if (c < best) { best = c; delay = d; } }

  const error = [], yaw = [], declared = [], declaredYaw = [], step = [], behind = [];
  let frames = 0, moving = 0, stallFrames = 0, stalls = 0, enemySeconds = 0;
  for (const [uid, track] of drawn) {
    let stalled = false, previous = null, previousHost = null;
    for (const s of track) {
      const h = where(uid, s.t - delay);
      if (!h) { previous = previousHost = null; stalled = false; continue; }
      frames++;
      error.push(Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z));
      yaw.push(turn(s.yaw, h.yaw) * 180 / Math.PI);
      const host = { x: h.x, y: h.y, z: h.z };
      if (Number.isFinite(s.playhead)) {
        const d = where(uid, hostRec.origin + s.playhead);
        if (d) { declared.push(Math.hypot(s.x - d.x, s.y - d.y, s.z - d.z)); declaredYaw.push(turn(s.yaw, d.yaw) * 180 / Math.PI); behind.push(s.t - (hostRec.origin + s.playhead)); }
      }
      // Two frames a few milliseconds apart (a page catching up after a hitch) say nothing about standing still.
      if (previous && s.t - previous.t < 120 && s.t - previous.t >= 4) {
        const dt = (s.t - previous.t) / 1000;
        enemySeconds += dt;
        const guestMove = Math.hypot(s.x - previous.x, s.y - previous.y, s.z - previous.z);
        const hostMove = Math.hypot(host.x - previousHost.x, host.y - previousHost.y, host.z - previousHost.z);
        step.push(Math.abs(guestMove - hostMove));
        if (hostMove / dt > 0.5) {
          moving++;
          const still = guestMove / dt < 0.03;
          if (still) { stallFrames++; if (!stalled) stalls++; }
          stalled = still;
        } else stalled = false;
      } else stalled = false;
      previous = s; previousHost = host;
    }
  }
  const seconds = (frameTimes.at(-1) - frameTimes[0]) / 1000;
  const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
  const gaps = times => { const out = []; for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]); return spread(out); };
  return {
    seconds: round(seconds, 1), enemies: drawn.size, samples: frames, hostTeleports: teleports, guestFps: round(guestRec.frames / seconds, 1), hostFps: round(hostRec.frames / seconds, 1),
    frames: { hostMs: gaps(hostTimes), guestMs: gaps(frameTimes) },
    jitterMs: jitters.length ? spread(jitters) : null,
    delay, error: spread(error), yaw: spread(yaw),
    declared: declared.length ? { behindMs: spread(behind), error: spread(declared), yaw: spread(declaredYaw) } : null,
    stalls: { frames: stallFrames, movingFrames: moving, percent: round(100 * stallFrames / Math.max(1, moving)), perMinute: round(stalls / seconds * 60, 1),
      perEnemyMinute: round(stalls / Math.max(0.001, enemySeconds) * 60, 2) },
    step: spread(step),
    common: common(drawn, where, delay),
  };
}

/** The windows an enemy's delay is first fitted over, ms; and how far its host twin must travel in one for a delay to show. */
const FIT_WINDOW_MS = 2000;
const FIT_TRAVEL_M = 1.5;
/** Each frame's own delay is then looked for this far either side of its window's, ms. */
const LAG_SEARCH_MS = 250;
/** A frame's delay only counts where its twin was moving at least this fast, m/s: a body standing still has no "when". */
const LAG_SPEED = 1;
/** A jump: in one frame, this much further than its twin's fastest speed nearby explains, and that much faster. */
const JUMP_M = 0.10;
const JUMP_SPEED = 3;
/** After a knockdown ends (on either screen) the copy is "rising" for this long: getting up and walking to the host's place, ms. */
const RISING_MS = 3000;
/** On the guest's screen for less than this: it has just come into view (they turned, or it walked in), ms. */
const ENTERED_MS = 1000;

/**
 * One yardstick for any lane, from the recordings alone: nothing here is what the netcode says of itself.
 *
 * Each frame an enemy is drawn somewhere. The host's twin walked a path. The point of that path nearest the drawn body
 * (looked for around the delay that fits the enemy's last 2 s best) says two things at once: **how old** the picture is
 * (when the twin was there: `lagMs`) and **how far off the path** the body is (`offPath`: it is somewhere the real one never
 * was). With the twin's moment known, the rest is what a player can see: frames it stood still or went backwards while
 * its twin walked on, frames it darted further than its twin's speed explains, and how far its speed is from its twin's.
 * `nowError` is the plain distance to where the host has it at that same instant: age and wobble together.
 *
 * Classes: `near` and `far` by the host's own rule at the twin's moment; `seen` is on the guest's screen (inside their
 * real field of view, any distance), `entered` on it for under a second, `unseen` off it. A knocked-down enemy is a
 * ragdoll on each screen's own physics, by design: `down` is those frames and `rising` the 3 s after, and neither is in
 * `all` or the other classes.
 */
function common(drawn, where, crowdDelay) {
  const bucket = () => ({ samples: 0, seconds: 0, lag: [], windows: [], now: [], off: [], wobble: [], yaw: [], speed: [], moving: 0, stallFrames: 0, stallMs: [], jumps: 0, worstJump: 0, backsteps: 0 });
  const B = { all: bucket(), near: bucket(), far: bucket(), seen: bucket(), entered: bucket(), unseen: bucket(), down: bucket(), rising: bucket() };
  const P = () => ({ x: 0, y: 0, z: 0, yaw: 0, far: 0, down: 0 });
  const h = P(), h0 = P(), a = P(), b = P(), c = P();
  const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
  // The jumps and the longer stalls themselves, for whoever wants to know what they were (times in ms from the first frame).
  const events = [];
  let t0 = Infinity;
  for (const track of drawn.values()) t0 = Math.min(t0, track[0].t);
  const fit = (uid, track, from, to) => {
    // Can a delay be seen at all? Only on a twin that goes somewhere.
    let travel = 0, last = null;
    for (let i = from; i < to; i += 2) {
      const p = where(uid, track[i].t - crowdDelay, a);
      if (!p) { last = null; continue; }
      if (last) travel += Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
      last = { x: p.x, y: p.y, z: p.z };
    }
    if (travel < FIT_TRAVEL_M) return null;
    const cost = d => {
      let sum = 0, n = 0;
      for (let i = from; i < to; i += 2) {
        const s = track[i], p = where(uid, s.t - d, a);
        if (p) { sum += Math.min(2, Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z)); n++; }
      }
      return n >= 10 ? sum / n : Infinity;
    };
    let bestD = null, best = Infinity;
    for (let d = 0; d <= 1200; d += 10) { const k = cost(d); if (k < best) { best = k; bestD = d; } }
    if (bestD === null) return null;
    for (let d = Math.max(0, bestD - 9); d <= bestD + 9; d += 1) { const k = cost(d); if (k < best) { best = k; bestD = d; } }
    return bestD;
  };
  const gap = (s, uid, tau) => { const p = where(uid, s.t - tau, a); return p ? Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) : Infinity; };
  /** The twin's velocity at host time `t`, over 50 ms, into `c`. False where the host has no record. */
  const velocity = (uid, t) => {
    const p0 = where(uid, t - 25, a), p1 = p0 && where(uid, t + 25, b);
    if (!p1) return false;
    c.x = (p1.x - p0.x) / 0.05; c.y = (p1.y - p0.y) / 0.05; c.z = (p1.z - p0.z) / 0.05;
    return true;
  };
  for (const [uid, track] of drawn) {
    const windows = [];
    for (let from = 0; from < track.length;) {
      let to = from;
      while (to < track.length && track[to].t - track[from].t < FIT_WINDOW_MS) to++;
      if (to < track.length && track.at(-1).t - track[to].t < FIT_WINDOW_MS / 2) to = track.length;
      windows.push({ from, to, d: fit(uid, track, from, to) });
      from = to;
    }
    const fitted = windows.map(w => w.d).filter(d => d !== null).sort((p, q) => p - q);
    const fallback = fitted.length ? fitted[fitted.length >> 1] : crowdDelay;
    let stall = null;   // { ms, keys } while it stands still
    const endStall = () => {
      if (!stall) return;
      for (const key of stall.keys) B[key].stallMs.push(stall.ms);
      if (stall.ms >= 50 && events.length < 400) events.push({ kind: 'stall', uid: stall.uid, t: stall.t, ms: Math.round(stall.ms), lagMs: stall.lagMs, far: stall.far, seen: stall.seen, in: stall.in, interval: stall.interval });
      stall = null;
    };
    let seenSince = -Infinity, unseenSince = -Infinity, wasSeen = null, downUntil = -Infinity;
    for (const w of windows) {
      const d = w.d ?? fallback;
      let nearN = 0, farN = 0;
      for (let i = w.from; i < w.to; i++) {
        const s = track[i];
        // On screen, and for how long (a moment off screen at its edge does not make it new again).
        if (s.seen !== wasSeen) { if (s.seen) { if (s.t - unseenSince > 300 || wasSeen === null) seenSince = wasSeen === null ? -Infinity : s.t; } else unseenSince = s.t; wasSeen = s.seen; }
        // The twin's moment: the point of its path nearest the drawn body, around the window's delay.
        let tau = d, best = gap(s, uid, d);
        for (let t = Math.max(0, d - LAG_SEARCH_MS); t <= d + LAG_SEARCH_MS; t += 10) { const g = gap(s, uid, t); if (g < best - 1e-9) { best = g; tau = t; } }
        for (let t = Math.max(0, tau - 9); t <= tau + 9; t += 1) { const g = gap(s, uid, t); if (g < best - 1e-9) { best = g; tau = t; } }
        if (!Number.isFinite(best) || !where(uid, s.t - tau, h)) { endStall(); continue; }
        // Knocked down, here or on the host: the body is a ragdoll on each screen's own physics, which is not this lane's
        // motion. Those frames, and the moments after while the copy walks back to the host's place, are kept apart.
        const downNow = s.down || h.down === 1;
        if (downNow) downUntil = s.t + RISING_MS;
        const keys = downNow ? ['down'] : s.t < downUntil ? ['rising'] : ['all', h.far ? 'far' : 'near', s.seen ? 'seen' : 'unseen'];
        if (keys.length > 1 && s.seen && s.t - seenSince < ENTERED_MS) keys.push('entered');
        if (keys.length > 1) { if (h.far) farN++; else nearN++; }
        const atWindow = gap(s, uid, d), yawError = turn(s.yaw, h.yaw) * 180 / Math.PI;
        const now = where(uid, s.t, h0) ? Math.hypot(s.x - h0.x, s.y - h0.y, s.z - h0.z) : NaN;
        const twinMoves = velocity(uid, s.t - tau);
        const vx = c.x, vy = c.y, vz = c.z, twinSpeed = twinMoves ? Math.hypot(vx, vy, vz) : 0;
        for (const key of keys) {
          const k = B[key];
          k.samples++; k.off.push(best); k.yaw.push(yawError);
          if (Number.isFinite(atWindow)) k.wobble.push(atWindow);
          if (Number.isFinite(now)) k.now.push(now);
          if (twinMoves && twinSpeed > LAG_SPEED) k.lag.push(tau);
        }
        const p = i > 0 ? track[i - 1] : null;
        // Two frames a few milliseconds apart (a page catching up after a hitch) say nothing about standing still.
        // Nor does the frame a ragdoll takes the body or hands it back: what is recorded changes there from the body's
        // middle to its feet, which is no movement.
        if (!p || s.t - p.t >= 120 || s.t - p.t < 4 || !twinMoves || p.down !== s.down) { endStall(); continue; }
        const dt = (s.t - p.t) / 1000;
        const gx = (s.x - p.x) / dt, gy = (s.y - p.y) / dt, gz = (s.z - p.z) / dt, guestSpeed = Math.hypot(gx, gy, gz);
        // The twin's fastest speed within 150 ms either side: what a frame's movement may fairly be.
        let fastest = twinSpeed;
        for (let k = -3; k < 3; k++) {
          const p0 = where(uid, s.t - tau + k * 50, a), p1 = p0 && where(uid, s.t - tau + (k + 1) * 50, b);
          if (p1) fastest = Math.max(fastest, Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) / 0.05);
        }
        const excess = (guestSpeed - fastest) * dt;
        const jumped = excess > JUMP_M && excess / dt > JUMP_SPEED;
        const twinWalks = twinSpeed > 0.5;
        const still = twinWalks && guestSpeed < 0.03;
        const back = twinWalks && guestSpeed * dt > 0.01 && gx * vx + gy * vy + gz * vz < 0;
        for (const key of keys) {
          const k = B[key];
          k.seconds += dt;
          k.speed.push(Math.hypot(gx - vx, gy - vy, gz - vz));
          if (jumped) { k.jumps++; k.worstJump = Math.max(k.worstJump, excess); }
          if (twinWalks) k.moving++;
          if (still) k.stallFrames++;
          if (back) k.backsteps++;
        }
        if (jumped && events.length < 400) events.push({ kind: 'jump', uid, t: Math.round(s.t - t0), cm: Math.round(excess * 100), dtMs: Math.round(dt * 1000), lagMs: tau, twinSpeed: round(twinSpeed, 1), fastest: round(fastest, 1),
          far: h.far, seen: s.seen, in: keys[0], interval: s.interval, intervalBefore: p.interval, playheadStepMs: round(s.playhead - p.playhead, 1) });
        if (still) { if (!stall) stall = { ms: 0, keys, uid, t: Math.round(s.t - t0), lagMs: tau, far: h.far, seen: s.seen, in: keys[0], interval: s.interval }; stall.ms += dt * 1000; } else endStall();
      }
      if (w.d !== null) { B.all.windows.push(w.d); if (!farN) B.near.windows.push(w.d); else if (!nearN) B.far.windows.push(w.d); }
    }
    endStall();
  }
  const report = k => {
    const minutes = Math.max(1e-9, k.seconds / 60);
    const stalledMs = k.stallMs.reduce((sum, ms) => sum + ms, 0);
    return {
      samples: k.samples, share: round(k.samples / Math.max(1, B.all.samples + B.down.samples + B.rising.samples), 3), enemySeconds: round(k.seconds, 1),
      lagMs: spread(k.lag), windowDelayMs: spread(k.windows), nowError: spread(k.now), offPath: spread(k.off), wobble: spread(k.wobble), yaw: spread(k.yaw), speedError: spread(k.speed),
      stall: { frames: k.stallFrames, movingFrames: k.moving, percent: round(100 * k.stallFrames / Math.max(1, k.moving)), events: k.stallMs.length,
        perEnemyMinute: round(k.stallMs.length / minutes), ms: spread(k.stallMs), msPerEnemyMinute: round(stalledMs / minutes, 1) },
      jumps: { count: k.jumps, perEnemyMinute: round(k.jumps / minutes), worst: round(k.worstJump, 3) },
      backsteps: { count: k.backsteps, perEnemyMinute: round(k.backsteps / minutes) },
    };
  };
  const out = { fitWindowMs: FIT_WINDOW_MS };
  for (const key of Object.keys(B)) out[key] = report(B[key]);
  out.events = events;
  return out;
}

export default async function (host, { sleep, outDir }, options = fromEnv()) {
  const { enemies: ENEMIES, net: NET, hostFps: HOST_FPS, seconds: SECONDS, tag: TAG, shots: SHOTS, strict: STRICT, guest: GUEST } = { ...fromEnv(), ...options };
  const out = { errors: [], checks: [], screenshots: [] };
  const name = `motion-${TAG}-${ENEMIES}e-${HOST_FPS || 60}fps-${NET ? NET.replace(/[^a-z0-9.]+/gi, '_') : 'clean'}`;
  const { check, progress, shot } = kit(outDir, name, out, sleep);
  let party;
  try {
    await host.addInitScript(capFrames, HOST_FPS);
    // Drawn, with sound: what is measured is what a player's page does (fast mode draws nothing, and the old build cannot be
    // told not to draw, so the two would not even be the same kind of page).
    party = await startParty(host, { mode: 'crucible', net: NET || undefined, look: true, out, progress, sleep });
    const { guest } = party;
    await live(party);
    // The wave director off, and a crowd of our own: melee chasers, gunmen who keep their distance, fast ones.
    await calm(host);
    await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 1e9; });
    const spawned = await host.evaluate(count => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      const kinds = ['husk', 'husk', 'trooper', 'husk', 'stalker'];
      let made = 0;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2, radius = 9 + (i % 4) * 2.5;
        const p = new V(s.position.x + Math.sin(angle) * radius, s.position.y, s.position.z + Math.cos(angle) * radius);
        const snapped = p.clone();
        if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
        if (ctx.enemies.spawn(kinds[i % kinds.length], p)) made++;
      }
      return made;
    }, ENEMIES);
    check(spawned === ENEMIES, `The host has its ${ENEMIES} enemies`, spawned);
    await host.evaluate(runInCircles, 0.55);
    // The guest in the fight, looking about (the default); `circles` is the first version: it runs its own circle and ends
    // up 40 to 70 m from the crowd, which is the far tier's case.
    if (GUEST === 'circles') await guest.evaluate(runInCircles, -0.4);
    else await guest.evaluate(`(${shadowHost})(14, 1.9, 7000)`);
    await guest.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, ENEMIES, { timeout: 30000 });
    // Players cannot die, enemies cannot either: the crowd stays whole for the recording.
    for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await sleep(4000);

    progress(`recording ${SECONDS} s: ${ENEMIES} enemies, host ${HOST_FPS || 'uncapped'} fps, net ${NET || 'clean'}`);
    await host.evaluate(record, SECONDS + 2); await guest.evaluate(record, SECONDS + 2);
    await resetNet(party.pages);
    const before = await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.stats, at: performance.now() }));
    await sleep(SECONDS * 1000);
    const after = await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.stats, at: performance.now() }));
    const hostNet = await netStats(host), guestNet = await netStats(guest);
    const [hostRec, guestRec] = [await host.evaluate(() => window.__motion.read()), await guest.evaluate(() => window.__motion.read())];
    // The recordings themselves, so the yardstick can be changed and the run measured again without running it again
    // (coop-motion-matrix.mjs --reanalyse).
    writeFileSync(`${outDir}/${name}.raw.json.gz`, gzipSync(JSON.stringify({ host: hostRec, guest: guestRec })));
    const result = analyse(hostRec, guestRec);
    const windowSeconds = (after.at - before.at) / 1000;
    const lanes = Object.entries(hostNet.lanes ?? {});
    result.bytes = {
      snapshotsPerSecond: Math.round((after.snapshotBytes - before.snapshotBytes) / windowSeconds),
      snapshotPacketsPerSecond: Math.round((after.snapshotPackets - before.snapshotPackets) / windowSeconds),
      eventsPerSecond: Math.round((after.eventBytes - before.eventBytes) / windowSeconds),
      hostAllLanesPerSecond: lanes.reduce((sum, [, lane]) => sum + (lane.out?.bytesPerSecond ?? 0), 0),
      worldLane: hostNet.lanes?.world ? { unreliable: hostNet.lanes.world.unreliable, out: hostNet.lanes.world.out, fallback: hostNet.lanes.world.fallback, skipped: hostNet.lanes.world.skipped } : null,
      guestWorldLane: guestNet.lanes?.world ? { in: guestNet.lanes.world.in, lossPercent: guestNet.lanes.world.lossPercent, late: guestNet.lanes.world.late, gap: guestNet.lanes.world.gap } : null,
    };
    // What the game itself says a frame costs on each page: a page that is cheap to run and still slow was starved by the
    // machine (or its window was not being drawn), and its numbers say nothing about the netcode.
    const cost = page => page.evaluate(() => { const s = window.__op2.stats(); return { fps: s.fps, cpuMs: s.cpuMs, hidden: document.hidden, visibility: document.visibilityState }; });
    result.run = { tag: TAG, enemies: ENEMIES, hostFpsCap: HOST_FPS, net: NET || 'clean', guest: GUEST, transport: party.transport, coopMs: hostNet.coopMs,
      host: await cost(host), guest: await cost(guest) };
    // A page that got few frames was starved by the machine (or its window was not being drawn): what it measured is the
    // machine. The matrix throws such a run away; a strict run fails on it.
    result.starved = result.guestFps < 40 || result.hostFps < (HOST_FPS ? HOST_FPS * 0.8 : 40);
    out.result = result;
    check(result.enemies >= ENEMIES * 0.9, 'The guest drew the crowd', result.enemies);
    check(result.stalls.movingFrames > 1000, 'The crowd was moving', result.stalls);
    if (SHOTS) {
      // For the pictures the guest stops and watches the crowd come past the host.
      await guest.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.input.simulate('forward', false);
        const look = () => {
          let x = 0, y = 0, z = 0, n = 0;
          for (const e of ctx.enemies.alive) { x += e.center.x; y += e.center.y; z += e.center.z; n++; }
          if (n) {
            const dx = x / n - ctx.player.eye.x, dy = y / n - ctx.player.eye.y, dz = z / n - ctx.player.eye.z;
            ctx.player.yaw = Math.atan2(-dx, -dz);
            ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
          }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      await sleep(1500);
      for (let i = 0; i < SHOTS; i++) { await shot(guest, `guest-${i}`); await sleep(120); }
    }
    if (STRICT) {
      check(!result.starved, 'The pages really ran (40 fps or more): the numbers are the netcode\'s, not the machine\'s', { host: result.hostFps, guest: result.guestFps, cost: result.run });
      const measured = result.declared?.error ?? result.error;
      check(measured.p50 <= LIMITS.errorP50, `An enemy is drawn within ${LIMITS.errorP50} m of the host's, half the time`, measured);
      check(measured.p95 <= LIMITS.errorP95, `... and within ${LIMITS.errorP95} m 95% of the time`, measured);
      check(result.stalls.perEnemyMinute <= LIMITS.stallsPerEnemyMinute, `An enemy stalls at most ${LIMITS.stallsPerEnemyMinute} time a minute`, result.stalls);
      check(result.bytes.snapshotsPerSecond <= LIMITS.snapshotBytes, `Snapshots stay under ${LIMITS.snapshotBytes} bytes a second for this guest`, result.bytes);
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
